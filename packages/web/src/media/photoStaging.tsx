import { GIF_MAX_BYTES } from '@media-tracker/shared';
import { useCallback, useEffect, useState } from 'react';
import { IconButton } from '../design/components/IconButton';
import { Sheet } from '../design/components/Sheet';
import { useToast } from '../design/components/Toast';
import { resizeImage } from '../screens/messages/resizeImage';
import '../design/media.css';

/**
 * Picking a photo or GIF to send, shared by the chat's composer and the comment box (Dan, 2026-11-20): the file is prepared
 * (photos resized to 1600 px JPEG, no EXIF; GIFs as they are, up to 8 MB), waits staged with a preview and a ✕, and Send sends it.
 */

/** A GIF by its type or its first bytes (GIF87a / GIF89a). */
export async function isGif(file: Blob): Promise<boolean> {
  if (file.type === 'image/gif') return true;
  try {
    const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
    return head.length === 6 && String.fromCharCode(...head).startsWith('GIF8') && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61;
  } catch { return false; }
}

export interface StagedPhoto { blob: Blob; url: string }

/** The `accept` of the hidden file input. */
export const PHOTO_ACCEPT = 'image/*,image/gif';

/** The blob to upload for a chosen file, or the sentence to tell the person when it can't be sent. */
export async function preparePhoto(file: File): Promise<{ blob: Blob } | { error: string }> {
  if (await isGif(file)) {
    // A GIF goes as it is: resizing would flatten it to one frame.
    if (file.size > GIF_MAX_BYTES) return { error: 'That GIF is too big to send (max 8 MB).' };
    return { blob: file.type === 'image/gif' ? file : new Blob([file], { type: 'image/gif' }) };
  }
  try {
    // Resized (longest side 1600 px) and re-encoded: the copy carries no EXIF or location.
    return { blob: await resizeImage(file) };
  } catch {
    return { error: "That file isn't a photo that can be sent." };
  }
}

/** The staged picture and what to do with it: `stage(file)` prepares and shows it (a toast says why when it can't), `clear()` is the ✕. */
export function usePhotoStaging(): { staged: StagedPhoto | null; stage: (file: File | undefined) => Promise<boolean>; clear: () => void } {
  const toast = useToast();
  const [staged, setStaged] = useState<StagedPhoto | null>(null);
  useEffect(() => () => { if (staged?.url) URL.revokeObjectURL(staged.url); }, [staged]);
  const stage = useCallback(async (file: File | undefined) => {
    if (!file) return false;
    const r = await preparePhoto(file);
    if ('error' in r) { toast.show(r.error); return false; }
    let url = '';
    try { url = URL.createObjectURL(r.blob); } catch { /* no preview, still sendable */ }
    setStaged({ blob: r.blob, url });
    return true;
  }, [toast]);
  const clear = useCallback(() => setStaged(null), []);
  return { staged, stage, clear };
}

/** The preview above the field, with its ✕. */
export function StagedPhotoPreview({ staged, onRemove }: { staged: StagedPhoto; onRemove: () => void }) {
  return (
    <div className="composer__staged" role="group" aria-label="Photo to send">
      <span className="composer__staged-img">
        <img src={staged.url} alt="Photo to send" />
        <IconButton label="Remove photo" icon="close" look="plain" className="composer__staged-remove" onClick={onRemove} />
      </span>
    </div>
  );
}

/** The full-size picture in a sheet (chat pictures and comment pictures). Render it only while there is something to show. */
export function PictureViewer({ src, alt, onClose }: { src: string | null; alt: string; onClose: () => void }) {
  return (
    <Sheet open={src !== null} title="Picture" onClose={onClose}>
      {src && <img className="chat__full" src={src} alt={alt} />}
    </Sheet>
  );
}
