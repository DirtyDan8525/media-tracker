import type { ReactElement } from 'react';
import type { Category } from '@media-tracker/shared';

export type IconName = Category | 'more' | 'search' | 'close' | 'back' | 'image' | 'plus' | 'upload' | 'settings' | 'info' | 'compare' | 'top5' | 'stats' | 'chevron'
  | 'activity' | 'palette' | 'check' | 'warning' | 'download' | 'user' | 'logout' | 'lists' | 'share' | 'tiers' | 'lock' | 'eye' | 'eye-off' | 'home' | 'chevron-down';

/** Stroke paths, 24×24 viewBox. The list icons match the mockups' bottom bar. */
const PATHS: Record<IconName, ReactElement> = {
  anime: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  movies: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 5v4M12 5v4M17 5v4" /></>,
  tv: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M8 21h8M9 3l3 3 3-3" /></>,
  albums: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /></>,
  songs: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  games: <><rect x="2.5" y="7" width="19" height="11" rx="4" /><path d="M7 10.5v4M5 12.5h4M15.5 12h.01M18 14h.01" /></>,
  books: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></>,
  manga: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 12h16M12 3v9M9 16h6" /></>,
  youtube: <><rect x="2.5" y="5" width="19" height="14" rx="4" /><path d="M10 9.5v5l4.5-2.5z" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  image: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 16l5-5 4 4 3-3 4 4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  compare: <path d="M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8" />,
  top5: <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4M8 20h8" /></>,
  chevron: <path d="M9 5l7 7-7 7" />,
  stats: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  lists: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1.2" /><circle cx="10" cy="7" r="1.2" /><circle cx="15" cy="7.5" r="1.2" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  warning: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>,
  tiers: <><path d="M12 3l9 4.5-9 4.5-9-4.5z" /><path d="M3 12l9 4.5 9-4.5" /><path d="M3 16.5l9 4.5 9-4.5" /></>,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  logout: <path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  home: <path d="M3 11l9-8 9 8M5 9.5V21h5v-6h4v6h5V9.5" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  share: <path d="M12 15V3M7 8l5-5 5 5M5 12v8h14v-8" />,
};

/** A decorative icon (always aria-hidden: the control around it carries the name). */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
