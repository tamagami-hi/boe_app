import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  ResourceCacheProvider,
  __resetFallbackResourceStore,
} from '@beonedge/shared/data/ResourceCacheProvider.jsx';

const loadAdminCollection = vi.fn();
const loadAdminFundPage = vi.fn();
vi.mock('../helpers/loadAdminData.js', () => ({
  loadAdminCollection: (...a) => loadAdminCollection(...a),
  loadAdminFundPage: (...a) => loadAdminFundPage(...a),
  loadApprovals: async () => ({ rows: [], truncated: false }),
}));

const apiRequest = vi.fn();
vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...a) => apiRequest(...a),
}));

const addToast = vi.fn();
vi.mock('../components/ToastProvider.jsx', () => ({
  default: ({ children }) => children,
  useToast: () => ({ addToast }),
}));

const {
  ADMIN_KEYS,
  useAdminAuditLogs,
  useAdminCacheActions,
  useAdminFunds,
  useAdminInvestmentReviews,
  useAdminPayments,
} = await import('./adminResources.js');
const { useFundMutations } = await import('./useFundMutations.js');
const { slugify } = await import('../screens/fundOps/fundOpsModel.js');

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const Wrap = ({ children }) => <ResourceCacheProvider>{children}</ResourceCacheProvider>;

const EMPTY_PAGE = {
  rows: [],
  nextCursor: null,
  hasMore: false,
  summary: { total: 0, byState: { draft: 0, review_pending: 0, published: 0, paused: 0, archived: 0 } },
};

const pathsCalled = () => [
  ...loadAdminCollection.mock.calls.map((call, index) => ({
    order: loadAdminCollection.mock.invocationCallOrder[index],
    path: call[0],
  })),
  ...loadAdminFundPage.mock.calls.map((call, index) => ({
    order: loadAdminFundPage.mock.invocationCallOrder[index],
    path: '/v1/admin/funds',
  })),
].sort((left, right) => left.order - right.order).map((entry) => entry.path);

beforeEach(() => {
  __resetFallbackResourceStore();
  loadAdminCollection.mockReset().mockResolvedValue([]);
  loadAdminFundPage.mockReset().mockResolvedValue(EMPTY_PAGE);
  apiRequest.mockReset().mockResolvedValue({ fund: { id: 'f1' } });
  addToast.mockReset();
});

describe('cache keys', () => {
  test('all keys are namespaced and unique', () => {
    const keys = Object.values(ADMIN_KEYS).map((build) => build());
    for (const key of keys) expect(key.startsWith('admin:')).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('there is no transactions collection key', () => {
    expect(Object.keys(ADMIN_KEYS)).not.toContain('transactions');
  });

  test('there is no mandates collection key', () => {
    expect(Object.keys(ADMIN_KEYS)).not.toContain('mandates');
  });
});

describe('per-screen reads', () => {
  test('a screen that needs the review queue does not fetch funds, payments or audit logs', async () => {
    function ReviewsShape() { useAdminInvestmentReviews('pending'); return null; }
    render(<Wrap><ReviewsShape /></Wrap>);
    await settle();
    expect(pathsCalled()).toEqual(['/v1/admin/investment-reviews?state=pending']);
  });

  test('a screen that needs nothing fetches nothing', async () => {
    render(<Wrap><div /></Wrap>);
    await settle();
    expect(loadAdminCollection).not.toHaveBeenCalled();
    expect(loadAdminFundPage).not.toHaveBeenCalled();
  });

  test('two screens needing funds share one request', async () => {
    function Holdings() { useAdminFunds(); return null; }
    function Transactions() { useAdminFunds(); return null; }
    render(<Wrap><Holdings /><Transactions /></Wrap>);
    await settle();
    expect(pathsCalled()).toEqual(['/v1/admin/funds']);
  });

  test('navigating away and back inside the stale window does not refetch', async () => {
    function Funds() { useAdminFunds(); return null; }
    const view = render(<Wrap><Funds /></Wrap>);
    await settle();
    view.rerender(<Wrap><div /></Wrap>);
    view.rerender(<Wrap><Funds /></Wrap>);
    await settle();
    expect(loadAdminFundPage).toHaveBeenCalledTimes(1);
  });

  test('a state filter and a search are separate cached reads, sent to the server', async () => {
    function Filtered() { useAdminFunds({ state: 'paused', search: 'edge' }); return null; }
    render(<Wrap><Filtered /></Wrap>);
    await settle();
    expect(loadAdminFundPage).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'paused', search: 'edge' }),
    );
  });

  test('rows is always an array, even before the read lands', () => {
    loadAdminCollection.mockReturnValue(new Promise(() => {}));
    let seen;
    function Probe() { seen = useAdminPayments(); return null; }
    render(<Wrap><Probe /></Wrap>);
    expect(seen.rows).toEqual([]);
    expect(seen.isLoading).toBe(true);
  });

  test('a failed read reports an error instead of an empty table', async () => {
    loadAdminCollection.mockRejectedValue(new Error('backend down'));
    let seen;
    function Probe() { seen = useAdminPayments(); return null; }
    render(<Wrap><Probe /></Wrap>);
    await settle();
    expect(seen.error?.message).toBe('backend down');
    expect(seen.rows).toEqual([]);
    expect(seen.isLoading).toBe(false);
  });
});

describe('fund mutations invalidate only what they changed', () => {
  function FundsAndFriends() {
    useAdminFunds();
    useAdminAuditLogs();
    useAdminPayments();
    useAdminInvestmentReviews('pending');
    return null;
  }

  let mutations;
  function Mutator() { mutations = useFundMutations(); return null; }

  async function mutateInPlace(mutate) {
    await settle();
    const before = pathsCalled().length;
    await act(async () => { await mutate(); });
    await settle();
    return pathsCalled().slice(before);
  }

  test('a fund publish re-reads funds and the audit log only', async () => {
    render(<Wrap><FundsAndFriends /><Mutator /></Wrap>);
    const refetched = await mutateInPlace(() => mutations.handlePublishVersion('f1', { name: 'A' }));
    expect(refetched.sort()).toEqual(['/v1/admin/audit-logs', '/v1/admin/funds']);
  });

  test('a lifecycle change re-reads the same two', async () => {
    render(<Wrap><FundsAndFriends /><Mutator /></Wrap>);
    const refetched = await mutateInPlace(() => mutations.handleFundLifecycle('f1', 'paused'));
    expect(refetched.sort()).toEqual(['/v1/admin/audit-logs', '/v1/admin/funds']);
  });

  test('there is no fund delete: archiving is a lifecycle change', () => {
    render(<Wrap><Mutator /></Wrap>);
    expect(mutations.handleDeleteFund).toBeUndefined();
  });

  test('a create is a single atomic request', async () => {
    render(<Wrap><Mutator /></Wrap>);
    await settle();
    await act(async () => {
      await mutations.handleCreateFund({
        slug: 'alpha-fund',
        terms: { name: 'Alpha Fund' },
        openingAum: { aumPaise: '1000', asOfDate: '2026-08-21', reasonCode: 'fund_launch' },
      });
    });
    const calls = apiRequest.mock.calls.map(([path]) => path);
    expect(calls).toEqual(['/v1/admin/funds']);
    expect(calls.some((path) => path.endsWith('/versions'))).toBe(false);
    expect(calls.some((path) => path.endsWith('/initialize'))).toBe(false);
    expect(calls.some((path) => path.endsWith('/stocks'))).toBe(false);
  });

  test('a create carries an Idempotency-Key, so a retried submit cannot double-write', async () => {
    render(<Wrap><Mutator /></Wrap>);
    await settle();
    const payload = {
      slug: 'alpha-fund',
      terms: { name: 'Alpha Fund' },
      openingAum: { aumPaise: '1000', asOfDate: '2026-08-21', reasonCode: 'fund_launch' },
    };
    await act(async () => { await mutations.handleCreateFund(payload); });
    await act(async () => { await mutations.handleCreateFund(payload); });
    const keys = apiRequest.mock.calls.map(([, options]) => options.headers['Idempotency-Key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  test('the version body is passed through untouched', async () => {
    render(<Wrap><Mutator /></Wrap>);
    await settle();
    const version = { name: 'Alpha', category: 'equity', riskLevel: 'high' };
    await act(async () => { await mutations.handlePublishVersion('f1', version); });
    const [, options] = apiRequest.mock.calls.find(([path]) => path.endsWith('/versions'));
    expect(options.body).toEqual(version);
  });
});

describe('AUM and client-growth invalidation boundaries (spec §12.2)', () => {
  function FundsAndFriends() {
    useAdminFunds();
    useAdminAuditLogs();
    useAdminPayments();
    useAdminInvestmentReviews('pending');
    return null;
  }

  let actions;
  function Actions() { actions = useAdminCacheActions(); return null; }

  async function invalidateInPlace(invalidate) {
    await settle();
    const before = pathsCalled().length;
    act(invalidate);
    await settle();
    return pathsCalled().slice(before);
  }

  test('an AUM commit re-reads the catalogue and the audit log — never payments or reviews', async () => {
    render(<Wrap><FundsAndFriends /><Actions /></Wrap>);
    const refetched = await invalidateInPlace(() => actions.invalidateAum());
    expect(refetched.sort()).toEqual(['/v1/admin/audit-logs', '/v1/admin/funds']);
    expect(refetched.some((path) => path.includes('payments'))).toBe(false);
    expect(refetched.some((path) => path.includes('investment-reviews'))).toBe(false);
  });

  test('a client-growth commit re-reads the audit log only — never the catalogue', async () => {
    render(<Wrap><FundsAndFriends /><Actions /></Wrap>);
    const refetched = await invalidateInPlace(() => actions.invalidateClientGrowth());
    expect(refetched).toEqual(['/v1/admin/audit-logs']);
  });

  test('a review decision re-reads reviews, refunds, payments and the audit log', async () => {
    render(<Wrap><FundsAndFriends /><Actions /></Wrap>);
    const refetched = await invalidateInPlace(() => actions.invalidateReviews());
    expect(refetched.sort()).toEqual([
      '/v1/admin/audit-logs',
      '/v1/admin/investment-reviews?state=pending',
      '/v1/admin/payments',
    ]);
    expect(refetched.some((path) => path.endsWith('/funds'))).toBe(false);
  });
});

describe('sign-out clears', () => {
  test('clearAll drops the data rather than marking it stale', async () => {
    let actions;
    let funds;
    function Probe() {
      funds = useAdminFunds();
      actions = useAdminCacheActions();
      return null;
    }
    loadAdminFundPage.mockResolvedValue({ ...EMPTY_PAGE, rows: [{ id: 'f1' }] });
    render(<Wrap><Probe /></Wrap>);
    await settle();
    expect(funds.rows).toHaveLength(1);
    act(() => { actions.clearAll(); });
    expect(funds.rows).toEqual([]);
  });
});

describe('fund payload adapters', () => {
  test('slugs are lowercase, hyphenated and bounded', () => {
    expect(slugify('  Alpha Growth Fund! ')).toBe('alpha-growth-fund');
    expect(slugify('x'.repeat(80))).toHaveLength(60);
  });
});
