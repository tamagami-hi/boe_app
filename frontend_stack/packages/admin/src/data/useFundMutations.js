// Fund catalogue writes. The canonical catalogue splits the legacy editor's single
// document into: create a draft (slug), publish an immutable version, then publish
// AUM and stock snapshots — each with its own endpoint.
//
// Each of those now has exactly ONE owner in the UI: the pool list creates, the
// workspace's terms form publishes versions, FundAumPanel publishes AUM, and
// FundStockListPanel manages stocks. `publishFundFollowUps` is gone with the editor
// that needed it: it used to post the editor's pool-size field as an opening AUM
// balance and its per-company rows as stocks, which is why saving a fund could
// half-succeed and report "Fund saved, but some details did not publish".

import { useCallback, useMemo } from 'react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { useToast } from '../components/ToastProvider.jsx';
import { useAdminCacheActions } from './adminResources.js';

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function useFundMutations() {
  const { addToast } = useToast();
  const { invalidateFunds } = useAdminCacheActions();

  // `payload` is already the version body (see fundOps/fundOpsModel.js), plus a slug
  // for the create. Nothing is reshaped here, so what the form validates is what the
  // route receives.
  const handleCreateFund = useCallback(async (payload) => {
    const { slug, ...version } = payload;
    const created = await apiRequest('/v1/admin/funds', {
      method: 'POST',
      scope: 'admin',
      body: { slug: slug || slugify(version.name) },
    });
    const fundId = created?.fund?.id;
    if (fundId) {
      await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/versions`, {
        method: 'POST',
        scope: 'admin',
        body: version,
      });
    }
    invalidateFunds();
    addToast('Pool created as a draft with its first version published.', 'success');
    return fundId;
  }, [addToast, invalidateFunds]);

  // A published version is immutable, so an edit publishes the next one.
  const handlePublishVersion = useCallback(async (fundId, version) => {
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/versions`, {
      method: 'POST',
      scope: 'admin',
      body: version,
    });
    invalidateFunds();
  }, [invalidateFunds]);

  const handleFundLifecycle = useCallback(async (fundId, status) => {
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, {
      method: 'PATCH',
      scope: 'admin',
      body: { status },
    });
    invalidateFunds();
  }, [invalidateFunds]);

  const handleDeleteFund = useCallback(async (fundId) => {
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, {
      method: 'DELETE',
      scope: 'admin',
    });
    invalidateFunds();
  }, [invalidateFunds]);

  return useMemo(
    () => ({ handleCreateFund, handlePublishVersion, handleFundLifecycle, handleDeleteFund }),
    [handleCreateFund, handlePublishVersion, handleFundLifecycle, handleDeleteFund],
  );
}
