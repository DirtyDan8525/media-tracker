import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
