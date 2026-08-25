// Regression test for the "Back to plans" navigation target (fixed in Task 2).
//
// The button previously navigated to `/app/orders`, a route that does not exist
// in the ClientApp route table, dumping the user on splash. It now targets
// `/app/portfolio`, the parent of the plan detail in the navigation IA.
import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MandateDetail from './MandateDetail.jsx';

const getAutoPaySip = vi.fn();
const listSips = vi.fn();

// Force the "plan unavailable" branch that renders the broken button: no plan
// with this id exists on the account.
vi.mock('../services/ordersApi.js', () => ({
  getAutoPaySip: (...args) => getAutoPaySip(...args),
  listSips: (...args) => listSips(...args),
  listOrders: async () => [],
  requestSipControl: async () => ({}),
  cancelAutoPaySip: async () => ({}),
  retryAutoPaySetup: async () => ({}),
}));

beforeEach(() => {
  getAutoPaySip.mockReset().mockResolvedValue(null);
  listSips.mockReset().mockResolvedValue([]);
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

test('"Back to plans" navigates to /app/portfolio', async () => {
  render(
    <MemoryRouter initialEntries={['/app/mandates/s1']}>
      <Routes>
        <Route path="/app/mandates/:mandateId" element={<MandateDetail />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );

  const button = await screen.findByRole('button', { name: 'Back to plans' });
  fireEvent.click(button);

  expect(await screen.findByTestId('location')).toHaveTextContent('/app/portfolio');
});

test('AutoPay state comes from mandate detail and has no merchant pause controls', async () => {
  getAutoPaySip.mockResolvedValue({
    id: 's1',
    collectionMode: 'phonepe_autopay',
    status: 'active',
    amount: 1000,
    debitDay: 5,
    durationMonths: 12,
    mandate: { id: 'm1', status: 'active' },
  });

  render(
    <MemoryRouter initialEntries={['/app/mandates/s1']}>
      <Routes>
        <Route path="/app/mandates/:mandateId" element={<MandateDetail />} />
      </Routes>
    </MemoryRouter>,
  );

  expect((await screen.findAllByText('Active')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  expect(listSips).not.toHaveBeenCalled();
});

test('shows setup retry only when the backend explicitly allows it', async () => {
  getAutoPaySip.mockResolvedValue({
    id: 's1',
    collectionMode: 'phonepe_autopay',
    status: 'pending_mandate',
    canRetrySetup: false,
    amount: 1000,
    debitDay: 5,
    durationMonths: 12,
    mandate: { id: 'm1', status: 'setup_pending' },
  });

  const first = render(
    <MemoryRouter initialEntries={['/app/mandates/s1']}>
      <Routes><Route path="/app/mandates/:mandateId" element={<MandateDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect((await screen.findAllByText('Awaiting authorization')).length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Retry authorization' })).not.toBeInTheDocument();
  first.unmount();

  getAutoPaySip.mockResolvedValue({
    id: 's1',
    collectionMode: 'phonepe_autopay',
    status: 'pending_mandate',
    canRetrySetup: true,
    latestSetupState: 'failed',
    amount: 1000,
    debitDay: 5,
    durationMonths: 12,
    mandate: { id: 'm1', status: 'setup_pending' },
  });
  render(
    <MemoryRouter initialEntries={['/app/mandates/s1']}>
      <Routes><Route path="/app/mandates/:mandateId" element={<MandateDetail />} /></Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('button', { name: 'Retry authorization' })).toBeInTheDocument();
});
