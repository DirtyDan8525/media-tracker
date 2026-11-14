/**
 * A blurred, scaled-up copy of a cover under a Background (or Cards, with `backdrop--card`) scrim.
 * Decorative only: hidden from assistive tech, and only Text / Bright text may sit on top of it.
 * The parent must be `position: relative` (or use `.has-backdrop`) and clip its overflow.
 */
export function CoverBackdrop({ src, className }: { src: string | null | undefined; className?: string }) {
  if (!src) return null;
  return (
    <div className={['backdrop', className].filter(Boolean).join(' ')} aria-hidden="true">
      <img src={src} alt="" decoding="async" referrerPolicy="no-referrer" />
    </div>
  );
}
