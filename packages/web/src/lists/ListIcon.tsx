import { isBuiltinCategory, type Category } from '@media-tracker/shared';
import { Icon } from '../design/components/Icon';
import { listCfg } from './registry';

/** A list's icon: the built-in glyph, a custom list's emoji, or the generic list glyph when it has none. */
export function ListIcon({ c, size = 18 }: { c: Category; size?: number }) {
  if (isBuiltinCategory(c)) return <Icon name={c} size={size} />;
  const emoji = listCfg(c).icon;
  if (!emoji) return <Icon name="lists" size={size} />;
  return <span className="list-emoji" aria-hidden="true" style={{ fontSize: Math.round(size * 0.9), lineHeight: 1, width: size, display: 'inline-flex', justifyContent: 'center' }}>{emoji}</span>;
}
