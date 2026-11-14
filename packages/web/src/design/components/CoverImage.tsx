import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export interface CoverImageProps {
  src: string | null | undefined;
  /** Required: e.g. "Frieren cover". The fallback carries the same name. */
  alt: string;
  /** Albums and songs are square; everything else is a 2:3 poster. */
  square?: boolean;
  /** Width in px (height follows the aspect ratio). Default 56, the v2 phone list row. */
  width?: number;
  className?: string;
}

export function CoverImage({ src, alt, square, width = 56, className }: CoverImageProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const cls = ['cover', square ? 'cover--square' : 'cover--poster', className].filter(Boolean).join(' ');
  if (!src || failed) {
    return (
      <div role="img" aria-label={alt} className={`${cls} cover--fallback`} style={{ width }}>
        <Icon name="image" size={Math.min(20, Math.round(width * 0.4))} />
      </div>
    );
  }
  return (
    <img className={cls} src={src} alt={alt} width={width} loading="lazy" decoding="async"
      referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ width }} />
  );
}
