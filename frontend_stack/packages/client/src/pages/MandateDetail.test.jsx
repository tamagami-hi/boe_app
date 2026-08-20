// Regression test for the "Back to plans" navigation target (fixed in Task 2).
//
// The button previously navigated to `/app/orders`, a route that does not exist
// in the ClientApp route table, dumping the user on splash. It now targets
// `/app/portfolio`, the parent of the plan detail in the navigation IA.
import React from 'react';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MandateDetail from './MandateDetail.jsx';

// Force the "plan unavailable" branch that renders the broken button: no plan
// with this id exists on the account.
vi.mock('../services/ordersApi.js', () => ({
  listSips: async () => [],
  listOrders: async () => [],
  requestSipControl: async () => ({}),
}));

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
