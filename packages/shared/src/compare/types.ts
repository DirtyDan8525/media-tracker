import type { COMPARE_ROOM, COMPARE_STYLE } from '../types';

/** 'a' = the first item passed to the question is better. */
export type Answer = 'a' | 'b' | 'same' | 'skip' | 'stop';
export type CompareStyle = (typeof COMPARE_STYLE)[number];
export type CompareRoom = (typeof COMPARE_ROOM)[number];

export interface CompareOptions { style: CompareStyle; room: CompareRoom; window: number }

export interface CompareItem { id: string; title: string; rating: number | null; cover: string; square: boolean; isNew?: boolean }

/** One new rating. `old` is null for a new item (the script shows '—'). */
export interface RatingChange { id: string; title: string; old: number | null; isNew: boolean; rating: number }
