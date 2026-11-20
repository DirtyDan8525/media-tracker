import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBackend, makeEntry } from '../test/fakeBackend';
import { renderApp } from '../test/renderApp';
import { setViewportWidth } from '../test/viewport';

const rows = () => [
  makeEntry({ id: 'a1', title: 'Frieren', rating: 9.5, tags: ['With Ren', 'Comfy'] }),
  makeEntry({ id: 'a2', title: 'Mob Psycho', rating: 9.4, tags: ['Comfy'] }),
  makeEntry({ id: 'a3', title: 'Bebop', rating: 9, tags: [] }),
];

describe('list filter: Tag (phone sheet)', () => {
  beforeEach(() => setViewportWidth(390));
  it('has a Tags section that filters, is kept in the URL, and shows a removable chip', async () => {
    fakeBackend({ entries: rows() });
    const { router } = renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = await screen.findByRole('dialog');
    const group = within(dialog).getByRole('group', { name: 'Tags' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Comfy', 'With Ren']);
    await userEvent.click(within(group).getByRole('button', { name: 'With Ren' }));
    expect(router.state.location.search).toContain('tag=With+Ren');
    expect(within(dialog).getByRole('button', { name: 'Show 1' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show 1' }));
    expect(screen.queryByText('Mob Psycho')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Tag: With Ren' }));
    expect(await screen.findByText('Mob Psycho')).toBeInTheDocument();
    expect(router.state.location.search).not.toContain('tag=');
  });

  it('opens already filtered from ?tag=, and drops a tag nothing has', async () => {
    fakeBackend({ entries: rows() });
    const { router } = renderApp('/list/anime?tag=comfy');
    await screen.findByText('Frieren');
    expect(screen.getByText('Mob Psycho')).toBeInTheDocument();
    expect(screen.queryByText('Bebop')).not.toBeInTheDocument();
    await router.navigate('/list/anime?tag=nope');
    expect(await screen.findByText('Bebop')).toBeInTheDocument();
  });

  it('has no Tags section when no title has a tag', async () => {
    fakeBackend({ entries: [makeEntry({ id: 'a1', title: 'Frieren' })] });
    renderApp('/list/anime');
    await screen.findByText('Frieren');
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(within(await screen.findByRole('dialog')).queryByRole('group', { name: 'Tags' })).not.toBeInTheDocument();
  });
});

describe('list filter: Tag (PC chip)', () => {
  beforeEach(() => setViewportWidth(1280));
  afterEach(() => setViewportWidth(390));
  it('a Tag select filters the table', async () => {
    fakeBackend({ entries: rows() });
    renderApp('/list/anime');
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tag' }), 'With Ren (1)');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Frieren')).toBeInTheDocument();
    expect(within(table).queryByText('Mob Psycho')).not.toBeInTheDocument();
  });
});
