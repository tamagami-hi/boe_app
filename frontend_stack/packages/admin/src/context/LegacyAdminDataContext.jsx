import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { decideApplication } from '@beonedge/client/services/adminApplicationsApi.js';
import { loadAdminCollection, loadApprovals } from '../helpers/loadAdminData.js';
import { useToast } from '../components/ToastProvider.jsx';
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
  transactions: [],
};

const LegacyAdminDataContext = createContext(null);

/*
 * How often the approvals queue is re-read while the console is on screen.
 *
 * New approval requests arrive without the operator doing anything — someone
 * signs up on the website — but this provider fetched once on mount and never
 * again, so a request submitted afterwards was invisible until the whole app was
 * relaunched. Only the approvals collection is polled: funds, payments, mandates
 * and transactions change in response to an action, and refetching all six on a
 * timer would be six requests to solve one problem.
 *
 * Polling stops while the tab is hidden and resumes with an immediate refresh, so
 * a backgrounded console does not keep asking and a foregrounded one is never
 * showing a stale queue.
 */
const APPROVALS_POLL_MS = 20000;

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
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [detailOverlayUserId, setDetailOverlayUserId] = useState(null);
  /*
   * Freshness of the approvals table, so the screen can show when it was last
   * read instead of leaving the operator to guess whether they are looking at
   * live data. `truncated` is true when the queue is longer than one paginated
   * walk.
   */
  const [approvalsMeta, setApprovalsMeta] = useState({
    updatedAt: null,
    syncing: false,
    truncated: false,
    error: '',
  });
  const loadRef = useRef(0);
  const decisionOperationsRef = useRef({});
  // Read by the poll, which must not overwrite an optimistic row removal while a
  // decision is still in flight. A ref rather than the state value because the
  // polling effect's closure would otherwise hold a stale one.
  const decisionBusyRef = useRef(false);
  const approvalsRequestRef = useRef(0);
  const lastApprovalsFetchRef = useRef(0);
  const navigate = useNavigate();
  const { addToast } = useToast();

  /**
   * Re-read the approvals queue only.
   *
   * `quiet` calls (the poll, a tab regaining focus) are throttled and show no
   * spinner; an explicit Refresh is neither.
   */
  const refreshApprovals = useCallback(async ({ quiet = false } = {}) => {
    // A decision in flight already reloads when it settles, and clobbering its
    // optimistic removal would make the row reappear and then vanish.
    if (decisionBusyRef.current) return;
    if (quiet && Date.now() - lastApprovalsFetchRef.current < 5000) return;
    lastApprovalsFetchRef.current = Date.now();

    const reqId = ++approvalsRequestRef.current;
    if (!quiet) setApprovalsMeta((prev) => ({ ...prev, syncing: true }));
    try {
      // The poll walks fewer pages than a full load: it runs unattended every 20s,
      // and issuing ten sequential admin requests on a timer to re-render a
      // thousand rows is not a reasonable background cost. A longer queue is
      // reported as truncated instead, and Refresh walks the full bound.
      const { rows, truncated } = await loadApprovals({ maxPages: quiet ? 2 : undefined });
      // Re-checked after the await, not just before it. `decisionBusyRef` at entry
      // only stops a refresh from *starting* during a decision; a refresh already
      // in flight when the operator approves would otherwise land afterwards and
      // write back the row that was just decided — the exact reappear-then-vanish
      // the guard exists to prevent. `approvalsRequestRef` is also bumped by
      // `loadAdminData` and at the start of a decision, so either supersedes this.
      if (reqId !== approvalsRequestRef.current || decisionBusyRef.current) return;
      setAdminData((prev) => ({ ...prev, approvals: rows }));
      setOverview((prev) => ({ ...prev, counts: { ...prev.counts, approvals: rows.length } }));
      setApprovalsMeta({ updatedAt: Date.now(), syncing: false, truncated, error: '' });
    } catch (error) {
      if (reqId !== approvalsRequestRef.current) return;
      setApprovalsMeta((prev) => ({
        ...prev,
        syncing: false,
        error: error?.message || 'Could not refresh the approvals queue.',
      }));
    }
  }, []);

  async function loadAdminData() {
    const reqId = ++loadRef.current;
    // Supersedes any approvals refresh already in flight: this load is the newer
    // truth, and both write the same slice of state.
    approvalsRequestRef.current += 1;
    setLoading(true);
    setLoadNote('');
    // Only canonical collections are fetched. Risk profiles, the reconciliation
    // ledger, SIP control requests, support tickets, and the manual KYC review
    // queue were retired by the canonical decisions (spec §8 / MVP scope /
    // OTP-as-KYC onboarding), so nothing requests them.
    const COLLECTIONS = [
      '/v1/admin/approvals',
      '/v1/admin/funds',
      '/v1/admin/payments',
      '/v1/admin/mandates',
      '/v1/admin/audit-logs',
      '/v1/admin/transactions',
    ];
    // The approvals slot goes through `loadApprovals` so the full load and the
    // poll agree on the shape, and so a truncated queue is reported here too.
    const results = await Promise.allSettled(
      COLLECTIONS.map((path) => (path.endsWith('/approvals') ? loadApprovals() : loadAdminCollection(path))),
    );
    if (reqId !== loadRef.current) return; // ignore stale responses
    const [approvalsPage, funds, payments, mandates, auditLogs, transactions] =
      results.map((result) => (result.status === 'fulfilled' ? result.value : null));
    const approvals = approvalsPage?.rows ?? null;
    setAdminData({
      approvals: approvals || [],
      funds: funds || [],
      payments: payments || [],
      mandates: mandates || [],
      auditLogs: auditLogs || [],
      transactions: transactions || [],
    });

    /*
     * Sidebar badge counts, derived from what was just loaded rather than fetched
     * separately. `approvals` counts the whole pending queue.
     */
    setOverview({
      counts: {
        approvals: (approvals || []).length,
        funds: (funds || []).length,
      },
      stats: {},
    });

    const labels = COLLECTIONS.map((path) => path.replace('/v1/admin/', ''));
    const failures = results
      .map((result, index) =>
        result.status === 'rejected' ? `${labels[index]}: ${result.reason?.message || 'failed'}` : '',
      )
      .filter(Boolean);
    if (failures.length > 0) setLoadNote(`Some admin data could not be loaded: ${failures.join('; ')}`);
    /*
     * Only stamp a fresh timestamp when the approvals fetch actually succeeded.
     * Stamping it unconditionally showed "Updated just now" above an empty table
     * next to an error message, and advanced the throttle so the next poll was
     * skipped too — the two things an operator needs least when the queue failed
     * to load.
     */
    const approvalsFailed = results[0]?.status === 'rejected';
    if (approvalsFailed) {
      setApprovalsMeta((prev) => ({
        ...prev,
        syncing: false,
        error: results[0].reason?.message || 'Could not load the approvals queue.',
      }));
    } else {
      lastApprovalsFetchRef.current = Date.now();
      setApprovalsMeta({
        updatedAt: Date.now(),
        syncing: false,
        truncated: approvalsPage?.truncated ?? false,
        error: '',
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    loadAdminData().catch((error) => {
      if (!cancelled) setLoadNote(`Admin data could not be loaded: ${error.message}`);
    });
    return () => { cancelled = true };
  }, []);

  /*
   * Keep the approvals queue current without a reload.
   *
   * Poll while visible; stop while hidden; refresh immediately on becoming
   * visible again, on regaining focus, and on the network coming back. The
   * visibility path is what covers a phone browser being backgrounded and
   * reopened — previously the only way to see a new request was to kill the app
   * and start it again, because the mount effect was the sole fetch.
   */
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    let timer = null;
    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const startPolling = () => {
      if (timer === null) {
        timer = setInterval(() => { refreshApprovals({ quiet: true }); }, APPROVALS_POLL_MS);
      }
    };
    const syncNow = () => {
      if (document.visibilityState === 'hidden') {
        stopPolling();
        return;
      }
      refreshApprovals({ quiet: true });
      startPolling();
    };

    if (document.visibilityState === 'visible') startPolling();
    document.addEventListener('visibilitychange', syncNow);
    window.addEventListener('focus', syncNow);
    window.addEventListener('online', syncNow);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', syncNow);
      window.removeEventListener('focus', syncNow);
      window.removeEventListener('online', syncNow);
    };
  }, [refreshApprovals]);

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

  /**
   * Publish the AUM opening balance and the disclosed stock list.
   *
   * Both are tolerant of an already-published period: the canonical routes refuse
   * a repeat, and a refused repeat must not fail the fund save itself. What is NOT
   * tolerated any more is silence. These calls used to end in `.catch(() => null)`,
   * so a rejected AUM figure or stock row left the fund looking saved while its
   * pool size and holdings were not — the operator had no way to know. Failures
   * are now collected and reported to the caller, which surfaces them as a
   * partial-success warning.
   */
  async function publishFundFollowUps(fundId, payload) {
    const warnings = [];
    const aumPaise = toPaise(payload.totalPoolSize);
    if (aumPaise > 0) {
      try {
        await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/aum-updates`, {
          method: 'POST',
          scope: 'admin',
          body: {
            periodStart: currentPeriodStart(),
            openingAumPaise: aumPaise,
            note: 'Opening balance set from the fund editor.',
          },
        });
      } catch (error) {
        warnings.push(`pool size: ${error?.message || 'could not be published'}`);
      }
    }

    const stocks = (payload.investments || [])
      .filter((investment) => investment?.companyName)
      .map((investment, index) => ({
        stockName: investment.companyName,
        quarterLabel: currentQuarterLabel(),
        sortOrder: index + 1,
      }));
    for (const stock of stocks) {
      try {
        await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/stocks`, {
          method: 'POST',
          scope: 'admin',
          body: stock,
        });
      } catch (error) {
        warnings.push(`${stock.stockName}: ${error?.message || 'could not be published'}`);
      }
    }
    return warnings;
  }

  // Report what did not publish without claiming the whole save failed — the fund
  // and its version did commit, and saying otherwise would send the operator to
  // re-create a fund that already exists.
  function warnPartialPublish(warnings) {
    if (warnings.length === 0) return;
    addToast(
      `Fund saved, but some details did not publish — ${warnings.join('; ')}`,
      'warning',
    );
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
      warnPartialPublish(await publishFundFollowUps(fundId, payload));
    }
    await loadAdminData();
  }

  async function handleUpdateFund(fundId, payload) {
    // A published fund version is immutable, so an edit publishes the next one.
    await publishFundVersion(fundId, payload);
    warnPartialPublish(await publishFundFollowUps(fundId, payload));
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

  async function handleUserDecision(row, status) {
    if (!row?.id) return;
    const existingOperation = decisionOperationsRef.current[row.id];
    if (existingOperation?.isBusy) return;
    const idempotencyKey = existingOperation?.idempotencyKey || crypto.randomUUID();
    decisionOperationsRef.current = {
      ...decisionOperationsRef.current,
      [row.id]: { idempotencyKey, isBusy: true },
    };
    // Supersedes any approvals refresh in flight, so a poll that started before
    // this decision cannot land afterwards and reinstate the row.
    approvalsRequestRef.current += 1;
    // Suppresses the approvals poll for the duration: it would otherwise
    // reinstate the row this optimistically removes.
    decisionBusyRef.current = true;
    setDecisionBusy(true);

    // Optimistic UI: remove row from approvals immediately
    setAdminData((prev) => ({
      ...prev,
      approvals: prev.approvals.filter((a) => a.id !== row.id),
    }));

    try {
      await decideApplication(row.applicationId || row.id, status, idempotencyKey);

      addToast(
        status === 'approved'
          ? `${row.name || 'User'} approved. A welcome email with the app download link is queued — they can sign in with the password they chose at signup.`
          : `${row.name || 'User'} rejected.`,
        status === 'approved' ? 'success' : 'warning'
      );

      // Background refetch to reconcile
      await loadAdminData();
    } catch (error) {
      addToast(error?.message || 'Action failed. Please try again.', 'error');
      /*
       * Reload rather than putting the captured row back. A failure usually means
       * this screen's snapshot disagrees with the server, and restoring the stale
       * row guaranteed every retry failed the same way. Refetching means the next
       * attempt starts from the real state.
       */
      await loadAdminData().catch(() => {});
    } finally {
      decisionOperationsRef.current = {
        ...decisionOperationsRef.current,
        [row.id]: { idempotencyKey, isBusy: false },
      };
      decisionBusyRef.current = false;
      setDecisionBusy(false);
    }
  }

  async function handleApproveUser(row) {
    await handleUserDecision(row, 'approved');
  }

  async function handleRejectUser(row) {
    await handleUserDecision(row, 'rejected');
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
    decisionBusy,
    approvalsMeta,
    refreshApprovals,
    handleApproveUser,
    handleRejectUser,
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
