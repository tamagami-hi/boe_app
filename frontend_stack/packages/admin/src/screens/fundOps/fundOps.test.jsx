// Fund operations. The 1,304-line editor this replaces collected fifteen groups of
// fields that no endpoint accepts and no client payload carries, offered six
// lifecycle stages of which the route accepts three, and crashed on open.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  FUND_STATES, LIFECYCLE_ACTIONS, profileFromDetail, validateProfile, versionPayloadFromProfile,
} from './fundOpsModel.js';
import FundsListScreen from './FundsListScreen.jsx';
import FundWorkspace from './FundWorkspace.jsx';
import RedemptionsScreen from '../RedemptionsScreen.jsx';
import { normalizeFundRow } from '../../helpers/formatters.js';

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
  useHttpApi: () => true,
  listFromPayload: (payload) => payload?.items ?? [],
  isFixtureModeError: () => false,
}));

// The three panels the workspace hosts each own their own reads; this suite is about
// the workspace, so they are stubbed out.
vi.mock('../FundAumPanel.jsx', () => ({ default: () => <div data-testid="aum-panel" /> }));
vi.mock('../FundInvestorsPanel.jsx', () => ({ default: () => <div data-testid="investors-panel" /> }));
vi.mock('../FundStockListPanel.jsx', () => ({ default: () => <div data-testid="stocks-panel" /> }));

const PROFILE = {
  name: 'Edge Growth',
  category: 'equity',
  objective: 'Long-term compounding',
  riskLevel: 'high',
  returnTier: '',
  minSip: '5000',
  minLumpsum: '25000',
  minimumDurationMonths: '',
  recommendedHoldingMonths: '',
  disclosureTitle: 'Edge Growth disclosure',
  disclosureBody: 'Markets carry risk.',
};

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ items: [] });
});

describe('the canonical fund model', () => {
  test('the states are the ones the database has', () => {
    expect(FUND_STATES).toEqual(['draft', 'review_pending', 'published', 'paused', 'archived']);
    // The old editor's strip offered `active` and `closed`, which are not fund states,
    // and its save path never sent a lifecycle change at all.
    expect(FUND_STATES).not.toContain('active');
    expect(FUND_STATES).not.toContain('closed');
  });

  test('only the three states the PATCH route accepts can be moved to', () => {
    expect(LIFECYCLE_ACTIONS).toEqual(['published', 'paused', 'archived']);
  });

  test('the version body carries exactly the fields the route accepts', () => {
    const body = versionPayloadFromProfile(PROFILE);
    expect(Object.keys(body).sort()).toEqual([
      'category', 'disclosure', 'minimumPurchasePaise', 'minimumSipPaise', 'name',
      'objective', 'riskLevel',
    ]);
    expect(body.minimumSipPaise).toBe(500000);
    expect(body.minimumPurchasePaise).toBe(2500000);
    expect(body.disclosure).toEqual({ title: 'Edge Growth disclosure', body: 'Markets carry risk.' });
  });

  test('the fields that went nowhere are gone', () => {
    const body = versionPayloadFromProfile(PROFILE);
    for (const ghost of [
      'nav', 'rating', 'performanceSummary', 'performanceSeries', 'performancePeriods',
      'assetAllocation', 'advancedRatios', 'chartConfig', 'sectors', 'investments',
      'initialInvestment', 'currentValue', 'launchDate', 'status', 'lifecycleStage',
    ]) {
      expect(body, ghost).not.toHaveProperty(ghost);
    }
  });

  test('optional fields are omitted rather than sent empty', () => {
    const body = versionPayloadFromProfile(PROFILE);
    expect(body).not.toHaveProperty('returnTier');
    expect(body).not.toHaveProperty('minimumDurationMonths');
    const withOptionals = versionPayloadFromProfile({
      ...PROFILE, returnTier: 'high', minimumDurationMonths: '12', recommendedHoldingMonths: '36',
    });
    expect(withOptionals.returnTier).toBe('high');
    expect(withOptionals.minimumDurationMonths).toBe(12);
    expect(withOptionals.recommendedHoldingMonths).toBe(36);
  });

  test('a blank disclosure is refused before the route refuses it', () => {
    expect(validateProfile({ ...PROFILE, disclosureBody: '  ' }).disclosureBody).toBeTruthy();
    expect(validateProfile({ ...PROFILE, name: '' }).name).toBeTruthy();
    expect(validateProfile({ ...PROFILE, riskLevel: 'spicy' }).riskLevel).toBeTruthy();
    expect(validateProfile(PROFILE)).toEqual({});
  });

  test('the form prefills from the detail payload in rupees', () => {
    const profile = profileFromDetail({
      fund: { name: 'Edge', category: 'equity', riskLevel: 'moderate', minimumSipPaise: '500000' },
      disclosures: [{ title: 'D', body: 'B' }],
      versions: [{ minimumDurationMonths: 6 }],
    });
    expect(profile.minSip).toBe(5000);
    expect(profile.disclosureBody).toBe('B');
    expect(profile.minimumDurationMonths).toBe(6);
  });
});

const fund = normalizeFundRow({
  id: 'f1',
  slug: 'edge-growth',
  name: 'Edge Growth',
  status: 'published',
  stockCount: 4,
  currentVersion: 2,
  aum: { closingPaise: '250000000', periodStart: '2026-08-01', updatedAt: '2026-08-05T00:00:00.000Z' },
});

const renderAt = (ui, path = '/admin/ops/funds') => render(
  <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>,
);

describe('FundsListScreen', () => {
  test('the AUM tile is a real figure, not rounded to crores', () => {
    const { container } = renderAt(<FundsListScreen funds={[fund]} />);
    expect(container.textContent).toContain('25,00,000');
    // Was `₹${(totalAum / 1e7).toFixed(2)}Cr`, i.e. "₹0.00Cr" for any pool under a crore.
    expect(container.textContent).not.toContain('Cr');
  });

  test('the state filter offers only real states', () => {
    renderAt(<FundsListScreen funds={[fund]} />);
    const values = Array.from(screen.getByLabelText('Pool state').querySelectorAll('option'))
      .map((option) => option.value)
      .filter((value) => value !== 'all');
    expect(values).toEqual(FUND_STATES);
  });

  test('a pool links to its own workspace', () => {
    renderAt(<FundsListScreen funds={[fund]} />);
    expect(screen.getByRole('link', { name: /Open/u }).getAttribute('href')).toBe('/admin/ops/funds/f1');
  });

  test('a load in progress does not claim there are no pools', () => {
    renderAt(<FundsListScreen funds={[]} loading />);
    expect(screen.queryByText(/No fund pools yet/u)).toBeNull();
  });

  test('creating a pool happens inline and sends a slug with the version', async () => {
    const onCreate = vi.fn().mockResolvedValue('f2');
    renderAt(<FundsListScreen funds={[fund]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /New pool/u }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByLabelText('Pool name'), { target: { value: 'Alpha Pool' } });
    fireEvent.change(screen.getByLabelText('Disclosure text'), { target: { value: 'Risk applies.' } });
    fireEvent.click(screen.getByRole('button', { name: /Create pool/u }));
    await Promise.resolve();
    await Promise.resolve();
    expect(onCreate).toHaveBeenCalledTimes(1);
    const payload = onCreate.mock.calls[0][0];
    expect(payload.slug).toBe('alpha-pool');
    expect(payload.name).toBe('Alpha Pool');
    expect(payload.disclosure.body).toBe('Risk applies.');
  });

  test('a save with no disclosure never reaches the route', () => {
    const onCreate = vi.fn();
    renderAt(<FundsListScreen funds={[]} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: /New pool/u }));
    fireEvent.change(screen.getByLabelText('Pool name'), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: /Create pool/u }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
});

const DETAIL = {
  fund: {
    id: 'f1',
    slug: 'edge-growth',
    name: 'Edge Growth',
    status: 'published',
    riskLevel: 'high',
    category: 'equity',
    objective: 'Compounding',
    minimumSipPaise: '500000',
    minimumPurchasePaise: '2500000',
    currentVersion: 2,
    aum: { closingPaise: '250000000', periodStart: '2026-08-01' },
  },
  versions: [{ id: 'v2', version: 2, name: 'Edge Growth', riskLevel: 'high', createdAt: '2026-08-01T00:00:00.000Z' }],
  disclosures: [{ title: 'Edge disclosure', body: 'Markets carry risk.' }],
  investors: { count: 3, currentValuePaise: '260000000' },
};

function Probe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function renderWorkspace(props = {}) {
  request.mockResolvedValue(DETAIL);
  return render(
    <MemoryRouter initialEntries={['/admin/ops/funds/f1']}>
      <Routes>
        <Route path="/admin/ops/funds/:fundId" element={<><FundWorkspace {...props} /><Probe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('FundWorkspace', () => {
  test('a pool has its own address and reads its own detail', async () => {
    renderWorkspace();
    expect(await screen.findByText('Edge Growth')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('/v1/admin/funds/f1', { scope: 'admin' });
  });

  test('the header states the pool size and investor value', async () => {
    const { container } = renderWorkspace();
    await screen.findByText('Edge Growth');
    expect(container.textContent).toContain('25,00,000');
    expect(container.textContent).toContain('26,00,000');
  });

  test('only the reachable states are offered, and not the current one', async () => {
    renderWorkspace();
    await screen.findByText('Edge Growth');
    expect(screen.queryByRole('button', { name: /Publish to clients/u })).toBeNull();
    expect(screen.getByRole('button', { name: /Move to paused/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Move to archived/u })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /active/u })).toBeNull();
  });

  test('a lifecycle change confirms inline and sends the canonical status', async () => {
    const onLifecycle = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onLifecycle });
    await screen.findByText('Edge Growth');
    fireEvent.click(screen.getByRole('button', { name: /Move to paused/u }));
    // No overlay: the five hand-rolled modals are gone.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/cannot add money/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Confirm paused/u }));
    expect(onLifecycle).toHaveBeenCalledWith('f1', 'paused');
  });

  test('a double tap on a confirm applies the change once', async () => {
    let resolve;
    const onLifecycle = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderWorkspace({ onLifecycle });
    await screen.findByText('Edge Growth');
    fireEvent.click(screen.getByRole('button', { name: /Move to archived/u }));
    const confirm = screen.getByRole('button', { name: /Confirm archived/u });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onLifecycle).toHaveBeenCalledTimes(1);
    resolve();
  });

  test('sections are addressable and do not stack history', async () => {
    renderWorkspace();
    await screen.findByText('Edge Growth');
    fireEvent.click(screen.getByRole('button', { name: 'Fund size' }));
    expect(screen.getByTestId('search').textContent).toBe('?section=aum');
    expect(screen.getByTestId('aum-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stock list' }));
    expect(screen.getByTestId('stocks-panel')).toBeTruthy();
  });

  test('publishing sends the version body and nothing else', async () => {
    const onPublishVersion = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onPublishVersion });
    await screen.findByText('Edge Growth');
    fireEvent.click(screen.getByRole('button', { name: /Publish new version/u }));
    await Promise.resolve();
    expect(onPublishVersion).toHaveBeenCalledTimes(1);
    const [fundId, body] = onPublishVersion.mock.calls[0];
    expect(fundId).toBe('f1');
    expect(body.name).toBe('Edge Growth');
    expect(body.disclosure.body).toBe('Markets carry risk.');
    expect(body).not.toHaveProperty('chartConfig');
  });

  test('a failed read is announced with a retry', async () => {
    request.mockRejectedValue(new Error('Read failed'));
    render(
      <MemoryRouter initialEntries={['/admin/ops/funds/f1']}>
        <Routes>
          <Route path="/admin/ops/funds/:fundId" element={<FundWorkspace />} />
        </Routes>
      </MemoryRouter>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Read failed');
    expect(screen.getByRole('button', { name: /Try again/u })).toBeTruthy();
  });
});

const REQUEST_ROW = {
  id: 'r1',
  userEmail: 'asha@example.com',
  fundSlug: 'edge-growth',
  mode: 'full',
  status: 'submitted',
  requestedAmountPaise: '1500000',
  returnsComponentPaise: '500000',
  principalComponentPaise: '1000000',
  submittedAt: '2026-08-01T00:00:00.000Z',
};

describe('RedemptionsScreen', () => {
  test('the decision panel states the real payout', async () => {
    request.mockResolvedValue({ items: [REQUEST_ROW] });
    render(<RedemptionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    const panel = document.getElementById('redemption-decision-r1');
    // The old overlay read `actionRequest.amount`, which the projection never sends,
    // so the operator confirmed a payout against ₹0.
    expect(panel.textContent).toContain('15,000');
    expect(panel.textContent).toContain('5,000');
    expect(panel.textContent).toContain('10,000');
    expect(panel.textContent).not.toContain('₹0.00');
  });

  test('an approval with no note omits the reason instead of sending an empty one', async () => {
    request.mockResolvedValue({ items: [REQUEST_ROW] });
    render(<RedemptionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    fireEvent.click(screen.getByRole('button', { name: /Approve/u }));
    await Promise.resolve();
    const patch = request.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patch[0]).toBe('/v1/admin/redemption-requests/r1');
    // `reason` is `min(1)` when present, so `reason: ''` was a validation error.
    expect(patch[1].body).toEqual({ action: 'approved' });
  });

  test('a rejection without a reason never reaches the route', async () => {
    request.mockResolvedValue({ items: [REQUEST_ROW] });
    render(<RedemptionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    const before = request.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(request.mock.calls.length).toBe(before);
    expect(screen.getByRole('alert').textContent).toContain('reason');
  });

  test('a rejection with a reason sends it', async () => {
    request.mockResolvedValue({ items: [REQUEST_ROW] });
    render(<RedemptionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Insufficient units' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await Promise.resolve();
    const patch = request.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patch[1].body).toEqual({ action: 'rejected', reason: 'Insufficient units' });
  });

  test('a double tap approves once', async () => {
    request.mockResolvedValueOnce({ items: [REQUEST_ROW] });
    let resolve;
    render(<RedemptionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    request.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const approve = screen.getByRole('button', { name: /Approve/u });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(request.mock.calls.filter(([, o]) => o?.method === 'PATCH')).toHaveLength(1);
    resolve({});
  });

  test('a failed read is announced and never reads as an empty queue', async () => {
    request.mockRejectedValue(new Error('Queue unavailable'));
    render(<RedemptionsScreen />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Queue unavailable');
    expect(screen.queryByText(/No redemption requests with this status/u)).toBeNull();
  });

  test('nothing calls window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    request.mockResolvedValue({ items: [REQUEST_ROW] });
    render(<RedemptionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    request.mockRejectedValue(new Error('nope'));
    fireEvent.click(screen.getByRole('button', { name: /Approve/u }));
    await Promise.resolve();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
