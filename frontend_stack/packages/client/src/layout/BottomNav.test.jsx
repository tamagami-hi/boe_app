// BottomNav semantics tests (Task 17).
import React from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BottomNav from './BottomNav.jsx';
import { CLIENT_ROUTES } from '../navigation/routes.js';

function renderNav(at = '/app/dashboard') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <BottomNav />
    </MemoryRouter>,
  );
}

describe('link semantics', () => {
  test('destinations are links, not ARIA tabs', () => {
    // `role="tab"` promised a keyboard contract the app does not implement: a
    // tablist parent, arrow-key movement, aria-selected, associated tabpanels.
    // These change the URL, so they are links.
    renderNav();

    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  test('the active destination is marked with aria-current', () => {
    renderNav('/app/portfolio');

    const current = screen.getByRole('link', { current: 'page' });
    expect(current).toHaveAttribute('href', '/app/portfolio');
  });

  test('each link has exactly one accessible name', () => {
    // An aria-label duplicating the visible text produced a doubled announcement.
    renderNav();

    for (const label of ['Home', 'Explore', 'Portfolio', 'Transactions', 'Profile']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  test('the nav landmark is labelled', () => {
    renderNav();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });
});

describe('destinations come from the route manifest', () => {
  test('every tab targets a real primary route', () => {
    renderNav();

    const primaryPaths = CLIENT_ROUTES
      .filter((route) => route.showsBottomNav)
      .map((route) => route.path)
      .sort();

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href')).sort();
    expect(hrefs).toEqual(primaryPaths);
  });

  test('a descendant route does not light up its ancestor tab', () => {
    // `end` matching: /app/profile/security is a pushed screen, not the Profile tab.
    renderNav('/app/profile/security');

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
  });
});
