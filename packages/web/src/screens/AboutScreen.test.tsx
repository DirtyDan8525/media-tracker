import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { localDb } from '../db/local';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

describe('AboutScreen', () => {
  it('renders the exact copy', async () => {
    mockApi(makeMe());
    renderApp('/about');
    expect(await screen.findByRole('heading', { level: 1, name: 'WELCOME TO MEDIA TRACKER' })).toBeInTheDocument();
    expect(screen.getByText('Created by Dan')).toBeInTheDocument();
    expect(screen.getByText(
      'Hey! I got tired of keeping track of everything I watch, listen to, play and read across a bunch of different websites and random notes apps, so I made this to keep it all in one spot. Just type in a title, give it a rating, and it fills in the cover and the rest for you.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      "I'm super hyped that other people might actually use this. Make it yours, fill it up with your favorite stuff, and let's compare and share what we love!",
    )).toBeInTheDocument();
    expect(screen.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.')).toBeInTheDocument();
    expect(screen.getByText('Game data from IGDB.com.')).toBeInTheDocument();
  });

  it('v2: fans out your top-rated covers from the device cache (no fetches) and blurs the #1 behind the top', async () => {
    const entries = [
      makeEntry({ title: 'A', rating: 9, coverUrl: 'https://img.example/a.jpg' }),
      makeEntry({ title: 'B', rating: 10, category: 'movies', coverUrl: 'https://img.example/b.jpg' }),
      makeEntry({ title: 'C', rating: 8, coverUrl: 'https://img.example/c.jpg' }),
      makeEntry({ title: 'D', rating: 7, coverUrl: 'https://img.example/d.jpg' }),
      makeEntry({ title: 'E', rating: 6, coverUrl: 'https://img.example/e.jpg' }),
      makeEntry({ title: 'F', rating: null, coverUrl: 'https://img.example/f.jpg' }),
    ];
    await localDb.entries.bulkPut(entries);
    const { calls } = fakeBackend({ entries });
    renderApp('/about');
    await screen.findByRole('heading', { level: 1, name: 'WELCOME TO MEDIA TRACKER' });
    const fan = () => [...document.querySelectorAll<HTMLImageElement>('.about__fan img')].map((i) => i.getAttribute('src'));
    await waitFor(() => expect(fan()).toEqual(['https://img.example/d.jpg', 'https://img.example/c.jpg', 'https://img.example/a.jpg', 'https://img.example/b.jpg']));
    expect(document.querySelector('.about__fan')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.backdrop img')).toHaveAttribute('src', 'https://img.example/b.jpg');
    expect(calls.filter((c) => c.path.startsWith('/api/entries'))).toEqual([]);
  });

  it('v2: no rated covers, no fan and no backdrop', async () => {
    mockApi(makeMe());
    renderApp('/about');
    await screen.findByText('Created by Dan');
    expect(document.querySelector('.about__fan')).not.toBeInTheDocument();
    expect(document.querySelector('.backdrop')).not.toBeInTheDocument();
  });
});
