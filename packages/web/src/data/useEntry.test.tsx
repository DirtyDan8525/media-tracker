import type { Entry } from '@media-tracker/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { makeEntry } from '../test/fakeBackend';
import { mockFetch } from '../test/mockApi';
import { makeQueryClient } from '../test/queryClient';
import { useEntry } from './useEntry';

/** A row as a pre-3c Worker (or a stale cache) sends it: no tier fields at all. */
function pre3c(over: Partial<Entry> = {}): Entry {
  const { tier: _t, priorMean: _p, strength: _s, scoreLocked: _l, ...rest } = makeEntry({ id: 'old', rating: 8.5, ...over });
  return rest as Entry;
}

describe('useEntry', () => {
  it('reads a pre-3c row as unrated-tier and unlocked (Review Focus 1)', async () => {
    mockFetch({ 'GET /api/entries/old': { body: pre3c() } });
    const qc = makeQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useEntry('old'), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe('old'));
    expect(result.current.data).toMatchObject({ rating: 8.5, tier: null, priorMean: null, strength: null, scoreLocked: false });
  });

  it('normalizes the placeholder taken from a cached list too', async () => {
    mockFetch({ 'GET /api/entries/old': () => new Promise(() => {}) as never });
    const qc = makeQueryClient();
    qc.setQueryData(['entries', 'anime'], [pre3c()]);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useEntry('old'), { wrapper });
    await waitFor(() => expect(result.current.data?.id).toBe('old'));
    expect(result.current.data).toMatchObject({ tier: null, scoreLocked: false });
  });
});
