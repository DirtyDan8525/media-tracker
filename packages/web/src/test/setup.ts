import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetAuthState } from '../api/auth';
import { localDb } from '../db/local';
import { setViewportWidth } from './viewport';

beforeEach(async () => {
  setViewportWidth(390);
  sessionStorage.clear();
  resetAuthState();
  await localDb.delete();
  await localDb.open();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('style');
});
