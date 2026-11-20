import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../../test/fakeBackend';
import { renderApp } from '../../test/renderApp';
import { setViewportWidth } from '../../test/viewport';

const patches = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method === 'PATCH').map((c) => c.body as Record<string, unknown>);
const watching = (over = {}) => makeEntry({ id: 'f1', title: 'Frieren', status: 'Watching / In Progress', rating: null, ...over });

describe('rate on complete', () => {
  it('title page: Completed on an unrated title opens the sheet; Save rating uses the normal save', async () => {
    const { calls } = fakeBackend({ entries: [watching()] });
    renderApp('/entry/f1');
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'Completed');
    const dialog = await screen.findByRole('dialog', { name: 'You finished Frieren 🎉' });
    expect(within(dialog).getByText('Rate it now?')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('spinbutton', { name: 'Rating' }), '9.4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rating' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /You finished/ })).not.toBeInTheDocument());
    expect(patches(calls)).toEqual([{ status: 'Completed' }, { rating: 9.4 }]);
  });

  it('"Later" closes it and saves nothing more', async () => {
    const { calls } = fakeBackend({ entries: [watching()] });
    renderApp('/entry/f1');
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'Completed');
    await userEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog', { name: /You finished/ })).not.toBeInTheDocument();
    expect(patches(calls)).toEqual([{ status: 'Completed' }]);
  });

  it('a bad number shows an error and saves nothing', async () => {
    const { calls } = fakeBackend({ entries: [watching()] });
    renderApp('/entry/f1');
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'Completed');
    const d = await screen.findByRole('dialog', { name: /You finished/ });
    await userEvent.type(within(d).getByRole('spinbutton', { name: 'Rating' }), '42');
    await userEvent.click(within(d).getByRole('button', { name: 'Save rating' }));
    expect(await within(d).findByRole('alert')).toBeInTheDocument();
    expect(patches(calls)).toEqual([{ status: 'Completed' }]);
  });

  it('does not ask when the title already has a rating', async () => {
    fakeBackend({ entries: [watching({ rating: 8.1, typed: 8.1 })] });
    renderApp('/entry/f1');
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'Completed');
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('Completed'));
    expect(screen.queryByRole('dialog', { name: /You finished/ })).not.toBeInTheDocument();
  });

  it('does not ask for a title that was already Completed, or for other statuses', async () => {
    fakeBackend({ entries: [watching()] });
    renderApp('/entry/f1');
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'On Hold');
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('On Hold'));
    expect(screen.queryByRole('dialog', { name: /You finished/ })).not.toBeInTheDocument();
  });

  it('the list table status cell asks too', async () => {
    setViewportWidth(1024);
    const { calls } = fakeBackend({ entries: [watching({ title: 'Mob Psycho' })] });
    renderApp('/list/anime');
    await userEvent.click(await screen.findByRole('button', { name: /^Status for Mob Psycho/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status for Mob Psycho' }), 'Completed');
    const d = await screen.findByRole('dialog', { name: 'You finished Mob Psycho 🎉' });
    await userEvent.type(within(d).getByRole('spinbutton', { name: 'Rating' }), '8');
    await userEvent.click(within(d).getByRole('button', { name: 'Save rating' }));
    await waitFor(() => expect(patches(calls)).toContainEqual({ rating: 8 }));
  });
});
