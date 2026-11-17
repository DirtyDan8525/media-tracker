/**
 * The ratings module. Number-first (docs/plans/2026-11-16-phase5-number-first.md): `close.ts`
 * decides every shown score from the typed numbers and the picks between close titles. Pure: the
 * device and the Worker run the same code, so both always agree on a score. The tier modules
 * (tiers, score, fit, shown) remain for the stored `tier` column (Profile and Stats counts) and for
 * reading 3c-era rows in the one-time backfill.
 */
export * from './types';
export * from './tiers';
export * from './score';
export * from './fit';
export * from './shown';
export * from './close';
