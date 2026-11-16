import type { FriendEntry } from '@media-tracker/shared';

let n = 0;
/** A friend's entry as GET /api/users/:u/entries answers it. */
export function makeFriendEntry(over: Partial<FriendEntry> = {}): FriendEntry {
  n++;
  return {
    id: `fe${n}`, userId: 'id-ren', category: 'anime', title: `Their title ${n}`, status: null, rating: null, tier: null, genres: '', creator: '',
    album: '', coverUrl: '', releaseDate: '', synopsis: '', lengthLabel: '', origin: '', detailsState: 'none', source: null, sourceId: null,
    seasonAvg: null, createdAt: '2026-01-01T00:00:00Z', notes: null, ...over,
  };
}

export const REN = { id: 'id-ren', username: 'ren', displayName: 'Ren', avatarAt: null };
export const friendsOf = (...us: (typeof REN)[]) => ({
  friends: us.map((u) => ({ ...u, since: '2026-11-03T10:00:00Z' })), incoming: [], outgoing: [],
});
