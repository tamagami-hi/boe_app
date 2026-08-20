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
  useAdminInvestmentReviews,
  useAdminRefunds,
} from '../data/adminResources.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { fmtDateTime, fmtInt, fmtPaise, humanizeState } from '../helpers/formatters.js';
import { hasAnyPermission } from '../navigation/nav.js';
import './admin-screens-shared.css';

/*
 * The private review queue (spec §9.3, §11.1).
 *
 * PhonePe confirming a payment is evidence of money movement, not acceptance of an
 * investment. An investment exists only after an admin verifies the bank evidence
 * and accepts here; the full succeeded amount is then allocated to the exact
 * issued fund the client selected — which is why the fund is shown read-only and
 * there is no fund selector anywhere on this screen.
 *
 * Tabs are routes (`/admin/reviews/awaiting|accepted|refunds`) so each is a real
 * destination with its own breadcrumb and permission gate.
 *
 *   GET  /v1/admin/investment-reviews?state=pending|accepted
 *   POST /v1/admin/investment-reviews/:orderId/accept   { bankVerified, expectedVersion, privateNote? }
 *   POST /v1/admin/investment-reviews/:orderId/reject   { reasonCode, expectedVersion, privateNote? }
 *   GET  /v1/admin/refunds?state=...
 *   POST /v1/admin/refunds/:refundId/retry | /reconcile
 *
 * Every mutation sends an Idempotency-Key (see helpers/idempotencyKeys.js) and the
 * CSRF token that apiRequest attaches to unsafe requests. A stale expectedVersion
 * or a conflicting terminal state comes back as 409 and is answered by refreshing
 * the queue, not by retrying blindly.
 */

const REVIEW_TABS = [
  { id: 'awaiting', label: 'Awaiting review', path: '/admin/reviews/awaiting' },
  { id: 'accepted', label: 'Accepted', path: '/admin/reviews/accepted' },
  { id: 'refunds', label: 'Refunds and exceptions', path: '/admin/reviews/refunds' },
];

const REFUND_STATES = ['refund_pending', 'provider_pending', 'refund_failed', 'refunded'];
// The exception queue: terminal refund failures an operator must retry or reconcile.
const REFUND_ACTIONABLE = ['refund_failed', 'failed'];

const isConflict = (error) => error?.status === 409;

function ReviewPanel({ item, onDone }) {
  const [bankConfirmed, setBankConfirmed] = useState(false);
  const [privateNote, setPrivateNote] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const lockRef = useRef(false);
  const idempotencyKeyFor = useIdempotencyKeys();

  const expectedVersion = String(item.review?.version ?? '1');
  const note = privateNote.trim();

  async function decide(action) {
    if (lockRef.current) return;
    if (action === 'accept' && !bankConfirmed) {
      setError('Confirm the payment against the bank evidence before accepting.');
      return;
    }
    if (action === 'reject' && !reasonCode.trim()) {
      setError('A rejection needs a reason code. It is recorded on the review and starts a full refund.');
      return;
    }
    lockRef.current = true;
    setBusy(action);
    setError('');
    const body = action === 'accept'
      // `bankVerified` is the admin's attestation, sent as the literal true the
      // accept command requires. There is no earlier "mark verified" step.
      ? { bankVerified: true, expectedVersion, ...(note ? { privateNote: note } : {}) }
      : { reasonCode: reasonCode.trim(), expectedVersion, ...(note ? { privateNote: note } : {}) };
    try {
      await apiRequest(
        `/v1/admin/investment-reviews/${encodeURIComponent(item.orderId)}/${action}`,
        {
          method: 'POST',
          scope: 'admin',
          body,
          headers: { 'Idempotency-Key': idempotencyKeyFor(`${item.orderId}:${action}`, body) },
        },
      );
      onDone(
        action === 'accept'
          ? 'Accepted. The full payment is allocated to the fund the client selected; the investment now appears on the client\u2019s record.'
          : 'Rejected. A full refund has been started; follow it under Refunds and exceptions.',
      );
    } catch (decideError) {
      if (isConflict(decideError)) {
        // A conflict closes the panel and refreshes the queue, so the in-panel
        // error would vanish with it; the screen-level notice carries the why.
        onDone('This review changed since you opened it. The queue was refreshed — check the item again before deciding.');
        return;
      }
      setError(decideError?.message || 'The decision was not applied.');
    } finally {
      lockRef.current = false;
      setBusy('');
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
          {/* Read-only by design: the allocation target is the fund the client
              selected at order time. There is deliberately no selector here. */}
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

      <label className="adm-field adm-field--wide adm-checkbox-field">
        <input
          type="checkbox"
          checked={bankConfirmed}
          onChange={(event) => setBankConfirmed(event.target.checked)}
        />
        <span>
          I have confirmed this payment against the bank evidence. Accepting allocates the full
          amount to the selected fund and cannot be undone from this screen.
        </span>
      </label>

      <label className="adm-field adm-field--wide">
        <span className="adm-field-label">Private note (optional)</span>
        <input
          type="text"
          maxLength={2000}
          value={privateNote}
          onChange={(event) => setPrivateNote(event.target.value)}
          placeholder="Visible only inside Investment reviews"
        />
      </label>

      <label className="adm-field adm-field--wide">
        <span className="adm-field-label">Rejection reason code</span>
        <input
          type="text"
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value)}
          placeholder="Required to reject, e.g. bank_mismatch"
        />
      </label>

      {error && (
        <div className="adm-validation-banner adm-validation-banner--error" role="alert">
          {error}
        </div>
      )}

      <div className="adm-decision-actions">
        <button
          type="button"
          className="be-btn be-btn-danger adm-decision-btn"
          onClick={() => decide('reject')}
          disabled={busy !== ''}
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject and refund'}
        </button>
        <button
          type="button"
          className="be-btn be-btn-primary adm-decision-btn"
          onClick={() => decide('accept')}
          disabled={busy !== '' || !bankConfirmed}
        >
          {busy === 'accept' ? 'Accepting…' : `Accept and allocate ${fmtPaise(item.amountPaise, 0)}`}
        </button>
      </div>
    </div>
  );
}

function AwaitingReview() {
  const queue = useAdminInvestmentReviews('pending');
  const { invalidateReviews } = useAdminCacheActions();
  const [openOrderId, setOpenOrderId] = useState(null);
  const [notice, setNotice] = useState('');

  function onDecided(message) {
    if (message) setNotice(message);
    setOpenOrderId(null);
    invalidateReviews();
  }

  return (
    <div className="adm-card adm-table">
      <AdminReadError resources={[{ label: 'review queue', ...queue }]} />
      <div className="adm-card-head">
        <div>
          <span className="be-eyebrow">Investment reviews</span>
          <h2 className="adm-card-title">Awaiting review</h2>
        </div>
        <div className="adm-payment-count">{fmtInt(queue.rows.length)} pending</div>
      </div>

      <p className="adm-screen-note">
        PhonePe has confirmed these payments. An investment exists only after you verify the bank
        evidence and accept; the full amount is then allocated to the fund the client selected.
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
                No payments are waiting for review. One appears here as soon as PhonePe confirms a
                client&apos;s checkout.
              </EmptyTableRow>
            )}
            {queue.rows.map((item) => {
              const isOpen = openOrderId === item.orderId;
              const panelId = `review-panel-${item.orderId}`;
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
                      {isOpen ? 'Close' : 'Review'}
                    </button>
                  </td>
                </tr>,
                isOpen ? (
                  <tr key={`${item.orderId}-review`} className="adm-decision-row">
                    <td colSpan={7} id={panelId}>
                      <ReviewPanel item={item} onDone={onDecided} />
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

function AcceptedReviews() {
  const accepted = useAdminInvestmentReviews('accepted');
  return (
    <div className="adm-card adm-table">
      <AdminReadError resources={[{ label: 'accepted reviews', ...accepted }]} />
      <div className="adm-card-head">
        <div>
          <span className="be-eyebrow">Investment reviews</span>
          <h2 className="adm-card-title">Accepted</h2>
        </div>
        <div className="adm-payment-count">{fmtInt(accepted.rows.length)} shown</div>
      </div>
      <p className="adm-screen-note">
        The record of accepted investments. Acceptance already allocated each payment in full to the
        client&apos;s selected fund; there is nothing further to decide here.
      </p>
      <div className="adm-table-scroll">
        <table className="adm-table-cards">
          <thead>
            <tr>
              <th>Client</th><th>Amount</th><th>Fund</th><th>Order</th><th>Accepted</th>
            </tr>
          </thead>
          <tbody>
            {accepted.isLoading && accepted.rows.length === 0 && (
              <>
                <SkeletonTableRow columnCount={5} />
                <SkeletonTableRow columnCount={5} />
              </>
            )}
            {!accepted.isLoading && accepted.rows.length === 0 && (
              <EmptyTableRow colSpan={5}>No investments have been accepted yet.</EmptyTableRow>
            )}
            {accepted.rows.map((item) => (
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
                <td className="be-num adm-cell-meta" data-label="Accepted">
                  {item.review?.reviewedAt ? fmtDateTime(item.review.reviewedAt) : '—'}
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
  const [stateFilter, setStateFilter] = useState('refund_failed');
  const refunds = useAdminRefunds(stateFilter);
  const { invalidateReviews } = useAdminCacheActions();
  const { user } = useAdminSession();
  // Presentation only: the backend enforces refunds.write on every request.
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
      invalidateReviews();
    } catch (actionError) {
      setError(
        isConflict(actionError)
          ? 'This refund changed since the list was read. It has been refreshed — check it again.'
          : actionError?.message || 'The refund action was not applied.',
      );
      if (isConflict(actionError)) invalidateReviews();
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
          <span className="be-eyebrow">Investment reviews</span>
          <h2 className="adm-card-title">Refunds and exceptions</h2>
        </div>
        <div className="adm-card-actions">
          <label className="adm-filter">
            <span className="adm-sr-only">Refund status</span>
            <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
              <option value="refund_failed">Exceptions (refund failed)</option>
              {REFUND_STATES.filter((state) => state !== 'refund_failed').map((state) => (
                <option key={state} value={state}>{state.replace(/_/gu, ' ')}</option>
              ))}
              <option value="all">All refunds</option>
            </select>
          </label>
        </div>
      </div>

      <p className="adm-screen-note">
        A rejected investment is refunded in full through PhonePe. A refund that exhausts its retries
        lands here; retry dispatches the same stable merchant reference, and reconcile asks PhonePe
        for the authoritative status. Neither action changes a client value or fund AUM.
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
                No refunds in this state. A rejected investment appears here while its refund is in
                flight, and stays if the refund fails terminally.
              </EmptyTableRow>
            )}
            {refunds.rows.map((refund) => {
              const actionable = REFUND_ACTIONABLE.includes(refund.state) && canWriteRefunds;
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

export default function InvestmentReviewScreen({ tab = 'awaiting' }) {
  const active = REVIEW_TABS.some((item) => item.id === tab) ? tab : 'awaiting';
  // Reads are declared unconditionally so the hook order never changes across tabs;
  // the idle tabs' reads are disabled, so no extra requests are issued.
  return (
    <div className="adm-screen">
      <div className="adm-chip-row" role="group" aria-label="Investment review sections">
        {REVIEW_TABS.map((item) => (
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

      {active === 'awaiting' && <AwaitingReview />}
      {active === 'accepted' && <AcceptedReviews />}
      {active === 'refunds' && <RefundExceptions />}
    </div>
  );
}

// Re-exported for the route wrappers and tests.
export { AwaitingReview, AcceptedReviews, RefundExceptions };
