// Regression test for the Portfolio → withdrawal history entry (Task 2).
//
// `/app/withdrawals` (WithdrawalRequests) existed as a route but had no UI
// entry. Portfolio now links to it; this test locks the entry and its target.
// T28 turned the entry from a `<button onClick={navigate}>` into a real link, so
// the assertion is now on the href rather than on a click side effect.
import React from 'react';
import { expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { buildPath } from '../navigation/routes.js';
import Portfolio from './Portfolio.jsx';

vi.mock('../services/portfolioApi.js', () => ({
  getPortfolio: async () => ({
    invested: 1000,
    currentValue: 1200,
    totalReturn: 200,
    returnPercent: 20,
    returnSince: '2026-01-01',
    lastUpdated: '2026-08-01',
    summary: {
      sipInstallments: 2,
      sipTotal: 1000,
      lumpSumCount: 0,
      lumpSumTotal: 0,
      redemptionCount: 0,
      redeemedTotal: 0,
      allocatedGain: 0,
    },
    pools: [{ fundId: 'f1', currentValue: 1200, invested: 1000, returnPercent: 20 }],
  }),
}));

vi.mock('../services/fundsApi.js', () => ({
  submitRedemption: async () => ({}),
}));

vi.mock('@beonedge/shared', () => ({
  EmptyState: () => null,
}));

test('Portfolio links to withdrawal history at /app/withdrawals', async () => {
  render(
    <MemoryRouter initialEntries={['/app/portfolio']}>
      <Portfolio />
    </MemoryRouter>,
  );

  const link = await screen.findByRole('link', { name: 'View withdrawal history' });
  expect(link).toHaveAttribute('href', buildPath('withdrawals'));
  expect(buildPath('withdrawals')).toBe('/app/withdrawals');
});
