import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import { decideApplication } from '@beonedge/client/services/adminApplicationsApi.js';
import { loadApprovals } from '../helpers/loadAdminData.js';
import { useToast } from '../components/ToastProvider.jsx';

// The approvals queue: rows, freshness, polling, decisions.
//
// Not in adminResources.js because it is not a plain cached read: it arrives
// unprompted (so it is polled), a decision removes a row optimistically, and its
// count is a shell-wide badge. The concurrency handling below is carried over
// unchanged — it prevents a poll that started before a decision from landing after
// it and reinstating the decided row.

const ApprovalsQueueContext = createContext(null);

const APPROVALS_POLL_MS = 20000;
// Elsewhere in the console only the sidebar badge needs updating, so poll slower.
const APPROVALS_BADGE_POLL_MS = 120000;
const APPROVALS_SURFACES = ['/admin/users/approvals', '/admin/overview'];
const QUIET_MAX_PAGES = 2;

const EMPTY_META = { updatedAt: null, syncing: false, truncated: false, error: '' };

export function useApprovalsQueue() {
  const value = useContext(ApprovalsQueueContext);
  if (!value) throw new Error('useApprovalsQueue must be used inside ApprovalsQueueProvider.');
  return value;
}

export default function ApprovalsQueueProvider({ children }) {
  // null = not read yet. An empty array is a real, empty queue.
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(EMPTY_META);
  const [decisionBusy, setDecisionBusy] = useState(false);

  const location = useLocation();
  const { addToast } = useToast();

  const decisionOperationsRef = useRef({});
  // A ref, not the state value: the polling effect's closure would hold a stale one.
  const decisionBusyRef = useRef(false);
  const approvalsRequestRef = useRef(0);
  const lastFetchRef = useRef(0);

  // `ignoreDecisionBusy` is for the decision's own reconcile: that read IS the
  // decision settling, so the anti-clobber guard must not block it.
  const readApprovals = useCallback(async ({ quiet, ignoreDecisionBusy = false }) => {
    const reqId = ++approvalsRequestRef.current;
    if (!quiet) setMeta((prev) => ({ ...prev, syncing: true }));
    try {
      // The unattended poll walks fewer pages; a longer queue is reported as
      // truncated instead, and an explicit Refresh walks the full bound.
      const { rows: fetched, truncated } = await loadApprovals(
        quiet ? { maxPages: QUIET_MAX_PAGES } : {},
      );
      // Re-checked AFTER the await, not just before it: a read already in flight when
      // the operator approves would otherwise land afterwards and write the decided
      // row back. approvalsRequestRef is bumped by every read AND by every decision.
      if (reqId !== approvalsRequestRef.current) return;
      if (!ignoreDecisionBusy && decisionBusyRef.current) return;
      setRows(fetched);
      lastFetchRef.current = Date.now();
      setMeta({ updatedAt: Date.now(), syncing: false, truncated, error: '' });
    } catch (error) {
      if (reqId !== approvalsRequestRef.current) return;
      // No updatedAt stamp and no throttle advance on failure: that showed
      // "Updated just now" above an empty table and skipped the next poll too.
      setMeta((prev) => ({
        ...prev,
        syncing: false,
        error: error?.message || 'Could not refresh the approvals queue.',
      }));
    }
  }, []);

  const refreshApprovals = useCallback(async ({ quiet = false } = {}) => {
    if (decisionBusyRef.current) return;
    if (quiet && Date.now() - lastFetchRef.current < 5000) return;
    lastFetchRef.current = Date.now();
    await readApprovals({ quiet });
  }, [readApprovals]);

  // One request on mount, where the old provider issued six for every admin route.
  useEffect(() => {
    readApprovals({ quiet: false });
  }, [readApprovals]);

  const isApprovalsSurface = APPROVALS_SURFACES.includes(location.pathname);

  // Poll while visible; stop while hidden; refresh on becoming visible, on focus and
  // on the network returning. The visibility path covers a backgrounded phone
  // browser — previously the mount fetch was the only one.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const intervalMs = isApprovalsSurface ? APPROVALS_POLL_MS : APPROVALS_BADGE_POLL_MS;
    let timer = null;
    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const startPolling = () => {
      if (timer === null) {
        timer = setInterval(() => { refreshApprovals({ quiet: true }); }, intervalMs);
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
  }, [refreshApprovals, isApprovalsSurface]);

  // Returns true when the decision was accepted, false when it failed. The
  // approvals screen keeps its decision dialog open on false so the operator can
  // retry with the applicant still in front of them; previously the only signal was
  // a toast, and the dialog closed either way.
  const handleUserDecision = useCallback(async (row, status) => {
    if (!row?.id) return false;
    const existingOperation = decisionOperationsRef.current[row.id];
    if (existingOperation?.isBusy) return false;
    // Reused across retries so a retried decision cannot be applied twice.
    const idempotencyKey = existingOperation?.idempotencyKey || crypto.randomUUID();
    decisionOperationsRef.current = {
      ...decisionOperationsRef.current,
      [row.id]: { idempotencyKey, isBusy: true },
    };
    // Supersedes any read in flight; suppresses the poll for the duration.
    approvalsRequestRef.current += 1;
    decisionBusyRef.current = true;
    setDecisionBusy(true);

    setRows((prev) => (prev || []).filter((candidate) => candidate.id !== row.id));

    try {
      await decideApplication(row.applicationId || row.id, status, idempotencyKey);

      addToast(
        status === 'approved'
          ? `${row.name || 'User'} approved. A welcome email with the app download link is queued — they can sign in with the password they chose at signup.`
          : `${row.name || 'User'} rejected.`,
        status === 'approved' ? 'success' : 'warning',
      );

      await readApprovals({ quiet: false, ignoreDecisionBusy: true });
      return true;
    } catch (error) {
      addToast(error?.message || 'Action failed. Please try again.', 'error');
      // Re-read rather than restoring the captured row: a failure usually means this
      // snapshot disagrees with the server, and restoring it made every retry fail.
      await readApprovals({ quiet: false, ignoreDecisionBusy: true }).catch(() => {});
      return false;
    } finally {
      decisionOperationsRef.current = {
        ...decisionOperationsRef.current,
        [row.id]: { idempotencyKey, isBusy: false },
      };
      decisionBusyRef.current = false;
      setDecisionBusy(false);
    }
  }, [addToast, readApprovals]);

  const handleApproveUser = useCallback((row) => handleUserDecision(row, 'approved'), [handleUserDecision]);
  const handleRejectUser = useCallback((row) => handleUserDecision(row, 'rejected'), [handleUserDecision]);

  // Memoised; the old provider rebuilt this object literal on every render.
  const value = useMemo(() => ({
    approvals: rows || [],
    loading: rows === null,
    meta,
    decisionBusy,
    refreshApprovals,
    handleApproveUser,
    handleRejectUser,
    handleUserDecision,
  }), [rows, meta, decisionBusy, refreshApprovals, handleApproveUser, handleRejectUser, handleUserDecision]);

  return (
    <ApprovalsQueueContext.Provider value={value}>
      {children}
    </ApprovalsQueueContext.Provider>
  );
}
