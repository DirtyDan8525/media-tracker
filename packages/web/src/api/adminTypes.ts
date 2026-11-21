import type { Category, PublicUser, SourceId } from '@media-tracker/shared';

/** Shapes of the /api/admin/* answers added in Phase 6c (mirrors packages/worker/src/api/admin.ts and lookup/adminTools.ts). */
export interface AdminComment {
  id: string;
  body: string;
  createdAt: string;
  author: PublicUser;
  entryId: string;
  title: string;
  category: Category;
  owner: string | null;
  image: boolean;
  expired: boolean;
}

export interface AdminNumbers {
  members: number;
  active7: number;
  titles7: number;
  messages7: number;
  mostRated: { title: string; category: Category; count: number; average: number }[];
}

export interface SourceCheck {
  source: SourceId;
  label: string;
  query: string;
  /** true ok, false failed, null not set up. */
  ok: boolean | null;
  ms: number;
  error?: string;
}

export interface TraceStep {
  source: SourceId;
  query: string;
  results: number;
  chosen?: string;
  reason?: string;
}

export interface Explanation {
  category: Category;
  title: string;
  steps: TraceStep[];
  found: string | null;
  cached: string | null;
}
