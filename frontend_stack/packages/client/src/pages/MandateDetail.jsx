import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppBar from '../layout/AppBar.jsx';
import { buildPath } from '../navigation/routes.js';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import * as ordersApi from '../services/ordersApi.js';
import { fmtMoney, fmtDate } from '../utils/format.js';
import { redirectToCheckout } from '../utils/checkoutRedirect.js';
import PageSheet from '../layout/PageSheet.jsx';

// A SIP plan is a schedule/reminder (spec §6.2 fallback): nothing is debited
// automatically and there is no mandate to authorise. Pause, resume and cancel
// act on the plan directly — there is no approval queue in between, so this
// screen shows the resulting plan state rather than a pending request. Each due
// installment is paid by the client through a fresh PhonePe checkout.

const STATUS_LABEL = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  draft: 'Draft',
};

const PLAN_BADGE = { active: 'be-badge-active', paused: 'be-badge-paused', draft: 'be-badge-paused' };

// A due, unpaid installment order. Statuses are the client-safe projection
// (§9.2) plus the raw pre-payment order states tolerated from older payloads.
const PAYABLE_ORDER_STATES = new Set(['submitted', 'payment_pending', 'payment_in_progress', 'payment_failed']);

export default function MandateDetail() {
  const { mandateId } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [dueOrder, setDueOrder] = useState(null);
  const [confirm, setConfirm] = useState(null); // { action }
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const allPlans = await ordersApi.listSips();
      const found = allPlans.find((p) => p.id === mandateId) ?? null;
      setPlan(found);
      if (!found) {
        setNotFound(true);
        return;
      }
      const allOrders = await ordersApi.listOrders();
      setDueOrder(
        allOrders.find((order) => order.sipPlanId === found.id && PAYABLE_ORDER_STATES.has(order.status)) ?? null,
      );
    } catch (loadError) {
      setNotFound(true);
      setError(loadError?.message || 'This plan could not be loaded.');
    }
  }, [mandateId]);

  useEffect(() => {
    load();
  }, [load]);

  async function applyControl() {
    if (!confirm) return;
    setBusy(true);
    setError('');
    try {
      await ordersApi.requestSipControl({ orderId: plan.id, requestType: confirm.action });
      setConfirm(null);
      await load();
    } catch (controlError) {
      setError(controlError?.message || 'That change could not be applied.');
    } finally {
      setBusy(false);
    }
  }

  // Pay the due installment: a fresh client-initiated PhonePe checkout via the
  // same order/pay flow as a one-time investment. The browser never asserts
  // success — the status route polls the backend.
  async function payDueInstallment() {
    if (!dueOrder || paying) return;
    setPaying(true);
    setError('');
    try {
      const begun = await ordersApi.beginOrderPayment(dueOrder.id);
      if (begun?.checkout?.type === 'redirect' && begun.checkout.url && redirectToCheckout(begun.checkout.url).ok) {
        return; // browser is leaving for PhonePe
      }
      if (begun?.paymentId) {
        navigate(buildPath('payment_status', { paymentId: begun.paymentId }), { replace: true });
        return;
      }
      setError("Couldn't start the payment. Try again.");
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
    return (
      <>
        <AppBar title="SIP plan" />
        <div className="apk-screen">
          <Skeleton variant="card" height={200} />
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="SIP plan" />
      <div className="apk-screen">
        <div className="be-card apk-mandate-card">
          <div className="apk-mandate-head">
            <div className="apk-fund-name">SIP schedule</div>
            <span className={'be-badge ' + (PLAN_BADGE[plan.status] || 'be-badge-paused')}>
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
            <div className="apk-sheet-summary-row">
              <span>Duration</span>
              <strong>{plan.durationMonths} months</strong>
            </div>
          )}
          {plan.nextDueDate && (
            <div className="apk-sheet-summary-row">
              <span>Next instalment</span>
              <strong>{fmtDate(plan.nextDueDate)}</strong>
            </div>
          )}
        </div>

        {dueOrder && plan.status === 'active' && (
          <div className="be-card be-pad-4">
            <p className="apk-body-text">
              Your instalment of {fmtMoney(dueOrder.amount)} is due. Pay it now through a secure checkout.
            </p>
            <button
              type="button"
              className="be-btn be-btn-primary"
              onClick={payDueInstallment}
              disabled={paying}
            >
              {paying ? 'Opening checkout…' : `Pay ${fmtMoney(dueOrder.amount)} now`}
            </button>
          </div>
        )}

        {plan.status !== 'cancelled' && (
          <div className="apk-mandate-actions">
            {plan.status === 'active' && (
              <button
                type="button"
                className="be-btn be-btn-secondary"
                onClick={() => setConfirm({ action: 'pause' })}
              >
                Pause
              </button>
            )}
            {plan.status === 'paused' && (
              <button
                type="button"
                className="be-btn be-btn-secondary"
                onClick={() => setConfirm({ action: 'resume' })}
              >
                Resume
              </button>
            )}
            <button
              type="button"
              className="be-btn be-btn-danger"
              onClick={() => setConfirm({ action: 'cancel' })}
            >
              Cancel
            </button>
          </div>
        )}

        {error !== '' && <p className="be-error">{error}</p>}

        <p className="be-disclosure">
          This SIP is a monthly schedule. Each instalment is paid by you through a fresh checkout — no
          automatic debit is set up. To change the amount, cancel this plan and start a new one.
        </p>
      </div>

      {/* `dismissible={!busy}` matters: this is a destructive confirmation for a
          money action, and while it is applying a backdrop tap, Escape or
          Android Back must NOT dismiss it — the request is already in flight and
          the user would be left not knowing whether it landed. */}
      <PageSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        dismissible={!busy}
        label="Confirm plan change"
      >
        {confirm !== null && (
          <>
            <h2 className="apk-h-sm">
              {confirm.action === 'pause' && 'Pause this plan?'}
              {confirm.action === 'resume' && 'Resume this plan?'}
              {confirm.action === 'cancel' && 'Cancel this plan?'}
            </h2>
            <p className="apk-body-text">
              {confirm.action === 'pause' && 'No further instalments are scheduled until you resume it.'}
              {confirm.action === 'resume' && 'Instalments resume from the next debit day.'}
              {confirm.action === 'cancel' &&
                'This cannot be undone. Money already invested stays invested and keeps earning returns.'}
            </p>
            <div className="apk-mandate-actions">
              <button
                type="button"
                className="be-btn be-btn-secondary"
                onClick={() => setConfirm(null)}
                disabled={busy}
              >
                Keep as is
              </button>
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
