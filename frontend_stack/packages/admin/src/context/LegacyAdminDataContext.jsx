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
  riskProfiles: [],
  sipControlRequests: [],
  supportTickets: [],
  ledger: [],
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
    const results = await Promise.allSettled([
      loadAdminOverview(),
      loadAdminCollection('/v1/admin/approvals'),
      loadAdminCollection('/v1/admin/funds'),
      loadAdminCollection('/v1/admin/payments'),
      loadAdminCollection('/v1/admin/mandates'),
      loadAdminCollection('/v1/admin/audit-logs'),
      loadAdminCollection('/v1/admin/kyc-review'),
      loadAdminCollection('/v1/admin/risk-profiles'),
      loadAdminCollection('/v1/admin/sip-control-requests'),
      loadAdminCollection('/v1/admin/support/tickets'),
      loadAdminCollection('/v1/admin/reconciliation-ledger'),
      loadAdminCollection('/v1/admin/transactions'),
    ]);
    if (reqId !== loadRef.current) return; // ignore stale responses
    const [nextOverview, approvals, funds, payments, mandates, auditLogs, kycReview, riskProfiles, sipControlRequests, supportTickets, ledger, transactions] = results.map((result) => (
      result.status === 'fulfilled' ? result.value : null
    ));
    setOverview(nextOverview || EMPTY_OVERVIEW);
    setAdminData({
      approvals: approvals || [],
      funds: funds || [],
      payments: payments || [],
      mandates: mandates || [],
      auditLogs: auditLogs || [],
      kycReview: kycReview || [],
      riskProfiles: riskProfiles || [],
      sipControlRequests: sipControlRequests || [],
      supportTickets: supportTickets || [],
      ledger: ledger || [],
      transactions: transactions || [],
    });

    const failures = results
      .map((result, index) => (result.status === 'rejected' ? `${['overview', 'approvals', 'funds', 'payments', 'mandates', 'audit-logs', 'kyc-review', 'risk-profiles', 'sip-control-requests', 'support-tickets', 'reconciliation-ledger', 'transactions'][index]}: ${result.reason?.message || 'failed'}` : ''))
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

  async function handleCreateFund(payload) {
    await apiRequest('/v1/admin/funds', { method: 'POST', body: payload, scope: 'admin' });
    await loadAdminData();
  }

  async function handleUpdateFund(fundId, payload) {
    await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, { method: 'PATCH', body: payload, scope: 'admin' });
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

  async function handleApprovePayment(row, payload) {
    if (!row?.id || paymentBusyId) return;
    setPaymentBusyId(row.id);
    setPaymentActionError('');
    try {
      const result = await apiRequest(`/v1/admin/payments/${encodeURIComponent(row.id)}/approve`, {
        method: 'POST',
        body: payload,
        scope: 'admin',
      });
      addToast(`${row.fundName || 'Fund pool'} credited with approved payment.`, 'success');
      await loadAdminData();
      return result;
    } catch (error) {
      const message = error?.message || 'Payment approval failed.';
      setPaymentActionError(message);
      addToast(message, 'error');
      throw error;
    } finally {
      setPaymentBusyId('');
    }
  }

  async function handleRejectPayment(row, payload) {
    if (!row?.id || paymentBusyId) return;
    setPaymentBusyId(row.id);
    setPaymentActionError('');
    try {
      const result = await apiRequest(`/v1/admin/payments/${encodeURIComponent(row.id)}/reject`, {
        method: 'POST',
        body: payload,
        scope: 'admin',
      });
      addToast(`Payment ${row.id} rejected.`, 'warning');
      await loadAdminData();
      return result;
    } catch (error) {
      const message = error?.message || 'Payment rejection failed.';
      setPaymentActionError(message);
      addToast(message, 'error');
      throw error;
    } finally {
      setPaymentBusyId('');
    }
  }

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
    handleApprovePayment,
    handleRejectPayment,
    handleCreateFund,
    handleUpdateFund,
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
