import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  RETRY_BACKOFF_MS,
  SPLASH_MIN_VISIBLE_MS,
  backoffFor,
  isLaunchInProgress,
  subscribeToLaunch,
  useLaunchGate,
} from './launchGate.js';

function Gate({ probe, sessionSettled = true }) {
  const { phase, ready } = useLaunchGate({ probe, sessionSettled });
  return <div data-phase={phase} data-ready={String(ready)} />;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the retry backoff is bounded and increasing', () => {
  test('grows then caps instead of retrying forever at one interval', () => {
    const first = backoffFor(1);
    const second = backoffFor(2);
    const far = backoffFor(99);

    expect(first).toBe(RETRY_BACKOFF_MS[0]);
    expect(second).toBeGreaterThan(first);
    expect(far).toBe(RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
  });

  test('an attempt below one still yields a usable delay', () => {
    expect(backoffFor(0)).toBe(RETRY_BACKOFF_MS[0]);
  });
});

describe('the product floor', () => {
  test('the minimum visible hold is 1600ms', () => {
    expect(SPLASH_MIN_VISIBLE_MS).toBe(1600);
  });
});

describe('launch ownership', () => {
  test('is false before anything mounts', () => {
    expect(isLaunchInProgress()).toBe(false);
  });

  test('is true while a gate is mounted and false once it unmounts', () => {
    const seen = [];
    const stop = subscribeToLaunch((value) => seen.push(value));

    const view = render(<Gate probe={() => new Promise(() => {})} />);
    expect(isLaunchInProgress()).toBe(true);

    view.unmount();
    expect(isLaunchInProgress()).toBe(false);
    expect(seen).toEqual([true, false]);

    stop();
  });

  test('nested gates keep ownership until the last one unmounts', () => {
    const first = render(<Gate probe={() => new Promise(() => {})} />);
    const second = render(<Gate probe={() => new Promise(() => {})} />);

    expect(isLaunchInProgress()).toBe(true);
    first.unmount();
    expect(isLaunchInProgress()).toBe(true);
    second.unmount();
    expect(isLaunchInProgress()).toBe(false);
  });
});

describe('without a probe', () => {
  test('the gate still honours the hold and then reports ready', async () => {
    const view = render(<Gate probe={undefined} />);
    expect(view.container.firstChild.dataset.ready).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });

    expect(view.container.firstChild.dataset.ready).toBe('true');
    view.unmount();
  });
});
