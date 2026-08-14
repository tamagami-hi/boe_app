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
vi.mock('@beonedge/client/store/AdminSessionContext.jsx', () => ({
  useAdminSession: () => sessionValue,
}));

let reachabilityCalls = 0;
let pendingResolvers = [];
vi.mock('@beonedge/client/services/authApi.js', () => ({
  checkReachability: () => {
    reachabilityCalls += 1;
    return new Promise((resolve) => { pendingResolvers.push(resolve); });
  },
}));

vi.mock('@beonedge/shared/assets/logo-on-red.svg', () => ({ default: 'logo-red.svg' }));
vi.mock('@beonedge/client/styles/mobile/base.css', () => ({}));
vi.mock('@beonedge/client/styles/mobile/auth.css', () => ({}));
vi.mock('../styles/desktop/admin.css', () => ({}));

const { default: AdminSplash } = await import('./AdminSplash.jsx');

const HOLD_MS = 1600;

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function renderSplash() {
  return render(
    <MemoryRouter initialEntries={['/admin/splash']}>
      <AdminSplash />
    </MemoryRouter>,
  );
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

describe('the admin splash gates on the server, like the client', () => {
  test('probes reachability on launch', async () => {
    renderSplash();
    await act(async () => { await flush(); });

    expect(reachabilityCalls).toBe(1);
  });

  test('does not navigate before 1600ms', async () => {
    sessionValue = { user: { id: 'a1' }, status: 'authenticated' };
    renderSplash();
    await answerProbe({ ok: true });

    await advance(HOLD_MS - 1);
    expect(navigateMock).not.toHaveBeenCalled();

    await advance(1);
    expect(navigateMock).toHaveBeenCalledWith('/admin/overview', { replace: true });
  });

  test('sends a signed-out operator to the admin login', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await answerProbe({ ok: true });
    await advance(HOLD_MS);

    expect(navigateMock).toHaveBeenCalledWith('/admin/login', { replace: true });
  });

  test('never navigates while the backend is unreachable', async () => {
    sessionValue = { user: null, status: 'anonymous' };
    renderSplash();
    await answerProbe({ ok: false });

    expect(screen.getByText('Cannot reach BeOnEdge')).toBeInTheDocument();

    await advance(HOLD_MS * 3);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('does not navigate while the session is still restoring', async () => {
    sessionValue = { user: null, status: 'restoring' };
    renderSplash();
    await answerProbe({ ok: true });
    await advance(HOLD_MS * 2);

    expect(navigateMock).not.toHaveBeenCalled();
  });
});
