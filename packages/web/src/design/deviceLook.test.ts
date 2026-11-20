import { describe, expect, it } from 'vitest';
import { applyTextScale, getDeviceTheme, getTextScale, reloadDeviceLook, setDeviceTheme, setTextScale, TEXT_SCALE_KEY, THEME_KEY, withDeviceLook } from './deviceLook';
import { defaultNavWidth } from '../shell/navWidth';

const scale = () => document.documentElement.style.getPropertyValue('--app-scale');

describe('per-device look', () => {
  it('nothing saved: the account value stays', () => {
    const acct = { theme: 'Sakura', colors: {} };
    expect(getDeviceTheme()).toBeNull();
    expect(withDeviceLook(acct)).toBe(acct);
  });
  it('a saved device theme wins over the account, and survives a reload', () => {
    setDeviceTheme({ theme: 'Ocean', colors: { Background: '#101010' } });
    expect(withDeviceLook({ theme: 'Sakura', colors: { Text: '#ffffff' } })).toEqual({ theme: 'Ocean', colors: { Background: '#101010' } });
    reloadDeviceLook();
    expect(getDeviceTheme()?.theme).toBe('Ocean');
  });
  it('junk in storage is ignored', () => {
    localStorage.setItem(THEME_KEY, JSON.stringify({ theme: 'Nope', colors: {} }));
    localStorage.setItem(TEXT_SCALE_KEY, 'huge');
    reloadDeviceLook();
    expect(getDeviceTheme()).toBeNull();
    expect(getTextScale()).toBeNull();
  });
  it('text size is saved on the device and sets --app-scale (90/100/112/125 %)', () => {
    setTextScale('larger');
    expect(localStorage.getItem(TEXT_SCALE_KEY)).toBe('larger');
    expect(scale()).toBe('1.12');
    setTextScale('smaller');
    expect(scale()).toBe('0.9');
    setTextScale('largest');
    expect(scale()).toBe('1.25');
    applyTextScale(null);
    expect(scale()).toBe('1');
  });
});

describe('side bar default width', () => {
  it('grows with the window between 240 and 300 px', () => {
    expect(defaultNavWidth(1024)).toBe(240);
    expect(defaultNavWidth(1600)).toBe(240);
    expect(defaultNavWidth(1920)).toBe(269);
    expect(defaultNavWidth(2300)).toBe(300);
    expect(defaultNavWidth(3840)).toBe(300);
  });
});
