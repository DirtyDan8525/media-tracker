import type { AvatarType } from '@media-tracker/shared';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '../../design/components/Button';
import { Sheet } from '../../design/components/Sheet';
import { clampCrop, cropRect, initialCrop, MAX_SCALE, MIN_SCALE, zoomAt, type CropState } from './avatarImage';
import '../../design/nav.css';

/** The square viewport, in CSS px (B11). */
export const CROP_VIEW = 280;
const KEY_STEP = 10;
const WHEEL_BASE = 1.1;
/** The photo is painted to a canvas no bigger than this on its short side: sharp at 4x, light on memory. */
const PAINT_SHORT_SIDE = CROP_VIEW * MAX_SCALE;
const PREVIEW = 48;

export type CropRect = { sx: number; sy: number; side: number };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Crop sheet (PhotoCrop board): a 280 px square window over the photo. Drag to move, pinch (two
 * pointers) or the mouse wheel to zoom, the "Zoom" slider, and on the focused window the arrow keys
 * move the photo 10 px a press (+ and - zoom), so nothing needs a pointer. The photo always covers
 * the square, and a circle shows what the round avatar will show.
 */
export function CropSheet({ image, onUse, onCancel }: { image: ImageBitmap; onUse: (rect: CropRect) => void; onCancel: () => void }) {
  const { width: w, height: h } = image;
  const zoomId = useId();
  const [crop, setCrop] = useState<CropState>(() => initialCrop(w, h, CROP_VIEW));
  const viewRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const fit = CROP_VIEW / Math.min(w, h); // viewport px per photo px at zoom 1
  const paint = Math.min(1, PAINT_SHORT_SIDE / Math.min(w, h));

  useEffect(() => {
    const canvas = photoRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }, [image]);

  const rect = cropRect(crop, w, h, CROP_VIEW);
  useEffect(() => {
    const canvas = previewRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, rect.sx, rect.sy, rect.side, rect.side, 0, 0, canvas.width, canvas.height);
    }
  }, [image, rect.sx, rect.sy, rect.side]);

  const pan = useCallback((dx: number, dy: number) => setCrop((c) => clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, w, h, CROP_VIEW)), [w, h]);
  const zoomTo = useCallback((next: (c: CropState) => number, fx = CROP_VIEW / 2, fy = CROP_VIEW / 2) =>
    setCrop((c) => zoomAt(c, next(c), fx, fy, w, h, CROP_VIEW)), [w, h]);

  // The wheel listener is native and not passive: React's onWheel can't stop the page from scrolling.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo((c) => c.scale * WHEEL_BASE ** (-e.deltaY / 100), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  const local = (e: PointerEvent) => {
    const r = viewRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    const others = [...pointers.current].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
    pointers.current.set(e.pointerId, cur);
    if (others.length === 0) {
      pan(cur.x - prev.x, cur.y - prev.y);
      return;
    }
    // Pinch: the two pointers' midpoint drags the photo, their distance ratio zooms around the midpoint.
    const other = others[0]!;
    const [m0, m1] = [mid(prev, other), mid(cur, other)];
    const d0 = dist(prev, other);
    const ratio = d0 > 0 ? dist(cur, other) / d0 : 1;
    setCrop((c) => zoomAt({ ...c, x: c.x + m1.x - m0.x, y: c.y + m1.y - m0.y }, c.scale * ratio, m1.x, m1.y, w, h, CROP_VIEW));
  }

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP],
    };
    const step = move[e.key];
    if (step) pan(step[0], step[1]);
    else if (e.key === '+' || e.key === '=') zoomTo((c) => c.scale + 0.25);
    else if (e.key === '-' || e.key === '_') zoomTo((c) => c.scale - 0.25);
    else return;
    e.preventDefault();
  }

  return (
    <Sheet open title="Crop photo" onClose={onCancel}
      footer={
        <div className="crop__actions">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onUse(rect)}>Use photo</Button>
        </div>
      }>
      <div className="crop">
        <div ref={viewRef} className="crop__viewport" role="group" tabIndex={0}
          aria-label="Photo crop area. Arrow keys move the photo, plus and minus zoom"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}>
          <canvas ref={photoRef} className="crop__photo" aria-hidden="true"
            width={Math.max(1, Math.round(w * paint))} height={Math.max(1, Math.round(h * paint))}
            style={{ width: w * fit, height: h * fit, transform: `translate(${crop.x}px, ${crop.y}px) scale(${crop.scale})` }} />
          <span className="crop__ring" aria-hidden="true" />
        </div>
        <p className="crop__hint">Drag to move. Pinch, scroll or use the slider to zoom.</p>
        <div className="crop__preview">
          <span className="crop__preview-dot" aria-hidden="true">
            <canvas ref={previewRef} width={PREVIEW * 2} height={PREVIEW * 2} />
          </span>
          <span className="crop__preview-text">Preview of your profile picture</span>
        </div>
        <div className="crop__zoom">
          <label htmlFor={zoomId}>Zoom</label>
          <input id={zoomId} className="crop__slider" type="range" min={MIN_SCALE} max={MAX_SCALE} step={0.1}
            value={crop.scale} aria-valuetext={`${crop.scale.toFixed(1)} times`}
            onChange={(e) => zoomTo(() => Number(e.target.value))} />
          <span className="crop__zoom-value" aria-hidden="true">{crop.scale.toFixed(1)}×</span>
        </div>
      </div>
    </Sheet>
  );
}

/** What the person is about to save: shown at its real look before anything is sent. */
export function PhotoPreviewSheet({ photo, saving, onSave, onCancel }: {
  photo: { type: AvatarType; data: string };
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open title="Your new photo" onClose={onCancel}
      footer={
        <div className="crop__actions">
          <Button onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={saving} aria-busy={saving}>Save</Button>
        </div>
      }>
      <div className="photo-preview">
        <img className="photo-preview__img" src={`data:${photo.type};base64,${photo.data}`} width={112} height={112}
          alt="Preview of your new photo" />
        <p className="crop__hint">This is how your photo will look.</p>
      </div>
    </Sheet>
  );
}
