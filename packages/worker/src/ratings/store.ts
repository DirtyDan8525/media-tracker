import {
  priorFromScore,
  tierFor,
  tierRange,
  tiersFor,
  type Category,
  type Tier,
  type TierSet,
  type UserSettings,
} from '@media-tracker/shared';

/** The rating fields of a row as the model needs them, from a rating alone (Ruling Q10). */
export function tierFieldsFor(rating: number, tiers: TierSet): { tier: Tier; priorMean: number; strength: number } {
  const tier = tierFor(rating, tiers);
  const priorMean = priorFromScore(rating, tierRange(tiers, tier));
  return { tier, priorMean, strength: priorMean };
}

/**
 * The lazy backfill (Ruling Q10): gives every rated row of the user that has no tier yet its
 * tier, prior and strength (= prior) from its list's tiers. Season rows use their entry's list.
 * `rating` is never written, so every shown score stays exactly as it was.
 *
 * 2 queries when there is nothing to do (one batch of 2 SELECTs), else 4 (plus a batch of ≤ 2
 * UPDATEs, each with its rows as one JSON parameter). Returns the number of rows assigned.
 */
export async function ensureTiers(db: D1Database, userId: string, settings: Pick<UserSettings, 'tiers'>): Promise<number> {
  const [e, s] = await db.batch([
    db.prepare('SELECT id, category, rating FROM entries WHERE user_id = ? AND rating IS NOT NULL AND tier IS NULL').bind(userId),
    db.prepare(
      `SELECT s.id, e.category, s.rating FROM seasons s JOIN entries e ON e.id = s.entry_id
        WHERE e.user_id = ? AND s.rating IS NOT NULL AND s.tier IS NULL`,
    ).bind(userId),
  ]);
  type Pending = { id: string; category: Category; rating: number };
  const rows = (r: D1Result | undefined) => ((r?.results ?? []) as Pending[]).map((p) => {
    const f = tierFieldsFor(p.rating, tiersFor(settings, p.category));
    return { id: p.id, tier: f.tier, prior: f.priorMean };
  });
  const entryRows = rows(e), seasonRows = rows(s);
  const stmts: D1PreparedStatement[] = [];
  const pick = `SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.tier') AS tier,
                       json_extract(value, '$.prior') AS prior FROM json_each(?1)`;
  if (entryRows.length > 0) {
    stmts.push(db.prepare(
      `UPDATE entries SET tier = j.tier, prior_mean = j.prior, strength = j.prior FROM (${pick}) AS j
        WHERE entries.id = j.id AND entries.user_id = ?2 AND entries.tier IS NULL AND entries.rating IS NOT NULL`,
    ).bind(JSON.stringify(entryRows), userId));
  }
  if (seasonRows.length > 0) {
    stmts.push(db.prepare(
      `UPDATE seasons SET tier = j.tier, prior_mean = j.prior, strength = j.prior FROM (${pick}) AS j
        WHERE seasons.id = j.id AND seasons.tier IS NULL AND seasons.rating IS NOT NULL
          AND seasons.entry_id IN (SELECT id FROM entries WHERE user_id = ?2)`,
    ).bind(JSON.stringify(seasonRows), userId));
  }
  if (stmts.length > 0) await db.batch(stmts);
  return entryRows.length + seasonRows.length;
}
