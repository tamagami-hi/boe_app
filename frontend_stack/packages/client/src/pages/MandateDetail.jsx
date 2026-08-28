import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppBar from '../layout/AppBar.jsx';
import { buildPath } from '../navigation/routes.js';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import * as ordersApi from '../services/ordersApi.js';
import { fmtMoney, fmtDate } from '../utils/format.js';
import PageSheet from '../layout/PageSheet.jsx';
import { useCheckoutPlatform, useOrderCheckout } from '../payments/CheckoutProvider.jsx';

const STATUS_LABEL = {
  setup_pending: 'Awaiting authorization',
  pending_mandate: 'Awaiting authorization',
  active: 'Active',
  pause_pending: 'Pause pending',
  paused: 'Paused',
  cancel_pending: 'Cancellation pending',
  cancelled: 'Cancelled',
  revoke_pending: 'Revocation pending',
  revoked: 'Revoked',
  expired: 'Expired',
  setup_failed: 'Authorization failed',
  mandate_failed: 'Authorization failed',
  failed: 'Failed',
  completed: 'Completed',
  draft: 'Draft',
};

const POLLING_STATES = new Set(['pending_mandate', 'pause_pending', 'cancel_pending', 'revoke_pending']);
const AUTO_PAY_CANCEL_STATES = new Set(['pending_mandate', 'active', 'paused']);
const PAYABLE_ORDER_STATES = new Set(['submitted', 'payment_pending', 'payment_in_progress', 'payment_failed']);
const POLL_INTERVAL_MS = 3000;

function isNotFound(error) {
  return error?.code === 'RESOURCE_NOT_FOUND' || error?.status === 404 || error?.response?.status === 404;
}

export default function MandateDetail() {
  const { mandateId } = useParams();
  const navigate = useNavigate();
  const startOrderCheckout = useOrderCheckout();
  const checkoutPlatform = useCheckoutPlatform();
  const [plan, setPlan] = useState(null);
  const [dueOrder, setDueOrder] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const loadManualPlan = useCallback(async () => {
    const allPlans = await ordersApi.listSips();
    const found = allPlans.find((item) => item.id === mandateId) ?? null;
    if (!found) return null;
    const allOrders = await ordersApi.listOrders();
    setDueOrder(
      allOrders.find((order) => order.sipPlanId === found.id && PAYABLE_ORDER_STATES.has(order.status)) ?? null,
    );
    return found;
  }, [mandateId]);

  const load = useCallback(async () => {
    try {
      let found;
      try {
        found = await ordersApi.getAutoPaySip(mandateId);
      } catch (autoPayError) {
        if (!isNotFound(autoPayError)) throw autoPayError;
        found = null;
      }
      if (!found) found = await loadManualPlan();
      setPlan(found);
      setNotFound(found === null);
      setError('');
      if (found?.collectionMode === 'phonepe_autopay') setDueOrder(null);
    } catch (loadError) {
      setError(loadError?.message || 'This plan could not be loaded.');
    }
  }, [loadManualPlan, mandateId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (plan?.collectionMode !== 'phonepe_autopay' || !POLLING_STATES.has(plan.status)) return undefined;
    const timer = window.setInterval(load, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load, plan?.collectionMode, plan?.status]);

  async function applyControl() {
    if (!confirm || !plan) return;
    setBusy(true);
    setError('');
    try {
      if (plan.collectionMode === 'phonepe_autopay') {
        await ordersApi.cancelAutoPaySip(plan.id);
      } else {
        await ordersApi.requestSipControl({ orderId: plan.id, requestType: confirm.action });
      }
      setConfirm(null);
      await load();
    } catch (controlError) {
      setError(controlError?.message || 'That change could not be applied.');
    } finally {
      setBusy(false);
    }
  }

  async function retryAuthorization() {
    if (!plan || busy) return;
    setBusy(true);
    setError('');
    try {
      const setup = await ordersApi.retryAutoPaySetup(plan.id);
      if (!setup.checkout) throw new Error("Couldn't start AutoPay authorization. Try again.");
      await checkoutPlatform.start({ checkout: setup.checkout, paymentId: setup.paymentId });
      await load();
    } catch (retryError) {
      setError(retryError?.message || "Couldn't retry AutoPay authorization. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function payDueInstallment() {
    if (!dueOrder || paying) return;
    setPaying(true);
    setError('');
    try {
      await startOrderCheckout(dueOrder.id);
    } catch (payError) {
      setError(payError?.message || "Couldn't start the payment. Try again.");
    } finally {
      setPaying(false);
    }
  }

  if (notFound) {
    return (
      <>
        <AppBar title="SIP plan" />
        <div className="apk-screen">
          <div className="be-card apk-empty">
            <h2 className="apk-h-sm">Plan unavailable</h2>
            <p>{error || 'This plan is no longer available on your account.'}</p>
            <button type="button" className="be-btn be-btn-secondary" onClick={() => navigate(buildPath('portfolio'))}>
              Back to plans
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!plan) {
    if (error) {
      return (
        <>
          <AppBar title="SIP plan" />
          <div className="apk-screen">
            <div className="be-card apk-empty">
              <h2 className="apk-h-sm">Plan status unavailable</h2>
              <p>{error}</p>
              <button type="button" className="be-btn be-btn-primary" onClick={load}>Try again</button>
            </div>
          </div>
        </>
      );
    }
    return (
      <>
        <AppBar title="SIP plan" />
        <div className="apk-screen"><Skeleton variant="card" height={200} /></div>
      </>
    );
  }

  const isAutoPay = plan.collectionMode === 'phonepe_autopay';

  return (
    <>
      <AppBar title={isAutoPay ? 'UPI AutoPay SIP' : 'SIP plan'} />
      <div className="apk-screen">
        <div className="be-card apk-mandate-card">
          <div className="apk-mandate-head">
            <div className="apk-fund-name">{isAutoPay ? 'UPI AutoPay mandate' : 'SIP schedule'}</div>
            <span className={'be-badge ' + (plan.status === 'active' ? 'be-badge-active' : 'be-badge-paused')}>
              <span className="be-badge-dot" />
              {STATUS_LABEL[plan.status] || plan.status}
            </span>
          </div>
          <div className="apk-sheet-summary-row">
            <span>Amount per month</span>
            <strong className="be-money">{fmtMoney(plan.amount)}</strong>
          </div>
          <div className="apk-sheet-summary-row">
            <span>Debit day</span>
            <strong>{plan.debitDay ?? '—'}</strong>
          </div>
          {plan.durationMonths && (
            <div className="apk-sheet-summary-row"><span>Duration</span><strong>{plan.durationMonths} months</strong></div>
          )}
          {isAutoPay && plan.mandate?.status && (
            <div className="apk-sheet-summary-row">
              <span>Mandate status</span>
              <strong>{STATUS_LABEL[plan.mandate.status] || plan.mandate.status}</strong>
            </div>
          )}
          {!isAutoPay && plan.nextDueDate && (
            <div className="apk-sheet-summary-row"><span>Next instalment</span><strong>{fmtDate(plan.nextDueDate)}</strong></div>
          )}
        </div>

        {!isAutoPay && dueOrder && plan.status === 'active' && (
          <div className="be-card be-pad-4">
            <p className="apk-body-text">
              Your instalment of {fmtMoney(dueOrder.amount)} is due. Pay it now through a secure checkout.
            </p>
            <button type="button" className="be-btn be-btn-primary" onClick={payDueInstallment} disabled={paying}>
              {paying ? 'Opening checkout…' : `Pay ${fmtMoney(dueOrder.amount)} now`}
            </button>
          </div>
        )}

        {isAutoPay ? (
          <div className="apk-mandate-actions">
            {plan.canRetrySetup === true && (
              <button type="button" className="be-btn be-btn-primary" onClick={retryAuthorization} disabled={busy}>
                {busy ? 'Opening UPI app…' : 'Retry authorization'}
              </button>
            )}
            {AUTO_PAY_CANCEL_STATES.has(plan.status) && (
              <button type="button" className="be-btn be-btn-danger" onClick={() => setConfirm({ action: 'cancel' })} disabled={busy}>
                Cancel AutoPay
              </button>
            )}
          </div>
        ) : plan.status !== 'cancelled' && (
          <div className="apk-mandate-actions">
            {plan.status === 'active' && (
              <button type="button" className="be-btn be-btn-secondary" onClick={() => setConfirm({ action: 'pause' })}>Pause</button>
            )}
            {plan.status === 'paused' && (
              <button type="button" className="be-btn be-btn-secondary" onClick={() => setConfirm({ action: 'resume' })}>Resume</button>
            )}
            <button type="button" className="be-btn be-btn-danger" onClick={() => setConfirm({ action: 'cancel' })}>Cancel</button>
          </div>
        )}

        {error !== '' && <p className="be-error">{error}</p>}

        <p className="be-disclosure">
          {isAutoPay
            ? 'Returning from the UPI app does not confirm authorization. This status is updated only after PhonePe confirms it to our server.'
            : 'This SIP is a monthly schedule. Each instalment is paid by you through a fresh checkout — no automatic debit is set up. To change the amount, cancel this plan and start a new one.'}
        </p>
      </div>

      <PageSheet open={confirm !== null} onClose={() => setConfirm(null)} dismissible={!busy} label="Confirm plan change">
        {confirm !== null && (
          <>
            <h2 className="apk-h-sm">
              {confirm.action === 'pause' && 'Pause this plan?'}
              {confirm.action === 'resume' && 'Resume this plan?'}
              {confirm.action === 'cancel' && (isAutoPay ? 'Cancel this AutoPay mandate?' : 'Cancel this plan?')}
            </h2>
            <p className="apk-body-text">
              {confirm.action === 'pause' && 'No further instalments are scheduled until you resume it.'}
              {confirm.action === 'resume' && 'Instalments resume from the next debit day.'}
              {confirm.action === 'cancel' && 'This cannot be undone. Money already invested stays invested and keeps earning returns.'}
            </p>
            <div className="apk-mandate-actions">
              <button type="button" className="be-btn be-btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Keep as is</button>
              <button
                type="button"
                className={confirm.action === 'cancel' ? 'be-btn be-btn-danger' : 'be-btn be-btn-primary'}
                onClick={applyControl}
                disabled={busy}
              >
                {busy ? 'Applying…' : 'Confirm'}
              </button>
            </div>
          </>
        )}
      </PageSheet>
    </>
  );
}
