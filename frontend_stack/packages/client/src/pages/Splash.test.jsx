// Splash timing tests (Task 12).
//
// Two things are locked here, and the first is a product constraint:
//
//   1. The 1600ms minimum hold. It is INTENTIONAL. These tests fail if anyone
//      shortens it, makes it conditional, or navigates early.
//   2. Session restore and the reachability probe run CONCURRENTLY. They used to
//      be chained, so a slow connection cost session + reachability before the
//      hold was even evaluated and the floor became an addition on top.
//
// Fake timers plus React state means every resolution and every clock advance has
// to happen inside `act`, and `findBy*` cannot be used (its waitFor polls on the
// timers we control). Hence the explicit `settle`/`advance` helpers.
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

// Controlled by the test so the ordering of the two bootstrap tasks is observable.
let reachabilityCalls = 0;
let resolveReachability;
vi.mock('../services/authApi.js', () => ({
  checkReachability: () => {
    reachabilityCalls += 1;
    return new Promise((resolve) => { resolveReachability = resolve; });
  },
}));

vi.mock('@beonedge/shared/assets/logo-on-dark.svg', () => ({ default: 'logo.svg' }));

const { default: Splash } = await import('./Splash.jsx');

const HOLD_MS = 1600;

function renderSplash() {
  return render(
    <MemoryRouter initialEntries={['/app/splash']}>
      <Splash />
    </MemoryRouter>,
  );
}

/** Flush queued promise callbacks and let React commit, without moving the clock. */
async function settle() {
  await act(async () => { await Promise.resolve(); });
}

/** Move the clock inside act so timer-driven state lands before assertions. */
async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  navigateMock.mockClear();
  reachabilityCalls = 0;
  resolveReachability = undefined;
  sessionValue = { user: null, status: 'restoring' };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bootstrap concurrency', () => {
  test('reachability starts immediately, without waiting for the session', async () => {
    // The session is still restoring on this render. If the probe were chained
    // onto it — the old behaviour — it would not have been called yet.
    renderSplash();
    await settle();

    expect(reachabilityCalls).toBe(1);
  });
});

describe('the 1600ms hold is a floor, and is not shortened', () => {
  test('does not navigate before 1600ms even when everything resolves instantly', async () => {
    sessionValue = { user: { id: 'u1', role: 'client' }, status: 'authenticated' };
    renderSplash();
    await act(async () => { resolveReachability({ ok: true }); });

    await advance(HOLD_MS - 1);
    expect(navigateMock).not.toHaveBeenCalled();

    await advance(1);
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  test('navigates an authenticated client to Home, replacing the splash entry', async () => {
    sessionValue = { user: { id: 'u1', role: 'client' }, status: 'authenticated' };
    renderSplash();
    await act(async () => { resolveReachability({ ok: true }); });
    await advance(HOLD_MS);

    // `replace`: the splash must not be reachable with Back.
    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard', { replace: true });
  });

  test('navigates an anonymous visitor to login', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await act(async () => { resolveReachability({ ok: true }); });
    await advance(HOLD_MS);

    expect(navigateMock).toHaveBeenCalledWith('/app/login', { replace: true });
  });

  test('routes an admin principal to the admin root', async () => {
    sessionValue = { user: { id: 'a1', role: 'admin' }, status: 'authenticated' };
    renderSplash();
    await act(async () => { resolveReachability({ ok: true }); });
    await advance(HOLD_MS);

    expect(navigateMock).toHaveBeenCalledWith('/admin', { replace: true });
  });
});

describe('gating', () => {
  test('does not navigate while the session is still restoring', async () => {
    sessionValue = { user: null, status: 'restoring' };
    renderSplash();
    await act(async () => { resolveReachability({ ok: true }); });
    await advance(HOLD_MS * 2);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('does not navigate while reachability is still in flight', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await settle();
    await advance(HOLD_MS * 2);

    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('unreachable backend', () => {
  test('shows a recoverable error and never navigates', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await act(async () => { resolveReachability({ ok: false }); });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    await advance(HOLD_MS * 3);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('Retry runs a fresh reachability probe', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await act(async () => { resolveReachability({ ok: false }); });
    expect(reachabilityCalls).toBe(1);

    await act(async () => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });

    expect(reachabilityCalls).toBe(2);
  });
});
