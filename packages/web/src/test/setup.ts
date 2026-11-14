import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { resetPacing } from '@media-tracker/shared';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetAuthState } from '../api/auth';
import { localDb } from '../db/local';
import { flags } from './flags';
import { setViewportWidth } from './viewport';

// features.ts holds build-time constants; tests read them through live getters so a test can flip them.
vi.mock('../features', () => ({
  get COMPARE_ENABLED() { return flags.compare; },
}));

beforeEach(async () => {
  flags.compare = false;
  setViewportWidth(390);
  sessionStorage.clear();
  resetAuthState();
  await localDb.delete();
  await localDb.open();
});

afterEach(() => {
  cleanup();
  resetPacing(); // the AniList pacing gap is per page load, not per test
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
});
