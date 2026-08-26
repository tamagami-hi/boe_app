import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let pending = [];
const loadApprovals = vi.fn((options) => new Promise((resolve, reject) => {
  pending.push({ options, resolve, reject });
}));
vi.mock('../helpers/loadAdminData.js', () => ({
  loadApprovals: (...a) => loadApprovals(...a),
  loadAdminCollection: async () => [],
}));

const decideApplication = vi.fn();
vi.mock('@beonedge/client/services/adminApplicationsApi.js', () => ({
  decideApplication: (...a) => decideApplication(...a),
}));

const addToast = vi.fn();
vi.mock('../components/ToastProvider.jsx', () => ({
  default: ({ children }) => children,
  useToast: () => ({ addToast }),
}));

let mockUser = { id: 'admin-1', permissions: ['applications.read', 'applications.decide'] };
vi.mock('@beonedge/client/store/AdminSessionContext.jsx', () => ({
  useAdminSession: () => ({ user: mockUser }),
}));

const { default: ApprovalsQueueProvider, useApprovalsQueue } = await import('./ApprovalsQueueProvider.jsx');

const ROW_A = { id: 'a', applicationId: 'app-a', name: 'Ada' };
const ROW_B = { id: 'b', applicationId: 'app-b', name: 'Bo' };

let queue;
function Probe() {
  queue = useApprovalsQueue();
  return (
    <div>
      <span data-testid="ids">{queue.approvals.map((r) => r.id).join(',') || 'none'}</span>
      <span data-testid="loading">{String(queue.loading)}</span>
      <span data-testid="updated">{String(queue.meta.updatedAt !== null)}</span>
      <span data-testid="error">{queue.meta.error || 'none'}</span>
      <span data-testid="truncated">{String(queue.meta.truncated)}</span>
      <span data-testid="busy">{String(queue.decisionBusy)}</span>
    </div>
  );
}

function mountAt(path = '/admin/users/approvals') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ApprovalsQueueProvider><Probe /></ApprovalsQueueProvider>
    </MemoryRouter>,
  );
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const resolveCall = (index, rows, truncated = false) =>
  act(async () => { pending[index].resolve({ rows, truncated }); await Promise.resolve(); });
const rejectCall = (index, message) =>
  act(async () => { pending[index].reject(new Error(message)); await Promise.resolve(); });

beforeEach(() => {
  pending = [];
  loadApprovals.mockClear();
  decideApplication.mockReset().mockResolvedValue({});
  addToast.mockReset();
  if (!globalThis.crypto?.randomUUID) {
    let n = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++n}` });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('first read', () => {
  test('issues exactly one request, walking the full bound', async () => {
    mountAt();
    await flush();
    expect(loadApprovals).toHaveBeenCalledTimes(1);
    expect(pending[0].options).toEqual({});
  });

  test('not-read-yet and an empty queue are different states', async () => {
    mountAt();
    await flush();
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    await resolveCall(0, []);
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('ids')).toHaveTextContent('none');
  });

  test('a truncated queue is reported', async () => {
    mountAt();
    await flush();
    await resolveCall(0, [ROW_A], true);
    expect(screen.getByTestId('truncated')).toHaveTextContent('true');
  });

  test('a failed read reports the error and does NOT stamp updatedAt', async () => {
    mountAt();
    await flush();
    await rejectCall(0, 'gateway timeout');
    expect(screen.getByTestId('error')).toHaveTextContent('gateway timeout');
    expect(screen.getByTestId('updated')).toHaveTextContent('false');
  });
});

describe('a decision', () => {
  async function mountWithRows() {
    mountAt();
    await flush();
    await resolveCall(0, [ROW_A, ROW_B]);
  }

  test('removes the row optimistically and reconciles', async () => {
    await mountWithRows();
    let decision;
    act(() => { decision = queue.handleApproveUser(ROW_A); });
    expect(screen.getByTestId('ids')).toHaveTextContent('b');
    expect(screen.getByTestId('busy')).toHaveTextContent('true');

    await flush();
    await resolveCall(pending.length - 1, [ROW_B]);
    await act(async () => { await decision; });
    expect(screen.getByTestId('busy')).toHaveTextContent('false');
    expect(screen.getByTestId('ids')).toHaveTextContent('b');
    expect(decideApplication).toHaveBeenCalledWith('app-a', 'approved', expect.any(String));
  });

  test('a read already in flight cannot reinstate the decided row', async () => {
    await mountWithRows();
    act(() => { queue.refreshApprovals(); });
    const inFlightIndex = pending.length - 1;

    decideApplication.mockReturnValue(new Promise(() => {}));
    act(() => { queue.handleApproveUser(ROW_A); });
    expect(screen.getByTestId('ids')).toHaveTextContent('b');

    await resolveCall(inFlightIndex, [ROW_A, ROW_B]);
    expect(screen.getByTestId('ids')).toHaveTextContent('b');
  });

  test('a quiet poll asks for fewer pages than an explicit refresh', async () => {
    await mountWithRows();
    act(() => { queue.refreshApprovals(); });
    expect(pending[pending.length - 1].options).toEqual({});
    await resolveCall(pending.length - 1, [ROW_A, ROW_B]);
  });

  test('refreshApprovals is refused outright while a decision is in flight', async () => {
    await mountWithRows();
    decideApplication.mockReturnValue(new Promise(() => {}));
    act(() => { queue.handleApproveUser(ROW_A); });
    const before = loadApprovals.mock.calls.length;
    await act(async () => { await queue.refreshApprovals(); });
    expect(loadApprovals).toHaveBeenCalledTimes(before);
  });

  test('a second decision on the same row while one is in flight is ignored', async () => {
    await mountWithRows();
    let first;
    act(() => { first = queue.handleApproveUser(ROW_A); });
    await act(async () => { await queue.handleApproveUser(ROW_A); });
    expect(decideApplication).toHaveBeenCalledTimes(1);

    await flush();
    await resolveCall(pending.length - 1, [ROW_B]);
    await act(async () => { await first; });
  });

  test('a retry after failure reuses the idempotency key', async () => {
    await mountWithRows();
    decideApplication.mockRejectedValueOnce(new Error('precondition failed'));
    let attempt;
    act(() => { attempt = queue.handleRejectUser(ROW_A); });
    await flush();
    await resolveCall(pending.length - 1, [ROW_A, ROW_B]);
    await act(async () => { await attempt; });
    expect(addToast).toHaveBeenCalledWith('precondition failed', 'error');

    let retry;
    act(() => { retry = queue.handleRejectUser(ROW_A); });
    await flush();
    await resolveCall(pending.length - 1, [ROW_B]);
    await act(async () => { await retry; });

    const firstKey = decideApplication.mock.calls[0][2];
    const retryKey = decideApplication.mock.calls[1][2];
    expect(retryKey).toBe(firstKey);
  });

  test('a failure re-reads rather than restoring the captured row', async () => {
    await mountWithRows();
    decideApplication.mockRejectedValueOnce(new Error('conflict'));
    let attempt;
    act(() => { attempt = queue.handleApproveUser(ROW_A); });
    await flush();
    await resolveCall(pending.length - 1, [ROW_A, ROW_B]);
    await act(async () => { await attempt; });
    expect(screen.getByTestId('ids')).toHaveTextContent('a,b');
  });
});

describe('superseded reads', () => {
  test('an older read resolving last does not overwrite a newer one', async () => {
    mountAt();
    await flush();
    await resolveCall(0, [ROW_A]);

    act(() => { queue.refreshApprovals(); });
    const firstIndex = pending.length - 1;
    act(() => { queue.refreshApprovals(); });
    const secondIndex = pending.length - 1;

    await resolveCall(secondIndex, [ROW_B]);
    await resolveCall(firstIndex, [ROW_A]);
    expect(screen.getByTestId('ids')).toHaveTextContent('b');
  });
});

describe('throttling and polling', () => {
  test('a quiet refresh inside the throttle window is skipped', async () => {
    mountAt();
    await flush();
    await resolveCall(0, [ROW_A]);
    const before = loadApprovals.mock.calls.length;
    await act(async () => { await queue.refreshApprovals({ quiet: true }); });
    expect(loadApprovals).toHaveBeenCalledTimes(before);
  });

  test('an explicit refresh is never throttled', async () => {
    mountAt();
    await flush();
    await resolveCall(0, [ROW_A]);
    const before = loadApprovals.mock.calls.length;
    act(() => { queue.refreshApprovals(); });
    expect(loadApprovals).toHaveBeenCalledTimes(before + 1);
  });

  test('an approvals surface polls every 20s', async () => {
    vi.useFakeTimers();
    mountAt('/admin/users/approvals');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { pending[0].resolve({ rows: [ROW_A], truncated: false }); });
    const before = loadApprovals.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(loadApprovals.mock.calls.length).toBe(before + 1);
  });

  test('elsewhere in the console only the badge is polled, every 120s', async () => {
    vi.useFakeTimers();
    mountAt('/admin/payments');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { pending[0].resolve({ rows: [ROW_A], truncated: false }); });
    const before = loadApprovals.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(loadApprovals.mock.calls.length).toBe(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(100000); });
    expect(loadApprovals.mock.calls.length).toBe(before + 1);
  });

  test('polling does not start while the document is hidden', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    mountAt('/admin/users/approvals');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { pending[0].resolve({ rows: [ROW_A], truncated: false }); });
    const before = loadApprovals.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(loadApprovals.mock.calls.length).toBe(before);
    spy.mockRestore();
  });

  test('unmounting stops the timer', async () => {
    vi.useFakeTimers();
    const view = mountAt('/admin/users/approvals');
    await act(async () => { await Promise.resolve(); });
    await act(async () => { pending[0].resolve({ rows: [ROW_A], truncated: false }); });
    view.unmount();
    const before = loadApprovals.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(loadApprovals.mock.calls.length).toBe(before);
  });
});

describe('provider requirement', () => {
  test('the hook refuses to work without its provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside ApprovalsQueueProvider/);
    spy.mockRestore();
  });
});
