// AppBar back-affordance tests (Task 17).
//
// The old behaviour was an unconditional `navigate(-1)`, which is only correct when
// the user tapped their way here. These tests pin the cases where it was not:
// a deep link with no history, and a route whose parent is the only sensible answer.
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppBar from './AppBar.jsx';

const navigateMock = vi.fn();
let currentPathname = '/app/statements';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ pathname: currentPathname, search: '', hash: '' }),
  };
});

/** React Router tracks its position in history as `window.history.state.idx`. */
function setHistoryIndex(idx) {
  window.history.replaceState(idx === undefined ? null : { idx }, '');
}

function renderBar(props = {}) {
  return render(
    <MemoryRouter>
      <AppBar title="Statements" {...props} />
    </MemoryRouter>,
  );
}

const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));

beforeEach(() => {
  navigateMock.mockClear();
  currentPathname = '/app/statements';
});

afterEach(() => {
  setHistoryIndex(undefined);
});

describe('with history to pop', () => {
  test('pops, which preserves the parent scroll position and cached state', () => {
    setHistoryIndex(3);
    renderBar();

    back();

    expect(navigateMock).toHaveBeenCalledWith(-1);
  });
});

describe('without history — the deep-link case', () => {
  test('goes to the declared parent instead of doing nothing', () => {
    // Opened from a notification: idx 0 means this is the first entry, so
    // `navigate(-1)` had nothing to pop and the button appeared dead.
    setHistoryIndex(0);
    renderBar();

    back();

    expect(navigateMock).toHaveBeenCalledWith('/app/profile', { replace: true });
  });

  test('substitutes route params back into a parameterised parent', () => {
    setHistoryIndex(0);
    currentPathname = '/app/invest/sip/f1';
    renderBar();

    back();

    expect(navigateMock).toHaveBeenCalledWith('/app/funds/f1', { replace: true });
  });

  test('falls back to Home for a route with no parent', () => {
    setHistoryIndex(0);
    currentPathname = '/app/dashboard';
    renderBar();

    back();

    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard', { replace: true });
  });

  test('falls back to Home for an unknown route', () => {
    setHistoryIndex(0);
    currentPathname = '/app/nope';
    renderBar();

    back();

    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard', { replace: true });
  });

  test('treats a missing history state as no history', () => {
    setHistoryIndex(undefined);
    renderBar();

    back();

    expect(navigateMock).toHaveBeenCalledWith('/app/profile', { replace: true });
  });
});

describe('explicit onLeft', () => {
  test('always wins, so a multi-step flow keeps its own semantics', () => {
    const onLeft = vi.fn();
    setHistoryIndex(3);
    renderBar({ onLeft });

    back();

    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
