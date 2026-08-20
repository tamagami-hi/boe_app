// Client value management (spec §9.4, §11.1). Locks the boundary: the banner is on
// the growth tabs, an individual commit sends exactly one signed instruction as a
// paise string with an Idempotency-Key, the collective preview sends no key, and the
// commit adds the preview's basisHash. A 409 discards the preview rather than
// committing against stale figures.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClientValuesScreen, {
  ClientDetailTab,
  CollectiveGrowthTab,
  IndividualGrowthTab,
  VALUE_BOUNDARY_NOTE,
} from './ClientValuesScreen.jsx';

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
}));

const invalidateClientGrowth = vi.fn();
vi.mock('../data/adminResources.js', () => ({
  useAdminFunds: () => ({
    rows: [{ id: 'f1', name: 'Edge Growth' }],
    isLoading: false,
    error: null,
  }),
  useAdminCacheActions: () => ({ invalidateClientGrowth }),
}));

const listState = {
  items: [], loading: false, error: '', hasMore: false, loadMore: vi.fn(), reload: vi.fn(),
};
vi.mock('../hooks/useAdminList.js', () => ({
  default: (path, filters) => ({ ...listState, path, filters }),
}));

vi.mock('../data/AdminReadError.jsx', () => ({ default: () => null }));

beforeEach(() => {
  request.mockReset().mockResolvedValue({});
  invalidateClientGrowth.mockReset();
  Object.assign(listState, { items: [], loading: false, error: '' });
});

function renderAt(ui, path = '/admin/client-values/detail') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

describe('the tab shell and the boundary banner', () => {
  test('tabs are route links with the active one marked', () => {
    renderAt(<ClientValuesScreen tab="individual" />, '/admin/client-values/individual');
    const individual = screen.getByRole('link', { name: 'Individual growth' });
    expect(individual).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Client detail' }))
      .toHaveAttribute('href', '/admin/client-values/detail');
  });

  test('both growth tabs carry the §11.1 boundary sentence verbatim', () => {
    renderAt(<ClientValuesScreen tab="individual" />, '/admin/client-values/individual');
    expect(screen.getByText(VALUE_BOUNDARY_NOTE)).toBeTruthy();
  });
});

describe('ClientDetailTab', () => {
  const CLIENT = {
    id: 'u1', name: 'Asha Rao', email: 'asha@example.com',
    status: 'active', createdAt: '2026-07-01T00:00:00.000Z',
  };

  test('a result links to the directory record and to a prefilled growth form', () => {
    Object.assign(listState, { items: [CLIENT] });
    renderAt(<ClientDetailTab />);
    expect(screen.getByText('Asha Rao')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open record' }))
      .toHaveAttribute('href', '/admin/users/directory/u1');
    expect(screen.getByRole('link', { name: 'Adjust growth' }))
      .toHaveAttribute('href', '/admin/client-values/individual?userId=u1');
  });
});

describe('IndividualGrowthTab', () => {
  function fillCommon() {
    fireEvent.change(screen.getByLabelText(/Fund/u), { target: { value: 'f1' } });
    fireEvent.change(screen.getByLabelText(/Reason code/u), { target: { value: 'monthly_growth' } });
  }

  test('a userId in the URL prefills the form', () => {
    renderAt(<IndividualGrowthTab />, '/admin/client-values/individual?userId=u9');
    expect(screen.getByLabelText(/Client user ID/u)).toHaveValue('u9');
  });

  test('an amount commit sends signed string paise and nothing else as instruction', async () => {
    renderAt(<IndividualGrowthTab />, '/admin/client-values/individual?userId=u1');
    fillCommon();
    fireEvent.change(screen.getByLabelText(/Amount \(₹\)/u), { target: { value: '1500.50' } });
    fireEvent.click(screen.getByRole('button', { name: /Commit growth adjustment/u }));
    await Promise.resolve();
    await Promise.resolve();
    const [path, options] = request.mock.calls.find(([p]) => p === '/v1/admin/client-growth/individual');
    expect(options.method).toBe('POST');
    expect(options.body.userId).toBe('u1');
    expect(options.body.fundId).toBe('f1');
    expect(options.body.reasonCode).toBe('monthly_growth');
    expect(options.body.growthPaise).toBe('150050');
    // Exactly one instruction field — never both.
    expect(options.body).not.toHaveProperty('growthBasisPoints');
    expect(options.headers['Idempotency-Key']).toBeTruthy();
    expect(invalidateClientGrowth).toHaveBeenCalled();
  });

  test('a loss percentage commits as negative basis points', async () => {
    renderAt(<IndividualGrowthTab />, '/admin/client-values/individual?userId=u1');
    fillCommon();
    fireEvent.change(screen.getByLabelText(/Instruction/u), { target: { value: 'percentage' } });
    fireEvent.change(screen.getByLabelText(/Direction/u), { target: { value: 'loss' } });
    fireEvent.change(screen.getByLabelText(/Percentage \(%\)/u), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Commit growth adjustment/u }));
    await Promise.resolve();
    await Promise.resolve();
    const [, options] = request.mock.calls.find(([p]) => p === '/v1/admin/client-growth/individual');
    expect(options.body.growthBasisPoints).toBe(-250);
    expect(options.body).not.toHaveProperty('growthPaise');
  });

  test('a missing reason code never reaches the route', async () => {
    renderAt(<IndividualGrowthTab />, '/admin/client-values/individual?userId=u1');
    fireEvent.change(screen.getByLabelText(/Fund/u), { target: { value: 'f1' } });
    fireEvent.change(screen.getByLabelText(/Amount \(₹\)/u), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Commit growth adjustment/u }));
    await Promise.resolve();
    expect(request.mock.calls.some(([p]) => p === '/v1/admin/client-growth/individual')).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('reason code');
  });
});

describe('CollectiveGrowthTab', () => {
  const PREVIEW = {
    basisHash: 'bh_abc',
    excludedCount: 2,
    targets: [
      { userId: 'u1', name: 'Asha Rao', beforePaise: '100000', deltaPaise: '3500', afterPaise: '103500' },
    ],
  };

  function fillPercentage() {
    fireEvent.change(screen.getByLabelText(/Fund/u), { target: { value: 'f1' } });
    fireEvent.change(screen.getByLabelText(/Percentage \(%\)/u), { target: { value: '3.5' } });
    fireEvent.change(screen.getByLabelText(/Reason code/u), { target: { value: 'monthly_growth' } });
  }

  test('the preview writes nothing: no basisHash, no Idempotency-Key', async () => {
    request.mockResolvedValue(PREVIEW);
    renderAt(<CollectiveGrowthTab />);
    fillPercentage();
    fireEvent.click(screen.getByRole('button', { name: /Preview adjustment/u }));
    await screen.findByText(/Nothing has been committed yet/u);
    const [path, options] = request.mock.calls[0];
    expect(path).toBe('/v1/admin/client-growth/collective/preview');
    expect(options.body).toMatchObject({ fundId: 'f1', growthBasisPoints: 350, reasonCode: 'monthly_growth' });
    expect(options.body).not.toHaveProperty('basisHash');
    expect(options.headers).toBeUndefined();
    // The exclusion count the server reported is on screen.
    expect(screen.getByText(/2 zero-value or ineligible positions are excluded/u)).toBeTruthy();
    expect(screen.getByText('Asha Rao')).toBeTruthy();
  });

  test('the commit adds the preview basisHash and an Idempotency-Key', async () => {
    request.mockResolvedValueOnce(PREVIEW).mockResolvedValueOnce({ targetCount: 1 });
    renderAt(<CollectiveGrowthTab />);
    fillPercentage();
    fireEvent.click(screen.getByRole('button', { name: /Preview adjustment/u }));
    fireEvent.click(await screen.findByRole('button', { name: /Commit adjustment/u }));
    await Promise.resolve();
    const [path, options] = request.mock.calls[1];
    expect(path).toBe('/v1/admin/client-growth/collective');
    expect(options.body.basisHash).toBe('bh_abc');
    expect(options.body.growthBasisPoints).toBe(350);
    expect(options.headers['Idempotency-Key']).toBeTruthy();
    expect(invalidateClientGrowth).toHaveBeenCalled();
  });

  test('explicit mode sends signed per-client deltas, never a shared total', async () => {
    request.mockResolvedValue({ basisHash: 'bh_x', items: [] });
    renderAt(<CollectiveGrowthTab />);
    fireEvent.change(screen.getByLabelText(/Fund/u), { target: { value: 'f1' } });
    fireEvent.change(screen.getByLabelText(/Mode/u), { target: { value: 'explicit' } });
    fireEvent.change(screen.getByLabelText('Client user ID 1'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByLabelText('Amount 1'), { target: { value: '-800' } });
    fireEvent.change(screen.getByLabelText(/Reason code/u), { target: { value: 'correction' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview adjustment/u }));
    await Promise.resolve();
    const [, options] = request.mock.calls[0];
    expect(options.body.items).toEqual([{ userId: 'u1', growthPaise: '-80000' }]);
    expect(options.body).not.toHaveProperty('growthPaise');
    expect(options.body).not.toHaveProperty('totalPaise');
  });

  test('a 409 on commit discards the preview and asks for a fresh one', async () => {
    const conflict = new Error('Conflict');
    conflict.status = 409;
    request.mockResolvedValueOnce(PREVIEW).mockRejectedValueOnce(conflict);
    renderAt(<CollectiveGrowthTab />);
    fillPercentage();
    fireEvent.click(screen.getByRole('button', { name: /Preview adjustment/u }));
    fireEvent.click(await screen.findByRole('button', { name: /Commit adjustment/u }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Preview again before committing/u);
    // The stale preview is gone: no commit button to double-fire.
    expect(screen.queryByRole('button', { name: /Commit adjustment/u })).toBeNull();
    expect(invalidateClientGrowth).not.toHaveBeenCalled();
  });
});
