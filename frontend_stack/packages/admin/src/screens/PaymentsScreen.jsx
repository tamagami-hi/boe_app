import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import { fmtDateTime, fmtInt, fmtPaise } from '../helpers/formatters.js';
import './admin-screens-shared.css';

// The canonical payment_state enum (spec §5.2), including the refund lifecycle.
const PAYMENT_STATES = [
  'created', 'provider_pending', 'succeeded', 'failed', 'expired',
  'refund_pending', 'refunded', 'refund_failed',
];
const SETTLED = ['succeeded'];
const IN_FLIGHT = ['created', 'provider_pending'];
const UNSUCCESSFUL = ['failed', 'expired'];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isWithinDate(row, from, to) {
  const value = row.createdAt || '';
  if (!value) return true;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return true;
  if (from) {
    const start = new Date(from).getTime();
    if (!Number.isNaN(start) && ts < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59`).getTime();
    if (!Number.isNaN(end) && ts > end) return false;
  }
  return true;
}

/*
 * Read-only PhonePe gateway evidence (spec §11.1).
 *
 * PhonePe confirms money movement; accepting or rejecting the INVESTMENT is a
 * separate, private decision made under Investment reviews — never here. This
 * screen deliberately has no approval buttons: a payment record is evidence, not
 * a decision surface.
 *
 * There is no fund-pool column or filter: a payment settles an order, and the
 * order reference is the link to the fund. `GET /v1/admin/payments` carries no
 * fund fields.
 */

function PaymentsScreen({ rows = [], loading = false, onUserDetail }) {
  const [filters, setFilters] = useState({ status: '', from: '', to: '', q: '' });

  const filteredRows = useMemo(() => {
    const q = normalizeText(filters.q);
    return rows.filter((row) => {
      if (filters.status && row.status !== filters.status) return false;
      if (!isWithinDate(row, filters.from, filters.to)) return false;
      if (!q) return true;
      return [row.id, row.orderId, row.userEmail, row.userId, row.providerReference]
        .some((value) => normalizeText(value).includes(q));
    });
  }, [filters, rows]);

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  /*
   * Counted from the rows on screen. These tiles previously read
   * `stats.paymentsProcessedToday` / `pendingPayments` / `failedPayments`, none of
   * which any endpoint supplies — and since the integer formatter renders a
   * missing value as "0", the screen reported zero pending and zero failed
   * payments as fact. The state lists they counted were wrong too: nothing is ever
   * in state `success`, so "Settled" read 0 with every payment settled.
   */
  const countIn = (states) => rows.filter((row) => states.includes(row.status)).length;

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Succeeded" value={fmtInt(countIn(SETTLED))} />
        <StatTile label="In flight" value={fmtInt(countIn(IN_FLIGHT))} />
        <StatTile label="Failed or expired" value={fmtInt(countIn(UNSUCCESSFUL))} />
        <StatTile label="Loaded" value={fmtInt(rows.length)} />
      </div>

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Transactions</span>
            <h2 className="adm-card-title">Payment record</h2>
          </div>
          <div className="adm-payment-count">{fmtInt(filteredRows.length)} / {fmtInt(rows.length)}</div>
        </div>

        <p className="adm-screen-note">
          PhonePe confirms each payment; this is the gateway evidence trail, most recent first.
          Verifying bank evidence and accepting or rejecting an investment happens under{' '}
          Investment reviews — a succeeded payment is not yet an accepted investment.
        </p>

        <div className="adm-payment-filters">
          <label className="adm-search">
            <I icon={Search} size={14} />
            <span className="adm-sr-only">Search payments</span>
            <input
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Search payment, order, user or provider reference"
            />
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Payment status</span>
            <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">All statuses</option>
              {PAYMENT_STATES.map((state) => (
                <option key={state} value={state}>{state.replace(/_/gu, ' ')}</option>
              ))}
            </select>
          </label>
          <label className="adm-filter adm-date-filter">
            <span>From</span>
            <input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
          </label>
          <label className="adm-filter adm-date-filter">
            <span>To</span>
            <input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
          </label>
        </div>

        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <th>Payment</th><th>User</th><th>Amount</th><th>Provider</th>
                <th className="adm-col-status">Status</th><th>Created</th><th>Settled</th>
                <th className="adm-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={8} />
                  <SkeletonTableRow columnCount={8} />
                  <SkeletonTableRow columnCount={8} />
                </>
              )}
              {!loading && rows.length === 0 && (
                <EmptyTableRow colSpan={8}>
                  No payments have been recorded yet.
                </EmptyTableRow>
              )}
              {!loading && rows.length > 0 && filteredRows.length === 0 && (
                <EmptyTableRow colSpan={8}>No payment records match the selected filters.</EmptyTableRow>
              )}
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Payment">
                    <div className="adm-user-info">
                      <code className="adm-code">{row.id}</code>
                      {row.orderId && <span className="adm-cell-meta">order {row.orderId}</span>}
                    </div>
                  </td>
                  <td data-label="User">
                    <div className="adm-user-info">
                      <span className="adm-user-name">{row.userEmail || row.userId || 'Client'}</span>
                      {row.attemptCount > 1 && (
                        <span className="adm-cell-meta">{fmtInt(row.attemptCount)} attempts</span>
                      )}
                    </div>
                  </td>
                  <td className="be-money" data-label="Amount">{fmtPaise(row.amountPaise)}</td>
                  <td data-label="Provider">
                    <div className="adm-user-info">
                      <span>{row.provider || '—'}</span>
                      {row.providerReference && (
                        <span className="adm-cell-meta">{row.providerReference}</span>
                      )}
                    </div>
                  </td>
                  <td className="adm-col-status" data-label="Status"><StateBadge state={row.status} /></td>
                  <td className="be-num adm-cell-meta" data-label="Created">{fmtDateTime(row.createdAt)}</td>
                  <td className="be-num adm-cell-meta" data-label="Settled">
                    {row.settledAt ? fmtDateTime(row.settledAt) : '—'}
                  </td>
                  <td className="adm-col-actions adm-payment-actions" data-label="">
                    <button
                      type="button"
                      className="be-btn be-btn-ghost be-btn-sm"
                      onClick={() => onUserDetail?.(row)}
                    >
                      View user
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default PaymentsScreen;
