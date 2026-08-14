// The claim this task makes is a request-count claim, so these tests count
// requests. Everything here is about how many times a service function is called,
// under which key, and what stays on screen while it is called again.
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  ResourceCacheProvider,
  __resetFallbackResourceStore,
} from '@beonedge/shared/data/ResourceCacheProvider.jsx';

const getPortfolio = vi.fn();
const listFunds = vi.fn();
const getResearchContext = vi.fn();
const listSips = vi.fn();
const listTransactions = vi.fn();
const listPendingPayments = vi.fn();
const listFailedPayments = vi.fn();
const listApprovalPayments = vi.fn();
const getInvestingEligibility = vi.fn();

vi.mock('../services/portfolioApi.js', () => ({ getPortfolio: (...a) => getPortfolio(...a) }));
vi.mock('../services/fundsApi.js', () => ({ listFunds: (...a) => listFunds(...a) }));
vi.mock('../services/researchApi.js', () => ({ getResearchContext: (...a) => getResearchContext(...a) }));
vi.mock('../services/ordersApi.js', () => ({
  listSips: (...a) => listSips(...a),
  listPendingPayments: (...a) => listPendingPayments(...a),
  listFailedPayments: (...a) => listFailedPayments(...a),
  listApprovalPayments: (...a) => listApprovalPayments(...a),
}));
vi.mock('../services/transactionsApi.js', () => ({ listTransactions: (...a) => listTransactions(...a) }));
vi.mock('../services/eligibilityApi.js', () => ({
  getInvestingEligibility: (...a) => getInvestingEligibility(...a),
}));

let mockSessionUser = null;
vi.mock('../store/SessionContext.jsx', () => ({
  useSession: () => ({
    user: mockSessionUser,
    status: mockSessionUser ? 'authenticated' : 'anonymous',
    isLoading: false,
    error: null,
  }),
}));

const {
  CLIENT_KEYS,
  useClientCacheActions,
  useEligibility,
  useFundList,
  useFundsById,
  usePaymentQueue,
  usePortfolio,
  useResearchContext,
  useSipPlans,
  useTransactions,
} = await import('./clientResources.js');
const { default: ClientCacheEvictor } = await import('./ClientCacheEvictor.jsx');

/** Flush the effect -> fetch -> setState chain. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  __resetFallbackResourceStore();
  mockSessionUser = null;
  for (const fn of [
    getPortfolio, listFunds, getResearchContext, listSips, listTransactions,
    listPendingPayments, listFailedPayments, listApprovalPayments, getInvestingEligibility,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue([]);
  }
  getPortfolio.mockResolvedValue({ currentValue: 100, invested: 90 });
  getInvestingEligibility.mockResolvedValue({ canInvest: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Each test gets its own store, so nothing leaks between cases. */
const Wrap = ({ children }) => <ResourceCacheProvider>{children}</ResourceCacheProvider>;

describe('cache keys', () => {
  // The keys are a contract: the eviction prefix, the invalidation prefixes and
  // the per-user scoping all depend on their exact shape.
  test('every key lives under the client: namespace', () => {
    const keys = [
      CLIENT_KEYS.portfolio(),
      CLIENT_KEYS.funds(),
      CLIENT_KEYS.fund('f1'),
      CLIENT_KEYS.research(),
      CLIENT_KEYS.sipPlans(),
      CLIENT_KEYS.eligibility('u1'),
      CLIENT_KEYS.transactions('all'),
      CLIENT_KEYS.paymentQueue('pending'),
    ];
    for (const key of keys) expect(key.startsWith('client:')).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('eligibility is scoped by user id', () => {
    expect(CLIENT_KEYS.eligibility('u1')).not.toBe(CLIENT_KEYS.eligibility('u2'));
  });
});

describe('de-duplication', () => {
  function FundCount() {
    const { data } = useFundList();
    return <div data-testid="funds">{Array.isArray(data) ? data.length : 'none'}</div>;
  }

  test('two components reading the fund list issue one request', async () => {
    listFunds.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);
    render(<Wrap><FundCount /><FundCount /></Wrap>);
    await settle();
    expect(listFunds).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('funds')[0]).toHaveTextContent('2');
  });

  test('leaving a page and returning inside the stale window issues no second request', async () => {
    listFunds.mockResolvedValue([{ id: 'f1' }]);
    // One provider throughout — this is the bottom-nav case: the page unmounts,
    // the cache above it does not.
    const view = render(<Wrap><FundCount /></Wrap>);
    await settle();
    expect(listFunds).toHaveBeenCalledTimes(1);

    view.rerender(<Wrap><div /></Wrap>);
    expect(screen.queryByTestId('funds')).not.toBeInTheDocument();

    view.rerender(<Wrap><FundCount /></Wrap>);
    await settle();
    expect(listFunds).toHaveBeenCalledTimes(1);
    // And the content is there on the first frame, with no skeleton in between.
    expect(screen.getByTestId('funds')).toHaveTextContent('1');
  });

  test('a page mounting five distinct resources issues exactly five requests', async () => {
    // This is the Dashboard shape: portfolio, SIP plans, research, funds,
    // eligibility. Previously five per mount, and a bottom-nav tap remounts.
    mockSessionUser = { id: 'u1' };
    function DashboardShape() {
      usePortfolio();
      useSipPlans();
      useResearchContext();
      useFundsById();
      useEligibility('u1');
      return <div data-testid="ready" />;
    }
    const view = render(<Wrap><DashboardShape /></Wrap>);
    await settle();
    expect(getPortfolio).toHaveBeenCalledTimes(1);
    expect(listSips).toHaveBeenCalledTimes(1);
    expect(getResearchContext).toHaveBeenCalledTimes(1);
    expect(listFunds).toHaveBeenCalledTimes(1);
    expect(getInvestingEligibility).toHaveBeenCalledTimes(1);

    // The tab-switch-and-return case, within one store.
    view.rerender(<Wrap><div /></Wrap>);
    view.rerender(<Wrap><DashboardShape /></Wrap>);
    await settle();
    expect(getPortfolio).toHaveBeenCalledTimes(1);
    expect(listFunds).toHaveBeenCalledTimes(1);
  });

  test('Dashboard and Explore share the fund list and research entries', async () => {
    function DashboardShape() { useFundsById(); useResearchContext(); return null; }
    function ExploreShape() { useFundList(); useResearchContext(); return null; }
    render(<Wrap><DashboardShape /><ExploreShape /></Wrap>);
    await settle();
    expect(listFunds).toHaveBeenCalledTimes(1);
    expect(getResearchContext).toHaveBeenCalledTimes(1);
  });
});

describe('useFundsById', () => {
  test('indexes the shared fund list by id without a second request', async () => {
    listFunds.mockResolvedValue([{ id: 'f1', name: 'One' }, { id: 'f2', name: 'Two' }]);
    function Probe() {
      const { data } = useFundsById();
      return <div data-testid="name">{data.f2?.name || '—'}</div>;
    }
    render(<Wrap><Probe /><Probe /></Wrap>);
    await settle();
    expect(listFunds).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('name')[0]).toHaveTextContent('Two');
  });

  test('yields an empty map before the list arrives', () => {
    listFunds.mockReturnValue(new Promise(() => {}));
    function Probe() {
      const { data } = useFundsById();
      return <div data-testid="keys">{Object.keys(data).length}</div>;
    }
    render(<Wrap><Probe /></Wrap>);
    expect(screen.getByTestId('keys')).toHaveTextContent('0');
  });
});

describe('useEligibility', () => {
  function Probe({ userId }) {
    const { data } = useEligibility(userId);
    return <div data-testid="can">{String(data?.canInvest)}</div>;
  }

  test('a missing user id issues no request', async () => {
    render(<Wrap><Probe userId={null} /></Wrap>);
    await settle();
    expect(getInvestingEligibility).not.toHaveBeenCalled();
  });

  test('two users do not share an answer', async () => {
    render(<Wrap><Probe userId="u1" /><Probe userId="u2" /></Wrap>);
    await settle();
    expect(getInvestingEligibility).toHaveBeenCalledTimes(2);
  });

  test('the guard and the dashboard share one answer for one user', async () => {
    render(<Wrap><Probe userId="u1" /><Probe userId="u1" /></Wrap>);
    await settle();
    expect(getInvestingEligibility).toHaveBeenCalledTimes(1);
  });
});

describe('useTransactions and usePaymentQueue', () => {
  function TxProbe({ filter, enabled }) {
    const { data } = useTransactions(filter, { enabled });
    return <div data-testid="tx">{Array.isArray(data) ? data.length : 'none'}</div>;
  }

  test('each filter is its own entry, and returning to one does not refetch', async () => {
    listTransactions.mockResolvedValue([{ id: 't1' }]);
    const view = render(<Wrap><TxProbe filter="all" enabled /></Wrap>);
    await settle();
    view.rerender(<Wrap><TxProbe filter="sip" enabled /></Wrap>);
    await settle();
    expect(listTransactions).toHaveBeenCalledTimes(2);
    expect(listTransactions).toHaveBeenNthCalledWith(1, { filter: 'all' });
    expect(listTransactions).toHaveBeenNthCalledWith(2, { filter: 'sip' });

    // Back to the first tab: the old page cleared its list to null and refetched.
    view.rerender(<Wrap><TxProbe filter="all" enabled /></Wrap>);
    await settle();
    expect(listTransactions).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tx')).toHaveTextContent('1');
  });

  test('a disabled resource issues no request', async () => {
    render(<Wrap><TxProbe filter="all" enabled={false} /></Wrap>);
    await settle();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  test('each payment queue maps to its own loader', async () => {
    function Queue({ kind }) { usePaymentQueue(kind, { enabled: true }); return null; }
    render(<Wrap><Queue kind="pending" /><Queue kind="failed" /><Queue kind="approval" /></Wrap>);
    await settle();
    expect(listPendingPayments).toHaveBeenCalledTimes(1);
    expect(listFailedPayments).toHaveBeenCalledTimes(1);
    expect(listApprovalPayments).toHaveBeenCalledTimes(1);
  });

  test('an unknown queue kind issues no request', async () => {
    function Queue() { usePaymentQueue('all', { enabled: true }); return null; }
    render(<Wrap><Queue /></Wrap>);
    await settle();
    expect(listPendingPayments).not.toHaveBeenCalled();
    expect(listFailedPayments).not.toHaveBeenCalled();
    expect(listApprovalPayments).not.toHaveBeenCalled();
  });
});

describe('invalidation after a write', () => {
  test('invalidateMoney refetches while the previous figures stay on screen', async () => {
    let resolveSecond;
    getPortfolio
      .mockResolvedValueOnce({ currentValue: 100 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    let actions;
    function Probe() {
      const { data, isRefreshing } = usePortfolio();
      actions = useClientCacheActions();
      return (
        <div>
          <span data-testid="value">{data ? data.currentValue : 'none'}</span>
          <span data-testid="refreshing">{String(isRefreshing)}</span>
        </div>
      );
    }

    const view = render(<Wrap><Probe /></Wrap>);
    await settle();
    expect(screen.getByTestId('value')).toHaveTextContent('100');
    expect(getPortfolio).toHaveBeenCalledTimes(1);

    act(() => { actions.invalidateMoney(); });
    // Remount within the same store is what a navigation does.
    view.rerender(<Wrap><div /></Wrap>);
    view.rerender(<Wrap><Probe /></Wrap>);
    await settle();

    expect(getPortfolio).toHaveBeenCalledTimes(2);
    // The whole point: the stale value is still readable during the refetch.
    expect(screen.getByTestId('value')).toHaveTextContent('100');
    expect(screen.getByTestId('refreshing')).toHaveTextContent('true');

    await act(async () => { resolveSecond({ currentValue: 250 }); });
    expect(screen.getByTestId('value')).toHaveTextContent('250');
  });

  test('invalidateMoney covers portfolio, history, queues and plans', async () => {
    let actions;
    function Probe() {
      usePortfolio();
      useTransactions('all');
      usePaymentQueue('pending', { enabled: true });
      useSipPlans();
      actions = useClientCacheActions();
      return null;
    }
    const view = render(<Wrap><Probe /></Wrap>);
    await settle();
    act(() => { actions.invalidateMoney(); });
    view.rerender(<Wrap><div /></Wrap>);
    view.rerender(<Wrap><Probe /></Wrap>);
    await settle();
    expect(getPortfolio).toHaveBeenCalledTimes(2);
    expect(listTransactions).toHaveBeenCalledTimes(2);
    expect(listPendingPayments).toHaveBeenCalledTimes(2);
    expect(listSips).toHaveBeenCalledTimes(2);
  });

  test('a write does not invalidate the catalogue', async () => {
    let actions;
    function Probe() {
      useFundList();
      actions = useClientCacheActions();
      return null;
    }
    const view = render(<Wrap><Probe /></Wrap>);
    await settle();
    act(() => { actions.invalidateMoney(); });
    view.rerender(<Wrap><div /></Wrap>);
    view.rerender(<Wrap><Probe /></Wrap>);
    await settle();
    expect(listFunds).toHaveBeenCalledTimes(1);
  });
});

describe('ClientCacheEvictor', () => {
  function Probe() {
    const { data } = usePortfolio();
    return <div data-testid="value">{data ? data.currentValue : 'none'}</div>;
  }

  test('a session restore does not discard what the launch path fetched', async () => {
    getPortfolio.mockResolvedValue({ currentValue: 100 });
    mockSessionUser = null;
    const view = render(<Wrap><ClientCacheEvictor /><Probe /></Wrap>);
    await settle();
    expect(screen.getByTestId('value')).toHaveTextContent('100');

    // anonymous -> authenticated is a restore, not a user change.
    mockSessionUser = { id: 'u1' };
    view.rerender(<Wrap><ClientCacheEvictor /><Probe /></Wrap>);
    await settle();
    expect(getPortfolio).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('value')).toHaveTextContent('100');
  });

  test('signing out drops the cached figures rather than marking them stale', async () => {
    getPortfolio.mockResolvedValue({ currentValue: 100 });
    mockSessionUser = { id: 'u1' };
    const view = render(<Wrap><ClientCacheEvictor /><Probe /></Wrap>);
    await settle();
    expect(screen.getByTestId('value')).toHaveTextContent('100');

    mockSessionUser = null;
    // Only the evictor is mounted for the logout render: with Probe still mounted
    // its own effect would immediately refetch, hiding whether the clear happened.
    view.rerender(<Wrap><ClientCacheEvictor /></Wrap>);
    await settle();
    view.rerender(<Wrap><ClientCacheEvictor /><Probe /></Wrap>);
    // Rendered before its request resolves: the previous user's value must be gone.
    expect(screen.getByTestId('value')).toHaveTextContent('none');
  });

  test('switching principal drops the previous one`s figures', async () => {
    getPortfolio.mockResolvedValue({ currentValue: 100 });
    mockSessionUser = { id: 'u1' };
    const view = render(<Wrap><ClientCacheEvictor /></Wrap>);
    await settle();

    mockSessionUser = { id: 'u2' };
    view.rerender(<Wrap><ClientCacheEvictor /></Wrap>);
    await settle();
    view.rerender(<Wrap><ClientCacheEvictor /><Probe /></Wrap>);
    expect(screen.getByTestId('value')).toHaveTextContent('none');
  });
});
