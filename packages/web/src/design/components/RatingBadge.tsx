import { ratingColor, type CfSet } from '@media-tracker/shared';
import { useCfSet } from '../ThemeContext';

/** The rating box: one decimal, colored low→mid→high by the theme's CF set. */
export function RatingBadge({ rating, cf, size = 'md' }: { rating: number | null; cf?: CfSet; size?: 'sm' | 'md' }) {
  const ctxCf = useCfSet();
  const set = cf ?? ctxCf;
  if (rating === null) {
    return <span className={`rating rating--${size} rating--none`} aria-label="Unrated">–</span>;
  }
  const text = rating.toFixed(1);
  return (
    <span className={`rating rating--${size}`} aria-label={`Rating ${text}`} style={{ background: ratingColor(rating, set) }}>
      {text}
    </span>
  );
}
