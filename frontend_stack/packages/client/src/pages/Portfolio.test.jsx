import React from 'react';
import { expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Portfolio from './Portfolio.jsx';

vi.mock('../services/portfolioApi.js', () => ({
  getPortfolio: async () => ({
    invested: 1000,
    currentValue: 1200,
    totalReturn: 200,
    returnPercent: 20,
    returnSince: '2026-01-01',
    lastUpdated: '2026-08-01',
    summary: { sipInstallments: 2, sipTotal: 1000, lumpSumCount: 0, lumpSumTotal: 0, allocatedGain: 0 },
    pools: [{ fundId: 'f1', currentValue: 1200, invested: 1000, returnPercent: 20 }],
  }),
}));

vi.mock('@beonedge/shared', () => ({ EmptyState: () => null }));

test('Portfolio does not advertise unsupported redemptions or withdrawal history', async () => {
  render(<MemoryRouter initialEntries={['/app/portfolio']}><Portfolio /></MemoryRouter>);

  expect(await screen.findByText('Current portfolio value')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Redeem' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View withdrawal history' })).not.toBeInTheDocument();
});
