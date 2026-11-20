import { useEffect, useState } from 'react';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { Sheet } from '../../design/components/Sheet';
import { Skeleton } from '../../design/components/Skeleton';
import { useToast } from '../../design/components/Toast';
import { canShareImage, renderCardPng, saveImage, shareOrSave, type CardSpec } from '../../share/shareImage';

export interface ShareRequest {
  /** The sheet's title: "Share your Anime Top 5" / "Share your #1s" (boards). */
  sheetTitle: string;
  card: CardSpec;
  /** `top5-<category>.png` / `my-number-ones.png`. */
  filename: string;
  /** The Web Share title: "My Anime Top 5" / "My #1s". */
  shareTitle: string;
}

export const SHARE_FAILED = "Couldn't share the image. Try Save image.";
export const RENDER_FAILED = "Couldn't make the image. Try again.";

/**
 * B17 preview: makes the PNG on open, shows it, then offers Share (only where the browser can share
 * files; the tap here gives Web Share the fresh user activation it needs) and Save image (download).
 * The preview's object URL is revoked when the sheet closes.
 */
export function ShareSheet({ request, onClose }: { request: ShareRequest; onClose: () => void }) {
  const toast = useToast();
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canShare = canShareImage();

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    renderCardPng(request.card).then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
      },
      () => {
        if (!live) return;
        toast.show(RENDER_FAILED);
        onClose();
      },
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // One render per opened sheet: the request is fixed while it is open.
  }, [request]); // toast and onClose are only called, never read for the render

  const share = async () => {
    if (!image) return;
    setBusy(true);
    try {
      const result = await shareOrSave(image.blob, request.filename, request.shareTitle);
      if (result === 'saved') toast.show('Image saved');
      if (result === 'shared') onClose();
    } catch {
      // Anything unexpected (shareOrSave handles cancel and share failures itself): tell the person, keep the sheet open.
      toast.show(SHARE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!image) return;
    saveImage(image.blob, request.filename);
    toast.show('Image saved');
  };

  const footer = image ? (
    <div className="share-sheet__actions">
      {canShare && (
        <Button variant="primary" disabled={busy} onClick={() => void share()}>
          <Icon name="share" size={18} />Share
        </Button>
      )}
      <Button variant={canShare ? 'secondary' : 'primary'} disabled={busy} onClick={save}>
        <Icon name="download" size={18} />Save image
      </Button>
    </div>
  ) : undefined;

  return (
    <Sheet open title={request.sheetTitle} onClose={onClose} footer={footer}>
      <div className="share-sheet__preview" aria-busy={!image}>
        {image ? (
          <img className="share-sheet__image" src={image.url} alt={`Preview of your ${request.card.heading} image`}
            width={1080} height={1350} />
        ) : (
          <>
            <Skeleton width="100%" height="100%" radius={12} />
            <p className="share-sheet__making" role="status">Making your image…</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
