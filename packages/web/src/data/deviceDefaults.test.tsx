import { COLUMN_IDS, DEFAULT_USER_SETTINGS, markCustomized } from '@media-tracker/shared';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTextSize } from '../design/components/useTextSize';
import { COL_WIDTHS } from '../screens/list/tableKit';
import { makeMe } from '../test/mockApi';
import { BUILT_IN_DEVICE, reloadDeviceDefaults, setDeviceDefaults } from './deviceDefaults';
import { normalizeMe } from './useMe';

beforeEach(() => { localStorage.clear(); reloadDeviceDefaults(); setDeviceDefaults(BUILT_IN_DEVICE); });

describe('device defaults (starting values only)', () => {
  it('the shared column ids are exactly the table columns', () => {
    expect([...COLUMN_IDS].sort()).toEqual(Object.keys(COL_WIDTHS).sort());
  });
  it('a text size starts from the admin value; what this device saved wins, and saving works', () => {
    setDeviceDefaults({ ...BUILT_IN_DEVICE, chatTextSize: 125 });
    const chat = renderHook(() => useTextSize('chat-text-size'));
    expect(chat.result.current.percent).toBe(125);
    expect(renderHook(() => useTextSize('activity-text-size')).result.current.percent).toBe(100);
    act(() => chat.result.current.set(0));
    expect(chat.result.current.percent).toBe(85);
    localStorage.setItem('chat-text-size', '115');
    expect(renderHook(() => useTextSize('chat-text-size')).result.current.percent).toBe(115);
  });
  it('a default that arrives later updates a device with nothing saved', () => {
    const chat = renderHook(() => useTextSize('chat-text-size'));
    expect(chat.result.current.percent).toBe(100);
    act(() => setDeviceDefaults({ ...BUILT_IN_DEVICE, chatTextSize: 140 }));
    expect(chat.result.current.percent).toBe(140);
  });
});

describe('settings overlay on the device', () => {
  it('normalizeMe keeps the server\'s effective settings and fills customized', () => {
    const me = normalizeMe({ ...makeMe(), customized: undefined, settings: { ...DEFAULT_USER_SETTINGS, theme: 'Ocean' } });
    expect(me.settings.theme).toBe('Ocean');
    expect(me.customized).toEqual({});
  });
  it('a change made on screen is marked as the person\'s own at once', () => {
    expect(markCustomized({}, { theme: 'Sakura', tabs: { games: false } })).toEqual({ theme: true, tabs: { games: true } });
  });
});
