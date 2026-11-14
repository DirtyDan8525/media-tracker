import { COMPARE_ASK, COMPARE_ROOM, COMPARE_STYLE } from '@media-tracker/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeMe, mockApi, type Call } from '../../test/mockApi';
import { renderApp } from '../../test/renderApp';
import { parseWindow } from './CompareOptions';

const puts = (calls: Call[]) => calls.filter((c) => c.method === 'PUT' && c.path === '/api/me/settings').map((c) => c.body);
const withSettings = (over: Partial<ReturnType<typeof makeMe>['settings']>) => {
  const me = makeMe();
  return makeMe({ settings: { ...me.settings, ...over } });
};

describe('parseWindow', () => {
  it('accepts a decimal point or comma, above 0 and up to 10', () => {
    expect(parseWindow('1')).toBe(1);
    expect(parseWindow('0.5')).toBe(0.5);
    expect(parseWindow('1,5')).toBe(1.5);
    expect(parseWindow(' 2 ')).toBe(2);
    expect(parseWindow('10')).toBe(10);
  });
  it('rejects 0, negatives, more than 10 and non-numbers', () => {
    expect(parseWindow('0')).toBeNull();
    expect(parseWindow('-1')).toBeNull();
    expect(parseWindow('10.1')).toBeNull();
    expect(parseWindow('abc')).toBeNull();
    expect(parseWindow('')).toBeNull();
    expect(parseWindow('1.2.3')).toBeNull();
    expect(parseWindow('Infinity')).toBeNull();
    expect(parseWindow('1e1')).toBeNull();
  });
});

describe('Settings: Comparing', () => {
  it('shows the three options with their current values and every choice', async () => {
    mockApi(withSettings({ compareAsk: 'Off', compareStyle: 'Swap the numbers', compareRoom: 'Push others down', compareWindow: 0.5 }));
    renderApp('/settings');
    const section = await screen.findByRole('region', { name: 'Comparing' });
    const ask = within(section).getByRole('combobox', { name: 'Ask to compare' });
    expect(ask).toHaveValue('Off');
    expect(within(ask).getAllByRole('option').map((o) => o.textContent)).toEqual([...COMPARE_ASK]);
    const style = within(section).getByRole('combobox', { name: 'Re-rating style' });
    expect(style).toHaveValue('Swap the numbers');
    expect(within(style).getAllByRole('option').map((o) => o.textContent)).toEqual([...COMPARE_STYLE]);
    const room = within(section).getByRole('combobox', { name: "When there's no room" });
    expect(room).toHaveValue('Push others down');
    expect(within(room).getAllByRole('option').map((o) => o.textContent)).toEqual([...COMPARE_ROOM]);
    const win = within(section).getByRole('textbox', { name: 'Compare within' });
    expect(win).toHaveValue('0.5');
    expect(win).toHaveAttribute('inputmode', 'decimal');
  });

  it.each([
    ['Ask to compare', 'Only for new ratings', 'compareAsk'],
    ['Re-rating style', 'Swap the numbers', 'compareStyle'],
    ["When there's no room", 'Give the same score', 'compareRoom'],
  ])('choosing %s → %s saves it', async (label, value, key) => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    const select = await screen.findByRole('combobox', { name: label });
    await userEvent.selectOptions(select, value);
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { [key]: value } }]));
    expect(select).toHaveValue(value);
  });

  it('a failed save shows the toast and the old value comes back', async () => {
    mockApi(makeMe(), { 'PUT /api/me/settings': { status: 500, body: { error: 'boom' } } });
    renderApp('/settings');
    const select = await screen.findByRole('combobox', { name: 'Re-rating style' });
    await userEvent.selectOptions(select, 'Swap the numbers');
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save your settings. Try again.");
    await waitFor(() => expect(select).toHaveValue('Meet in the middle'));
  });

  it('Compare within saves on blur, reading a comma as a decimal point', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    const win = await screen.findByRole('textbox', { name: 'Compare within' });
    await userEvent.clear(win);
    await userEvent.type(win, '1,5');
    expect(puts(calls)).toEqual([]);
    await userEvent.tab();
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { compareWindow: 1.5 } }]));
    expect(win).toHaveValue('1.5');
  });

  it('Compare within saves on Enter', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    const win = await screen.findByRole('textbox', { name: 'Compare within' });
    await userEvent.clear(win);
    await userEvent.type(win, '2{Enter}');
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { compareWindow: 2 } }]));
  });

  it('an unchanged Compare within is not saved again', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    const win = await screen.findByRole('textbox', { name: 'Compare within' });
    await userEvent.click(win);
    await userEvent.tab();
    expect(puts(calls)).toEqual([]);
  });

  it('typing 0 and tabbing away shows the error and saves nothing; a good value clears it', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings');
    const win = await screen.findByRole('textbox', { name: 'Compare within' });
    await userEvent.clear(win);
    await userEvent.type(win, '0');
    await userEvent.tab();
    expect(await screen.findByText('Enter a number above 0, up to 10.')).toBeInTheDocument();
    expect(win).toHaveAttribute('aria-invalid', 'true');
    expect(win).toHaveAccessibleDescription('Enter a number above 0, up to 10.');
    expect(puts(calls)).toEqual([]);
    await userEvent.clear(win);
    await userEvent.type(win, '3{Enter}');
    await waitFor(() => expect(puts(calls)).toEqual([{ settings: { compareWindow: 3 } }]));
    expect(screen.queryByText('Enter a number above 0, up to 10.')).not.toBeInTheDocument();
  });

  it('a failed Compare within save shows the toast and the old value comes back', async () => {
    mockApi(makeMe(), { 'PUT /api/me/settings': { status: 500, body: { error: 'boom' } } });
    renderApp('/settings');
    const win = await screen.findByRole('textbox', { name: 'Compare within' });
    await userEvent.clear(win);
    await userEvent.type(win, '4{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't save your settings. Try again.");
    await waitFor(() => expect(win).toHaveValue('1'));
  });
});
