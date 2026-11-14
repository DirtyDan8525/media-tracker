import { THEMES } from '@media-tracker/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contrast } from '../../design/theme';
import { makeMe, mockApi, type Call } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';

const css = (name: string) => document.documentElement.style.getPropertyValue(name);
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT' && c.path === '/api/me/settings').map((c) => c.body);
const themeName = (theme: string, colors: Record<string, string> = {}) => {
  const me = makeMe();
  return makeMe({ settings: { ...me.settings, theme, colors } });
};
const ratio = (a: string, b: string) => (Math.floor(contrast(a, b) * 10) / 10).toFixed(1);

describe('Settings: theme picker', () => {
  it('offers the 12 themes in order, then Custom, with the current one checked', async () => {
    mockApi(themeName('Sakura'));
    renderApp('/settings');
    const group = await screen.findByRole('radiogroup', { name: 'Theme' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual([...Object.keys(THEMES), 'Custom']);
    expect(within(group).getByRole('radio', { name: 'Sakura' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Midnight' })).not.toBeChecked();
    expect(screen.queryByRole('heading', { name: 'Custom colours' })).not.toBeInTheDocument();
  });

  it('picking Ocean saves it and applies its colours', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'Ocean' }));
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { theme: 'Ocean' } }]));
    await waitFor(() => expect(css('--bg')).toBe('#0f1c2b'));
    expect(screen.getByRole('radio', { name: 'Ocean' })).toBeChecked();
  });

  it('picking Custom with no saved colours starts from the theme on screen', async () => {
    const calls = mockApi(themeName('Sakura'));
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'Custom' }));
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { theme: 'Custom', colors: THEMES.Sakura } }]));
    expect(await screen.findByRole('heading', { name: 'Custom colours' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Background hex' })).toHaveValue('#fff7f9');
    expect(css('--bg')).toBe('#fff7f9');
  });

  it('picking Custom again keeps the colours saved before', async () => {
    const calls = mockApi(themeName('Ocean', { Background: '#101010' }));
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'Custom' }));
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { theme: 'Custom' } }]));
    expect(await screen.findByRole('textbox', { name: 'Background hex' })).toHaveValue('#101010');
  });

  it('a failed theme save shows the toast and the old theme comes back', async () => {
    mockApi(makeMe(), { 'PUT /api/me/settings': { status: 500, body: { error: 'boom' } } });
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'Forest' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save your settings. Try again.");
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Midnight' })).toBeChecked());
    expect(css('--bg')).toBe('#1b1b25');
  });
});

describe('Settings: Custom colours', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });
  const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('has a colour input and a hex box for each of the 10 roles', async () => {
    mockApi(themeName('Custom'));
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'Custom colours' });
    for (const [role, hex] of Object.entries(THEMES.Midnight!)) {
      expect(screen.getByLabelText(role, { selector: 'input[type="color"]' })).toHaveValue(hex);
      expect(screen.getByRole('textbox', { name: `${role} hex` })).toHaveValue(hex);
    }
  });

  it('an invalid hex shows the error and is not saved', async () => {
    const calls = mockApi(themeName('Custom'));
    renderApp('/settings');
    const box = await screen.findByRole('textbox', { name: 'Text hex' });
    const u = user();
    await u.clear(box);
    await u.type(box, '#zzzzzz');
    expect(await screen.findByText('Use a colour like #1b1b25.')).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await tick(1000);
    expect(puts(calls)).toEqual([]);
    expect(css('--text')).toBe('#e6e6ed');
  });

  it('editing Text to #333333 applies at once, warns, and saves 500 ms after the last edit', async () => {
    const calls = mockApi(themeName('Custom'));
    renderApp('/settings');
    const box = await screen.findByRole('textbox', { name: 'Text hex' });
    const u = user();
    await u.clear(box);
    await u.type(box, '#333333');
    expect(css('--text')).toBe('#333333');
    expect(screen.getByText(`Text is hard to read on Background (${ratio('#333333', '#1b1b25')}:1; aim for 4.5:1).`)).toBeInTheDocument();
    expect(screen.getByText(`Text is hard to read on Cards (${ratio('#333333', '#232339')}:1; aim for 4.5:1).`)).toBeInTheDocument();
    await tick(400);
    expect(puts(calls)).toEqual([]);
    await tick(200);
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { colors: { Text: '#333333' } } }]));
    expect(screen.getByLabelText('Text', { selector: 'input[type="color"]' })).toHaveValue('#333333');
  });

  it('the colour input saves the role too, and edits to two roles go in one save', async () => {
    const calls = mockApi(themeName('Custom'));
    renderApp('/settings');
    const bg = await screen.findByLabelText('Background', { selector: 'input[type="color"]' });
    fireEvent.input(bg, { target: { value: '#000000' } });
    fireEvent.input(screen.getByLabelText('Highlight', { selector: 'input[type="color"]' }), { target: { value: '#00ff00' } });
    expect(css('--bg')).toBe('#000000');
    expect(screen.getByRole('textbox', { name: 'Background hex' })).toHaveValue('#000000');
    await tick(600);
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { colors: { Background: '#000000', Highlight: '#00ff00' } } }]));
  });

  it('a saved edit is kept when you leave before 500 ms', async () => {
    const calls = mockApi(themeName('Custom'));
    const { router } = renderApp('/settings');
    const box = await screen.findByRole('textbox', { name: 'Muted text hex' });
    const u = user();
    await u.clear(box);
    await u.type(box, '#55556a');
    await act(async () => { await router.navigate('/more'); });
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { colors: { 'Muted text': '#55556a' } } }]));
  });

  it('a half-typed hex in one row survives another row being saved', async () => {
    const calls = mockApi(themeName('Custom'));
    renderApp('/settings');
    const text = await screen.findByRole('textbox', { name: 'Text hex' });
    const muted = screen.getByRole('textbox', { name: 'Muted text hex' });
    const u = user();
    await u.clear(text);
    await u.type(text, '#cccccc');
    await u.clear(muted);
    await u.type(muted, '#zz');
    await u.tab();
    expect(screen.getByText('Use a colour like #1b1b25.')).toBeInTheDocument();
    await tick(600);
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { colors: { Text: '#cccccc' } } }]));
    expect(muted).toHaveValue('#zz');
    expect(screen.getByText('Use a colour like #1b1b25.')).toBeInTheDocument();
  });

  it('a failed colour save shows the toast and the saved colour comes back', async () => {
    mockApi(themeName('Custom'), { 'PUT /api/me/settings': { status: 500, body: { error: 'boom' } } });
    renderApp('/settings');
    const box = await screen.findByRole('textbox', { name: 'Text hex' });
    const u = user();
    await u.clear(box);
    await u.type(box, '#333333');
    await tick(600);
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save your settings. Try again.");
    await waitFor(() => expect(box).toHaveValue('#e6e6ed'));
    expect(css('--text')).toBe('#e6e6ed');
  });

  it('shows no warnings for a readable palette', async () => {
    mockApi(themeName('Custom'));
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'Custom colours' });
    expect(screen.queryByText(/is hard to read on/)).not.toBeInTheDocument();
  });
});
