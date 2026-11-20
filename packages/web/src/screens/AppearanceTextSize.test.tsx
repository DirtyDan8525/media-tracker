import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TEXT_SCALE_KEY } from '../design/deviceLook';
import { makeMe, mockApi } from '../test/mockApi';
import { renderApp } from '../test/renderApp';

describe('Appearance: text size', () => {
  it('offers Smaller / Default / Larger / Largest, saved on this device only', async () => {
    const calls = mockApi(makeMe());
    renderApp('/settings/appearance');
    const group = await screen.findByRole('radiogroup', { name: 'Text size' });
    expect([...group.querySelectorAll('[role=radio]')].map((r) => r.textContent)).toEqual(['Smaller', 'Default', 'Larger', 'Largest']);
    expect(screen.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Larger' }));
    expect(localStorage.getItem(TEXT_SCALE_KEY)).toBe('larger');
    expect(document.documentElement.style.getPropertyValue('--app-scale')).toBe('1.12');
    expect(screen.getByRole('radio', { name: 'Larger' })).toHaveAttribute('aria-checked', 'true');
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });
});
