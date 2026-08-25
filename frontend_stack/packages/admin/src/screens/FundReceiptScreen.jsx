import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '@beonedge/client/services/_util.js';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import AdminReadError from '../data/AdminReadError.jsx';
import {
  useAdminCacheActions,
  useAdminFundReceipts,
  useAdminRefunds,
} from '../data/adminResources.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { fmtDateTime, fmtInt, fmtPaise, humanizeState } from '../helpers/formatters.js';
import { hasAnyPermission } from '../navigation/nav.js';
import './admin-screens-shared.css';

const RECEIPT_TABS = [
  { id: 'awaiting', label: 'Awaiting acknowledgement', path: '/admin/funds-received/awaiting' },
  { id: 'acknowledged', label: 'Acknowledged', path: '/admin/funds-received/acknowledged' },
  { id: 'refunds', label: 'Refunds and exceptions', path: '/admin/funds-received/refunds' },
];

const REFUND_STATES = ['pending', 'provider_pending', 'failed', 'refunded'];

const isConflict = (error) => error?.status === 409;

function FundReceiptPanel({ item, onDone, canAcknowledge }) {
  const [privateNote, setPrivateNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lockRef = useRef(false);
  const idempotencyKeyFor = useIdempotencyKeys();

  const expectedVersion = String(item.acknowledgement?.version ?? '1');
  const note = privateNote.trim();

  async function acknowledge() {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setError('');
    const body = { expectedVersion, ...(note ? { privateNote: note } : {}) };
    try {
      await apiRequest(
        `/v1/admin/fund-receipts/${encodeURIComponent(item.orderId)}/acknowledge`,
        {
          method: 'POST',
          scope: 'admin',
          body,
          headers: { 'Idempotency-Key': idempotencyKeyFor(`${item.orderId}:acknowledge`, body) },
        },
      );
      onDone('Funds acknowledged. The client has been notified that their funds are ready for investment.');
    } catch (decideError) {
      if (isConflict(decideError)) {
        onDone('This acknowledgement changed since you opened it. The queue was refreshed.');
        return;
      }
      setError(decideError?.message || 'The acknowledgement was not recorded.');
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="adm-decision">
      <dl className="adm-decision-facts">
        <div>
          <dt>Client</dt>
          <dd>
            {item.client?.name || 'Client'}
            {item.client?.email && <div className="adm-cell-sub">{item.client.email}</div>}
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd className="be-money">{fmtPaise(item.amountPaise)}</dd>
        </div>
        <div>
          <dt>Selected fund</dt>
          <dd>
            {item.selectedFund?.name || '—'}
            {item.selectedFund?.versionId && (
              <div className="adm-cell-sub">version {item.selectedFund.versionId}</div>
            )}
          </dd>
        </div>
        <div>
          <dt>PhonePe payment</dt>
          <dd>
            {humanizeState(item.payment?.state)}
            {item.payment?.providerReference && (
              <div className="adm-cell-sub">{item.payment.providerReference}</div>
            )}
          </dd>
        </div>
        <div>
          <dt>Merchant order</dt>
          <dd><code className="adm-code">{item.payment?.merchantOrderId || '—'}</code></dd>
        </div>
        <div>
          <dt>Succeeded at</dt>
          <dd>{item.payment?.succeededAt ? fmtDateTime(item.payment.succeededAt) : '—'}</dd>
        </div>
      </dl>

      {canAcknowledge && (
        <label className="adm-field adm-field--wide">
          <span className="adm-field-label">Private note (optional)</span>
          <input
            type="text"
            maxLength={2000}
            value={privateNote}
            onChange={(event) => setPrivateNote(event.target.value)}
            placeholder="Visible only to administrators"
          />
        </label>
      )}

      {error && (
        <div className="adm-validation-banner adm-validation-banner--error" role="alert">
          {error}
        </div>
      )}

      {canAcknowledge && (
        <div className="adm-decision-actions">
          <button
            type="button"
            className="be-btn be-btn-primary adm-decision-btn"
            onClick={acknowledge}
            disabled={busy}
          >
            {busy ? 'Acknowledging…' : `Acknowledge ${fmtPaise(item.amountPaise, 0)}`}
          </button>
        </div>
      )}
    </div>
  );
}

function AwaitingReceipts() {
  const queue = useAdminFundReceipts('pending');
  const { invalidateFundReceipts } = useAdminCacheActions();
  const { user } = useAdminSession();
  const canAcknowledge = hasAnyPermission(user, ['funds.receipts.write']);
  const [openOrderId, setOpenOrderId] = useState(null);
  const [notice, setNotice] = useState('');

  function onDecided(message) {
    if (message) setNotice(message);
    setOpenOrderId(null);
    invalidateFundReceipts();
  }

  return (
    <div className="adm-card adm-table">
      <AdminReadError resources={[{ label: 'fund receipt queue', ...queue }]} />
      <div className="adm-card-head">
        <div>
          <span className="be-eyebrow">Funds received</span>
          <h2 className="adm-card-title">Awaiting acknowledgement</h2>
        </div>
        <div className="adm-payment-count">{fmtInt(queue.rows.length)} pending</div>
      </div>

      <p className="adm-screen-note">
        These PhonePe payments are already confirmed, allocated, and visible in each client&apos;s portfolio.
        Acknowledge receipt to notify the client that BeOnEdge LLP has received their funds.
      </p>

      {notice && <div className="adm-inline-note" role="status">{notice}</div>}

      <div className="adm-table-scroll">
        <table className="adm-table-cards">
          <thead>
            <tr>
              <th>Client</th><th>Amount</th><th>Selected fund</th><th>PhonePe reference</th>
              <th className="adm-col-status">Payment</th><th>Succeeded</th>
              <th className="adm-col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {queue.isLoading && queue.rows.length === 0 && (
              <>
                <SkeletonTableRow columnCount={7} />
                <SkeletonTableRow columnCount={7} />
                <SkeletonTableRow columnCount={7} />
              </>
            )}
            {!queue.isLoading && queue.rows.length === 0 && (
              <EmptyTableRow colSpan={7}>
                No funds are waiting for acknowledgement. One appears here as soon as PhonePe confirms a
                client&apos;s checkout.
              </EmptyTableRow>
            )}
            {queue.rows.map((item) => {
              const isOpen = openOrderId === item.orderId;
              const panelId = `fund-receipt-panel-${item.orderId}`;
              return [
                <tr key={item.orderId}>
                  <td data-label="Client">
                    <div className="adm-user-info">
                      <span className="adm-user-name">{item.client?.name || 'Client'}</span>
                      {item.client?.email && <span className="adm-cell-meta">{item.client.email}</span>}
                    </div>
                  </td>
                  <td className="be-money" data-label="Amount">{fmtPaise(item.amountPaise)}</td>
                  <td data-label="Selected fund">{item.selectedFund?.name || '—'}</td>
                  <td data-label="PhonePe reference">
                    <div className="adm-user-info">
                      <span>{item.payment?.providerReference || '—'}</span>
                      {item.payment?.merchantOrderId && (
                        <span className="adm-cell-meta">{item.payment.merchantOrderId}</span>
                      )}
                    </div>
                  </td>
                  <td className="adm-col-status" data-label="Payment">
                    <StateBadge state={item.payment?.state} />
                  </td>
                  <td className="be-num adm-cell-meta" data-label="Succeeded">
                    {item.payment?.succeededAt ? fmtDateTime(item.payment.succeededAt) : '—'}
                  </td>
                  <td className="adm-col-actions" data-label="">
                    <button
                      type="button"
                      className="be-btn be-btn-primary be-btn-sm"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpenOrderId(isOpen ? null : item.orderId)}
                    >
                      {isOpen ? 'Close' : 'View funds'}
                    </button>
                  </td>
                </tr>,
                isOpen ? (
                  <tr key={`${item.orderId}-receipt`} className="adm-decision-row">
                    <td colSpan={7} id={panelId}>
                      <FundReceiptPanel item={item} onDone={onDecided} canAcknowledge={canAcknowledge} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AcknowledgedReceipts() {
  const acknowledged = useAdminFundReceipts('acknowledged');
  return (
    <div className="adm-card adm-table">
      <AdminReadError resources={[{ label: 'acknowledged funds', ...acknowledged }]} />
      <div className="adm-card-head">
        <div>
          <span className="be-eyebrow">Funds received</span>
          <h2 className="adm-card-title">Acknowledged</h2>
        </div>
        <div className="adm-payment-count">{fmtInt(acknowledged.rows.length)} shown</div>
      </div>
      <p className="adm-screen-note">
        These payments were already allocated when PhonePe confirmed them. This records when an
        administrator acknowledged receipt and notified the client.
      </p>
      <div className="adm-table-scroll">
        <table className="adm-table-cards">
          <thead>
            <tr>
              <th>Client</th><th>Amount</th><th>Fund</th><th>Order</th><th>Acknowledged</th>
            </tr>
          </thead>
          <tbody>
            {acknowledged.isLoading && acknowledged.rows.length === 0 && (
              <>
                <SkeletonTableRow columnCount={5} />
                <SkeletonTableRow columnCount={5} />
              </>
            )}
            {!acknowledged.isLoading && acknowledged.rows.length === 0 && (
              <EmptyTableRow colSpan={5}>No fund receipts have been acknowledged yet.</EmptyTableRow>
            )}
            {acknowledged.rows.map((item) => (
              <tr key={item.orderId}>
                <td data-label="Client">
                  <div className="adm-user-info">
                    <span className="adm-user-name">{item.client?.name || 'Client'}</span>
                    {item.client?.email && <span className="adm-cell-meta">{item.client.email}</span>}
                  </div>
                </td>
                <td className="be-money" data-label="Amount">{fmtPaise(item.amountPaise)}</td>
                <td data-label="Fund">{item.selectedFund?.name || '—'}</td>
                <td data-label="Order"><code className="adm-code">{item.orderId}</code></td>
                <td className="be-num adm-cell-meta" data-label="Acknowledged">
                  {item.acknowledgement?.acknowledgedAt ? fmtDateTime(item.acknowledgement.acknowledgedAt) : '—'}
                  {item.acknowledgement?.privateNote && (
                    <div className="adm-cell-sub">{item.acknowledgement.privateNote}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RefundExceptions() {
  const [stateFilter, setStateFilter] = useState('failed');
  const refunds = useAdminRefunds(stateFilter);
  const { invalidateRefunds } = useAdminCacheActions();
  const { user } = useAdminSession();
  const canWriteRefunds = hasAnyPermission(user, ['refunds.write']);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lockRef = useRef(false);
  const idempotencyKeyFor = useIdempotencyKeys();

  async function act(refund, action) {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusyId(`${refund.id}:${action}`);
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/v1/admin/refunds/${encodeURIComponent(refund.id)}/${action}`,
        {
          method: 'POST',
          scope: 'admin',
          body: {},
          headers: { 'Idempotency-Key': idempotencyKeyFor(`${refund.id}:${action}`, {}) },
        },
      );
      setNotice(
        action === 'retry'
          ? 'Refund retry dispatched with its stable merchant reference.'
          : 'Reconciliation requested against PhonePe.',
      );
      invalidateRefunds();
    } catch (actionError) {
      setError(
        isConflict(actionError)
          ? 'This refund changed since the list was read. It has been refreshed — check it again.'
          : actionError?.message || 'The refund action was not applied.',
      );
      if (isConflict(actionError)) invalidateRefunds();
    } finally {
      lockRef.current = false;
      setBusyId('');
    }
  }

  return (
    <div className="adm-card adm-table">
      <AdminReadError resources={[{ label: 'refunds', ...refunds }]} />
      <div className="adm-card-head">
        <div>
          <span className="be-eyebrow">Payment operations</span>
          <h2 className="adm-card-title">Refunds and exceptions</h2>
        </div>
        <div className="adm-card-actions">
          <label className="adm-filter">
            <span className="adm-sr-only">Refund status</span>
            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
              <option value="failed">Exceptions (refund failed)</option>
              {REFUND_STATES.filter((state) => state !== 'failed').map((state) => (
                <option key={state} value={state}>{state.replace(/_/gu, ' ')}</option>
              ))}
              <option value="all">All refunds</option>
            </select>
          </label>
        </div>
      </div>

      <p className="adm-screen-note">
        Failed refund operations land here. Retry dispatches the same stable merchant reference,
        and reconcile asks PhonePe for the authoritative status.
      </p>

      {notice && <div className="adm-inline-note" role="status">{notice}</div>}
      {error && (
        <div className="adm-validation-banner adm-validation-banner--error" role="alert">{error}</div>
      )}

      <div className="adm-table-scroll">
        <table className="adm-table-cards">
          <thead>
            <tr>
              <th>Refund</th><th>Order</th><th>Amount</th>
              <th className="adm-col-status">Status</th><th>Attempts</th><th>Created</th>
              <th className="adm-col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {refunds.isLoading && refunds.rows.length === 0 && (
              <>
                <SkeletonTableRow columnCount={7} />
                <SkeletonTableRow columnCount={7} />
              </>
            )}
            {!refunds.isLoading && refunds.rows.length === 0 && (
              <EmptyTableRow colSpan={7}>
                No refunds are currently in this state.
              </EmptyTableRow>
            )}
            {refunds.rows.map((refund) => {
              const actionable = refund.state === 'failed' && canWriteRefunds;
              return (
                <tr key={refund.id}>
                  <td data-label="Refund">
                    <div className="adm-user-info">
                      <code className="adm-code">{refund.merchantRefundId || refund.id}</code>
                      {refund.providerRefundId && (
                        <span className="adm-cell-meta">{refund.providerRefundId}</span>
                      )}
                    </div>
                  </td>
                  <td data-label="Order"><code className="adm-code">{refund.orderId || '—'}</code></td>
                  <td className="be-money" data-label="Amount">{fmtPaise(refund.amountPaise)}</td>
                  <td className="adm-col-status" data-label="Status">
                    <StateBadge state={refund.state} />
                    {refund.failureCode && <div className="adm-cell-sub">{refund.failureCode}</div>}
                  </td>
                  <td className="be-num" data-label="Attempts">{fmtInt(refund.attemptCount)}</td>
                  <td className="be-num adm-cell-meta" data-label="Created">
                    {refund.createdAt ? fmtDateTime(refund.createdAt) : '—'}
                  </td>
                  <td className="adm-col-actions adm-payment-actions" data-label="">
                    {actionable && (
                      <>
                        <button
                          type="button"
                          className="be-btn be-btn-secondary be-btn-sm"
                          disabled={busyId !== ''}
                          onClick={() => act(refund, 'retry')}
                        >
                          {busyId === `${refund.id}:retry` ? 'Retrying…' : 'Retry'}
                        </button>
                        <button
                          type="button"
                          className="be-btn be-btn-ghost be-btn-sm"
                          disabled={busyId !== ''}
                          onClick={() => act(refund, 'reconcile')}
                        >
                          {busyId === `${refund.id}:reconcile` ? 'Reconciling…' : 'Reconcile'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FundReceiptScreen({ tab = 'awaiting' }) {
  const active = RECEIPT_TABS.some((item) => item.id === tab) ? tab : 'awaiting';
  return (
    <div className="adm-screen">
      <div className="adm-chip-row" role="group" aria-label="Fund receipt sections">
        {RECEIPT_TABS.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            className={`adm-chip ${active === item.id ? 'is-active' : ''}`}
            aria-current={active === item.id ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {active === 'awaiting' && <AwaitingReceipts />}
      {active === 'acknowledged' && <AcknowledgedReceipts />}
      {active === 'refunds' && <RefundExceptions />}
    </div>
  );
}

export { AcknowledgedReceipts, AwaitingReceipts, RefundExceptions };
