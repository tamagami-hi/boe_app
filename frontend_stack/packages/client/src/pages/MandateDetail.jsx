import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppBar from '../layout/AppBar.jsx';
import { buildPath } from '../navigation/routes.js';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import * as ordersApi from '../services/ordersApi.js';
import { fmtMoney, fmtDate } from '../utils/format.js';
import PageSheet from '../layout/PageSheet.jsx';

// A mandate is the standing debit authority behind one or more SIP plans. The
// plans are what can be paused, resumed or cancelled, and those controls apply
// immediately — there is no approval queue in between, so this screen shows the
// resulting plan state rather than a pending request.

const STATUS_LABEL = {
  created: 'Setup pending',
  pending_user_authorization: 'Awaiting your approval',
  active: 'Active',
  paused: 'Paused',
  revoked: 'Revoked',
  failed: 'Failed',
  expired: 'Expired',
};

const PLAN_BADGE = { active: 'be-badge-active', paused: 'be-badge-paused', draft: 'be-badge-paused' };

export default function MandateDetail() {
  const { mandateId } = useParams();
  const navigate = useNavigate();
  const [mandate, setMandate] = useState(null);
  const [plans, setPlans] = useState([]);
  const [confirm, setConfirm] = useState(null); // { action, planId }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await ordersApi.getMandate(mandateId);
      setMandate(found ?? null);
      if (!found) {
        setNotFound(true);
        return;
      }
      const allPlans = await ordersApi.listSips();
      setPlans(allPlans.filter((plan) => plan.mandateId === mandateId));
    } catch (loadError) {
      setNotFound(true);
      setError(loadError?.message || 'This mandate could not be loaded.');
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
      await ordersApi.requestSipControl({ orderId: confirm.planId, requestType: confirm.action });
      setConfirm(null);
      await load();
    } catch (controlError) {
      setError(controlError?.message || 'That change could not be applied.');
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <>
        <AppBar title="Mandate" />
        <div className="apk-screen">
          <div className="be-card apk-empty">
            <h2 className="apk-h-sm">Mandate unavailable</h2>
            <p>{error || 'This mandate is no longer available on your account.'}</p>
            <button type="button" className="be-btn be-btn-secondary" onClick={() => navigate(buildPath('portfolio'))}>
              Back to plans
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!mandate) {
    return (
      <>
        <AppBar title="Mandate" />
        <div className="apk-screen">
          <Skeleton variant="card" height={200} />
        </div>
      </>
    );
  }

  const awaitingApproval = mandate.status === 'pending_user_authorization';

  return (
    <>
      <AppBar title="Mandate" />
      <div className="apk-screen">
        <div className="be-card apk-mandate-card">
          <div className="apk-mandate-head">
            <div className="apk-fund-name">Auto-debit mandate</div>
            <span className={'be-badge ' + (mandate.status === 'active' ? 'be-badge-active' : 'be-badge-paused')}>
              <span className="be-badge-dot" />
              {STATUS_LABEL[mandate.status] || mandate.status}
            </span>
          </div>
          <div className="apk-sheet-summary-row">
            <span>Max per cycle</span>
            <strong className="be-money">
              {fmtMoney(mandate.maxAmountPaise ? Number(mandate.maxAmountPaise) / 100 : mandate.maxAmount)}
            </strong>
          </div>
          <div className="apk-sheet-summary-row">
            <span>Debit day</span>
            <strong>{mandate.debitDay ?? '—'}</strong>
          </div>
          {mandate.validFrom && (
            <div className="apk-sheet-summary-row">
              <span>Active from</span>
              <strong>{fmtDate(mandate.validFrom)}</strong>
            </div>
          )}
          {mandate.validTo && (
            <div className="apk-sheet-summary-row">
              <span>Valid until</span>
              <strong>{fmtDate(mandate.validTo)}</strong>
            </div>
          )}
        </div>

        {awaitingApproval && (
          <div className="be-card be-pad-4">
            <p className="apk-body-text">
              This mandate still needs your approval before instalments can be collected.
            </p>
            <button
              type="button"
              className="be-btn be-btn-primary"
              onClick={() => navigate(buildPath('mandate_authorize', { mandateId }))}
            >
              Approve mandate
            </button>
          </div>
        )}

        <div className="be-eyebrow apk-mt-3">Plans on this mandate</div>
        {plans.length === 0 ? (
          <div className="be-card apk-empty">
            <p>No plans are using this mandate.</p>
          </div>
        ) : (
          plans.map((plan) => (
            <div key={plan.id} className="be-card apk-mandate-card">
              <div className="apk-mandate-head">
                <div className="apk-fund-name be-money">{fmtMoney(plan.amount)}/month</div>
                <span className={'be-badge ' + (PLAN_BADGE[plan.status] || 'be-badge-paused')}>
                  <span className="be-badge-dot" />
                  {plan.status}
                </span>
              </div>
              {plan.nextDueDate && (
                <div className="apk-sheet-summary-row">
                  <span>Next instalment</span>
                  <strong>{fmtDate(plan.nextDueDate)}</strong>
                </div>
              )}
              <div className="apk-mandate-actions">
                {plan.status === 'active' && (
                  <button
                    type="button"
                    className="be-btn be-btn-secondary"
                    onClick={() => setConfirm({ action: 'pause', planId: plan.id })}
                  >
                    Pause
                  </button>
                )}
                {plan.status === 'paused' && (
                  <button
                    type="button"
                    className="be-btn be-btn-secondary"
                    onClick={() => setConfirm({ action: 'resume', planId: plan.id })}
                  >
                    Resume
                  </button>
                )}
                {plan.status !== 'cancelled' && (
                  <button
                    type="button"
                    className="be-btn be-btn-danger"
                    onClick={() => setConfirm({ action: 'cancel', planId: plan.id })}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))
        )}

        {error !== '' && <p className="be-error">{error}</p>}

        <p className="be-disclosure">
          To change the amount, cancel this plan and start a new one. Cancelling releases the mandate when no
          other plan is using it.
        </p>
      </div>

      {/* Shared PageSheet wrapper. `dismissible={!busy}` matters here: this is a
          destructive confirmation for a money action, and while it is applying a
          backdrop tap, Escape or Android Back must NOT dismiss it — the request is
          already in flight and the user would be left not knowing whether it
          landed. The overlay stack absorbs Back in that state. The previous
          hand-rolled wrapper also had no accessible name at all. */}
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
              {confirm.action === 'pause' && 'No further instalments are collected until you resume it.'}
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
