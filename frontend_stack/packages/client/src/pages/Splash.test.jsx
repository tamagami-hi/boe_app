import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock };
});

let sessionValue = { user: null, status: 'restoring' };
vi.mock('../store/SessionContext.jsx', () => ({
  useSession: () => sessionValue,
}));

let reachabilityCalls = 0;
let pendingResolvers = [];
vi.mock('../services/authApi.js', () => ({
  checkReachability: () => {
    reachabilityCalls += 1;
    return new Promise((resolve) => { pendingResolvers.push(resolve); });
  },
}));

vi.mock('@beonedge/shared/assets/logo-on-dark.svg', () => ({ default: 'logo.svg' }));

const { default: Splash } = await import('./Splash.jsx');

const HOLD_MS = 1600;
const SLOW_MS = 2500;
const FIRST_BACKOFF_MS = 800;

function renderSplash() {
  return render(
    <MemoryRouter initialEntries={['/app/splash']}>
      <Splash />
    </MemoryRouter>,
  );
}

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

async function settle() {
  await act(async () => { await flush(); });
}

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await flush();
  });
}

async function answerProbe(value) {
  await act(async () => {
    await flush();
    const resolve = pendingResolvers.shift();
    expect(resolve, 'no reachability probe was in flight').toBeTypeOf('function');
    resolve(value);
    await flush();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  navigateMock.mockClear();
  reachabilityCalls = 0;
  pendingResolvers = [];
  sessionValue = { user: null, status: 'restoring' };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bootstrap concurrency', () => {
  test('the reachability probe starts immediately, not chained onto the session', async () => {
    renderSplash();
    await settle();

    expect(reachabilityCalls).toBe(1);
  });
});

describe('the 1600ms hold is a floor and is never shortened', () => {
  test('does not navigate before 1600ms even when everything answers instantly', async () => {
    sessionValue = { user: { id: 'u1', role: 'client' }, status: 'authenticated' };
    renderSplash();
    await answerProbe({ ok: true });

    await advance(HOLD_MS - 1);
    expect(navigateMock).not.toHaveBeenCalled();

    await advance(1);
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  test('navigates an authenticated client to Home, replacing the splash entry', async () => {
    sessionValue = { user: { id: 'u1', role: 'client' }, status: 'authenticated' };
    renderSplash();
    await answerProbe({ ok: true });
    await advance(HOLD_MS);

    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard', { replace: true });
  });

  test('navigates an anonymous visitor to login', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await answerProbe({ ok: true });
    await advance(HOLD_MS);

    expect(navigateMock).toHaveBeenCalledWith('/app/login', { replace: true });
  });

  test('routes an admin principal to the admin root', async () => {
    sessionValue = { user: { id: 'a1', role: 'admin' }, status: 'authenticated' };
    renderSplash();
    await answerProbe({ ok: true });
    await advance(HOLD_MS);

    expect(navigateMock).toHaveBeenCalledWith('/admin', { replace: true });
  });
});

describe('the gate holds until the server answers', () => {
  test('does not navigate while the session is still restoring', async () => {
    sessionValue = { user: null, status: 'restoring' };
    renderSplash();
    await answerProbe({ ok: true });
    await advance(HOLD_MS * 2);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('does not navigate while reachability is still in flight, however long it takes', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await settle();
    await advance(HOLD_MS * 10);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('navigates as soon as a late answer arrives, with no extra hold', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await advance(HOLD_MS * 2);
    expect(navigateMock).not.toHaveBeenCalled();

    await answerProbe({ ok: true });
    expect(navigateMock).toHaveBeenCalledWith('/app/login', { replace: true });
  });
});

describe('feedback while waiting', () => {
  test('shows only the spinner during a normal launch', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await settle();

    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
    expect(screen.queryByText('Cannot reach BeOnEdge')).not.toBeInTheDocument();
  });

  test('explains the delay once the launch is slow, without claiming failure', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await advance(SLOW_MS);

    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.queryByText('Cannot reach BeOnEdge')).not.toBeInTheDocument();
  });
});

describe('an unreachable backend', () => {
  test('names the problem and never navigates', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await answerProbe({ ok: false });

    expect(screen.getByText('Cannot reach BeOnEdge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try now' })).toBeInTheDocument();

    await advance(HOLD_MS * 3);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('retries by itself after a backoff, with no user action', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await answerProbe({ ok: false });
    expect(reachabilityCalls).toBe(1);

    await advance(FIRST_BACKOFF_MS);
    expect(reachabilityCalls).toBe(2);
  });

  test('recovers and enters the app once the server answers', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await answerProbe({ ok: false });
    await advance(FIRST_BACKOFF_MS);
    await answerProbe({ ok: true });

    await advance(HOLD_MS);
    expect(navigateMock).toHaveBeenCalledWith('/app/login', { replace: true });
  });

  test('Try now probes immediately instead of waiting out the backoff', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await answerProbe({ ok: false });
    expect(reachabilityCalls).toBe(1);

    await act(async () => {
      screen.getByRole('button', { name: 'Try now' }).click();
      await flush();
    });

    expect(reachabilityCalls).toBe(2);
  });
});
