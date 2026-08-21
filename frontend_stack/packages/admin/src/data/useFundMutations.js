import { useCallback, useMemo } from 'react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { useToast } from '../components/ToastProvider.jsx';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { parseCreatedFund } from './fundContracts.js';
import { useAdminCacheActions } from './adminResources.js';

export function useFundMutations() {
  const { addToast } = useToast();
  const { invalidateFunds } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();

  const handleCreateFund = useCallback(async (body) => {
    const created = await apiRequest('/v1/admin/funds', {
      method: 'POST',
      scope: 'admin',
      body,
      headers: { 'Idempotency-Key': idempotencyKeyFor('fund-create', body) },
    });
    const parsed = parseCreatedFund(created);
    invalidateFunds();
    addToast('Fund created as a draft with version 1 and its opening AUM.', 'success');
    return parsed.fund.id;
  }, [addToast, idempotencyKeyFor, invalidateFunds]);

  const handlePublishVersion = useCallback(async (fundId, version) => {
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/versions`, {
      method: 'POST',
      scope: 'admin',
      body: version,
      headers: { 'Idempotency-Key': idempotencyKeyFor(`fund-version:${fundId}`, version) },
    });
    invalidateFunds();
  }, [idempotencyKeyFor, invalidateFunds]);

  const handleFundLifecycle = useCallback(async (fundId, status) => {
    const body = { status };
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, {
      method: 'PATCH',
      scope: 'admin',
      body,
      headers: { 'Idempotency-Key': idempotencyKeyFor(`fund-lifecycle:${fundId}`, body) },
    });
    invalidateFunds();
  }, [idempotencyKeyFor, invalidateFunds]);

  return useMemo(
    () => ({ handleCreateFund, handlePublishVersion, handleFundLifecycle }),
    [handleCreateFund, handlePublishVersion, handleFundLifecycle],
  );
}
