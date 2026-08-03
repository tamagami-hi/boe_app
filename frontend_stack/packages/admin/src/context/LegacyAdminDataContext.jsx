import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { resolveApplication } from '@beonedge/client/services/adminApplicationsApi.js';
import { loadAdminCollection, loadAdminOverview } from '../helpers/loadAdminData.js';
import { useToast } from '../components/ToastProvider.jsx';
import ApprovalReviewPanel from '../screens/ApprovalReviewPanel.jsx';
import UserDetailScreen from '../screens/UserDetailScreen.jsx';

// State and handlers lifted verbatim from the pre-redesign monolithic
// Admin.jsx so the legacy screens keep their exact behavior while they
// wait for their per-domain rebuild passes.

const EMPTY_OVERVIEW = {
  counts: {},
  stats: {},
};

const EMPTY_DATA = {
  approvals: [],
  funds: [],
  payments: [],
  mandates: [],
  auditLogs: [],
  kycReview: [],
  transactions: [],
};

const LegacyAdminDataContext = createContext(null);

export function useLegacyAdminData() {
  const value = useContext(LegacyAdminDataContext);
  if (!value) throw new Error('useLegacyAdminData must be used inside LegacyAdminDataProvider.');
  return value;
}

export default function LegacyAdminDataProvider({ children }) {
  const [overview, setOverview] = useState(EMPTY_OVERVIEW);
  const [adminData, setAdminData] = useState(EMPTY_DATA);
  const [loadNote, setLoadNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewRow, setReviewRow] = useState(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [paymentBusyId, setPaymentBusyId] = useState('');
  const [paymentActionError, setPaymentActionError] = useState('');
  const [detailOverlayUserId, setDetailOverlayUserId] = useState(null);
  const loadRef = useRef(0);
  const navigate = useNavigate();
  const { addToast } = useToast();

  async function loadAdminData() {
    const reqId = ++loadRef.current;
    setLoading(true);
    setLoadNote('');
    // Only canonical collections are fetched. Risk profiles, the reconciliation
    // ledger, SIP control requests, and support tickets were retired by the
    // canonical decisions (spec §8 / MVP scope), so nothing requests them.
    const COLLECTIONS = [
      '/v1/admin/approvals',
      '/v1/admin/funds',
      '/v1/admin/payments',
      '/v1/admin/mandates',
      '/v1/admin/audit-logs',
      '/v1/admin/kyc-review',
      '/v1/admin/transactions',
    ];
    const results = await Promise.allSettled([
      loadAdminOverview(),
      ...COLLECTIONS.map((path) => loadAdminCollection(path)),
    ]);
    if (reqId !== loadRef.current) return; // ignore stale responses
    const [nextOverview, approvals, funds, payments, mandates, auditLogs, kycReview, transactions] =
      results.map((result) => (result.status === 'fulfilled' ? result.value : null));
    setOverview(nextOverview || EMPTY_OVERVIEW);
    setAdminData({
      approvals: approvals || [],
      funds: funds || [],
      payments: payments || [],
      mandates: mandates || [],
      auditLogs: auditLogs || [],
      kycReview: kycReview || [],
      transactions: transactions || [],
    });

    const labels = ['overview', ...COLLECTIONS.map((path) => path.replace('/v1/admin/', ''))];
    const failures = results
      .map((result, index) =>
        result.status === 'rejected' ? `${labels[index]}: ${result.reason?.message || 'failed'}` : '',
      )
      .filter(Boolean);
    if (failures.length > 0) setLoadNote(`Some admin data could not be loaded: ${failures.join('; ')}`);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    loadAdminData().catch((error) => {
      if (!cancelled) setLoadNote(`Admin data could not be loaded: ${error.message}`);
    });
    return () => { cancelled = true };
  }, []);

  // The canonical catalogue splits what the legacy editor submitted as one
  // document into: create a draft fund (slug), publish an immutable version
  // (name/category/risk/minimums + disclosure + initial NAV), then publish AUM
  // and position snapshots per date. These adapters do that translation so the
  // existing editor keeps working against the real endpoints.
  const RISK_LEVELS = ['low', 'moderate', 'high', 'very_high'];

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function riskLevelOf(payload) {
    const raw = String(payload?.riskLabel || payload?.riskText || '').toLowerCase().replace(/\s+/g, '_');
    return RISK_LEVELS.includes(raw) ? raw : 'moderate';
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function toPaise(rupees) {
    const value = Number(rupees);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
  }

  async function publishFundVersion(fundId, payload) {
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/versions`, {
      method: 'POST',
      scope: 'admin',
      body: {
        name: payload.name,
        category: payload.category?.trim() || 'general',
        objective: payload.tagline || payload.performanceSummary || '',
        riskLevel: riskLevelOf(payload),
        returnTier: payload.returnTier || null,
        minimumSipPaise: toPaise(payload.minSip),
        minimumPurchasePaise: toPaise(payload.minLumpsum),
        disclosure: {
          title: `${payload.name} disclosure`,
          body: payload.riskText?.trim() || 'Disclosure pending review.',
        },
      },
    });
  }

  /**
   * Option B follow-up publications. The pool's size is a monthly figure, so the
   * editor's pool-size field opens the current month; its stock rows become the
   * disclosed stock list. Both are tolerant of already-published periods — the
   * canonical routes refuse a repeat, and a refused follow-up must not fail the
   * fund save itself.
   */
  function currentPeriodStart() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  function currentQuarterLabel() {
    const now = new Date();
    const month = now.getUTCMonth();
    const fiscalIndex = Math.floor(((month + 9) % 12) / 3) + 1;
    const fiscalYearEnd = month >= 3 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    return `Q${fiscalIndex} FY${String(fiscalYearEnd).slice(-2)}`;
  }

  async function publishFundFollowUps(fundId, payload) {
    const aumPaise = toPaise(payload.totalPoolSize);
    if (aumPaise > 0) {
      await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/aum-updates`, {
        method: 'POST',
        scope: 'admin',
        body: {
          periodStart: currentPeriodStart(),
          openingAumPaise: aumPaise,
          note: 'Opening balance set from the fund editor.',
        },
      }).catch(() => null);
    }

    const stocks = (payload.investments || [])
      .filter((investment) => investment?.companyName)
      .map((investment, index) => ({
        stockName: investment.companyName,
        quarterLabel: currentQuarterLabel(),
        sortOrder: index + 1,
      }));
    for (const stock of stocks) {
      await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/stocks`, {
        method: 'POST',
        scope: 'admin',
        body: stock,
      }).catch(() => null);
    }
  }

  async function handleCreateFund(payload) {
    const created = await apiRequest('/v1/admin/funds', {
      method: 'POST',
      scope: 'admin',
      body: { slug: payload.slug || slugify(payload.name) },
    });
    const fundId = created?.fund?.id;
    if (fundId) {
      await publishFundVersion(fundId, payload);
      await publishFundFollowUps(fundId, payload);
    }
    await loadAdminData();
  }

  async function handleUpdateFund(fundId, payload) {
    // A published fund version is immutable, so an edit publishes the next one.
    await publishFundVersion(fundId, payload);
    await publishFundFollowUps(fundId, payload);
    if (payload.status === 'paused' || payload.status === 'archived') {
      await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, {
        method: 'PATCH',
        scope: 'admin',
        body: { status: payload.status },
      });
    }
    await loadAdminData();
  }

  async function handleFundLifecycle(fundId, status) {
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, {
      method: 'PATCH',
      scope: 'admin',
      body: { status },
    });
    await loadAdminData();
  }

  async function handleDeleteFund(fundId) {
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, { method: 'DELETE', scope: 'admin' });
    await loadAdminData();
  }

  function openReview(row) {
    setReviewRow(row);
    setReviewReason('');
    setReviewError('');
  }

  function closeReview() {
    if (reviewBusy) return;
    setReviewRow(null);
    setReviewReason('');
    setReviewError('');
  }

  async function handleUserDecision(row, status) {
    if (!row?.id) return;
    if (reviewBusy) return;
    const reason = reviewReason.trim();
    if (status === 'rejected' && !reason) {
      setReviewError('A rejection note is required.');
      return;
    }
    setReviewBusy(true);
    setReviewError('');

    // Optimistic UI: remove row from approvals immediately
    setAdminData((prev) => ({
      ...prev,
      approvals: prev.approvals.filter((a) => a.id !== row.id),
    }));

    try {
      // Canonical review -> decision handshake (submitted rows are moved to
      // in_review first; the decision uses the post-review version via If-Match).
      await resolveApplication({
        applicationId: row.applicationId || row.id,
        version: row.version,
        status: row.status,
        outcome: status,
        reasonCode: status === 'approved' ? 'approved_by_admin' : 'rejected_by_admin',
        reasonDetail: reason || undefined,
      });
      setReviewRow(null);
      setReviewReason('');

      addToast(
        status === 'approved'
          ? `${row.name || 'User'} approved successfully.`
          : `${row.name || 'User'} rejected.`,
        status === 'approved' ? 'success' : 'warning'
      );

      // Background refetch to reconcile
      await loadAdminData();
    } catch (error) {
      setReviewError(error?.message || 'Review action failed.');
      addToast(error?.message || 'Action failed. Please try again.', 'error');
      // Re-add row on error
      setAdminData((prev) => ({
        ...prev,
        approvals: [row, ...prev.approvals],
      }));
    } finally {
      setReviewBusy(false);
    }
  }

  async function handleApproveUser(row) {
    setReviewReason('');
    await handleUserDecision(row, 'approved');
  }

  // Payment approve/reject is intentionally absent: confirmation is driven by the
  // signed provider webhook (`POST /v1/provider-events/payment`), so the console
  // is read-only oversight over payment evidence.

  function openUserDetail(rowOrId) {
    const id = rowOrId?.userId || rowOrId?.user_id || rowOrId?.id || rowOrId;
    if (id) setDetailOverlayUserId(id);
  }

  function closeUserDetailOverlay() {
    setDetailOverlayUserId(null);
  }

  function navigateToUsers() {
    navigate('/admin/users/directory');
  }

  const value = {
    overview,
    adminData,
    loadNote,
    loading,
    reviewBusy,
    paymentBusyId,
    paymentActionError,
    openReview,
    handleApproveUser,
    handleUserDecision,
    handleCreateFund,
    handleUpdateFund,
    handleFundLifecycle,
    handleDeleteFund,
    openUserDetail,
    navigateToUsers,
    reloadAdminData: loadAdminData,
  };

  return (
    <LegacyAdminDataContext.Provider value={value}>
      {children}
      <ApprovalReviewPanel
        row={reviewRow}
        reason={reviewReason}
        busy={reviewBusy}
        error={reviewError}
        onReasonChange={setReviewReason}
        onClose={closeReview}
        onDecision={handleUserDecision}
      />
      {detailOverlayUserId && (
        <div className="adm-overlay" onClick={closeUserDetailOverlay}>
          <div className="adm-overlay-card" onClick={(e) => e.stopPropagation()}>
            <div className="adm-overlay-head">
              <h3>User Detail</h3>
              <button className="adm-icon-btn" onClick={closeUserDetailOverlay}><span className="adm-close-glyph">&times;</span></button>
            </div>
            <UserDetailScreen userId={detailOverlayUserId} />
          </div>
        </div>
      )}
    </LegacyAdminDataContext.Provider>
  );
}
