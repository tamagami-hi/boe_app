import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, RefreshCw, XCircle } from 'lucide-react';
import I from '../components/I.jsx';
import StateBadge from '../components/StateBadge.jsx';
import { fmtDateTime, fmtPaise } from '../helpers/formatters.js';
import './admin-screens-shared.css';

const CANCELLABLE_STATES = new Set(['setup_pending', 'active', 'paused']);

function Fact({ label, children }) {
  return (
    <div className="adm-field-readonly">
      <span className="adm-field-readonly__label">{label}</span>
      <strong className="adm-field-readonly__value">{children ?? '—'}</strong>
    </div>
  );
}

function TimelineItem({ title, state, timestamp, detail, action }) {
  return (
    <li className="adm-list-item">
      <div className="adm-list-item__header">
        <span className="adm-list-item__title">{title}</span>
        <StateBadge state={state} />
      </div>
      <div className="adm-list-item__body">{detail}</div>
      <div className="adm-event__head adm-list-item__meta">
        <span className="adm-event__time">{timestamp ? fmtDateTime(timestamp) : 'Not recorded'}</span>
        {action}
      </div>
    </li>
  );
}

export default function MandateDetailScreen({
  detail,
  canOperate = false,
  busy = '',
  actionError = '',
  onReconcileMandate,
  onReconcileCollection,
  onCancelMandate,
}) {
  const [reason, setReason] = useState('provider_status_check');
  const { mandate, user, fund, sip } = detail;
  const timeline = useMemo(() => [
    ...detail.setupAttempts.map((item) => ({ kind: 'setup', id: item.setupAttemptId, item })),
    ...detail.collectionAttempts.map((item) => ({ kind: 'collection', id: item.collectionId, item })),
    ...detail.cancelCommands.map((item) => ({ kind: 'cancel', id: item.commandId, item })),
  ].sort((left, right) => Date.parse(right.item.updatedAt) - Date.parse(left.item.updatedAt)), [detail]);
  const trimmedReason = reason.trim();
  const isCancellable = CANCELLABLE_STATES.has(mandate.state);

  return (
    <div className="adm-screen adm-screen--narrow be-stack-4">
      <div className="adm-title-bar">
        <Link className="be-btn be-btn-ghost be-btn-sm" to="/admin/payments/mandates">
          <I icon={ArrowLeft} size={14} /> Back to mandates
        </Link>
        <StateBadge state={mandate.state} />
      </div>

      {actionError && <div className="adm-validation-banner adm-validation-banner--error" role="alert"><I icon={AlertTriangle} size={14} /> {actionError}</div>}

      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">AutoPay mandate</span>
            <h2 className="adm-card-title">{user.name || user.email || user.id}</h2>
          </div>
        </div>
        <div className="adm-info-grid be-pad-4">
          <Fact label="Client">{user.email || user.id}</Fact>
          <Fact label="Fund">{fund.name || fund.id}</Fact>
          <Fact label="Monthly amount">{fmtPaise(mandate.amountPaise)}</Fact>
          <Fact label="Debit day">{sip.debitDay ?? 'Not set'}</Fact>
          <Fact label="SIP state"><StateBadge state={sip.state} /></Fact>
          <Fact label="Mandate state"><StateBadge state={mandate.state} /></Fact>
          <Fact label="Mandate ID"><code className="adm-code">{mandate.mandateId}</code></Fact>
          <Fact label="Merchant subscription"><code className="adm-code">{mandate.merchantSubscriptionId}</code></Fact>
          <Fact label="Provider subscription">{mandate.providerSubscriptionId || 'Not assigned'}</Fact>
          <Fact label="Provider status checked">{mandate.lastStatusCheckedAt ? fmtDateTime(mandate.lastStatusCheckedAt) : 'Not checked'}</Fact>
        </div>
      </div>

      {canOperate && (
        <div className="adm-card">
          <div className="adm-card-head"><h2 className="adm-card-title">Safe operator actions</h2></div>
          <div className="be-pad-4 be-stack-3">
            <label className="adm-field">
              <span>Reason</span>
              <input value={reason} maxLength={128} onChange={(event) => setReason(event.target.value)} placeholder="Required audit reason" />
            </label>
            <p className="adm-decision-note">Reconcile performs an authoritative status inquiry. It cannot mark a provider payment successful.</p>
            <div className="adm-card-actions adm-card-actions--responsive">
              <button type="button" className="be-btn be-btn-secondary" disabled={!trimmedReason || Boolean(busy)} onClick={() => onReconcileMandate?.(trimmedReason)}>
                <I icon={RefreshCw} size={14} /> {busy === 'mandate' ? 'Checking…' : 'Reconcile status'}
              </button>
              {isCancellable && (
                <button type="button" className="be-btn be-btn-danger" disabled={!trimmedReason || Boolean(busy)} onClick={() => onCancelMandate?.(trimmedReason)}>
                  <I icon={XCircle} size={14} /> {busy === 'cancel' ? 'Queuing…' : 'Request cancellation'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="adm-card">
        <div className="adm-card-head"><h2 className="adm-card-title">Provider and payment trace</h2></div>
        <div className="be-pad-4">
          {timeline.length === 0 ? (
            <p className="adm-decision-note">No setup, collection or cancellation records are available.</p>
          ) : (
            <ol className="adm-stream">
              {timeline.map(({ kind, id, item }) => {
                if (kind === 'setup') {
                  return <TimelineItem key={`${kind}:${id}`} title="Mandate setup authorization" state={item.state} timestamp={item.updatedAt} detail={`Payment ${item.paymentId || 'not linked'} · Order ${item.orderId || 'not linked'}${item.failureCode ? ` · ${item.failureCode}` : ''}`} />;
                }
                if (kind === 'cancel') {
                  return <TimelineItem key={`${kind}:${id}`} title="Cancellation command" state={item.state} timestamp={item.updatedAt} detail={item.failureCode || 'Durable provider cancellation workflow'} />;
                }
                return (
                  <TimelineItem
                    key={`${kind}:${id}`}
                    title={`Monthly collection ${item.duePeriod}`}
                    state={item.paymentState || item.notifyState}
                    timestamp={item.updatedAt}
                    detail={`${fmtPaise(item.amountPaise)} · Payment ${item.paymentId} · Notify ${item.notifyState}${item.failureCode ? ` · ${item.failureCode}` : ''}`}
                    action={canOperate ? (
                      <button type="button" className="be-btn be-btn-ghost be-btn-sm" disabled={!trimmedReason || Boolean(busy)} onClick={() => onReconcileCollection?.(item.collectionId, trimmedReason)}>
                        <I icon={RefreshCw} size={13} /> {busy === `collection:${item.collectionId}` ? 'Checking…' : 'Reconcile collection'}
                      </button>
                    ) : null}
                  />
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
