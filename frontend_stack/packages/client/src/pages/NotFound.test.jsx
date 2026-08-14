// Behavior tests for the Not Found screen added in Task 3.
//
// The route wiring is covered in ClientApp.test.jsx / ClientRoot.test.jsx, which
// mock this module to a marker. These tests exercise the real component: its
// recovery actions must work, and it must not offer a document reload (the
// error-boundary behavior this screen deliberately avoids, because on Android a
// reload re-runs native bootstrap and the 1.6s splash).
//
// `fireEvent` rather than user-event: the harness intentionally has no
// @testing-library/user-event dependency, and a click is all that is needed.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotFound from './NotFound.jsx';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock };
});

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotFound />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockClear();
});

describe('NotFound recovery actions', () => {
  test('"Go to Home" replaces history with the dashboard', () => {
    renderAt('/app/orders');

    fireEvent.click(screen.getByRole('button', { name: 'Go to Home' }));

    // `replace` matters: the dead-end path must not stay in the back stack,
    // otherwise Android Back returns straight to Not Found.
    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard', { replace: true });
  });

  test('"Go back" pops one history entry', () => {
    renderAt('/app/orders');

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(navigateMock).toHaveBeenCalledWith(-1);
  });
});

describe('NotFound diagnostics', () => {
  test('shows the attempted path so a report is actionable', () => {
    renderAt('/app/this-route-does-not-exist');
    expect(screen.getByText(/\/app\/this-route-does-not-exist/)).toBeInTheDocument();
  });

  test('drops query and hash from the shown path', () => {
    renderAt('/app/orders?token=secret#frag');

    expect(screen.getByText(/Attempted address:/)).toHaveTextContent('/app/orders');
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  test('offers no page-reload action', () => {
    renderAt('/app/orders');

    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['Go to Home', 'Go back']);
  });
});
