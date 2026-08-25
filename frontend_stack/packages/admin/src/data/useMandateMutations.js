import { useCallback, useMemo } from 'react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { useToast } from '../components/ToastProvider.jsx';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { useAdminCacheActions } from './adminResources.js';

export function useMandateMutations() {
  const { addToast } = useToast();
  const { invalidateMandates } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();

  const execute = useCallback(async (path, scope, reason, successMessage) => {
    const body = { reason };
    const result = await apiRequest(path, {
      method: 'POST',
      scope: 'admin',
      body,
      headers: { 'Idempotency-Key': idempotencyKeyFor(scope, body) },
    });
    invalidateMandates();
    addToast(successMessage, 'success');
    return result;
  }, [addToast, idempotencyKeyFor, invalidateMandates]);

  const reconcileMandate = useCallback((mandateId, reason) => execute(
    `/v1/admin/mandates/${encodeURIComponent(mandateId)}/reconcile`,
    `mandate-reconcile:${mandateId}`,
    reason,
    'Provider status inquiry completed.',
  ), [execute]);

  const reconcileCollection = useCallback((collectionId, reason) => execute(
    `/v1/admin/mandate-collections/${encodeURIComponent(collectionId)}/reconcile`,
    `collection-reconcile:${collectionId}`,
    reason,
    'Collection status inquiry completed.',
  ), [execute]);

  const cancelMandate = useCallback((mandateId, reason) => execute(
    `/v1/admin/mandates/${encodeURIComponent(mandateId)}/cancel`,
    `mandate-cancel:${mandateId}`,
    reason,
    'Cancellation request queued safely.',
  ), [execute]);

  return useMemo(() => ({ reconcileMandate, reconcileCollection, cancelMandate }), [
    cancelMandate, reconcileCollection, reconcileMandate,
  ]);
}
