import { THEMES } from '@media-tracker/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { reloadDeviceLook, THEME_KEY } from '../../design/deviceLook';
import { contrast } from '../../design/theme';
import { makeMe, mockApi, type Call } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { warningText } from './CustomColors';

const css = (name: string) => document.documentElement.style.getPropertyValue(name);
const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT' && c.path === '/api/me/settings').map((c) => c.body);
const stored = () => JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null') as { theme: string; colors: Record<string, string> } | null;
const themeName = (theme: string, colors: Record<string, string> = {}) => {
  const me = makeMe();
  return makeMe({ settings: { ...me.settings, theme, colors } });
};
const warning = (role: 'Text', surface: 'Background' | 'Cards', fg: string, bg: string) =>
  warningText({ role, surface, ratio: contrast(fg, bg) });

describe('Settings: theme picker', () => {
  it('offers the 12 themes in order, then Custom, with the current one checked', async () => {
    mockApi(themeName('Sakura'));
    renderApp('/settings/appearance');
    const group = await screen.findByRole('radiogroup', { name: 'Theme' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual([...Object.keys(THEMES), 'Custom']);
    expect(within(group).getByRole('radio', { name: 'Sakura' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Midnight' })).not.toBeChecked();
    expect(screen.queryByRole('heading', { name: 'Custom colours' })).not.toBeInTheDocument();
  });

  it('picking Ocean saves it on this device only (nothing goes to the account) and applies its colours', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings/appearance');
    await userEvent.click(await screen.findByRole('radio', { name: 'Ocean' }));
    await waitFor(() => expect(css('--bg')).toBe('#0f1c2b'));
    expect(stored()).toEqual({ theme: 'Ocean', colors: {} });
    expect(puts(calls)).toEqual([]);
    expect(screen.getByRole('radio', { name: 'Ocean' })).toBeChecked();
    expect(screen.getAllByText('Saved on this device only.').length).toBeGreaterThan(0);
  });

  it("this device's theme wins over the account's, which only starts a device that has not chosen", async () => {
    localStorage.setItem(THEME_KEY, JSON.stringify({ theme: 'Forest', colors: {} }));
    reloadDeviceLook();
    mockApi(themeName('Sakura'));
    renderApp('/settings/appearance');
    expect(await screen.findByRole('radio', { name: 'Forest' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Sakura' })).not.toBeChecked();
    await waitFor(() => expect(css('--bg')).toBe(THEMES.Forest!.Background));
  });

  it('a device with nothing saved starts from the account theme', async () => {
    mockApi(themeName('Sakura'));
    renderApp('/settings/appearance');
    expect(await screen.findByRole('radio', { name: 'Sakura' })).toBeChecked();
    expect(stored()).toBeNull();
    await waitFor(() => expect(css('--bg')).toBe('#fff7f9'));
  });

  it('picking Custom with no saved colours starts from the theme on screen', async () => {
    const calls = mockApi(themeName('Sakura'));
    renderApp('/settings/appearance');
    await userEvent.click(await screen.findByRole('radio', { name: 'Custom' }));
    expect(await screen.findByRole('heading', { name: 'Custom colours' })).toBeInTheDocument();
    expect(stored()).toEqual({ theme: 'Custom', colors: THEMES.Sakura });
    expect(puts(calls)).toEqual([]);
    expect(screen.getByRole('textbox', { name: 'Background hex' })).toHaveValue('#fff7f9');
    expect(css('--bg')).toBe('#fff7f9');
  });

  it('picking Custom again keeps the colours saved before', async () => {
    mockApi(themeName('Ocean', { Background: '#101010' }));
    renderApp('/settings/appearance');
    await userEvent.click(await screen.findByRole('radio', { name: 'Custom' }));
    expect(stored()).toEqual({ theme: 'Custom', colors: { Background: '#101010' } });
    expect(await screen.findByRole('textbox', { name: 'Background hex' })).toHaveValue('#101010');
  });
});

describe('Settings: Custom colours', () => {
  it('has a colour input and a hex box for each of the 10 roles', async () => {
    mockApi(themeName('Custom'));
    renderApp('/settings/appearance');
    await screen.findByRole('heading', { name: 'Custom colours' });
    for (const [role, hex] of Object.entries(THEMES.Midnight!)) {
      expect(screen.getByLabelText(role, { selector: 'input[type="color"]' })).toHaveValue(hex);
      expect(screen.getByRole('textbox', { name: `${role} hex` })).toHaveValue(hex);
    }
  });

  it('an invalid hex shows the error and is not saved', async () => {
    mockApi(themeName('Custom'));
    renderApp('/settings/appearance');
    const box = await screen.findByRole('textbox', { name: 'Text hex' });
    await userEvent.clear(box);
    await userEvent.type(box, '#zzzzzz');
    expect(await screen.findByText('Use a colour like #1b1b25.')).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(stored()).toBeNull();
    expect(css('--text')).toBe('#e6e6ed');
  });

  it('editing Text to #333333 applies at once, warns, and saves on this device (not the account)', async () => {
    const calls = mockApi(themeName('Custom'));
    renderApp('/settings/appearance');
    const box = await screen.findByRole('textbox', { name: 'Text hex' });
    await userEvent.clear(box);
    await userEvent.type(box, '#333333');
    expect(css('--text')).toBe('#333333');
    expect(screen.getByText(warning('Text', 'Background', '#333333', '#1b1b25'))).toBeInTheDocument();
    expect(screen.getByText(warning('Text', 'Cards', '#333333', '#232339'))).toBeInTheDocument();
    expect(screen.getByText(/^Text is hard to read on Background \(\d\.\d:1; aim for 4\.5:1\)\.$/)).toBeInTheDocument();
    expect(stored()).toEqual({ theme: 'Custom', colors: { ...THEMES.Midnight, Text: '#333333' } });
    expect(puts(calls)).toEqual([]);
    expect(screen.getByLabelText('Text', { selector: 'input[type="color"]' })).toHaveValue('#333333');
  });

  it('the colour input saves the role too, and two roles are both kept', async () => {
    mockApi(themeName('Custom'));
    renderApp('/settings/appearance');
    const bg = await screen.findByLabelText('Background', { selector: 'input[type="color"]' });
    fireEvent.input(bg, { target: { value: '#000000' } });
    fireEvent.input(screen.getByLabelText('Highlight', { selector: 'input[type="color"]' }), { target: { value: '#00ff00' } });
    expect(css('--bg')).toBe('#000000');
    expect(screen.getByRole('textbox', { name: 'Background hex' })).toHaveValue('#000000');
    expect(stored()!.colors).toMatchObject({ Background: '#000000', Highlight: '#00ff00' });
  });

  it('a half-typed hex in one row survives another row being saved', async () => {
    mockApi(themeName('Custom'));
    renderApp('/settings/appearance');
    const text = await screen.findByRole('textbox', { name: 'Text hex' });
    const muted = screen.getByRole('textbox', { name: 'Muted text hex' });
    await userEvent.clear(text);
    await userEvent.type(text, '#cccccc');
    await userEvent.clear(muted);
    await userEvent.type(muted, '#zz');
    await userEvent.tab();
    expect(screen.getByText('Use a colour like #1b1b25.')).toBeInTheDocument();
    expect(stored()!.colors.Text).toBe('#cccccc');
    expect(muted).toHaveValue('#zz');
  });

  it('a Highlight that no button label reads on warns on the Highlight row; a readable one does not', async () => {
    mockApi(themeName('Custom'));
    renderApp('/settings/appearance');
    const box = await screen.findByRole('textbox', { name: 'Highlight hex' });
    await userEvent.clear(box);
    await userEvent.type(box, '#777777');
    expect(screen.getByText(/^Button text is hard to read on Highlight \(\d\.\d:1; aim for 4\.5:1\)\.$/)).toBeInTheDocument();
    expect(box.closest('.color-row')!.querySelector('[aria-label="Hard to read"]')).not.toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, '#ff9f43');
    expect(screen.queryByText(/Button text is hard to read/)).not.toBeInTheDocument();
  });

  it('shows no warnings for a readable palette', async () => {
    mockApi(themeName('Custom'));
    renderApp('/settings/appearance');
    await screen.findByRole('heading', { name: 'Custom colours' });
    expect(screen.queryByText(/is hard to read on/)).not.toBeInTheDocument();
  });
});
