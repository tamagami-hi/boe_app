// Regression test for the "Back to plans" navigation target (fixed in Task 2).
//
// The button previously navigated to `/app/orders`, a route that does not exist
// in the ClientApp route table, dumping the user on splash. It now targets
// `/app/portfolio`, the parent of mandate detail in the navigation IA.
import React from 'react';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MandateDetail from './MandateDetail.jsx';

// Force the "mandate unavailable" branch that renders the broken button.
vi.mock('../services/ordersApi.js', () => ({
  getMandate: async () => null,
  listSips: async () => [],
  requestSipControl: async () => ({}),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

test('"Back to plans" navigates to /app/portfolio', async () => {
  render(
    <MemoryRouter initialEntries={['/app/mandates/m1']}>
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
