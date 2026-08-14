// Android Back coordinator tests (Task 16).
//
// The audit rates this HIGH risk with no existing coverage, and the failure modes
// are all silent: a listener that never registers, two listeners both acting on one
// press, a stale closure that stops closing overlays, or Back exiting the app from
// the middle of a payment. Each of those is asserted here.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* ---- Capacitor App bridge stub ---------------------------------------------- */

let backHandler = null;
let listenerCount = 0;
let removeCount = 0;
const exitApp = vi.fn(() => Promise.resolve());

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event, handler) => {
      if (event === 'backButton') {
        backHandler = handler;
        listenerCount += 1;
      }
      return Promise.resolve({ remove: () => { removeCount += 1; backHandler = null; } });
    },
    exitApp: () => exitApp(),
  },
}));

const navigateMock = vi.fn();
let currentPathname = '/app/dashboard';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ pathname: currentPathname, search: '', hash: '' }),
  };
});

const { OverlayStackProvider, useOverlayRegistration } = await import('@beonedge/shared/overlay/OverlayStackContext.jsx');
const { default: NativeBackCoordinator } = await import('./NativeBackCoordinator.jsx');
const { resolveClientBackPolicy } = await import('@beonedge/client/navigation/backPolicy.js');

/* ---- harness ---------------------------------------------------------------- */

function OpenOverlay({ onDismiss, dismissible = true }) {
  useOverlayRegistration(true, { onDismiss, dismissible });
  return null;
}

function renderCoordinator({ children, onTransactionalBack } = {}) {
  return render(
    <MemoryRouter>
      <OverlayStackProvider>
        <NativeBackCoordinator
          resolvePolicy={resolveClientBackPolicy}
          onTransactionalBack={onTransactionalBack}
        />
        {children}
      </OverlayStackProvider>
    </MemoryRouter>,
  );
}

/** Fire the native Back press and let React commit any resulting state. */
async function pressBack({ canGoBack = false } = {}) {
  await act(async () => {
    await backHandler?.({ canGoBack });
  });
}

beforeEach(() => {
  backHandler = null;
  listenerCount = 0;
  removeCount = 0;
  exitApp.mockClear();
  navigateMock.mockClear();
  currentPathname = '/app/dashboard';
});

/* ---- registration ---------------------------------------------------------- */

describe('listener registration', () => {
  test('registers exactly one backButton listener', async () => {
    await act(async () => { renderCoordinator(); });
    expect(listenerCount).toBe(1);
    expect(backHandler).toBeTypeOf('function');
  });

  test('removes the listener on unmount, so a remount cannot double-handle', async () => {
    let view;
    await act(async () => { view = renderCoordinator(); });
    await act(async () => { view.unmount(); });

    expect(removeCount).toBe(1);
  });

  test('navigating does not re-register the listener', async () => {
    await act(async () => { renderCoordinator(); });
    currentPathname = '/app/explore';
    await pressBack();

    // A stale-closure bug would show up as either a second registration or a Back
    // press acting on the old pathname.
    expect(listenerCount).toBe(1);
  });
});

/* ---- priority 1: overlays -------------------------------------------------- */

describe('overlays take priority over navigation', () => {
  test('Back closes the top overlay instead of navigating', async () => {
    const dismiss = vi.fn();
    currentPathname = '/app/funds/f1';
    await act(async () => { renderCoordinator({ children: <OpenOverlay onDismiss={dismiss} /> }); });

    await pressBack();

    expect(dismiss).toHaveBeenCalledTimes(1);
    // The screen underneath must not move — this was the original defect.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('nested overlays close one at a time, last opened first', async () => {
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => {
      renderCoordinator({
        children: (
          <>
            <OpenOverlay onDismiss={first} />
            <OpenOverlay onDismiss={second} />
          </>
        ),
      });
    });

    await pressBack();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  test('a non-dismissible overlay absorbs Back without closing or navigating', async () => {
    // e.g. a payment confirmation mid-submit: Back must not abandon it.
    const dismiss = vi.fn();
    currentPathname = '/app/payment/p1';
    await act(async () => {
      renderCoordinator({ children: <OpenOverlay onDismiss={dismiss} dismissible={false} /> });
    });

    await pressBack();

    expect(dismiss).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
  });
});

/* ---- priority 2: transactional -------------------------------------------- */

describe('transactional routes', () => {
  test('the transaction owner can intercept Back', async () => {
    const onTransactionalBack = vi.fn(() => true);
    currentPathname = '/app/invest/sip/f1';
    await act(async () => { renderCoordinator({ onTransactionalBack }); });

    await pressBack();

    expect(onTransactionalBack).toHaveBeenCalledWith({ pathname: '/app/invest/sip/f1' });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('declining to intercept falls through to the declared parent', async () => {
    const onTransactionalBack = vi.fn(() => false);
    currentPathname = '/app/invest/sip/f1';
    await act(async () => { renderCoordinator({ onTransactionalBack }); });

    await pressBack();

    // The manifest parent of the SIP flow is the fund it belongs to, with the id
    // substituted back in.
    expect(navigateMock).toHaveBeenCalledWith('/app/funds/f1', { replace: true });
  });

  test('a completed flow is never re-entered by Back', async () => {
    currentPathname = '/app/mandates/m1/authorize';
    await act(async () => { renderCoordinator(); });

    await pressBack({ canGoBack: true });

    // Goes to the mandate, NOT back into history where the authorize step sits.
    expect(navigateMock).toHaveBeenCalledWith('/app/mandates/m1', { replace: true });
  });
});

/* ---- priority 3: secondary routes ----------------------------------------- */

describe('secondary routes go to their logical parent', () => {
  const cases = [
    ['/app/statements', '/app/profile'],
    ['/app/notifications', '/app/dashboard'],
    ['/app/withdrawals', '/app/portfolio'],
    ['/app/funds/f1', '/app/explore'],
    ['/app/profile/security', '/app/profile'],
  ];

  for (const [from, parent] of cases) {
    test(`${from} -> ${parent}`, async () => {
      currentPathname = from;
      await act(async () => { renderCoordinator(); });

      await pressBack();

      expect(navigateMock).toHaveBeenCalledWith(parent, { replace: true });
    });
  }

  test('works with no history entry at all — the deep-link case', async () => {
    // Opened from a notification: there is nothing to pop, but there is always a
    // logical parent. This is why the coordinator uses the manifest, not history.
    currentPathname = '/app/statements';
    await act(async () => { renderCoordinator(); });

    await pressBack({ canGoBack: false });

    expect(navigateMock).toHaveBeenCalledWith('/app/profile', { replace: true });
    expect(exitApp).not.toHaveBeenCalled();
  });
});

/* ---- priority 4 and 5: primary tabs and exit ------------------------------ */

describe('primary tabs and exit', () => {
  const nonHomeTabs = ['/app/explore', '/app/portfolio', '/app/transactions', '/app/profile'];

  for (const tab of nonHomeTabs) {
    test(`${tab} returns to Home rather than replaying tab history`, async () => {
      currentPathname = tab;
      await act(async () => { renderCoordinator(); });

      await pressBack({ canGoBack: true });

      expect(navigateMock).toHaveBeenCalledWith('/app/dashboard', { replace: true });
      expect(exitApp).not.toHaveBeenCalled();
    });
  }

  test('Home exits the app when there is nothing to go back to', async () => {
    currentPathname = '/app/dashboard';
    await act(async () => { renderCoordinator(); });

    await pressBack({ canGoBack: false });

    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('Home prefers a real history entry over exiting', async () => {
    currentPathname = '/app/dashboard';
    await act(async () => { renderCoordinator(); });

    await pressBack({ canGoBack: true });

    expect(navigateMock).toHaveBeenCalledWith(-1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  test('a public screen exits rather than bouncing around pre-auth screens', async () => {
    currentPathname = '/app/login';
    await act(async () => { renderCoordinator(); });

    await pressBack({ canGoBack: false });

    expect(exitApp).toHaveBeenCalledTimes(1);
  });
});

/* ---- unknown routes -------------------------------------------------------- */

describe('unknown routes', () => {
  test('fall back to Home when there is no history', async () => {
    currentPathname = '/app/this-does-not-exist';
    await act(async () => { renderCoordinator(); });

    await pressBack({ canGoBack: false });

    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard', { replace: true });
    expect(exitApp).not.toHaveBeenCalled();
  });

  test('prefer history when there is some', async () => {
    currentPathname = '/app/this-does-not-exist';
    await act(async () => { renderCoordinator(); });

    await pressBack({ canGoBack: true });

    expect(navigateMock).toHaveBeenCalledWith(-1);
  });
});

/* ---- robustness ------------------------------------------------------------ */

describe('robustness', () => {
  test('a throwing dismiss handler does not wedge Back', async () => {
    const throwing = () => { throw new Error('boom'); };
    currentPathname = '/app/statements';
    await act(async () => { renderCoordinator({ children: <OpenOverlay onDismiss={throwing} /> }); });

    // First press: absorbed by the overlay, which throws but is still removed.
    await pressBack();
    // Second press: the stack is empty, so navigation resumes normally.
    await pressBack();

    expect(navigateMock).toHaveBeenCalledWith('/app/profile', { replace: true });
  });
});
