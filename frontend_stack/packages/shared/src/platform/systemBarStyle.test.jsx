import React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import {
  DEFAULT_BAR_BACKGROUND,
  SYSTEM_BAR_STYLE,
  getSystemBarStyle,
  getSystemChrome,
  pushSystemChrome,
  resetSystemChromeForTests,
  subscribeToSystemChrome,
  useSystemChrome,
} from './systemBarStyle.js';

function Screen({ style, background }) {
  useSystemChrome(style, background);
  return null;
}

afterEach(() => {
  resetSystemChromeForTests();
});

describe('the system chrome store', () => {
  test('defaults to dark icons on the ivory app background', () => {
    expect(getSystemChrome()).toEqual({
      style: SYSTEM_BAR_STYLE.LIGHT,
      background: DEFAULT_BAR_BACKGROUND,
    });
    expect(getSystemBarStyle()).toBe(SYSTEM_BAR_STYLE.LIGHT);
  });

  test('a screen claims its own bar colour while mounted and releases it on unmount', () => {
    const seen = [];
    subscribeToSystemChrome((chrome) => seen.push(chrome.background));

    const view = render(<Screen style={SYSTEM_BAR_STYLE.DARK} background="#1800AD" />);
    expect(getSystemChrome()).toEqual({ style: SYSTEM_BAR_STYLE.DARK, background: '#1800AD' });

    view.unmount();
    expect(getSystemChrome().background).toBe(DEFAULT_BAR_BACKGROUND);
    expect(seen).toEqual(['#1800AD', DEFAULT_BAR_BACKGROUND]);
  });

  test('the most recently mounted screen wins and unmounting restores the one beneath', () => {
    const release = pushSystemChrome({ style: SYSTEM_BAR_STYLE.DARK, background: '#1800AD' });
    const view = render(<Screen style={SYSTEM_BAR_STYLE.LIGHT} background="#F7F7F5" />);

    expect(getSystemChrome().background).toBe('#F7F7F5');

    view.unmount();
    expect(getSystemChrome().background).toBe('#1800AD');

    release();
    expect(getSystemChrome().background).toBe(DEFAULT_BAR_BACKGROUND);
  });

  test('releasing out of order does not strand a colour', () => {
    const first = pushSystemChrome({ style: SYSTEM_BAR_STYLE.DARK, background: '#1800AD' });
    const second = pushSystemChrome({ style: SYSTEM_BAR_STYLE.DARK, background: '#FF0000' });

    first();
    expect(getSystemChrome().background).toBe('#FF0000');

    second();
    expect(getSystemChrome().background).toBe(DEFAULT_BAR_BACKGROUND);
  });

  test('subscribers are not notified when nothing actually changed', () => {
    const seen = [];
    subscribeToSystemChrome((chrome) => seen.push(chrome));

    const release = pushSystemChrome({
      style: SYSTEM_BAR_STYLE.LIGHT,
      background: DEFAULT_BAR_BACKGROUND,
    });
    expect(seen).toEqual([]);

    release();
    expect(seen).toEqual([]);
  });

  test('an unknown style is refused', () => {
    expect(() => pushSystemChrome({ style: 'TRANSPARENT' })).toThrow(/Unknown system bar style/);
  });

  test('a non-hex background is refused, because the native side parses it', () => {
    expect(() => pushSystemChrome({ style: SYSTEM_BAR_STYLE.DARK, background: 'blue' }))
      .toThrow(/must be a hex colour/);
  });

  test('the splash colours the app actually ships are accepted', () => {
    expect(() => pushSystemChrome({ style: SYSTEM_BAR_STYLE.DARK, background: '#1800AD' }))
      .not.toThrow();
    expect(() => pushSystemChrome({ style: SYSTEM_BAR_STYLE.DARK, background: '#FF0000' }))
      .not.toThrow();
  });
});
