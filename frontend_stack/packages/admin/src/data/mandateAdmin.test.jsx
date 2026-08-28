import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiRequest = vi.fn();
const addToast = vi.fn();
const invalidateMandates = vi.fn();
const idempotencyKeyFor = vi.fn(() => 'idem-mandate-1');

vi.mock('@beonedge/client/services/_util.js', () => ({
  apiRequest: (...args) => apiRequest(...args),
}));

vi.mock('../components/ToastProvider.jsx', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('../helpers/idempotencyKeys.js', () => ({
  useIdempotencyKeys: () => idempotencyKeyFor,
}));

vi.mock('./adminResources.js', () => ({
  useAdminCacheActions: () => ({ invalidateMandates }),
}));

const { parseMandateDetail, parseMandateRow } = await import('./mandateContracts.js');
const { useMandateMutations } = await import('./useMandateMutations.js');
const MandateDetailScreen = (await import('../screens/MandateDetailScreen.jsx')).default;

function MutationHarness() {
  const operations = useMandateMutations();
  return (
    <>
      <button type="button" onClick={() => operations.reconcileMandate('m1', 'provider_status_check')}>Reconcile</button>
      <button type="button" onClick={() => operations.reconcileCollection('c1', 'stale_collection')}>Collection</button>
      <button type="button" onClick={() => operations.cancelMandate('m1', 'client_request')}>Cancel</button>
    </>
  );
}

const detail = {
  mandate: {
    mandateId: 'm1', sipPlanId: 's1', userId: 'u1', fundId: 'f1', amountPaise: 100000,
    state: 'active', merchantSubscriptionId: 'ms1', providerSubscriptionId: 'ps1',
    lastStatusCheckedAt: '2026-08-24T10:00:00.000Z', updatedAt: '2026-08-24T10:00:00.000Z',
  },
  user: { id: 'u1', name: 'Client', email: 'client@example.com' },
  fund: { id: 'f1', name: 'Growth Pool' },
  sip: { id: 's1', state: 'active', collectionMode: 'phonepe_autopay', debitDay: 5 },
  setupAttempts: [],
  collectionAttempts: [],
  cancelCommands: [],
};

beforeEach(() => {
  apiRequest.mockReset().mockResolvedValue({ status: 'accepted' });
  addToast.mockReset();
  invalidateMandates.mockReset();
  idempotencyKeyFor.mockClear();
});

describe('mandate admin security boundary', () => {
  test('strict mappers exclude provider-internal payload fields', () => {
    const row = parseMandateRow({
      mandateId: 'm1', sipPlanId: 's1', userId: 'u1', fundId: 'f1', amountPaise: 100000,
      sipState: 'active', mandateState: 'active', updatedAt: '2026-08-24T10:00:00.000Z',
      rawProviderPayload: 'secret-provider-payload',
    });
    const parsedDetail = parseMandateDetail({ ...detail, rawProviderPayload: 'secret-provider-payload' });
    expect(JSON.stringify({ row, parsedDetail })).not.toMatch(/secret-provider-payload|rawProviderPayload/u);
  });

  test('operator actions are absent without finance.operate', () => {
    render(<MemoryRouter><MandateDetailScreen detail={detail} canOperate={false} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /reconcile status/iu })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request cancellation/iu })).not.toBeInTheDocument();
  });

  test('safe actions use exact endpoints and idempotency keys', async () => {
    render(<MutationHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3));
    expect(apiRequest.mock.calls.map(([path]) => path)).toEqual([
      '/v1/admin/mandates/m1/reconcile',
      '/v1/admin/mandate-collections/c1/reconcile',
      '/v1/admin/mandates/m1/cancel',
    ]);
    for (const [, options] of apiRequest.mock.calls) {
      expect(options).toMatchObject({ method: 'POST', scope: 'admin' });
      expect(options.headers['Idempotency-Key']).toBe('idem-mandate-1');
      expect(options.body.reason).toBeTruthy();
    }
  });
});
