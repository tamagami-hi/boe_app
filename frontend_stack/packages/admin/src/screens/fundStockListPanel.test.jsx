import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
}));

const invalidateFunds = vi.fn();
vi.mock('../data/adminResources.js', () => ({
  useAdminCacheActions: () => ({ invalidateFunds }),
}));

const FundStockListPanel = (await import('./FundStockListPanel.jsx')).default;

const STOCK = {
  id: 's1',
  stockName: 'SJS Enterprises',
  quarterLabel: 'Q1 FY27',
  weightPercent: '4.5000',
  state: 'active',
  sortOrder: 1,
  exitedAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

const gets = () => request.mock.calls.filter(([, options]) => (options?.method ?? 'GET') === 'GET');
const writes = () => request.mock.calls.filter(([, options]) => (options?.method ?? 'GET') !== 'GET');

beforeEach(() => {
  request.mockReset().mockResolvedValue({ items: [STOCK] });
  invalidateFunds.mockReset();
});

describe('seeding from the fund detail response', () => {
  test('a fund whose detail listed no stocks does not trigger a second read', async () => {
    render(<FundStockListPanel fundId="f1" initialStocks={[]} />);
    await screen.findByText(/No stocks disclosed yet/u);
    expect(gets()).toHaveLength(0);
  });

  test('a fund whose detail listed stocks renders them without a read', async () => {
    render(<FundStockListPanel fundId="f1" initialStocks={[STOCK]} />);
    expect(await screen.findByText('SJS Enterprises')).toBeTruthy();
    expect(gets()).toHaveLength(0);
  });

  test('with no seed at all the panel loads the list itself', async () => {
    render(<FundStockListPanel fundId="f1" />);
    expect(await screen.findByText('SJS Enterprises')).toBeTruthy();
    expect(gets()).toHaveLength(1);
    expect(gets()[0][0]).toBe('/v1/admin/funds/f1/stocks');
  });
});

describe('write requests', () => {
  test('adding a stock sends an Idempotency-Key and refreshes the fund caches', async () => {
    request.mockImplementation((path, options = {}) => (
      (options.method ?? 'GET') === 'GET'
        ? Promise.resolve({ items: [STOCK] })
        : Promise.resolve({ stock: STOCK })
    ));
    render(<FundStockListPanel fundId="f1" initialStocks={[]} />);
    fireEvent.change(screen.getByLabelText(/Stock name/u), { target: { value: 'Newco' } });
    fireEvent.change(screen.getByLabelText(/^Quarter$/u), { target: { value: 'Q2 FY27' } });
    fireEvent.click(screen.getByRole('button', { name: /Add stock/u }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, options] = writes()[0];
    expect(path).toBe('/v1/admin/funds/f1/stocks');
    expect(options.method).toBe('POST');
    expect(options.body).toMatchObject({ stockName: 'Newco', quarterLabel: 'Q2 FY27', sortOrder: 1 });
    expect(options.headers['Idempotency-Key']).toBeTruthy();
    await waitFor(() => expect(invalidateFunds).toHaveBeenCalled());
  });

  test('marking a holding exited needs a second, explicit confirmation', async () => {
    request.mockImplementation((path, options = {}) => (
      (options.method ?? 'GET') === 'GET'
        ? Promise.resolve({ items: [STOCK] })
        : Promise.resolve({ stock: { ...STOCK, state: 'exited', exitedAt: '2026-08-02T00:00:00.000Z' } })
    ));
    render(<FundStockListPanel fundId="f1" initialStocks={[STOCK]} />);
    fireEvent.click(screen.getByRole('button', { name: /Mark exited/u }));
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Confirm exit/u }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, options] = writes()[0];
    expect(path).toBe('/v1/admin/funds/f1/stocks/s1');
    expect(options.method).toBe('DELETE');
    expect(options.headers['Idempotency-Key']).toBeTruthy();
  });

  test('an editable row PATCHes the registered stock route', async () => {
    request.mockImplementation((path, options = {}) => (
      (options.method ?? 'GET') === 'GET'
        ? Promise.resolve({ items: [STOCK] })
        : Promise.resolve({ stock: { ...STOCK, stockName: 'SJS Enterprises Ltd' } })
    ));
    render(<FundStockListPanel fundId="f1" initialStocks={[STOCK]} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/u }));
    fireEvent.change(screen.getByLabelText(/Stock name for SJS Enterprises/u), {
      target: { value: 'SJS Enterprises Ltd' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/u }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, options] = writes()[0];
    expect(path).toBe('/v1/admin/funds/f1/stocks/s1');
    expect(options.method).toBe('PATCH');
    expect(options.body.stockName).toBe('SJS Enterprises Ltd');
  });

  test('a read-only principal is offered no write control at all', () => {
    render(<FundStockListPanel fundId="f1" initialStocks={[STOCK]} canWrite={false} />);
    expect(screen.queryByRole('button', { name: /Add stock/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit/u })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark exited/u })).toBeNull();
  });
});

describe('local validation', () => {
  test('a malformed quarter never reaches the route', async () => {
    render(<FundStockListPanel fundId="f1" initialStocks={[]} />);
    fireEvent.change(screen.getByLabelText(/Stock name/u), { target: { value: 'Newco' } });
    fireEvent.change(screen.getByLabelText(/^Quarter$/u), { target: { value: 'Quarter One' } });
    fireEvent.click(screen.getByRole('button', { name: /Add stock/u }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Q1 FY27/u);
    expect(writes()).toHaveLength(0);
  });

  test('a weight outside 0..100 never reaches the route', async () => {
    render(<FundStockListPanel fundId="f1" initialStocks={[]} />);
    fireEvent.change(screen.getByLabelText(/Stock name/u), { target: { value: 'Newco' } });
    fireEvent.change(screen.getByLabelText(/^Quarter$/u), { target: { value: 'Q2 FY27' } });
    fireEvent.change(screen.getByLabelText(/Weight/u), { target: { value: '140' } });
    fireEvent.click(screen.getByRole('button', { name: /Add stock/u }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/between 0 and 100/u);
    expect(writes()).toHaveLength(0);
  });
});
