import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Loader2, CheckCircle, XCircle, RefreshCw, LifeBuoy } from 'lucide-react';
import { ErrorState, Skeleton } from '@beonedge/shared';
import AppBar from '../layout/AppBar.jsx';
import * as ordersApi from '../services/ordersApi.js';
import { fmtMoney, fmtDate } from '../utils/format.js';
import { buildPath, HOME_PATH } from '../navigation/routes.js';
import { useOrderCheckout } from '../payments/CheckoutProvider.jsx';
import { clearPendingPayment } from '../payments/pendingPayment.js';
import { useSession } from '../store/SessionContext.jsx';
import { useClientCacheActions } from '../data/clientResources.js';

/** The copy promises 90 seconds of checking, so the poll is bounded to it. */
const POLL_INTERVAL_MS = 2000;
const POLL_WINDOW_MS = 90000;

// Client-safe projection (spec §9.2). These are the ONLY states this screen can
// render — bank verification, review and allocation concepts never reach the
// client bundle.
const NON_TERMINAL = new Set(['payment_in_progress', 'processing', 'refund_in_progress']);

const STATE_COPY = {
  payment_in_progress: 'Awaiting payment…',
  processing: 'Payment received — investment is being processed',
  confirmed: 'Investment confirmed',
  refund_in_progress: 'This payment is being refunded to your account',
  support_required: 'We could not complete this payment automatically. Please contact support and we will sort it out.',
  refunded: 'This payment has been refunded',
  payment_failed: "Payment couldn't be confirmed",
};

// Neutral three-step timeline. No "review", "approval" or "allocation" step.
const TIMELINE = [
  { key: 'initiated', label: 'Payment initiated' },
  { key: 'received', label: 'Payment received' },
  { key: 'confirmed', label: 'Investment confirmed' },
];

function timelineIndex(status) {
  if (status === 'confirmed') return 2;
  if (status === 'processing' || status === 'refund_in_progress' || status === 'refunded') return 1;
  return 0;
}

function stateIcon(status) {
  if (status === 'confirmed' || status === 'refunded') return CheckCircle;
  if (status === 'payment_failed') return XCircle;
  if (status === 'support_required') return LifeBuoy;
  return Loader2;
}

export default function PaymentStatus() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const startOrderCheckout = useOrderCheckout();
  const { user } = useSession();
  const { invalidateMoney } = useClientCacheActions();
  const [payment, setPayment] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [pollExpired, setPollExpired] = useState(false);
  // Guards the retry path: beginning a fresh checkout is a write, and a double
  // tap must not begin two.
  const retryLockRef = useRef(false);
  const polling = useRef(null);
  const mountedRef = useRef(true);
  const observedStatusRef = useRef(null);

  const applyPayment = useCallback((nextPayment) => {
    const previousStatus = observedStatusRef.current;
    const nextStatus = nextPayment?.status ?? null;
    setPayment(nextPayment);
    if (previousStatus !== null && nextStatus !== previousStatus) invalidateMoney();
    observedStatusRef.current = nextStatus;
  }, [invalidateMoney]);

  const loadPayment = useCallback(async () => {
    try {
      const p = await ordersApi.getPayment(paymentId);
      if (!mountedRef.current) return null;
      applyPayment(p);
      if (!NON_TERMINAL.has(p?.status)) clearPendingPayment(paymentId, user?.id);
      setLoadError(null);
      return p;
    } catch (error) {
      if (error?.code === 'RESOURCE_NOT_FOUND' || error?.code === 'AUTHORIZATION_DENIED' || error?.status === 403 || error?.status === 404) {
        clearPendingPayment(paymentId);
      }
      // A failed read must not leave a permanent skeleton on the screen the
      // investor opened to find out whether their money moved.
      if (mountedRef.current) setLoadError(error);
      return null;
    }
  }, [applyPayment, paymentId, user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    setPollExpired(false);
    loadPayment();

    const startedAt = Date.now();
    polling.current = setInterval(async () => {
      try {
        const p = await ordersApi.getPayment(paymentId);
        if (!mountedRef.current) return;
        applyPayment(p);
        if (!NON_TERMINAL.has(p?.status)) {
          clearPendingPayment(paymentId);
          clearInterval(polling.current);
          return;
        }
      } catch {
        // A transient poll failure is not news; the window below bounds it.
      }
      // The disclosure says 90 seconds. Without this the interval ran forever on
      // a payment that never settled.
      if (mountedRef.current && Date.now() - startedAt >= POLL_WINDOW_MS) {
        clearInterval(polling.current);
        setPollExpired(true);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (polling.current) clearInterval(polling.current);
    };
  }, [applyPayment, paymentId, loadPayment]);

  const checkAgain = useCallback(async () => {
    setPollExpired(false);
    await loadPayment();
  }, [loadPayment]);

  const handleRetry = useCallback(async () => {
    if (!payment?.orderId) return;
    if (retryLockRef.current) return;
    retryLockRef.current = true;
    try {
      const outcome = await startOrderCheckout(payment.orderId);
      invalidateMoney();
      if (!outcome.leaving) await loadPayment();
    } catch (error) {
      if (mountedRef.current) setLoadError(error);
    } finally {
      retryLockRef.current = false;
    }
  }, [invalidateMoney, payment, startOrderCheckout, loadPayment]);

  if (!payment) {
    return (
      <>
        <AppBar title="Payment" leftIcon={X} onLeft={() => navigate(HOME_PATH, { replace: true })} />
        <div className="apk-screen">
          {loadError ? (
            <ErrorState
              title="We could not load this payment"
              description="Your payment is unaffected. This screen could not reach the server."
              onRetry={loadPayment}
            />
          ) : (
            <Skeleton variant="rect" height="200px" />
          )}
        </div>
      </>
    );
  }

  const status = payment.status;
  const isInProgress = NON_TERMINAL.has(status);
  const isSuccess = status === 'confirmed';
  const isFailed = status === 'payment_failed';
  const isRefund = status === 'refund_in_progress' || status === 'refunded' || status === 'support_required';
  const Icon = stateIcon(status);
  const stateLine = STATE_COPY[status] || 'Awaiting payment…';
  const tlIdx = timelineIndex(status);

  /*
   * Leaving a payment always REPLACES this entry, so Android Back can never
   * drop the user back into a transaction that already settled.
   */
  function onContinue() {
    navigate(HOME_PATH, { replace: true });
  }

  return (
    <>
      <AppBar title="Payment" leftIcon={X} onLeft={() => navigate(HOME_PATH, { replace: true })} />
      <div className="apk-screen">
        <div className="apk-payment-state">
          <div className={`apk-payment-icon-wrap ${isSuccess ? 'apk-payment-icon-wrap--success' : isFailed ? 'apk-payment-icon-wrap--failed' : ''}`}>
            <Icon size={32} strokeWidth={1.5} className={isInProgress ? 'apk-spin' : ''} />
          </div>
          <div className="apk-payment-state-line">{stateLine}</div>
          <div className="apk-payment-amount be-money">{fmtMoney(payment.amount)}</div>
        </div>

        {!isFailed && (
          <div className="be-card apk-timeline">
            {TIMELINE.map((t, i) => (
              <div key={t.key} className="apk-timeline-row">
                <div className={'apk-timeline-dot' + (i < tlIdx ? ' is-done' : i === tlIdx ? ' is-active' : '')} />
                <div>{t.label}</div>
                <div className="apk-timeline-ts">{i <= tlIdx ? fmtDate(payment.createdAt, { withTime: true }).split(',')[1] : ''}</div>
              </div>
            ))}
          </div>
        )}

        <div className="be-disclosure">
          {isInProgress
            ? pollExpired
              ? 'We stopped checking after 90 seconds. Your payment may still settle — check again, or find it under Transactions.'
              : "We'll keep checking the payment status for 90 seconds."
            : status === 'processing'
              ? ''
              : 'We do not store your UPI PIN or card details.'}
        </div>
        {status === 'processing' && (
          <div className="be-disclosure">Your investment appears in your portfolio once processing completes.</div>
        )}
        {isRefund && (
          <div className="be-disclosure">No investment was created from this payment. If you have questions, contact support.</div>
        )}
        {pollExpired && isInProgress && (
          <button type="button" className="be-btn be-btn-secondary be-btn-block" onClick={checkAgain}>
            Check again
          </button>
        )}
        {loadError && payment && (
          <div className="apk-banner apk-banner-red" role="alert">
            We could not confirm the latest status. What you see may be out of date.
          </div>
        )}

        <div className="apk-action-bar">
          {isFailed && (
            <>
              <button type="button" className="be-btn be-btn-primary be-btn-block be-btn-lg" onClick={handleRetry}>
                <RefreshCw size={18} strokeWidth={2} className="apk-pay-icon" /> Try again
              </button>
              <button type="button" className="be-btn be-btn-secondary be-btn-block be-btn-lg" onClick={() => navigate(buildPath('activity'), { replace: true })}>View transactions</button>
            </>
          )}
          {isSuccess && (
            <>
              <button
                type="button"
                className="be-btn be-btn-secondary be-btn-lg"
                onClick={() => navigate(buildPath('activity'), { replace: true })}
              >
                View transaction
              </button>
              <button type="button" className="be-btn be-btn-primary be-btn-lg" onClick={onContinue}>Continue</button>
            </>
          )}
          {isRefund && (
            <button type="button" className="be-btn be-btn-primary be-btn-block be-btn-lg" onClick={onContinue}>Continue</button>
          )}
          {isInProgress && (
            <button type="button" className="be-btn be-btn-ghost be-btn-block be-btn-lg" onClick={() => navigate(HOME_PATH, { replace: true })}>Cancel payment</button>
          )}
        </div>
      </div>
    </>
  );
}
