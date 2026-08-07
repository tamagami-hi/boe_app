import { useMemo, useState } from 'react';
import { Eye, Filter, Search } from 'lucide-react';
import '../styles/desktop/admin.css';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import { fmtInt } from '../helpers/formatters.js';

function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadge(status) {
  const normalized = String(status || 'unknown');
  const label = normalized.replace(/_/g, ' ');
  const className = {
    approved: 'be-badge-active',
    success: 'be-badge-active',
    confirmed: 'be-badge-active',
    pending: 'be-badge-paused',
    created: 'be-badge-paused',
    gateway_initiated: 'be-badge-paused',
    failed: 'be-badge-failed',
    rejected: 'be-badge-failed',
    reconciled: 'be-badge-neutral',
  }[normalized] || 'be-badge-neutral';

  return (
    <span className={`be-badge ${className}`}>
      <span className="be-badge-dot"/>
      {label}
    </span>
  );
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function isWithinDate(row, from, to) {
  const value = row.time || row.createdAt || '';
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

function fundOptions(funds, rows) {
  const map = new Map();
  funds.forEach((fund) => {
    if (fund?.id) map.set(fund.id, fund.name || fund.title || fund.id);
  });
  rows.forEach((row) => {
    if (row?.fundId) map.set(row.fundId, row.fundName || row.fundId);
  });
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
}

/*
 * There is no payment approve/reject panel any more, and no such buttons.
 *
 * A payment is confirmed by the signed provider webhook
 * (`POST /v1/provider-events/payment`) — the console has no endpoint to approve
 * one with, and none is planned: money movement is confirmed by the party that
 * moved it, not by an operator asserting it happened. What stood here was a
 * fully styled Approve/Reject flow whose handler props were never supplied by the
 * route, so submitting it closed the dialog and made no request at all. An
 * operator could "approve" a payment all day and nothing would happen.
 *
 * This screen is therefore read-only oversight over payment evidence.
 */

function PaymentsScreen({
  rows = [],
  funds = [],
  onUserDetail,
}) {
  const [filters, setFilters] = useState({
    fundId: '',
    status: '',
    from: '',
    to: '',
    q: '',
  });

  const options = useMemo(() => fundOptions(funds, rows), [funds, rows]);
  const filteredRows = useMemo(() => {
    const q = normalizeText(filters.q);
    return rows.filter((row) => {
      if (filters.fundId && row.fundId !== filters.fundId) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (!isWithinDate(row, filters.from, filters.to)) return false;
      if (!q) return true;
      return [
        row.id,
        row.userName,
        row.user,
        row.userEmail,
        row.fundName,
        row.providerPaymentId,
        row.providerOrderId,
        row.settlementReference,
        row.transactionId,
      ].some((value) => normalizeText(value).includes(q));
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
   * payments as fact.
   */
  const statusCount = (predicate) => rows.filter(predicate).length;
  const settledCount = statusCount((row) =>
    ['success', 'confirmed', 'reconciled', 'approved'].includes(row.status),
  );
  const pendingCount = statusCount((row) =>
    ['created', 'gateway_initiated', 'pending'].includes(row.status),
  );
  const failedCount = statusCount((row) => ['failed', 'rejected'].includes(row.status));

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Settled" value={fmtInt(settledCount)}/>
        <StatTile label="In flight" value={fmtInt(pendingCount)}/>
        <StatTile label="Failed" value={fmtInt(failedCount)}/>
        <StatTile label="Total loaded" value={fmtInt(rows.length)}/>
      </div>

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Transactions</span>
            <h2 className="adm-card-title">Payment record</h2>
          </div>
          <div className="adm-payment-count">{filteredRows.length} / {rows.length}</div>
        </div>

        <p className="adm-screen-note">
          Payments are confirmed by the payment provider, not from this console. This is the
          evidence trail; there is nothing to approve here.
        </p>

        <div className="adm-payment-filters">
          <label className="adm-search">
            <I icon={Search} size={14}/>
            <input
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              placeholder="Search reference, user, fund"
            />
          </label>
          <label className="adm-filter">
            <I icon={Filter} size={14}/>
            <select value={filters.fundId} onChange={(event) => updateFilter('fundId', event.target.value)}>
              <option value="">All fund pools</option>
              {options.map((fund) => (
                <option key={fund.id} value={fund.id}>{fund.name}</option>
              ))}
            </select>
          </label>
          <label className="adm-filter">
            <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="confirmed">Confirmed</option>
              <option value="reconciled">Reconciled</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="pending">Pending</option>
              <option value="created">Created</option>
              <option value="failed">Failed</option>
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
          <table>
            <thead><tr>
              <th>Reference</th><th>User</th><th>Fund pool</th><th>Amount</th><th>Mode</th><th>Provider</th><th>Status</th><th>Time</th><th></th>
            </tr></thead>
            <tbody>
              {filteredRows.length === 0 && (
                <EmptyTableRow colSpan={9}>No payment records match the selected filters.</EmptyTableRow>
              )}
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  <td><code className="adm-code">{row.id}</code></td>
                  <td>
                    <div className="adm-user-info">
                      <span className="adm-user-name">{row.userName || row.user || row.userId || 'Client'}</span>
                      {row.userEmail && <span className="adm-cell-meta">{row.userEmail}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="adm-user-info">
                      <span className="adm-user-name">{row.fundName || 'Unmapped fund'}</span>
                      <span className="adm-cell-meta">{formatMoney(row.fundPoolSize || 0)}</span>
                    </div>
                  </td>
                  <td className="be-money">{formatMoney(row.resolvedAmount ?? row.amount)}</td>
                  <td>{row.mode || '—'}</td>
                  <td>{row.provider || '—'}</td>
                  <td>{statusBadge(row.status)}</td>
                  <td className="be-num adm-cell-meta">{formatDate(row.time || row.createdAt)}</td>
                  <td className="adm-cell-actions adm-payment-actions">
                    <button className="be-btn be-btn-ghost be-btn-sm" onClick={() => onUserDetail?.(row)} title="View user">
                      <I icon={Eye} size={14}/>
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
