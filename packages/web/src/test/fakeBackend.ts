import { findDuplicate, type Details, type Entry, type LookupInfo, type Season } from '@media-tracker/shared';
import { makeMe, mockApi, type Call, type Handler, type MockResponse } from './mockApi';
import type { Me } from '../api/types';

let n = 0;
export function makeEntry(over: Partial<Entry> = {}): Entry {
  n++;
  return {
    id: `e${n}`, userId: 'u1', category: 'anime', title: `Title ${n}`, typedTitle: '', status: null, rating: null, genres: '',
    creator: '', album: '', coverUrl: '', notes: '', releaseDate: '', synopsis: '', lengthLabel: '', origin: '',
    detailsState: 'none', isPrivate: false, notesPrivate: false, source: null, sourceId: null, lookupState: 'ok', importId: null,
    seasonAvg: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
  };
}

// 'kitsu', not 'anilist': AniList lookups and details run on the device, so a server-answered match is Kitsu's.
export function makeInfo(over: Partial<LookupInfo> = {}): LookupInfo {
  return { title: 'Official', trusted: true, cover: 'https://img.example/cover.jpg', genres: 'Adventure, Fantasy', creator: 'Madhouse', source: 'kitsu', sourceId: '154587', ...over };
}

export const DETAILS: Details = { releaseDate: '2023-09-29', synopsis: 'An elf outlives her party.', lengthLabel: '28 ep · 24 min', origin: 'TV' };

type Reply = MockResponse | Promise<MockResponse>;
export interface BackendOptions {
  me?: Me;
  entries?: Entry[];
  seasons?: Season[];
  /** Answers POST /api/lookup (body = the lookup query). Default: nothing found. */
  lookup?: (body: { category: string; term: string; typedTitle: string; hint: string }) => Reply;
  details?: (body: { source: string; sourceId: string }) => Reply;
  /** Return a response to fail a PATCH /api/entries/:id (id, body); undefined lets it through. */
  /** More routes ("METHOD /path" keys), e.g. the import endpoints. */
  extra?: Record<string, Handler | MockResponse>;
  patchFail?: (id: string, body: Record<string, unknown>) => MockResponse | undefined;
}

/** An in-memory stand-in for the Worker's entries, seasons and lookup routes. */
export function fakeBackend(opts: BackendOptions = {}) {
  const entries = [...(opts.entries ?? [])];
  const seasons = [...(opts.seasons ?? [])];
  const avg = (id: string): number | null => {
    const r = seasons.filter((s) => s.entryId === id && s.rating !== null).map((s) => s.rating as number);
    return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 100) / 100 : null;
  };
  const view = (e: Entry): Entry => ({ ...e, seasonAvg: avg(e.id) });
  const calls: Call[] = mockApi(opts.me ?? makeMe(), {
    'GET /api/entries': (_b, url) => {
      const c = url.searchParams.get('category');
      return { body: entries.filter((e) => !c || e.category === c).map(view) };
    },
    'GET /api/entries/:id': (_b, _u, p) => {
      const e = entries.find((x) => x.id === p.id);
      return e ? { body: view(e) } : { status: 404, body: { error: 'not_found' } };
    },
    'POST /api/entries': (b) => {
      const body = b as Partial<Entry> & { category: Entry['category']; title: string };
      const entry = makeEntry({ typedTitle: body.title, lookupState: 'pending', ...body });
      const duplicateOf = findDuplicate(entries, { id: entry.id, title: entry.title, creator: entry.creator }, entry.category);
      entries.push(entry);
      return { status: 201, body: { entry: view(entry), duplicateOf } };
    },
    'PATCH /api/entries/:id': (b, _u, p) => {
      const body = b as Record<string, unknown>;
      const fail = opts.patchFail?.(p.id!, body);
      if (fail) return fail;
      const i = entries.findIndex((x) => x.id === p.id);
      if (i < 0) return { status: 404, body: { error: 'not_found' } };
      entries[i] = { ...entries[i]!, ...body } as Entry;
      return { body: view(entries[i]!) };
    },
    'DELETE /api/entries/:id': (_b, _u, p) => {
      const i = entries.findIndex((x) => x.id === p.id);
      if (i < 0) return { status: 404, body: { error: 'not_found' } };
      entries.splice(i, 1);
      return { status: 204 };
    },
    'GET /api/entries/:id/seasons': (_b, _u, p) => ({ body: seasons.filter((s) => s.entryId === p.id) }),
    'POST /api/entries/:id/seasons': (b, _u, p) => {
      const s: Season = { id: `s${seasons.length + 1}-${Math.random().toString(36).slice(2, 6)}`, entryId: p.id!, label: '', rating: null, notes: '', ...(b as object) };
      seasons.push(s);
      return { status: 201, body: s };
    },
    'PATCH /api/seasons/:id': (b, _u, p) => {
      const i = seasons.findIndex((x) => x.id === p.id);
      if (i < 0) return { status: 404, body: { error: 'not_found' } };
      seasons[i] = { ...seasons[i]!, ...(b as object) };
      return { body: seasons[i] };
    },
    'DELETE /api/seasons/:id': (_b, _u, p) => {
      const i = seasons.findIndex((x) => x.id === p.id);
      if (i >= 0) seasons.splice(i, 1);
      return { status: 204 };
    },
    'POST /api/lookup': (b) => (opts.lookup ? opts.lookup(b as never) : { body: { info: null } }),
    'POST /api/lookup/details': (b) => (opts.details ? opts.details(b as never) : { body: { details: null } }),
    ...opts.extra,
  });
  return { calls, entries, seasons };
}
