// Request-count tests for the admin domain split. The claim is that opening an
// admin route no longer fetches six collections, and that a fund write invalidates
// only what it changed.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  ResourceCacheProvider,
  __resetFallbackResourceStore,
} from '@beonedge/shared/data/ResourceCacheProvider.jsx';

const loadAdminCollection = vi.fn();
vi.mock('../helpers/loadAdminData.js', () => ({
  loadAdminCollection: (...a) => loadAdminCollection(...a),
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
const { useFundMutations, slugify } = await import('./useFundMutations.js');

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const Wrap = ({ children }) => <ResourceCacheProvider>{children}</ResourceCacheProvider>;

const pathsCalled = () => loadAdminCollection.mock.calls.map(([path]) => path);

beforeEach(() => {
  __resetFallbackResourceStore();
  loadAdminCollection.mockReset().mockResolvedValue([]);
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
    // The old provider fetched /v1/admin/transactions on every admin route and no
    // screen read it — list screens paginate through useAdminList.
    expect(Object.keys(ADMIN_KEYS)).not.toContain('transactions');
  });

  test('there is no mandates collection key', () => {
    // E-mandates are retired; the review queue replaced them.
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
    expect(loadAdminCollection).toHaveBeenCalledTimes(1);
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

  async function mutateAndRemount(view, mutate) {
    await settle();
    const before = loadAdminCollection.mock.calls.length;
    await act(async () => { await mutate(); });
    view.rerender(<Wrap><div /></Wrap>);
    view.rerender(<Wrap><FundsAndFriends /><Mutator /></Wrap>);
    await settle();
    return pathsCalled().slice(before);
  }

  let mutations;
  function Mutator() { mutations = useFundMutations(); return null; }

  test('a fund publish re-reads funds and the audit log only', async () => {
    const view = render(<Wrap><FundsAndFriends /><Mutator /></Wrap>);
    const refetched = await mutateAndRemount(view, () => mutations.handlePublishVersion('f1', { name: 'A' }));
    expect(refetched.sort()).toEqual(['/v1/admin/audit-logs', '/v1/admin/funds']);
  });

  test('a lifecycle change re-reads the same two', async () => {
    const view = render(<Wrap><FundsAndFriends /><Mutator /></Wrap>);
    const refetched = await mutateAndRemount(view, () => mutations.handleFundLifecycle('f1', 'paused'));
    expect(refetched.sort()).toEqual(['/v1/admin/audit-logs', '/v1/admin/funds']);
  });

  test('a delete re-reads the same two', async () => {
    const view = render(<Wrap><FundsAndFriends /><Mutator /></Wrap>);
    const refetched = await mutateAndRemount(view, () => mutations.handleDeleteFund('f1'));
    expect(refetched.sort()).toEqual(['/v1/admin/audit-logs', '/v1/admin/funds']);
  });

  // One owner per write: creating a pool is a draft plus its first version, and
  // nothing else. It used to also post an AUM opening balance and a stock per
  // company row, so a create could half-succeed.
  test('a create publishes a draft and its first version, and nothing else', async () => {
    render(<Wrap><Mutator /></Wrap>);
    await settle();
    await act(async () => {
      await mutations.handleCreateFund({ slug: 'alpha-pool', name: 'Alpha Pool', category: 'general' });
    });
    const calls = apiRequest.mock.calls.map(([path]) => path);
    expect(calls).toEqual(['/v1/admin/funds', '/v1/admin/funds/f1/versions']);
    expect(calls.some((path) => path.endsWith('/aum-updates'))).toBe(false);
    expect(calls.some((path) => path.endsWith('/stocks'))).toBe(false);
  });

  test('the version body is passed through untouched', async () => {
    render(<Wrap><Mutator /></Wrap>);
    await settle();
    const version = { name: 'Alpha', category: 'equity', riskLevel: 'high' };
    await act(async () => { await mutations.handleCreateFund({ slug: 'alpha', ...version }); });
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

  async function invalidateAndRemount(view, act_) {
    await settle();
    const before = loadAdminCollection.mock.calls.length;
    act(act_);
    view.rerender(<Wrap><div /></Wrap>);
    view.rerender(<Wrap><FundsAndFriends /><Actions /></Wrap>);
    await settle();
    return pathsCalled().slice(before);
  }

  test('an AUM commit re-reads the catalogue and the audit log — never payments or reviews', async () => {
    const view = render(<Wrap><FundsAndFriends /><Actions /></Wrap>);
    const refetched = await invalidateAndRemount(view, () => actions.invalidateAum());
    expect(refetched.sort()).toEqual(['/v1/admin/audit-logs', '/v1/admin/funds']);
    expect(refetched.some((path) => path.includes('payments'))).toBe(false);
    expect(refetched.some((path) => path.includes('investment-reviews'))).toBe(false);
  });

  test('a client-growth commit re-reads the audit log only — never the catalogue', async () => {
    const view = render(<Wrap><FundsAndFriends /><Actions /></Wrap>);
    const refetched = await invalidateAndRemount(view, () => actions.invalidateClientGrowth());
    expect(refetched).toEqual(['/v1/admin/audit-logs']);
  });

  test('a review decision re-reads reviews, refunds, payments and the audit log', async () => {
    const view = render(<Wrap><FundsAndFriends /><Actions /></Wrap>);
    const refetched = await invalidateAndRemount(view, () => actions.invalidateReviews());
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
    loadAdminCollection.mockResolvedValue([{ id: 'f1' }]);
    render(<Wrap><Probe /></Wrap>);
    await settle();
    expect(funds.rows).toHaveLength(1);
    act(() => { actions.clearAll(); });
    expect(funds.rows).toEqual([]);
  });
});

describe('fund payload adapters', () => {
  test('slugs are lowercase, hyphenated and bounded', () => {
    expect(slugify('  Alpha Growth Pool! ')).toBe('alpha-growth-pool');
    expect(slugify('x'.repeat(80))).toHaveLength(60);
  });
});
