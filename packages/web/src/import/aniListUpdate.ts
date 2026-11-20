import type { Entry, ImportRow } from '@media-tracker/shared';
import type { QueryClient } from '@tanstack/react-query';
import { saveEntryChange } from '../data/entryMutations';

/** What the person chose for a title that is on their list and on AniList. */
export type ConflictChoice = 'mine' | 'anilist' | 'both';

/** Work to do after the import: update entries the person already had. Not part of the import's Undo. */
export interface AfterImport {
  total: number;
  /** Runs the updates one after another; a failure never stops the rest. */
  run: (onProgress: (done: number) => void) => Promise<{ updated: number; failed: string[] }>;
}

/**
 * The PATCH body for "Use AniList": AniList's status, score, progress and total, dates and rewatches
 * (only the ones AniList has, and only when they differ); notes only when yours are empty; the AniList
 * source id when yours has none. Empty when nothing would change.
 */
export function buildAniListPatch(mine: Entry, row: ImportRow): Partial<Entry> {
  const p: Partial<Entry> = {};
  if (row.status && row.status !== mine.status) p.status = row.status;
  if (row.rating !== null && row.rating !== undefined && row.rating !== (mine.typed ?? mine.rating)) p.rating = row.rating;
  if (typeof row.progressTotal === 'number' && row.progressTotal !== mine.progressTotal) p.progressTotal = row.progressTotal;
  if (typeof row.progress === 'number' && row.progress !== mine.progress) {
    const total = p.progressTotal ?? mine.progressTotal;
    p.progress = typeof total === 'number' ? Math.min(row.progress, total) : row.progress;
  }
  if (row.startedAt && row.startedAt !== mine.startedAt) p.startedAt = row.startedAt;
  if (row.finishedAt && row.finishedAt !== mine.finishedAt) p.finishedAt = row.finishedAt;
  if (typeof row.rewatches === 'number' && row.rewatches !== (mine.rewatches ?? 0)) p.rewatches = row.rewatches;
  if (!mine.notes.trim() && row.notes.trim()) p.notes = row.notes;
  if (!mine.source && row.source && row.sourceId) { p.source = row.source; p.sourceId = row.sourceId; }
  if (p.progress === mine.progress) delete p.progress;
  return p;
}

/** Applies "Use AniList" to each pair, sequentially, through the normal entry PATCH (it writes the caches). */
export function aniListUpdates(qc: QueryClient, pairs: { mine: Entry; row: ImportRow }[]): AfterImport {
  return {
    total: pairs.length,
    async run(onProgress) {
      let updated = 0;
      const failed: string[] = [];
      for (let i = 0; i < pairs.length; i++) {
        const { mine, row } = pairs[i]!;
        const patch = buildAniListPatch(mine, row);
        if (Object.keys(patch).length === 0) { onProgress(i + 1); continue; }
        const saved = await saveEntryChange(qc, mine, patch);
        if (saved) updated++; else failed.push(mine.title);
        onProgress(i + 1);
      }
      return { updated, failed };
    },
  };
}
