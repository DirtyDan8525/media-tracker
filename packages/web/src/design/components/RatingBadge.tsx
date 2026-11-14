import { formatRating, ratingColor, type CfSet } from '@media-tracker/shared';
import type { ReactNode } from 'react';
import { labelColorOn } from '../theme';
import { useCfSet, useThemeColors } from '../ThemeContext';

export type RatingBadgeSize = 'xs' | 'sm' | 'md' | 'lg';

export interface RatingBadgeProps {
  rating: number | null;
  cf?: CfSet;
  size?: RatingBadgeSize;
  className?: string;
  /** What to show inside instead of the plain number (e.g. a CountUp); the accessible name stays "Rating 9.5". */
  children?: ReactNode;
}

/**
 * The rating box: one decimal (two when the rating has them). Its fill comes from the theme's rating
 * scale (ratingColor low → mid → high); its label is the theme role that keeps 4.5:1 on that fill.
 */
export function RatingBadge({ rating, cf, size = 'md', className, children }: RatingBadgeProps) {
  const ctxCf = useCfSet();
  const colors = useThemeColors();
  const cls = ['rating', `rating--${size}`, className].filter(Boolean).join(' ');
  if (rating === null) {
    return <span className={`${cls} rating--none`} aria-label="Unrated">–</span>;
  }
  const text = formatRating(rating);
  const fill = ratingColor(rating, cf ?? ctxCf);
  return (
    <span className={cls} aria-label={`Rating ${text}`} style={{ background: fill, color: labelColorOn(fill, colors) }}>
      {children ?? text}
    </span>
  );
}
