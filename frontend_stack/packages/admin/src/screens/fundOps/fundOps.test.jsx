// Fund operations. The 1,304-line editor this replaces collected fifteen groups of
// fields that no endpoint accepts and no client payload carries, offered six
// lifecycle stages of which the route accepts three, and crashed on open. The
// redemptions queue it used to sit beside is retired — acceptance is an Investment
// reviews task, and AUM management lives under /admin/aum.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  FUND_STATES, LIFECYCLE_ACTIONS, profileFromDetail, validateProfile, versionPayloadFromProfile,
} from './fundOpsModel.js';
import FundsListScreen from './FundsListScreen.jsx';
import FundWorkspace from './FundWorkspace.jsx';
import { normalizeFundRow } from '../../helpers/formatters.js';

const request = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => request(...args),
  useHttpApi: () => true,
  listFromPayload: (payload) => payload?.items ?? [],
  isFixtureModeError: () => false,
}));

// The stock panel owns its own reads; this suite is about the workspace, so it is
// stubbed out. The profile form and the version history stay real.
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
  aum: { aumPaise: '250000000', asOfDate: '2026-08-01', updatedAt: '2026-08-05T00:00:00.000Z' },
});

const renderAt = (ui, path = '/admin/funds') => render(
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
    expect(screen.getByRole('link', { name: /Open/u }).getAttribute('href')).toBe('/admin/funds/f1');
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
    aum: { aumPaise: '250000000', asOfDate: '2026-08-01' },
  },
  versions: [{ id: 'v2', version: 2, name: 'Edge Growth', riskLevel: 'high', createdAt: '2026-08-01T00:00:00.000Z' }],
  disclosures: [{ title: 'Edge disclosure', body: 'Markets carry risk.' }],
};

function Probe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function renderWorkspace(props = {}) {
  request.mockResolvedValue(DETAIL);
  return render(
    <MemoryRouter initialEntries={['/admin/funds/f1']}>
      <Routes>
        <Route path="/admin/funds/:fundId" element={<><FundWorkspace {...props} /><Probe /></>} />
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

  test('the header states the published AUM — and no investor figure', async () => {
    const { container } = renderWorkspace();
    await screen.findByText('Edge Growth');
    expect(container.textContent).toContain('25,00,000');
    // The investor facts row was retired: funds.read must never reveal client money.
    expect(container.textContent).not.toContain('26,00,000');
    expect(container.textContent).not.toContain('Investor');
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
    // The "Fund size" section is gone — AUM is managed under /admin/aum, not here.
    expect(screen.queryByRole('button', { name: 'Fund size' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stock list' }));
    expect(screen.getByTestId('search').textContent).toBe('?section=stocks');
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
      <MemoryRouter initialEntries={['/admin/funds/f1']}>
        <Routes>
          <Route path="/admin/funds/:fundId" element={<FundWorkspace />} />
        </Routes>
      </MemoryRouter>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Read failed');
    expect(screen.getByRole('button', { name: /Try again/u })).toBeTruthy();
  });
});
