// The primary screens were built out of clickable divs and an anchor with no href.
// These tests assert the semantics, not the styling: a thing that navigates must be
// a link, a thing that acts must be a button, and both must be reachable.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildPath } from '../navigation/routes.js';

/* ---- data layer stubs ------------------------------------------------------ */

const PORTFOLIO = {
  currentValue: 1200, invested: 1000, totalReturn: 200, returnPercent: 20,
  lastUpdated: '2026-08-01', source: 'admin',
};
const FUNDS = [
  { id: 'f1', name: 'Alpha Pool', tagline: 'Growth', status: 'active', riskLabel: 'high', totalPoolSize: 500000, minSip: 500, sectors: [] },
  { id: 'f2', name: 'Beta Pool', tagline: 'Waiting', status: 'coming_soon', riskLabel: 'low', totalPoolSize: 100000, minSip: 500, sectors: [] },
];
const PLANS = [{ id: 's1', fundId: 'f1', status: 'active', amount: 1000, debitDay: 5, nextDueDate: '2026-09-05' }];

let portfolioResource;
vi.mock('../data/clientResources.js', () => ({
  usePortfolio: () => portfolioResource,
  useSipPlans: () => ({ data: PLANS }),
  useResearchContext: () => ({ data: [] }),
  useFundsById: () => ({ data: Object.fromEntries(FUNDS.map((f) => [f.id, f])) }),
  useEligibility: () => ({ data: { canInvest: true } }),
  useFundList: () => ({ data: FUNDS, error: null }),
  useClientCacheActions: () => ({ invalidateMoney: () => {} }),
}));

vi.mock('../store/SessionContext.jsx', () => ({
  useSession: () => ({ user: { id: 'u1', name: 'Ada Lovelace' }, status: 'authenticated' }),
}));

// The real hook fetches remote config; the defaults are all these tests need.
vi.mock('../hooks/useAppConfig.js', () => ({
  useAppConfig: () => ({
    publishedAt: '2026-01-01',
    mobile: {
      screens: {
        dashboard: {
          copy: {
            portfolioTitle: 'Portfolio', activeSipsTitle: 'Active plans', viewAllLabel: 'View all',
            noActiveTitle: 'No plans', noActiveBody: 'Start one', noActiveCta: 'Browse strategies',
            researchTitle: 'Research', riskDisclosure: 'Market risk applies.',
          },
          quickActions: [
            { id: 'a1', label: 'Start a SIP', icon: 'Plus', route: buildPath('explore') },
            { id: 'a2', label: 'See activity', icon: 'Receipt', route: buildPath('activity') },
          ],
        },
        explore: {
          copy: { title: 'Explore', searchPlaceholder: 'Search', researchEyebrow: 'Research', allocationDisclosure: 'x' },
        },
      },
    },
  }),
}));

const { default: Dashboard } = await import('./Dashboard.jsx');
const { default: Explore } = await import('./Explore.jsx');

const renderAt = (ui, path = '/app/dashboard') =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

beforeEach(() => {
  portfolioResource = { data: PORTFOLIO, error: null, isLoading: false, isRefreshing: false, refresh: () => {} };
});

describe('Dashboard navigation is made of links', () => {
  test('the portfolio card is a link with an href, not a clickable div', () => {
    renderAt(<Dashboard />);
    const card = screen.getByRole('link', { name: /Portfolio/i });
    expect(card.tagName).toBe('A');
    expect(card).toHaveAttribute('href', buildPath('portfolio'));
  });

  test('"View all" is a real link — it used to be <a> with no href', () => {
    renderAt(<Dashboard />);
    const link = screen.getByRole('link', { name: 'View all' });
    expect(link).toHaveAttribute('href', buildPath('portfolio'));
  });

  test('a plan row is a link to its fund, and is focusable', () => {
    renderAt(<Dashboard />);
    const row = screen.getByRole('link', { name: /Alpha Pool/ });
    expect(row).toHaveAttribute('href', buildPath('fund_detail', { fundId: 'f1' }));
    row.focus();
    expect(row).toHaveFocus();
  });

  test('quick actions are links, each announced exactly once', () => {
    renderAt(<Dashboard />);
    const action = screen.getByRole('link', { name: 'Start a SIP' });
    expect(action).toHaveAttribute('href', buildPath('explore'));
    // The button version carried aria-label AND title AND the visible text, so the
    // label was announced twice and the title was dead weight on touch.
    expect(action).not.toHaveAttribute('aria-label');
    expect(action).not.toHaveAttribute('title');
  });

  test('every destination on the screen comes from the manifest', () => {
    renderAt(<Dashboard />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) expect(href.startsWith('/app/')).toBe(true);
  });

  test('a failed portfolio read shows an error with a retry, not a link', () => {
    const refresh = vi.fn();
    portfolioResource = { data: undefined, error: new Error('down'), isLoading: false, isRefreshing: false, refresh };
    renderAt(<Dashboard />);
    expect(screen.queryByRole('link', { name: /Portfolio —/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe('Explore fund cards', () => {
  test('an active fund card exposes one link to the fund', () => {
    renderAt(<Explore />, '/app/explore');
    const links = screen.getAllByRole('link', { name: /View details/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', buildPath('fund_detail', { fundId: 'f1' }));
  });

  test('no card promises keyboard operation it does not implement', () => {
    const { container } = renderAt(<Explore />, '/app/explore');
    // The card was <div role="button" tabIndex={0} onClick> with NO onKeyDown.
    expect(container.querySelectorAll('div[role="button"]').length).toBe(0);
    expect(container.querySelectorAll('div[tabindex]').length).toBe(0);
    expect(container.querySelectorAll('[data-clickable]').length).toBe(0);
  });

  test('a coming-soon card has its notify button and no fund link', () => {
    renderAt(<Explore />, '/app/explore');
    const notify = screen.getByRole('button', { name: /Notify me when open/ });
    expect(notify).toHaveAttribute('type', 'button');
    expect(screen.queryByRole('link', { name: /Beta Pool/ })).not.toBeInTheDocument();
  });

  test('the notify button works without relying on stopPropagation', () => {
    renderAt(<Explore />, '/app/explore');
    fireEvent.click(screen.getByRole('button', { name: /Notify me when open/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/Beta Pool/);
  });
});
