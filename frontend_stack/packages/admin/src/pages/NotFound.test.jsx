// Behavior tests for the Admin Not Found screen added in Task 4.
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

function renderAt(path, props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotFound {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockClear();
});

describe('Admin NotFound recovery actions', () => {
  test('"Go to Overview" replaces the dead-end history entry', () => {
    renderAt('/admin/nope');

    fireEvent.click(screen.getByRole('button', { name: 'Go to Overview' }));

    expect(navigateMock).toHaveBeenCalledWith('/admin/overview', { replace: true });
  });

  test('"Go back" pops one history entry', () => {
    renderAt('/admin/nope');

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(navigateMock).toHaveBeenCalledWith(-1);
  });
});

describe('Admin NotFound diagnostics', () => {
  test('shows the attempted path', () => {
    renderAt('/admin/ops/does-not-exist');
    expect(screen.getByText('/admin/ops/does-not-exist')).toBeInTheDocument();
  });

  test('drops query and hash from the shown path', () => {
    renderAt('/admin/nope?token=secret#frag');

    expect(screen.getByText('/admin/nope')).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });
});

describe('Admin NotFound heading level', () => {
  // Inside AdminShell the TopBar already renders the page `h1`, so the in-shell
  // variant must not emit a second one.
  test('renders an h2 inside the shell (default)', () => {
    renderAt('/admin/nope');

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  test('renders an h1 when standalone (no TopBar above it)', () => {
    renderAt('/nope', { standalone: true });

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
