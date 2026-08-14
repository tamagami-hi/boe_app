import { useEffect } from 'react';

export const SYSTEM_BAR_STYLE = {
  LIGHT: 'LIGHT',
  DARK: 'DARK',
};

export const DEFAULT_BAR_BACKGROUND = '#F7F7F5';

const DEFAULT_CHROME = {
  style: SYSTEM_BAR_STYLE.LIGHT,
  background: DEFAULT_BAR_BACKGROUND,
};

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const stack = [];
const listeners = new Set();

let current = DEFAULT_CHROME;

function resolve() {
  return stack.length === 0 ? DEFAULT_CHROME : stack[stack.length - 1].chrome;
}

function publish() {
  const next = resolve();
  if (next.style === current.style && next.background === current.background) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function getSystemChrome() {
  return current;
}

export function getSystemBarStyle() {
  return current.style;
}

export function subscribeToSystemChrome(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pushSystemChrome({ style, background = DEFAULT_BAR_BACKGROUND }) {
  if (style !== SYSTEM_BAR_STYLE.LIGHT && style !== SYSTEM_BAR_STYLE.DARK) {
    throw new Error(`Unknown system bar style: ${String(style)}`);
  }
  if (!HEX_COLOUR.test(background)) {
    throw new Error(`System bar background must be a hex colour, got: ${String(background)}`);
  }

  const token = { chrome: { style, background } };
  stack.push(token);
  publish();

  return () => {
    const index = stack.indexOf(token);
    if (index !== -1) stack.splice(index, 1);
    publish();
  };
}

export function resetSystemChromeForTests() {
  stack.length = 0;
  current = DEFAULT_CHROME;
  listeners.clear();
}

export function useSystemChrome(style, background) {
  useEffect(() => pushSystemChrome({ style, background }), [style, background]);
}
