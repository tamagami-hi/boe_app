import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import { decideApplication } from '@beonedge/client/services/adminApplicationsApi.js';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { loadApprovals } from '../helpers/loadAdminData.js';
import { useToast } from '../components/ToastProvider.jsx';
import { hasAnyPermission } from '../navigation/nav.js';

const ApprovalsQueueContext = createContext(null);

const APPROVALS_POLL_MS = 20000;
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
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(EMPTY_META);
  const [decisionBusy, setDecisionBusy] = useState(false);

  const location = useLocation();
  const { addToast } = useToast();
  const { user } = useAdminSession();
  const canReadApplications = hasAnyPermission(user, ['applications.read']);

  const decisionOperationsRef = useRef({});
  const decisionBusyRef = useRef(false);
  const approvalsRequestRef = useRef(0);
  const lastFetchRef = useRef(0);

  const readApprovals = useCallback(async ({ quiet, ignoreDecisionBusy = false }) => {
    const reqId = ++approvalsRequestRef.current;
    if (!quiet) setMeta((prev) => ({ ...prev, syncing: true }));
    try {
      const { rows: fetched, truncated } = await loadApprovals(
        quiet ? { maxPages: QUIET_MAX_PAGES } : {},
      );
      if (reqId !== approvalsRequestRef.current) return;
      if (!ignoreDecisionBusy && decisionBusyRef.current) return;
      setRows(fetched);
      lastFetchRef.current = Date.now();
      setMeta({ updatedAt: Date.now(), syncing: false, truncated, error: '' });
    } catch (error) {
      if (reqId !== approvalsRequestRef.current) return;
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

  useEffect(() => {
    if (!canReadApplications) return;
    readApprovals({ quiet: false });
  }, [canReadApplications, readApprovals]);

  const isApprovalsSurface = APPROVALS_SURFACES.includes(location.pathname);

  useEffect(() => {
    if (!canReadApplications) return undefined;
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
  }, [refreshApprovals, isApprovalsSurface, canReadApplications]);

  const handleUserDecision = useCallback(async (row, status) => {
    if (!row?.id) return false;
    const existingOperation = decisionOperationsRef.current[row.id];
    if (existingOperation?.isBusy) return false;
    const idempotencyKey = existingOperation?.idempotencyKey || crypto.randomUUID();
    decisionOperationsRef.current = {
      ...decisionOperationsRef.current,
      [row.id]: { idempotencyKey, isBusy: true },
    };
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
