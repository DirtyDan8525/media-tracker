/**
 * The ratings module (spec §3, §5.2): tiers, the prior, the Bradley-Terry fit, the shown-score
 * rule, question choice, placement and the rating session. Pure: the device and the Worker run the
 * same code, so both always agree on a score.
 *
 * A title's TIER IS STORED EXPLICITLY (`tier`) and is never re-derived from an unchanged number.
 * Only a newly typed number picks a tier (`applyTyped` → `tierFor`); moves, Re-tier and tier
 * choices set it directly. Shown scores are capped below the next tier's lower bound (see
 * `shownValue`), but a locked title keeps whatever it was typed as, and old stored values may
 * predate the cap, so `tierFor(rating)` is not a reliable way to find a title's tier. Callers
 * (Worker PATCH and save routes, Tasks 6/7; entry form, Task 13) must treat a request whose
 * rating equals the stored rating as "no rating edit", never as a re-type that re-derives the tier.
 */
export * from './types';
export * from './tiers';
export * from './score';
export * from './fit';
export * from './shown';
export * from './questions';
export * from './session';
