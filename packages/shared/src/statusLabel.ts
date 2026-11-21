import { customListOf, type CustomList, type StatusWords } from './customLists';
import { isBuiltinCategory, type BuiltinCategory, type Category, type Status } from './types';

type Verbs = { active: string; again: string; plan: string; done?: string };

const READ: Verbs = { active: 'Reading', again: 'Rereading', plan: 'Plan to read' };
const PLAY: Verbs = { active: 'Playing', again: 'Replaying', plan: 'Plan to play' };

const VERBS: Partial<Record<BuiltinCategory, Verbs>> = {
  games: PLAY,
  books: READ,
  manga: READ,
  // Videos keep the watch wording; only a finished one says Watched.
  youtube: { active: 'Watching / In Progress', again: 'Rewatching', plan: 'Plan to watch', done: 'Watched' },
};

/** A custom list's chosen words ('watch' keeps the stored wording, like Anime and TV). */
const WORDS: Record<StatusWords, Verbs | undefined> = {
  watch: undefined,
  read: READ,
  play: PLAY,
  try: { active: 'Trying', again: 'Going again', plan: 'Want to try', done: 'Been' },
};

/**
 * What to show the user for a stored status on a given list. Display only: the stored value
 * (STATUSES), the API, URL filters and imports never change. Anime, TV and lists without a Status
 * column keep the stored wording. A custom list's words come from `lists` (its owner's custom lists).
 */
export function statusLabel(status: Status, category: Category, lists?: Iterable<CustomList> | ReadonlyMap<string, CustomList>): string {
  const v = isBuiltinCategory(category) ? VERBS[category] : WORDS[customListOf(category, lists)?.statusWords ?? 'watch'];
  if (!v) return status;
  switch (status) {
    case 'Watching / In Progress': return v.active;
    case 'Rewatching': return v.again;
    case 'Plan to watch': return v.plan;
    case 'Completed': return v.done ?? status;
    default: return status;
  }
}

/** The words of a feed line around the title: "<who> <verb> <title><suffix>". */
export interface StatusSentence { verb: string; suffix: string }

type Family = 'watch' | 'read' | 'play' | 'try';

function familyOf(category: Category, lists?: Iterable<CustomList> | ReadonlyMap<string, CustomList>): Family {
  if (isBuiltinCategory(category)) return category === 'games' ? 'play' : category === 'books' || category === 'manga' ? 'read' : 'watch';
  return customListOf(category, lists)?.statusWords ?? 'watch';
}

/**
 * How the Activity feed phrases a status change ("started Elden Ring", "finished Frieren", "dropped X",
 * "wants to read X"). `own` picks "You want to" over "Ren wants to". Display only, like statusLabel.
 */
export function statusSentence(
  status: Status,
  category: Category,
  own: boolean,
  lists?: Iterable<CustomList> | ReadonlyMap<string, CustomList>,
): StatusSentence {
  const f = familyOf(category, lists);
  switch (status) {
    case 'Watching / In Progress': return { verb: 'started', suffix: '' };
    case 'Rewatching':
      return f === 'play' ? { verb: own ? 'are replaying' : 'is replaying', suffix: '' }
        : f === 'try' ? { verb: own ? 'are going back to' : 'is going back to', suffix: '' }
        : { verb: f === 'read' ? 'started rereading' : 'started rewatching', suffix: '' };
    case 'Completed': return { verb: 'finished', suffix: '' };
    case 'Dropped': return { verb: 'dropped', suffix: '' };
    case 'Plan to watch': return { verb: `${own ? 'want' : 'wants'} to ${f === 'watch' ? 'watch' : f === 'read' ? 'read' : f === 'play' ? 'play' : 'try'}`, suffix: '' };
    default: return { verb: 'put', suffix: ' on hold' };
  }
}
