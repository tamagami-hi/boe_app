import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, Loader2, CheckCircle, XCircle, CreditCard } from 'lucide-react';
import { ErrorState, Skeleton } from '@beonedge/shared';
import AppBar from '../layout/AppBar.jsx';
import * as ordersApi from '../services/ordersApi.js';
import { fmtMoney, fmtDate } from '../utils/format.js';
import { openRazorpayCheckout } from '../utils/razorpay.js';
import { HOME_PATH, buildPath } from '../navigation/routes.js';

/** The copy promises 90 seconds of checking, so the poll is bounded to it. */
const POLL_INTERVAL_MS = 2000;
const POLL_WINDOW_MS = 90000;
const TERMINAL = ['success', 'reconciled', 'approved', 'failed', 'expired', 'rejected'];

const TIMELINE = [
  { key: 'created', label: 'Created' },
  { key: 'gateway_initiated', label: 'Gateway initiated' },
  { key: 'pending', label: 'Awaiting confirmation' },
  { key: 'success', label: 'Payment received' },
  { key: 'approved', label: 'Admin approved' },
];

export default function PaymentStatus() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [pollExpired, setPollExpired] = useState(false);
  const [order, setOrder] = useState(null);
  // Guards a second Razorpay checkout: the button is not disabled while the sheet
  // is open, so a double tap used to open two.
  const payLockRef = useRef(false);
  const polling = useRef(null);
  const mountedRef = useRef(true);

  const loadPayment = useCallback(async () => {
    try {
      const p = await ordersApi.getPayment(paymentId);
      if (!mountedRef.current) return null;
      setPayment(p);
      setLoadError(null);
      if (p.orderId) {
        const o = await ordersApi.getOrder(p.orderId);
        if (mountedRef.current) setOrder(o);
      }
      return p;
    } catch (error) {
      // A failed read used to leave `payment` null forever: a permanent skeleton
      // on a screen the investor opened to find out whether their money moved.
      if (mountedRef.current) setLoadError(error);
      return null;
    }
  }, [paymentId]);

  useEffect(() => {
    mountedRef.current = true;
    setPollExpired(false);
    loadPayment();

    const startedAt = Date.now();
    polling.current = setInterval(async () => {
      try {
        const p = await ordersApi.pollPaymentStatus(paymentId);
        if (!mountedRef.current) return;
        setPayment(p);
        if (TERMINAL.includes(p.status)) {
          clearInterval(polling.current);
          return;
        }
      } catch {
        // A transient poll failure is not news; the window below bounds it.
      }
      // The disclosure says 90 seconds. Without this the interval ran forever on a
      // payment that never settled, so the app both lied and kept polling.
      if (mountedRef.current && Date.now() - startedAt >= POLL_WINDOW_MS) {
        clearInterval(polling.current);
        setPollExpired(true);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (polling.current) clearInterval(polling.current);
    };
  }, [paymentId, loadPayment]);

  const checkAgain = useCallback(async () => {
    setPollExpired(false);
    await loadPayment();
  }, [loadPayment]);

  const handlePayNow = useCallback(async () => {
    if (!payment?.providerPaymentId || !payment?.amount) return;
    if (payLockRef.current) return;
    payLockRef.current = true;
    await openRazorpayCheckout({
      keyId: payment.providerKeyId,
      orderId: payment.providerOrderId || payment.providerPaymentId,
      amount: payment.amount,
      currency: payment.currency,
      name: order?.fundName || (order?.type === 'sip' ? 'Monthly SIP' : 'One-time Investment'),
      description: order?.type === 'sip' ? 'SIP Setup' : 'Lumpsum Investment',
      userEmail: payment.userEmail || '',
      userContact: payment.userPhone || '',
      onSuccess: async (response) => {
        try {
          await ordersApi.confirmRazorpayPayment(paymentId, response);
        } catch (error) {
          // The gateway took the payment but confirmation did not land. Say so and
          // re-read: the server state is the authority, not this screen.
          if (mountedRef.current) setLoadError(error);
        }
        payLockRef.current = false;
        await loadPayment();
      },
      // Also fires on dismissal, so the lock must release here or the button is
      // dead for the rest of the screen's life.
      onFailure: () => {
        payLockRef.current = false;
        loadPayment();
      },
    });
  }, [payment, order, loadPayment]);

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

  const isSuccess = payment.status === 'success' || payment.status === 'reconciled' || payment.status === 'approved';
  const isAwaitingApproval = payment.status === 'success' || payment.status === 'reconciled';
  const isFailed = payment.status === 'failed' || payment.status === 'expired' || payment.status === 'rejected';
  const isCreated = payment.status === 'created';
  const Icon = isSuccess ? CheckCircle : isFailed ? XCircle : Loader2;
  const stateLine = isAwaitingApproval
    ? 'Payment received, awaiting admin approval'
    : isSuccess
      ? 'Payment approved'
      : isFailed
        ? "Payment couldn't be confirmed"
        : 'Awaiting payment…';
  const timelineStatus = payment.status === 'reconciled' ? 'success' : payment.status;
  const tlIdx = TIMELINE.findIndex((t) => t.key === timelineStatus);

  /*
   * Leaving a payment always REPLACES this entry.
   *
   * Completion used to push the next screen on top of the payment, so Android Back
   * dropped the user straight back into a transaction that had already settled —
   * where the pay button was still on screen. Replacing prunes the completed step
   * from history instead, which is the plan's "completed transactional routes are
   * pruned" rule.
   *
   * The mandate hand-off is the one case that moves forward rather than home: a
   * mock-provider SIP still needs its mandate authorised.
   */
  function onContinue() {
    if (order?.type === 'sip' && order.mandateId && payment?.provider === 'mock') {
      navigate(buildPath('mandate_authorize', { mandateId: order.mandateId }), { replace: true });
      return;
    }
    navigate(HOME_PATH, { replace: true });
  }

  const showPayButton = isCreated && payment.provider === 'razorpay' && payment.providerPaymentId && payment.providerKeyId;
  const showRazorpayConfigError = isCreated && payment.provider === 'razorpay' && payment.providerPaymentId && !payment.providerKeyId;

  return (
    <>
      {/* `replace` for the same reason as onContinue: an abandoned payment must
          not be reachable with Back. */}
      <AppBar title="Payment" leftIcon={X} onLeft={() => navigate(HOME_PATH, { replace: true })} />
      <div className="apk-screen">
        <div className="apk-payment-state">
          <div className={`apk-payment-icon-wrap ${isSuccess ? 'apk-payment-icon-wrap--success' : isFailed ? 'apk-payment-icon-wrap--failed' : ''}`}>
            <Icon size={32} strokeWidth={1.5} className={!isSuccess && !isFailed ? 'apk-spin' : ''} />
          </div>
          <div className="apk-payment-state-line">{stateLine}</div>
          <div className="apk-payment-amount be-money">{fmtMoney(payment.amount)}</div>
          <div className="apk-payment-method">{payment.upiHandle ? `UPI · ${payment.upiHandle}` : 'Payment method pending'}</div>
          {isFailed && payment.failureReason && <div className="be-disclosure apk-payment-error">{payment.failureReason}</div>}
        </div>

        <div className="be-card apk-timeline">
          {TIMELINE.map((t, i) => (
            <div key={t.key} className="apk-timeline-row">
              <div className={'apk-timeline-dot' + (i < tlIdx ? ' is-done' : i === tlIdx ? ' is-active' : '')} />
              <div>{t.label}</div>
              <div className="apk-timeline-ts">{i <= tlIdx ? fmtDate(payment.createdAt, { withTime: true }).split(',')[1] : ''}</div>
            </div>
          ))}
        </div>

        <div className="be-disclosure">
          {isSuccess || isFailed
            ? 'We do not store your UPI PIN.'
            : pollExpired
              ? 'We stopped checking after 90 seconds. Your payment may still settle — check again, or find it under Transactions.'
              : "We'll keep checking the gateway status for 90 seconds."}
        </div>
        {pollExpired && !isSuccess && !isFailed && (
          <button type="button" className="be-btn be-btn-secondary be-btn-block" onClick={checkAgain}>
            Check again
          </button>
        )}
        {loadError && payment && (
          <div className="apk-banner apk-banner-red" role="alert">
            We could not confirm the latest status. What you see may be out of date.
          </div>
        )}

        {isAwaitingApproval && (
          <div className="be-disclosure">Your payment is now with the admin portal for approval. Portfolio and fund pool values update after approval.</div>
        )}

        {payment.status === 'approved' && (
          <div className="be-disclosure">The approved amount has been posted to your selected fund pool and portfolio.</div>
        )}

        <div className="apk-action-bar">
          {showPayButton && (
            <button type="button" className="be-btn be-btn-primary be-btn-block be-btn-lg" onClick={handlePayNow}>
              <CreditCard size={18} strokeWidth={2} className="apk-pay-icon" /> Pay with Razorpay
            </button>
          )}
          {showRazorpayConfigError && (
            <div className="apk-banner apk-banner-red">
              Razorpay checkout is not configured for this payment.
            </div>
          )}
          {isSuccess && (
            <>
              <button
                type="button"
                className="be-btn be-btn-secondary be-btn-lg"
                onClick={() => navigate(
                  isAwaitingApproval ? `${buildPath('activity')}?tab=approval` : buildPath('activity'),
                  { replace: true },
                )}
              >
                View transaction
              </button>
              <button type="button" className="be-btn be-btn-primary be-btn-lg" onClick={onContinue}>Continue</button>
            </>
          )}
          {isFailed && (
            <button type="button" className="be-btn be-btn-secondary be-btn-block be-btn-lg" onClick={() => navigate(buildPath('activity'), { replace: true })}>View transactions</button>
          )}
          {!isSuccess && !isFailed && !showPayButton && (
            <button type="button" className="be-btn be-btn-ghost be-btn-block be-btn-lg" onClick={() => navigate(HOME_PATH, { replace: true })}>Cancel payment</button>
          )}
        </div>
      </div>
    </>
  );
}
