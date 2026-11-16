import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Entry } from '@media-tracker/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGOUT_PATH } from '../data/logout';
import { CURRENT_LIST_KEY } from '../shell/currentList';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { makeMe } from '../test/mockApi';
import { renderApp } from '../test/renderApp';
import { CropSheet } from './profile/AvatarEditor';
import { AvatarReadError, AvatarTooBigError, cropRect, initialCrop, makeAvatar, readImage, zoomAt } from './profile/avatarImage';

vi.mock('./profile/avatarImage', async (orig) => ({
  ...(await orig<typeof import('./profile/avatarImage')>()),
  readImage: vi.fn(),
  makeAvatar: vi.fn(),
}));

const bitmap = (w = 400, h = 300) => ({ width: w, height: h, close: vi.fn() }) as unknown as ImageBitmap;
const MADE = { type: 'image/webp' as const, data: 'UklGRgAAAABXRUJQ', blob: new Blob(['x'], { type: 'image/webp' }) };

beforeEach(() => {
  // jsdom has no 2D canvas: the crop sheet draws the photo and a small preview with it
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    { drawImage: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D,
  );
});

const rows = (): Entry[] => [
  makeEntry({ id: 'a1', category: 'anime', title: 'Frieren', rating: 9, coverUrl: 'https://img.example/frieren.jpg' }),
  makeEntry({ id: 'a2', category: 'anime', title: 'Mushishi', rating: 7, coverUrl: 'https://img.example/mushishi.jpg' }),
  makeEntry({ id: 'm1', category: 'movies', title: 'Heat', rating: 8.5, coverUrl: 'https://img.example/heat.jpg' }),
  makeEntry({ id: 'b1', category: 'books', title: 'Unrated book', rating: null }),
];
const ME = () => makeMe({ createdAt: '2026-11-06T12:00:00.000Z' });

describe('Profile: info, tiles, strip, rows', () => {
  it('shows @dan and "Member since November 2026" and no email', async () => {
    fakeBackend({ me: ME(), entries: rows() });
    renderApp('/profile');
    expect(await screen.findByText('@dan')).toBeInTheDocument();
    expect(screen.getByText('Member since November 2026')).toBeInTheDocument();
    expect(screen.queryByText(/dan@example\.com/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
  });

  it('tiles Titles 3 / Rated 2 / Avg 8.8 / Friends 0 (Avg is 9 and 8.5 over rated titles only)', async () => {
    fakeBackend({ me: ME(), entries: rows().filter((e) => e.id !== 'a2') });
    renderApp('/profile');
    await screen.findByText('@dan');
    const value = async (label: string) => (await screen.findByText(label)).closest('div')!.textContent;
    await waitFor(async () => expect(await value('Titles')).toBe('Titles3'));
    expect(await value('Rated')).toBe('Rated2');
    expect(await value('Avg')).toBe('Avg8.8');
    expect(await value('Friends')).toBe('Friends0');
  });

  it('Add friend toasts "Coming with friends"', async () => {
    fakeBackend({ me: ME() });
    renderApp('/profile');
    await userEvent.click(await screen.findByRole('button', { name: 'Add friend' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Coming with friends');
  });

  it('the banner uses the highest-rated cover', async () => {
    fakeBackend({ me: ME(), entries: rows() });
    const { container } = renderApp('/profile');
    await screen.findByText('@dan');
    await waitFor(() => expect(container.querySelector('.profile__banner .backdrop img')).toHaveAttribute('src', 'https://img.example/frieren.jpg'));
  });

  it('with no rated title that has a cover there is no backdrop', async () => {
    fakeBackend({ me: ME(), entries: [makeEntry({ category: 'anime', rating: 9, coverUrl: '' }), makeEntry({ category: 'movies', rating: null, coverUrl: 'https://img.example/x.jpg' })] });
    const { container } = renderApp('/profile');
    await screen.findByText('@dan');
    await screen.findByText('2'); // the lists loaded
    expect(container.querySelector('.backdrop')).toBeNull();
  });

  it("the My #1s strip links each list's #1 entry, labelled with the list name, and skips lists with nothing rated", async () => {
    fakeBackend({ me: ME(), entries: rows() });
    renderApp('/profile');
    const strip = await screen.findByRole('region', { name: 'My #1s' });
    await waitFor(() => expect(within(strip).getAllByRole('link')).toHaveLength(2));
    const [anime, movies] = within(strip).getAllByRole('link');
    expect(anime).toHaveAttribute('href', '/entry/a1');
    expect(anime).toHaveAccessibleName(/Anime.*Frieren/);
    expect(within(anime!).getByText('Anime')).toBeInTheDocument();
    expect(movies).toHaveAttribute('href', '/entry/m1');
    expect(within(strip).queryByText('Books')).not.toBeInTheDocument();
    expect(within(strip).queryByText('TV Shows')).not.toBeInTheDocument();
  });

  it('with nothing rated the strip says what it is for', async () => {
    fakeBackend({ me: ME() });
    renderApp('/profile');
    const strip = await screen.findByRole('region', { name: 'My #1s' });
    expect(await within(strip).findByText(/Rate something to see your #1/)).toBeInTheDocument();
  });

  it('rows link to /top5, /stats, /settings', async () => {
    fakeBackend({ me: ME() });
    renderApp('/profile');
    expect(await screen.findByRole('link', { name: 'My Top 5' })).toHaveAttribute('href', '/top5');
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('Back goes to the current list (history first)', async () => {
    localStorage.setItem(CURRENT_LIST_KEY, 'movies');
    fakeBackend({ me: ME() });
    const { router } = renderApp('/profile');
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/list/movies'));
  });
});

describe('Profile: photo', () => {
  const choose = async (file = new File(['x'], 'me.png', { type: 'image/png' })) => {
    const input = await screen.findByLabelText('Choose a photo', { selector: 'input' });
    await userEvent.upload(input, file);
  };

  it('no photo: the avatar is the initial "D"', async () => {
    fakeBackend({ me: ME() });
    const { container } = renderApp('/profile');
    await screen.findByText('@dan');
    expect(container.querySelector('.profile__photo .avatar')).toHaveTextContent('D');
    expect(container.querySelector('.profile__photo img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument();
  });

  it('a photo is requested as /api/me/avatar?v=<avatarAt>', async () => {
    const avatarAt = '2026-11-10T08:30:00.000Z';
    fakeBackend({ me: makeMe({ avatarAt, createdAt: '2026-11-06T12:00:00.000Z' }) });
    const { container } = renderApp('/profile');
    await screen.findByText('@dan');
    const img = container.querySelector('.profile__photo img')!;
    expect(img).toHaveAttribute('src', `/api/me/avatar?v=${encodeURIComponent(avatarAt)}`);
    expect(img).toHaveAttribute('alt', '');
    fireEvent.error(img);
    expect(container.querySelector('.profile__photo img')).toBeNull();
    expect(container.querySelector('.profile__photo .avatar')).toHaveTextContent('D');
  });

  it('choosing a file opens the crop sheet; Use photo shows the preview; Save PUTs {type, data} and the avatar becomes an img', async () => {
    let me = ME();
    const { calls } = fakeBackend({
      me,
      extra: {
        'GET /api/me': () => ({ body: me }),
        'PUT /api/me/avatar': () => { me = { ...me, avatarAt: '2026-11-15T10:00:00.000Z' }; return { body: me }; },
      },
    });
    vi.mocked(readImage).mockResolvedValue(bitmap());
    vi.mocked(makeAvatar).mockResolvedValue(MADE);
    const { container } = renderApp('/profile');
    await choose();
    const crop = await screen.findByRole('dialog', { name: 'Crop photo' });
    expect(within(crop).getByRole('slider', { name: 'Zoom' })).toBeInTheDocument();
    await userEvent.click(within(crop).getByRole('button', { name: 'Use photo' }));

    expect(makeAvatar).toHaveBeenCalledOnce();
    expect(vi.mocked(makeAvatar).mock.calls[0]![1]).toEqual({ sx: 50, sy: 0, side: 300 });
    const preview = await screen.findByRole('dialog', { name: 'Your new photo' });
    expect(within(preview).getByRole('img', { name: 'Preview of your new photo' })).toHaveAttribute('src', `data:image/webp;base64,${MADE.data}`);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false); // nothing saved until Save

    await userEvent.click(within(preview).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path === '/api/me/avatar')?.body).toEqual({ type: 'image/webp', data: MADE.data }));
    expect(await screen.findByText('Photo saved')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.profile__photo img')).toHaveAttribute('src', `/api/me/avatar?v=${encodeURIComponent('2026-11-15T10:00:00.000Z')}`));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a failed save keeps the preview and says so', async () => {
    fakeBackend({ me: ME(), extra: { 'PUT /api/me/avatar': { status: 500, body: { error: 'boom' } } } });
    vi.mocked(readImage).mockResolvedValue(bitmap());
    vi.mocked(makeAvatar).mockResolvedValue(MADE);
    renderApp('/profile');
    await choose();
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Crop photo' })).getByRole('button', { name: 'Use photo' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Your new photo' })).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Couldn't save your photo. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Your new photo' })).toBeInTheDocument();
  });

  it('shows "Reading photo…" while a large photo decodes, then opens the crop sheet', async () => {
    fakeBackend({ me: ME() });
    let done!: (b: ImageBitmap) => void;
    vi.mocked(readImage).mockReturnValue(new Promise<ImageBitmap>((r) => { done = r; }));
    renderApp('/profile');
    await choose();
    const busy = await screen.findByRole('button', { name: 'Reading photo…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    done(bitmap());
    await screen.findByRole('dialog', { name: 'Crop photo' });
    expect(screen.queryByRole('button', { name: 'Reading photo…' })).not.toBeInTheDocument();
  });

  it('a read error toasts "Couldn\'t read that image. Try a JPEG or PNG." and opens no sheet', async () => {
    fakeBackend({ me: ME() });
    vi.mocked(readImage).mockRejectedValue(new AvatarReadError());
    renderApp('/profile');
    await choose(new File(['x'], 'me.heic', { type: 'image/heic' }));
    expect(await screen.findByText("Couldn't read that image. Try a JPEG or PNG.")).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a photo that will not shrink under the limit says so', async () => {
    fakeBackend({ me: ME() });
    vi.mocked(readImage).mockResolvedValue(bitmap());
    vi.mocked(makeAvatar).mockRejectedValue(new AvatarTooBigError());
    renderApp('/profile');
    await choose();
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Crop photo' })).getByRole('button', { name: 'Use photo' }));
    expect(await screen.findByText('That photo has too much detail to shrink. Try another.')).toBeInTheDocument();
  });

  it('Cancel closes the crop sheet without saving', async () => {
    const { calls } = fakeBackend({ me: ME() });
    const image = bitmap();
    vi.mocked(readImage).mockResolvedValue(image);
    renderApp('/profile');
    await choose();
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Crop photo' })).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(image.close).toHaveBeenCalled();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('Remove photo DELETEs and goes back to the initial', async () => {
    let me = makeMe({ avatarAt: '2026-11-10T08:30:00.000Z', createdAt: '2026-11-06T12:00:00.000Z' });
    const { calls } = fakeBackend({
      me,
      extra: { 'GET /api/me': () => ({ body: me }), 'DELETE /api/me/avatar': () => { me = { ...me, avatarAt: null }; return { body: me }; } },
    });
    const { container } = renderApp('/profile');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/me/avatar')).toBe(true));
    expect(await screen.findByText('Photo removed')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.profile__photo img')).toBeNull());
    expect(container.querySelector('.profile__photo .avatar')).toHaveTextContent('D');
  });
});

describe('Profile: Log out', () => {
  it("calls location.assign('/cdn-cgi/access/logout')", async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    fakeBackend({ me: ME() });
    renderApp('/profile');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(assign).toHaveBeenCalledExactlyOnceWith(LOGOUT_PATH));
    expect(LOGOUT_PATH).toBe('/cdn-cgi/access/logout');
  });
});

describe('CropSheet', () => {
  const IMG = { width: 4000, height: 3000, close: vi.fn() } as unknown as ImageBitmap;
  const setup = () => {
    const onUse = vi.fn();
    render(<CropSheet image={IMG} onUse={onUse} onCancel={vi.fn()} />);
    const view = screen.getByRole('group', { name: /Photo crop area/ });
    return { onUse, view, use: () => fireEvent.click(screen.getByRole('button', { name: 'Use photo' })) };
  };
  const usedRect = (onUse: ReturnType<typeof vi.fn>) => onUse.mock.calls.at(-1)![0] as { sx: number; sy: number; side: number };

  it('the live preview is drawn from the downscaled photo canvas, never the full-size bitmap', () => {
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      { drawImage: draw, clearRect: vi.fn(), fillRect: vi.fn() } as unknown as CanvasRenderingContext2D,
    );
    const { view } = setup();
    fireEvent.keyDown(view, { key: 'ArrowLeft' });
    const nineArg = draw.mock.calls.filter((c) => c.length === 9);
    expect(nineArg.length).toBeGreaterThan(1); // drawn again after the pan
    for (const c of nineArg) expect(c[0]).toBeInstanceOf(HTMLCanvasElement);
    // the full bitmap is only used for the one-off paint of the photo canvas
    expect(draw.mock.calls.filter((c) => c[0] === IMG)).toHaveLength(1);
    // source rect is in canvas pixels: the photo canvas is 4000 * (1120 / 3000) wide, so the side at 1x is 3000 * that
    const [, , , sw] = nineArg[0]!;
    expect(sw).toBeCloseTo(3000 * (1120 / 3000), 0);
  });

  it('stays square when the sheet is narrower than 280 px (320 px phones)', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
    try {
      const { onUse, view } = setup();
      expect(view).toHaveStyle({ width: '240px', height: '240px' });
      fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use photo' }));
      const before = usedRect(onUse);
      fireEvent.keyDown(view, { key: 'ArrowLeft' });
      fireEvent.click(screen.getByRole('button', { name: 'Use photo' }));
      // 10 viewport px at a 240 px viewport (not 280)
      expect(usedRect(onUse).sx - before.sx).toBeCloseTo(10 / ((240 / 3000) * 2), 3);
    } finally {
      spy.mockRestore();
    }
  });

  it('starts centred at 1x', () => {
    const { onUse, use } = setup();
    use();
    expect(usedRect(onUse)).toEqual({ sx: 500, sy: 0, side: 3000 });
  });

  it('the Zoom slider and ArrowLeft on the viewport change the rect passed to onUse', () => {
    const { onUse, view, use } = setup();
    const slider = screen.getByRole('slider', { name: 'Zoom' });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '4');

    fireEvent.change(slider, { target: { value: '2' } });
    use();
    const zoomed = usedRect(onUse);
    const expected = cropRect(zoomAt(initialCrop(4000, 3000, 280), 2, 140, 140, 4000, 3000, 280), 4000, 3000, 280);
    expect(zoomed.side).toBeCloseTo(1500, 3);
    expect(zoomed).toEqual(expected);

    view.focus();
    fireEvent.keyDown(view, { key: 'ArrowLeft' }); // the photo moves 10 px left, so the window moves right
    use();
    const panned = usedRect(onUse);
    expect(panned.side).toBeCloseTo(zoomed.side, 6);
    expect(panned.sx).toBeGreaterThan(zoomed.sx);
    expect(panned.sx - zoomed.sx).toBeCloseTo(10 / ((280 / 3000) * 2), 3);
    expect(panned.sy).toBe(zoomed.sy);

    fireEvent.keyDown(view, { key: 'ArrowDown' });
    use();
    expect(usedRect(onUse).sy).toBeLessThan(panned.sy); // the photo moves down, the window up
  });

  it('arrow keys never pan past the edge (no gap)', () => {
    const { onUse, view, use } = setup();
    for (let i = 0; i < 60; i++) fireEvent.keyDown(view, { key: 'ArrowRight' });
    use();
    expect(usedRect(onUse).sx).toBe(0);
  });

  it('a pointer drag (pointerdown/move/up) moves the crop', () => {
    const { onUse, view, use } = setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    use();
    const before = usedRect(onUse);
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 80, clientY: 90 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 80, clientY: 90 });
    use();
    const after = usedRect(onUse);
    const srcPerPx = 1 / ((280 / 3000) * 2);
    expect(after.sx - before.sx).toBeCloseTo(20 * srcPerPx, 3);
    expect(after.sy - before.sy).toBeCloseTo(10 * srcPerPx, 3);
    // moves after the pointer is up do nothing
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 0, clientY: 0 });
    use();
    expect(usedRect(onUse)).toEqual(after);
  });

  it('two pointers moving apart zoom in (pinch)', () => {
    const { onUse, view, use } = setup();
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 120, clientY: 140 });
    fireEvent.pointerDown(view, { pointerId: 2, clientX: 160, clientY: 140 });
    fireEvent.pointerMove(view, { pointerId: 2, clientX: 200, clientY: 140 });
    use();
    expect(usedRect(onUse).side).toBeLessThan(3000);
  });

  it('the mouse wheel zooms around the cursor, deltaY < 0 in', () => {
    const { onUse, view, use } = setup();
    fireEvent.wheel(view, { deltaY: -100, clientX: 140, clientY: 140 });
    use();
    expect(usedRect(onUse).side).toBeCloseTo(3000 / 1.1, 3);
    fireEvent.wheel(view, { deltaY: 100, clientX: 140, clientY: 140 });
    use();
    expect(usedRect(onUse).side).toBeCloseTo(3000, 3);
  });
});
