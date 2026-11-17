import type { Category, Status } from './types';

type Verbs = { active: string; again: string; plan: string };

const VERBS: Partial<Record<Category, Verbs>> = {
  games: { active: 'Playing', again: 'Replaying', plan: 'Plan to play' },
  books: { active: 'Reading', again: 'Rereading', plan: 'Plan to read' },
  manga: { active: 'Reading', again: 'Rereading', plan: 'Plan to read' },
};

/**
 * What to show the user for a stored status on a given list. Display only: the stored value
 * (STATUSES), the API, URL filters and imports never change. Anime, TV and lists without a Status
 * column keep the stored wording.
 */
export function statusLabel(status: Status, category: Category): string {
  const v = VERBS[category];
  if (!v) return status;
  switch (status) {
    case 'Watching / In Progress': return v.active;
    case 'Rewatching': return v.again;
    case 'Plan to watch': return v.plan;
    default: return status;
  }
}
