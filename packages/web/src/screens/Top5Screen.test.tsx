import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry } from '@media-tracker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCardPng, saveImage, shareOrSave } from '../share/shareImage';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { friendsOf, makeFriendEntry, REN } from '../test/friends';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

vi.mock('../share/shareImage', async (orig) => ({
  ...(await orig<typeof import('../share/shareImage')>()),
  renderCardPng: vi.fn(),
  shareOrSave: vi.fn(),
  saveImage: vi.fn(),
}));

const rows = (): Entry[] => [
  makeEntry({ id: 'a1', category: 'anime', title: 'Frieren', creator: 'Madhouse', rating: 9.5, coverUrl: 'https://img.example/f.jpg' }),
  makeEntry({ id: 'a2', category: 'anime', title: 'Mushishi', creator: 'Artland', rating: 9 }),
  makeEntry({ id: 'a3', category: 'anime', title: 'Unrated one', rating: null }),
  makeEntry({ id: 'm1', category: 'movies', title: 'Heat', creator: 'Michael Mann', rating: 8.25 }),
  makeEntry({ id: 'al1', category: 'albums', title: 'Blonde', creator: 'Frank Ocean', rating: 9.4 }),
];

describe('Top 5 screen', () => {
  it('shows a block per enabled list in nav order with ranked, linked rows', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    expect(await screen.findByRole('heading', { level: 1, name: 'Top 5' })).toBeInTheDocument();
    await screen.findByRole('heading', { level: 2, name: 'Anime' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Anime', 'Movies', 'TV Shows', 'Albums', 'Songs', 'Games', 'Books', 'Manga', 'YouTube']);

    const anime = screen.getByRole('region', { name: 'Anime' });
    const items = within(within(anime).getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2); // the unrated one is left out
    const first = within(items[0]!).getByRole('link', { name: /^1\s+Frieren\s+Madhouse\s+Rating 9\.5$/ });
    expect(first).toHaveAttribute('href', '/entry/a1');
    expect(within(items[1]!).getByRole('link', { name: /^2\s+Mushishi\s+Artland\s+Rating 9\.0$/ })).toHaveAttribute('href', '/entry/a2');

    const movies = screen.getByRole('region', { name: 'Movies' });
    expect(within(movies).getByRole('link', { name: /Heat.*Rating 8\.25/ })).toBeInTheDocument();
  });

  it('says so, with a way on, for a list with nothing rated', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    const tv = await screen.findByRole('region', { name: 'TV Shows' });
    expect(within(tv).getByText('Nothing rated yet.')).toBeInTheDocument();
    expect(within(tv).getByRole('link', { name: 'Go to TV Shows' })).toHaveAttribute('href', '/list/tv');
  });

  it('leaves out a turned-off list', async () => {
    fakeBackend({ entries: rows(), me: makeMe({}, { albums: false }) });
    renderApp('/top5');
    await screen.findByRole('region', { name: 'Anime' });
    expect(screen.queryByRole('region', { name: 'Albums' })).not.toBeInTheDocument();
    expect(screen.queryByText('Blonde')).not.toBeInTheDocument();
  });

  it('shows a retry, not an empty state, when the lists cannot be loaded', async () => {
    let fail = true;
    mockApi(makeMe(), {
      'GET /api/entries': () => (fail ? { status: 500, body: { error: 'boom' } } : { body: rows().filter((e) => e.category === 'anime') }),
    });
    renderApp('/top5');
    expect(await screen.findByText("Couldn't load your lists")).toBeInTheDocument();
    expect(screen.queryByText('Nothing rated yet.')).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText("Couldn't load your lists")).not.toBeInTheDocument());
  });

  it('shows #1 as a poster card on a backdrop of its cover and 2-5 as compact rows; albums get square covers', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    const anime = await screen.findByRole('region', { name: 'Anime' });
    const [first, second] = within(anime).getAllByRole('listitem');
    expect(first).toHaveClass('top5__item--hero');
    expect(first!.querySelector('.backdrop img')).toHaveAttribute('src', 'https://img.example/f.jpg');
    expect(first!.querySelector('.cover--poster')).not.toBeNull();
    expect(second).not.toHaveClass('top5__item--hero');
    expect(second!.querySelector('.backdrop')).toBeNull();
    const albums = screen.getByRole('region', { name: 'Albums' });
    expect(albums.querySelector('.cover--square')).not.toBeNull();
    expect(albums.querySelector('.cover--poster')).toBeNull();
  });

  it('keeps the lists that loaded and offers a retry for the ones that did not', async () => {
    let failMovies = true;
    mockApi(makeMe(), {
      'GET /api/entries': (_b, url) => {
        const c = url.searchParams.get('category');
        if (c === 'movies' && failMovies) return { status: 500, body: { error: 'boom' } };
        return { body: rows().filter((e) => e.category === c) };
      },
    });
    renderApp('/top5');
    expect(await screen.findByText("Couldn't load some lists.")).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Anime' })).getByRole('link', { name: /Frieren/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Movies' })).getByText("Couldn't load Movies.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your lists")).not.toBeInTheDocument();
    failMovies = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText("Couldn't load some lists.")).not.toBeInTheDocument());
    expect(await within(await screen.findByRole('region', { name: 'Movies' })).findByRole('link', { name: /Heat/ })).toBeInTheDocument();
  });

  it('Back goes to Profile (B20), also when you came from there', async () => {
    fakeBackend({ entries: [makeEntry({ category: 'anime', rating: 8 })] });
    const { router } = renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
    await userEvent.click(await screen.findByRole('link', { name: 'My Top 5' }));
    await screen.findByRole('heading', { level: 1, name: 'Top 5' });
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
  });
});

describe('Top 5 sharing (B17)', () => {
  const card = new Blob(['png'], { type: 'image/png' });
  let revoked: string[];
  beforeEach(() => {
    revoked = [];
    vi.mocked(renderCardPng).mockResolvedValue(card);
    vi.mocked(shareOrSave).mockResolvedValue('shared');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:card-1' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (u: string) => revoked.push(u) });
  });
  afterEach(() => {
    vi.mocked(renderCardPng).mockReset();
    vi.mocked(shareOrSave).mockReset();
    vi.mocked(saveImage).mockReset();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  });

  it('each block with a rated title has "Share Anime Top 5"', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    const anime = await screen.findByRole('region', { name: 'Anime' });
    expect(within(anime).getByRole('button', { name: 'Share Anime Top 5' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Movies' })).getByRole('button', { name: 'Share Movies Top 5' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Albums' })).getByRole('button', { name: 'Share Albums Top 5' })).toBeInTheDocument();
  });

  it('a block with nothing rated has no Share', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    const tv = await screen.findByRole('region', { name: 'TV Shows' });
    expect(within(tv).queryByRole('button', { name: /^Share/ })).not.toBeInTheDocument();
  });

  it('heading text for a list is "My Anime Top 5"; the card gets its rated rows, ranks, username, theme and filename', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Share Anime Top 5' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share your Anime Top 5' });
    expect(await within(sheet).findByRole('img', { name: 'Preview of your My Anime Top 5 image' })).toHaveAttribute('src', 'blob:card-1');
    expect(renderCardPng).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(renderCardPng).mock.calls[0]![0];
    expect(arg.kind).toBe('top5');
    expect(arg.heading).toBe('My Anime Top 5');
    expect(arg.username).toBe('dan');
    expect(arg.colors.Background).toBeDefined();
    expect(arg.rows).toEqual([
      { rank: 1, title: 'Frieren', creator: 'Madhouse', rating: 9.5, square: false, coverUrl: 'https://img.example/f.jpg' },
      { rank: 2, title: 'Mushishi', creator: 'Artland', rating: 9, square: false, coverUrl: '' },
    ]);
  });

  it('"Share my #1s" opens the preview with heading "My #1s"; hidden when nothing is rated', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Share my #1s' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share your #1s' });
    expect(await within(sheet).findByRole('img', { name: 'Preview of your My #1s image' })).toBeInTheDocument();
    const arg = vi.mocked(renderCardPng).mock.calls[0]![0];
    expect(arg.kind).toBe('ones');
    expect(arg.heading).toBe('My #1s');
    // the #1 of every enabled list with a rated title, in nav order, labelled with its list
    expect(arg.rows.map((r) => [r.rank, r.listLabel, r.title, r.square])).toEqual([
      [1, 'Anime', 'Frieren', false], [1, 'Movies', 'Heat', false], [1, 'Albums', 'Blonde', true],
    ]);
  });

  it('"Share my #1s" is hidden when nothing is rated', async () => {
    fakeBackend({ entries: [makeEntry({ category: 'anime', title: 'Unrated', rating: null })] });
    renderApp('/top5');
    await screen.findByRole('region', { name: 'Anime' });
    expect(screen.queryByRole('button', { name: 'Share my #1s' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Share/ })).not.toBeInTheDocument();
  });

  it('Share opens the preview sheet; "Save image" saves it as top5-anime.png', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Share Anime Top 5' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share your Anime Top 5' });
    await within(sheet).findByRole('img');
    // jsdom has no navigator.canShare, so only Save image is offered
    expect(within(sheet).queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save image' }));
    expect(saveImage).toHaveBeenCalledWith(card, 'top5-anime.png');
    expect(await screen.findByText('Image saved')).toBeInTheDocument();
  });

  it('with Web Share for files, "Share" calls shareOrSave with the file name and title, and closes the sheet', async () => {
    vi.stubGlobal('navigator', Object.defineProperties(Object.create(navigator), { canShare: { value: () => true }, share: { value: vi.fn() }, userAgent: { value: navigator.userAgent }, maxTouchPoints: { value: 0 } }));
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Share my #1s' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share your #1s' });
    await within(sheet).findByRole('img');
    expect(within(sheet).getByRole('button', { name: 'Save image' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(shareOrSave).toHaveBeenCalledWith(card, 'my-number-ones.png', 'My #1s');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(revoked).toEqual(['blob:card-1']);
  });

  it('a share that throws toasts, keeps the sheet open and re-enables the buttons (no unhandled rejection)', async () => {
    vi.stubGlobal('navigator', Object.defineProperties(Object.create(navigator), { canShare: { value: () => true }, share: { value: vi.fn() }, userAgent: { value: navigator.userAgent }, maxTouchPoints: { value: 0 } }));
    vi.mocked(shareOrSave).mockRejectedValue(new Error('boom'));
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Share my #1s' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share your #1s' });
    await within(sheet).findByRole('img');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText("Couldn't share the image. Try Save image.")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Share your #1s' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Share' })).toBeEnabled();
  });

  it('closing the sheet revokes the preview URL', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Share Movies Top 5' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share your Movies Top 5' });
    await within(sheet).findByRole('img');
    expect(revoked).toEqual([]);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(revoked).toEqual(['blob:card-1']);
  });

  it('render failure toasts "Couldn\'t make the image. Try again."', async () => {
    vi.mocked(renderCardPng).mockRejectedValue(new Error('no canvas'));
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Share Anime Top 5' }));
    expect(await screen.findByText("Couldn't make the image. Try again.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Share Anime Top 5' })).toBeInTheDocument();
  });

  it('while the image is being made the sheet says so', async () => {
    vi.mocked(renderCardPng).mockReturnValue(new Promise(() => {}));
    fakeBackend({ entries: rows() });
    renderApp('/top5');
    await userEvent.click(await screen.findByRole('button', { name: 'Share Anime Top 5' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share your Anime Top 5' });
    expect(within(sheet).getByText('Making your image…')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Save image' })).not.toBeInTheDocument();
  });

  describe('Friends view (group Top 5)', () => {
    const friendRows = [{
      userId: 'id-ren',
      entries: [
        makeFriendEntry({ id: 'r1', title: 'Frieren', rating: 8.5, category: 'anime' }),
        makeFriendEntry({ id: 'r2', title: 'Mushishi', rating: 3, category: 'anime' }),
        makeFriendEntry({ id: 'r3', title: 'Only Ren', rating: 10, category: 'anime' }),
      ],
    }, {
      userId: 'id-mika',
      entries: [makeFriendEntry({ id: 'k1', userId: 'id-mika', title: 'Frieren', rating: 9, category: 'anime' })],
    }];
    const extra = (fe: unknown = friendRows, friends = friendsOf(REN)) => ({
      'GET /api/friends/entries': { body: fe },
      'GET /api/friends': { body: friends },
    }) as never;

    it('the toggle switches to group rows (rating badge, "3 ratings") and back, in the same row style as Mine', async () => {
      fakeBackend({ entries: [...rows(), makeEntry({ id: 'p1', title: 'Secret', rating: 9, isPrivate: true })], extra: extra() });
      renderApp('/top5');
      await screen.findByRole('region', { name: 'Anime' });
      expect(screen.getByRole('radiogroup', { name: 'Whose Top 5' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('radio', { name: 'Friends' }));
      const anime = await screen.findByRole('region', { name: 'Anime' });
      // you 9.5, Ren 8.5, Mika 9 -> 9.0 over 3; Mushishi: you 9 + Ren 3 -> 6.0 over 2
      await waitFor(() => expect(within(anime).getAllByRole('listitem')).toHaveLength(2));
      expect(within(anime).getAllByRole('listitem')[0]).toHaveTextContent(/Frieren\s*3 ratings\s*9\.0/);
      expect(within(anime).getAllByRole('listitem')[1]).toHaveTextContent(/Mushishi\s*2 ratings\s*6\.0/);
      expect(anime.querySelector('.top5__hero')).not.toBeNull(); // the #1 gets Mine's big card
      expect(anime.querySelectorAll('.top5__row')).toHaveLength(1);
      expect(screen.getByRole('radiogroup', { name: 'Whose Top 5' })).toHaveClass('seg--auto');
      expect(screen.queryByText('Only Ren')).not.toBeInTheDocument(); // one rater
      expect(screen.queryByText('Secret')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Share/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('radio', { name: 'Mine' }));
      expect(await screen.findByRole('button', { name: 'Share Anime Top 5' })).toBeInTheDocument();
    });

    it('group rows link to your entry if you have the title, else to the highest-rating friend\'s entry', async () => {
      const MIKA = { id: 'id-mika', username: 'mika', displayName: 'Mika', avatarAt: null };
      const fe = [
        { userId: 'id-ren', entries: [makeFriendEntry({ id: 'r1', title: 'Frieren', rating: 8.5 }), makeFriendEntry({ id: 'r9', title: 'Odd Taxi', rating: 7 })] },
        { userId: 'id-mika', entries: [makeFriendEntry({ id: 'k1', userId: 'id-mika', title: 'Frieren', rating: 9 }), makeFriendEntry({ id: 'k9', userId: 'id-mika', title: 'Odd Taxi', rating: 9.5 })] },
      ];
      fakeBackend({ entries: rows(), extra: extra(fe, friendsOf(REN, MIKA)) });
      renderApp('/top5');
      await userEvent.click(await screen.findByRole('radio', { name: 'Friends' }));
      const anime = await screen.findByRole('region', { name: 'Anime' });
      const taxi = await within(anime).findByRole('link', { name: /Odd Taxi, group average 8\.3 from 2 ratings/ });
      expect(taxi).toHaveAttribute('href', '/u/mika/entry/k9');
      const frieren = within(anime).getByRole('link', { name: /Frieren, group average/ });
      expect(frieren.getAttribute('href')).toMatch(/^\/entry\//); // you have it: your own page
    });

    it('a list with no title two of you rated says "Rate more together"', async () => {
      fakeBackend({ entries: rows(), extra: extra() });
      renderApp('/top5');
      await userEvent.click(await screen.findByRole('radio', { name: 'Friends' }));
      const movies = await screen.findByRole('region', { name: 'Movies' });
      expect(within(movies).getByText(/Rate more together/)).toBeInTheDocument();
    });

    it('no friends yet → "No friends yet" with Add friend', async () => {
      fakeBackend({ entries: rows(), extra: extra([], { friends: [], incoming: [], outgoing: [] }) });
      renderApp('/top5');
      await userEvent.click(await screen.findByRole('radio', { name: 'Friends' }));
      expect(await screen.findByRole('heading', { name: 'No friends yet' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add friend' })).toBeInTheDocument();
    });

    it('a failed friends load offers Retry', async () => {
      fakeBackend({ entries: rows(), extra: { 'GET /api/friends/entries': { status: 500, body: { error: 'x' } }, 'GET /api/friends': { body: friendsOf(REN) } } as never });
      renderApp('/top5');
      await userEvent.click(await screen.findByRole('radio', { name: 'Friends' }));
      expect(await screen.findByRole('heading', { name: "Couldn't load your friends' lists" })).toBeInTheDocument();
    });
  });
});
