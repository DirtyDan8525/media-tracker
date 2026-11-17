import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { ME_KEY } from '../data/useMe';
import { makeMe } from '../test/mockApi';
import { makeQueryClient } from '../test/queryClient';
import { CURRENT_LIST_KEY, forgetCurrentList, rememberList, resolveCurrentList, useCurrentList } from './currentList';

function setup(tabs: Partial<Record<string, boolean>> = {}) {
  const qc = makeQueryClient();
  qc.setQueryData(ME_KEY, makeMe({}, tabs));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useCurrentList(), { wrapper });
}

beforeEach(() => localStorage.clear());

describe('resolveCurrentList', () => {
  it('uses a stored enabled list, else the first enabled, else null', () => {
    expect(resolveCurrentList('books', ['anime', 'books'])).toBe('books');
    expect(resolveCurrentList(null, ['movies', 'books'])).toBe('movies');
    expect(resolveCurrentList('nonsense', ['movies'])).toBe('movies');
    expect(resolveCurrentList('anime', [])).toBeNull();
  });
});

describe('useCurrentList', () => {
  it('nothing stored → first enabled', () => {
    expect(setup().result.current).toBe('anime');
  });

  it('stored list turned off → first enabled', () => {
    localStorage.setItem(CURRENT_LIST_KEY, 'books');
    expect(setup({ books: false }).result.current).toBe('anime');
  });

  it('all lists off → null', () => {
    const off = { anime: false, movies: false, tv: false, albums: false, songs: false, games: false, books: false, manga: false, youtube: false };
    expect(setup(off).result.current).toBeNull();
  });

  it('rememberList updates subscribers and storage; forgetCurrentList clears it', () => {
    const { result } = setup();
    act(() => rememberList('books'));
    expect(result.current).toBe('books');
    expect(localStorage.getItem(CURRENT_LIST_KEY)).toBe('books');
    act(() => forgetCurrentList());
    expect(result.current).toBe('anime');
    expect(localStorage.getItem(CURRENT_LIST_KEY)).toBeNull();
  });
});
