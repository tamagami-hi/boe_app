import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import { fmtDateTime, fmtInt, fmtPaise } from '../helpers/formatters.js';
import './admin-screens-shared.css';

/*
 * The withdrawal queue. Was a tab inside the 1,304-line fund editor, which is a
 * strange place to keep the one screen where an operator releases money.
 *
 * Four defects fixed here:
 *
 * 1. THE CONFIRMATION SHOWED ₹0. The row read `requestedAmountPaise` correctly, but
 *    the approve/reject dialog read `actionRequest.amount` and `.type`, neither of
 *    which the projection sends — so the operator confirmed a payout against a
 *    fabricated zero while the real figure sat behind the overlay.
 * 2. AN APPROVAL WITHOUT A NOTE WAS REJECTED BY THE ROUTE. `reason` is optional but
 *    `min(1)` when present, and the screen always sent `reason: ''` — so approving
 *    without typing a note returned a validation error. The note is now omitted when
 *    blank.
 * 3. `.catch(() => setRequests([]))` — a failed read rendered as "No redemption
 *    requests", i.e. an empty payout queue, which is the most dangerous thing this
 *    screen could say incorrectly.
 * 4. `alert()` twice. A browser alert in a WebView console, for a validation message
 *    and for a failed money action.
 */

const STATES = ['submitted', 'units_reserved', 'approved', 'settlement_pending', 'settled', 'rejected', 'cancelled'];

const MODE_LABELS = {
  full: 'Full amount',
  returns_only: 'Returns only',
  half: '50%',
  custom: 'Custom',
};

const DECIDABLE = ['submitted', 'units_reserved'];

export default function RedemptionsScreen({ onUserDetail }) {
  const [requests, setRequests] = useState([]);
  const [filter, setFilter] = useState('submitted');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [notice, setNotice] = useState('');
  const lockRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = filter === 'all' ? '' : `?status=${encodeURIComponent(filter)}`;
      const payload = await apiRequest(`/v1/admin/redemption-requests${query}`, { scope: 'admin' });
      setRequests(payload?.items || []);
    } catch (readError) {
      setRequests([]);
      setError(readError?.message || 'Could not read the redemption queue.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  function open(request) {
    setDeciding(request);
    setReason('');
    setDecisionError('');
  }

  // Each decision is one tap from the open panel. Rejection needs a reason, so it
  // reports the requirement instead of sending a request the route would refuse.
  async function decide(action) {
    if (lockRef.current || !deciding) return;
    const request = deciding;
    if (action === 'rejected' && !reason.trim()) {
      setDecisionError('A rejection needs a reason. The investor is told their request was declined.');
      return;
    }
    lockRef.current = true;
    setBusy(true);
    setDecisionError('');
    try {
      await apiRequest(`/v1/admin/redemption-requests/${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        scope: 'admin',
        // `reason` must be omitted rather than sent empty: the route's schema is
        // `min(1)` when the key is present.
        body: { action, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      });
      setDeciding(null);
      setReason('');
      setNotice(
        action === 'approved'
          ? 'Approved. The payout is recorded on the investor ledger now.'
          : 'Rejected. The investor has been notified.',
      );
      await load();
    } catch (decideError) {
      setDecisionError(decideError?.message || 'The decision was not applied.');
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  const amountOf = (request) => request.settledAmountPaise ?? request.requestedAmountPaise;

  return (
    <div className="adm-screen">
      {error && (
        <div className="ash-load-note" role="alert">
          <span>{error}</span>
          <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" disabled={loading} onClick={load}>
            <I icon={RefreshCw} size={13} />
            {loading ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Withdrawals</span>
            <h2 className="adm-card-title">Redemption requests</h2>
          </div>
          <div className="adm-card-actions">
            <span className="adm-cell-meta">{fmtInt(requests.length)} shown</span>
            <button type="button" className="be-btn be-btn-secondary be-btn-sm" onClick={load} disabled={loading}>
              <I icon={RefreshCw} size={14} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <p className="adm-screen-note">
          Approving settles the payout immediately: it is written to the investor&rsquo;s ledger in the
          same transaction, and returns are drawn before principal.
        </p>

        {notice && <div className="adm-inline-note" role="status">{notice}</div>}

        <div className="adm-payment-filters">
          <label className="adm-filter">
            <span className="adm-sr-only">Request status</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {STATES.map((state) => (
                <option key={state} value={state}>{state.replace(/_/gu, ' ')}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <th>Investor</th><th>Pool</th><th>Type</th><th>Amount</th>
                <th className="adm-col-status">Status</th><th>Requested</th>
                <th className="adm-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {loading && requests.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={7} />
                  <SkeletonTableRow columnCount={7} />
                </>
              )}
              {!loading && !error && requests.length === 0 && (
                <EmptyTableRow colSpan={7}>
                  No redemption requests with this status. A request appears here as soon as an
                  investor submits a withdrawal.
                </EmptyTableRow>
              )}
              {requests.map((request) => {
                const isOpen = deciding?.id === request.id;
                const panelId = `redemption-decision-${request.id}`;
                return [
                  <tr key={request.id}>
                    <td data-label="Investor">{request.userEmail || request.userId || '—'}</td>
                    <td data-label="Pool">{request.fundSlug || request.fundId || '—'}</td>
                    <td data-label="Type">{MODE_LABELS[request.mode] || request.mode || '—'}</td>
                    <td className="be-money" data-label="Amount">
                      {fmtPaise(amountOf(request))}
                      {request.returnsComponentPaise !== null && request.returnsComponentPaise !== undefined && (
                        <div className="adm-cell-sub">
                          returns {fmtPaise(request.returnsComponentPaise)} · principal{' '}
                          {fmtPaise(request.principalComponentPaise)}
                        </div>
                      )}
                    </td>
                    <td className="adm-col-status" data-label="Status">
                      <StateBadge state={request.status} />
                    </td>
                    <td className="adm-cell-meta" data-label="Requested">
                      {request.submittedAt ? fmtDateTime(request.submittedAt) : '—'}
                    </td>
                    <td className="adm-col-actions" data-label="">
                      <button
                        type="button"
                        className="be-btn be-btn-ghost be-btn-sm"
                        onClick={() => onUserDetail?.(request)}
                      >
                        View investor
                      </button>
                      {DECIDABLE.includes(request.status) && (
                        <button
                          type="button"
                          className="be-btn be-btn-primary be-btn-sm"
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          onClick={() => (isOpen ? setDeciding(null) : open(request))}
                        >
                          {isOpen ? 'Close' : 'Decide'}
                        </button>
                      )}
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${request.id}-decision`} className="adm-decision-row">
                      <td colSpan={7} id={panelId}>
                        <div className="adm-decision">
                          {/* The figures that used to be ₹0 in the overlay. */}
                          <dl className="adm-decision-facts">
                            <div>
                              <dt>Investor</dt>
                              <dd>{request.userEmail || request.userId}</dd>
                            </div>
                            <div>
                              <dt>Payout</dt>
                              <dd className="be-money">{fmtPaise(amountOf(request))}</dd>
                            </div>
                            <div>
                              <dt>From returns</dt>
                              <dd className="be-money">{fmtPaise(request.returnsComponentPaise)}</dd>
                            </div>
                            <div>
                              <dt>From principal</dt>
                              <dd className="be-money">{fmtPaise(request.principalComponentPaise)}</dd>
                            </div>
                            <div>
                              <dt>Type</dt>
                              <dd>{MODE_LABELS[request.mode] || request.mode || '—'}</dd>
                            </div>
                            <div>
                              <dt>Pool</dt>
                              <dd>{request.fundSlug || request.fundId}</dd>
                            </div>
                          </dl>

                          <label className="adm-field">
                            <span className="adm-field-label">Reason</span>
                            <input
                              type="text"
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                              placeholder="Required to reject, recorded on the audit entry either way"
                            />
                          </label>

                          {decisionError && (
                            <div className="adm-validation-banner adm-validation-banner--error" role="alert">
                              {decisionError}
                            </div>
                          )}

                          <div className="adm-decision-actions">
                            <button
                              type="button"
                              className="be-btn be-btn-danger adm-decision-btn"
                              onClick={() => decide('rejected')}
                              disabled={busy}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="be-btn be-btn-primary adm-decision-btn"
                              onClick={() => decide('approved')}
                              disabled={busy}
                            >
                              {busy ? 'Applying…' : `Approve ${fmtPaise(amountOf(request), 0)}`}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
