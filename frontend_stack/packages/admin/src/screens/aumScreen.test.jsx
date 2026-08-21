import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AumScreen, { CollectiveAumTab, CurrentAumTab } from './AumScreen.jsx';
import FundAumPanel, { AUM_BOUNDARY_NOTE } from './FundAumPanel.jsx';
import FundAumHistoryPanel from './FundAumHistoryPanel.jsx';

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
}));

const invalidateAum = vi.fn();
const invalidateFunds = vi.fn();
vi.mock('../data/adminResources.js', () => ({
  useAdminFunds: () => ({
    rows: [
      { id: 'f1', name: 'Edge Growth', slug: 'edge-growth', status: 'published', aumPaise: '250000000', aumAsOfDate: '2026-08-01' },
      { id: 'f2', name: 'Steady Income', slug: 'steady-income', status: 'published', aumPaise: null, aumAsOfDate: null },
      { id: 'f3', name: 'Retired Fund', slug: 'retired-fund', status: 'archived', aumPaise: '100', aumAsOfDate: '2026-01-01' },
    ],
    summary: { total: 3, byState: { draft: 0, review_pending: 0, published: 2, paused: 0, archived: 1 } },
    isLoading: false,
    error: null,
    hasMore: false,
    loadingMore: false,
    loadMore: () => {},
  }),
  useAdminCacheActions: () => ({ invalidateAum, invalidateFunds }),
}));

let mockUser = { id: 'a1', permissions: ['aum.write'] };
vi.mock('@beonedge/client/store/AdminSessionContext.jsx', () => ({
  useAdminSession: () => ({ user: mockUser }),
}));

vi.mock('../data/AdminReadError.jsx', () => ({ default: () => null }));

const HISTORY = [
  {
    id: 'snap_2', asOfDate: '2026-08-01', revision: 2, aumPaise: '250000000',
    reasonCode: 'monthly_valuation', createdAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'snap_1', asOfDate: '2026-07-01', revision: 1, aumPaise: '240000000',
    reasonCode: 'initial_seed', createdAt: '2026-07-01T10:00:00.000Z',
  },
];

beforeEach(() => {
  request.mockReset().mockResolvedValue({ items: [] });
  invalidateAum.mockReset();
  mockUser = { id: 'a1', permissions: ['aum.write'] };
});

function renderAt(ui, path = '/admin/aum/current') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

const lastPost = () => {
  const call = [...request.mock.calls].reverse().find(([, options]) => options?.method === 'POST');
  return call;
};

describe('the screen shell', () => {
  test('AUM navigation is not duplicated inside the page', () => {
    renderAt(<AumScreen tab="collective" />, '/admin/aum/collective');
    for (const label of ['Current published AUM', 'Collective fund growth', 'History and corrections']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
    expect(screen.getByRole('heading', { name: /Collective fund growth/u })).toBeTruthy();
  });

  test('each route renders only its own task', () => {
    renderAt(<AumScreen tab="current" />, '/admin/aum/current');
    expect(screen.getByRole('heading', { name: /Current published AUM/u })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Collective fund growth/u })).toBeNull();
  });
});

describe('CurrentAumTab', () => {
  test('published funds show their figure and as-of date; unpublished ones say so', () => {
    renderAt(<CurrentAumTab />);
    expect(screen.getByText(/25,00,000/u)).toBeTruthy();
    expect(screen.getByText('2026-08-01')).toBeTruthy();
    expect(screen.getByText('Not published')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /Open fund/u });
    expect(links.map((link) => link.getAttribute('href')))
      .toEqual(['/admin/funds/f1', '/admin/funds/f2', '/admin/funds/f3']);
  });
});

describe('FundAumPanel', () => {
  test('the boundary sentence is on screen verbatim', async () => {
    render(<FundAumPanel fundId="f1" />);
    expect(screen.getByText(AUM_BOUNDARY_NOTE)).toBeTruthy();
  });

  test('a fund with no snapshot publishes an opening figure the route accepts', async () => {
    request.mockResolvedValue({ items: [] });
    render(<FundAumPanel fundId="f2" />);
    const input = await screen.findByLabelText(/Opening AUM/u);
    fireEvent.change(input, { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText(/Reason/u), { target: { value: 'initial_publication' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish opening AUM/u }));
    await Promise.resolve();
    await Promise.resolve();
    const [path, options] = lastPost();
    expect(path).toBe('/v1/admin/aum/funds/f2/initialize');
    expect(options.body.aumPaise).toBe('10000000');
    expect(options.body).not.toHaveProperty('amountPaise');
    expect(options.body.reasonCode).toBe('initial_publication');
    expect(options.body.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(options.headers['Idempotency-Key']).toBeTruthy();
    expect(invalidateAum).toHaveBeenCalled();
  });

  test('a failed history read is never treated as an empty history', async () => {
    request.mockRejectedValue(new Error('Read failed'));
    render(<FundAumPanel fundId="f2" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Read failed');
    expect(screen.queryByLabelText(/Opening AUM/u)).toBeNull();
    expect(screen.getByRole('button', { name: /Try again/u })).toBeTruthy();
  });

  test('a growth commit sends one signed instruction, string paise, and no movement fields', async () => {
    request.mockResolvedValue({ items: HISTORY });
    render(<FundAumPanel fundId="f1" />);
    const input = await screen.findByLabelText(/Amount \(₹\)/u);
    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/Reason/u), { target: { value: 'monthly_valuation' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish AUM adjustment/u }));
    await Promise.resolve();
    await Promise.resolve();
    const [path, options] = lastPost();
    expect(path).toBe('/v1/admin/aum/funds/f1/growth');
    expect(options.body.growthPaise).toBe('500000');
    expect(options.body).not.toHaveProperty('growthBasisPoints');
    for (const ghost of ['newInvestmentsPaise', 'redemptionsPaise', 'portfolioGainPaise', 'userId', 'orderId', 'paymentId']) {
      expect(options.body, ghost).not.toHaveProperty(ghost);
    }
    expect(options.headers['Idempotency-Key']).toBeTruthy();
  });

  test('a decrease in percentage commits as negative basis points', async () => {
    request.mockResolvedValue({ items: HISTORY });
    render(<FundAumPanel fundId="f1" />);
    await screen.findByLabelText(/Instruction/u);
    fireEvent.change(screen.getByLabelText(/Instruction/u), { target: { value: 'percentage' } });
    fireEvent.change(screen.getByLabelText(/Direction/u), { target: { value: 'decrease' } });
    fireEvent.change(screen.getByLabelText(/Percentage \(%\)/u), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText(/Reason/u), { target: { value: 'market_movement' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish AUM adjustment/u }));
    await Promise.resolve();
    await Promise.resolve();
    const [, options] = lastPost();
    expect(options.body.growthBasisPoints).toBe(-150);
    expect(options.body).not.toHaveProperty('growthPaise');
  });

  test('a missing reason code never reaches the route', async () => {
    request.mockResolvedValue({ items: HISTORY });
    render(<FundAumPanel fundId="f1" />);
    const input = await screen.findByLabelText(/Amount \(₹\)/u);
    fireEvent.change(input, { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish AUM adjustment/u }));
    await Promise.resolve();
    expect(lastPost()).toBeUndefined();
    expect(screen.getByRole('alert').textContent).toContain('Choose a reason');
  });
});

describe('CollectiveAumTab', () => {
  const PREVIEW = {
    basisHash: 'bh_aum',
    items: [
      { fundId: 'f1', beforeAumPaise: '250000000', deltaPaise: '5000000', afterAumPaise: '255000000' },
    ],
  };

  function selectAndFill() {
    fireEvent.click(screen.getByLabelText(/Edge Growth/u));
    fireEvent.change(screen.getByLabelText(/Percentage \(%\)/u), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Reason/u), { target: { value: 'monthly_valuation' } });
  }

  test('an archived fund is not offered as a growth target', () => {
    renderAt(<CollectiveAumTab />);
    expect(screen.queryByLabelText(/Retired Fund/u)).toBeNull();
  });

  test('the preview renders the before and after values the route returns', async () => {
    request.mockResolvedValue(PREVIEW);
    renderAt(<CollectiveAumTab />);
    selectAndFill();
    fireEvent.click(screen.getByRole('button', { name: /Preview growth/u }));
    const table = await screen.findByRole('table');
    expect(table.textContent).toContain('25,00,000');
    expect(table.textContent).toContain('25,50,000');
  });

  test('editing an input after a preview discards it, so a stale basis cannot be committed', async () => {
    request.mockResolvedValue(PREVIEW);
    renderAt(<CollectiveAumTab />);
    selectAndFill();
    fireEvent.click(screen.getByRole('button', { name: /Preview growth/u }));
    expect(await screen.findByRole('button', { name: /Commit growth/u })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Percentage \(%\)/u), { target: { value: '9' } });
    expect(screen.queryByRole('button', { name: /Commit growth/u })).toBeNull();
  });

  test('the banner is on screen and the preview sends no Idempotency-Key or basisHash', async () => {
    request.mockResolvedValue(PREVIEW);
    renderAt(<CollectiveAumTab />);
    expect(screen.getByText(AUM_BOUNDARY_NOTE)).toBeTruthy();
    selectAndFill();
    fireEvent.click(screen.getByRole('button', { name: /Preview growth/u }));
    await screen.findByText(/Nothing has been committed yet/u);
    const [path, options] = request.mock.calls[0];
    expect(path).toBe('/v1/admin/aum/growth/collective/preview');
    expect(options.body).toMatchObject({
      fundIds: ['f1'],
      growthBasisPoints: 200,
      reasonCode: 'monthly_valuation',
    });
    expect(options.body).not.toHaveProperty('basisHash');
    expect(options.body).not.toHaveProperty('totalPaise');
    expect(options.headers).toBeUndefined();
  });

  test('the commit adds the basisHash and an Idempotency-Key, then invalidates AUM caches', async () => {
    request.mockResolvedValueOnce(PREVIEW).mockResolvedValueOnce({ targetCount: 1 });
    renderAt(<CollectiveAumTab />);
    selectAndFill();
    fireEvent.click(screen.getByRole('button', { name: /Preview growth/u }));
    fireEvent.click(await screen.findByRole('button', { name: /Commit growth/u }));
    await Promise.resolve();
    const [path, options] = request.mock.calls[1];
    expect(path).toBe('/v1/admin/aum/growth/collective');
    expect(options.body.basisHash).toBe('bh_aum');
    expect(options.headers['Idempotency-Key']).toBeTruthy();
    expect(invalidateAum).toHaveBeenCalled();
  });

  test('explicit mode sends a signed delta per fund, never one shared total', async () => {
    request.mockResolvedValue({ basisHash: 'bh_x', items: [] });
    renderAt(<CollectiveAumTab />);
    fireEvent.click(screen.getByLabelText(/Edge Growth/u));
    fireEvent.change(screen.getByLabelText(/Mode/u), { target: { value: 'explicit' } });
    fireEvent.change(screen.getByLabelText('Edge Growth', { selector: 'input[type="number"]' }), { target: { value: '-100000' } });
    fireEvent.change(screen.getByLabelText(/Reason/u), { target: { value: 'monthly_valuation' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview growth/u }));
    await Promise.resolve();
    const [, options] = request.mock.calls[0];
    expect(options.body.items).toEqual([{ fundId: 'f1', growthPaise: '-10000000' }]);
    expect(options.body).not.toHaveProperty('totalPaise');
    expect(options.body).not.toHaveProperty('growthBasisPoints');
    expect(options.body).not.toHaveProperty('fundIds');
  });
});

describe('FundAumHistoryPanel', () => {
  test('the history lists every snapshot, newest flagged authoritative', async () => {
    request.mockResolvedValue({ items: HISTORY });
    render(<FundAumHistoryPanel fundId="f1" />);
    await screen.findByText('monthly_valuation');
    expect(screen.getByText(/authoritative/u)).toBeTruthy();
    expect(screen.getByText('initial_seed')).toBeTruthy();
  });

  test('a correction posts a new revision body with an Idempotency-Key', async () => {
    request.mockResolvedValue({ items: HISTORY });
    render(<FundAumHistoryPanel fundId="f1" />);
    const [correct] = await screen.findAllByRole('button', { name: 'Correct' });
    fireEvent.click(correct);
    fireEvent.change(screen.getByLabelText(/Corrected AUM/u), { target: { value: '2510000' } });
    fireEvent.change(screen.getByLabelText(/Reason/u), { target: { value: 'valuation_error' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish correction/u }));
    await Promise.resolve();
    await Promise.resolve();
    const [path, options] = lastPost();
    expect(path).toBe('/v1/admin/aum/snapshots/snap_2/corrections');
    expect(options.body).toMatchObject({
      aumPaise: '251000000',
      reasonCode: 'valuation_error',
    });
    expect(options.body).not.toHaveProperty('amountPaise');
    expect(options.body).not.toHaveProperty('asOfDate');
    expect(options.headers['Idempotency-Key']).toBeTruthy();
    expect(invalidateAum).toHaveBeenCalled();
  });

  test('the correction action is hidden without aum.write', async () => {
    mockUser = { id: 'a2', permissions: ['aum.read'] };
    request.mockResolvedValue({ items: HISTORY });
    render(<FundAumHistoryPanel fundId="f1" />);
    await screen.findByText('monthly_valuation');
    expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull();
  });
});
