import { useState, useMemo, useEffect } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import useAdminList from '../hooks/useAdminList.js';
import { fmtDateTime, fmtInt, fmtPaise, humanizeState } from '../helpers/formatters.js';
import { fmtMoney } from '@beonedge/shared/format.js';
import './admin-screens-shared.css';

/*
 * `GET /v1/admin/transactions` is the ORDER stream, and its query schema is
 * `.strict()` with enums. The filters here sent values that are not in those
 * enums, so the request came back 400 and the screen showed a validation error
 * instead of a filtered table:
 *   status: awaiting_approval, approved, approval_rejected  <- none exist
 *   type:   sip, lumpsum                                     <- neither exists
 * Both dropdowns now offer exactly the canonical order_type / order_state values,
 * which is also why they are declared here rather than written inline.
 */
const ORDER_STATES = [
  'submitted',
  'payment_pending',
  'payment_confirmed',
  'booked',
  'payment_failed',
  'cancelled',
  'rejected',
  'refunded',
  'reversed',
];

const ORDER_TYPES = ['purchase', 'sip_installment', 'redemption', 'refund', 'adjustment'];

// `humanizeState` would render this one as "Sip installment".
const TYPE_LABELS = { sip_installment: 'SIP installment' };
const typeLabel = (type) => TYPE_LABELS[type] || humanizeState(type);

const SETTLED = ['payment_confirmed', 'booked'];
const UNSUCCESSFUL = ['payment_failed', 'rejected', 'reversed'];

function TransactionsScreen({ funds = [] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [search, setSearch] = useState('');
  const [fundFilter, setFundFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Debounce free-text search; the canonical endpoint matches an order-id or
  // email prefix, so partial input should not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { items: rows, loading, error, hasMore, loadMore, reload } = useAdminList(
    '/v1/admin/transactions',
    { fundId: fundFilter, status: statusFilter, type: typeFilter, q: search },
    { limit: 25 },
  );

  const stats = useMemo(() => {
    // `amountPaise` is a string from the canonical projection: rupees for display.
    const totalAmount = rows.reduce((sum, r) => sum + Number(r.amountPaise || 0) / 100, 0);
    return {
      totalAmount,
      confirmed: rows.filter((r) => SETTLED.includes(r.status)).length,
      failed: rows.filter((r) => UNSUCCESSFUL.includes(r.status)).length,
    };
  }, [rows]);

  // Skeletons only replace an EMPTY table. `loading` goes true on every fetch,
  // including Load more, so the old `{!loading && rows.map(...)}` wiped every row
  // the operator was reading and put three placeholders in their place.
  const showSkeleton = loading && rows.length === 0;

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Loaded orders" value={fmtInt(rows.length)} />
        <StatTile label="Total amount" value={fmtMoney(stats.totalAmount)} />
        <StatTile label="Confirmed or booked" value={fmtInt(stats.confirmed)} />
        <StatTile label="Failed" value={fmtInt(stats.failed)} />
      </div>

      {error && (
        <div className="ash-load-note" role="alert">
          <span>{error}</span>
          <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" disabled={loading} onClick={reload}>
            <I icon={RefreshCw} size={13} />
            {loading ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Transactions</span>
            <h2 className="adm-card-title">Client order stream</h2>
          </div>
        </div>

        {/* Was a row of bare `.be-select` controls — a class no stylesheet defines,
            so five unstyled native selects with no labels. `.adm-filter` is the
            console's select wrapper and carries the phone target height. */}
        <div className="adm-payment-filters">
          <label className="adm-search">
            <I icon={Search} size={14} />
            <span className="adm-sr-only">Search orders</span>
            <input
              type="text"
              placeholder="Search order id or email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Fund pool</span>
            <select value={fundFilter} onChange={(e) => setFundFilter(e.target.value)}>
              <option value="all">All fund pools</option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>{f.name || f.id}</option>
              ))}
            </select>
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Order status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {ORDER_STATES.map((state) => (
                <option key={state} value={state}>{humanizeState(state)}</option>
              ))}
            </select>
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Order type</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              {ORDER_TYPES.map((type) => (
                <option key={type} value={type}>{typeLabel(type)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead><tr>
              <th>Order</th><th>User</th><th>Fund</th><th>Type</th><th>Amount</th>
              <th className="adm-col-status">Status</th><th>Requested</th>
            </tr></thead>
            <tbody>
              {showSkeleton && (
                <>
                  <SkeletonTableRow columnCount={7} />
                  <SkeletonTableRow columnCount={7} />
                  <SkeletonTableRow columnCount={7} />
                </>
              )}
              {!loading && !error && rows.length === 0 && (
                <EmptyTableRow colSpan={7}>
                  No orders match these filters. An order appears here as soon as a client starts an
                  investment.
                </EmptyTableRow>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  {/* The id was sliced to 8 characters. An order reference exists to
                      be quoted against a payment or a support request, and 8 of 36
                      characters cannot be. */}
                  <td data-label="Order"><code className="adm-code">{r.id}</code></td>
                  <td data-label="User">
                    <div className="adm-cell-main">{r.userEmail || r.userId || '—'}</div>
                    {r.failureCode && <div className="adm-cell-sub">{r.failureCode}</div>}
                  </td>
                  <td data-label="Fund">{r.fundName || r.fundSlug || '—'}</td>
                  <td data-label="Type">{typeLabel(r.type)}</td>
                  <td className="be-money" data-label="Amount">
                    {r.amountPaise === null || r.amountPaise === undefined
                      ? '—'
                      : fmtPaise(r.amountPaise)}
                  </td>
                  <td className="adm-col-status" data-label="Status"><StateBadge state={r.status} /></td>
                  <td className="be-num adm-cell-meta" data-label="Requested">
                    {fmtDateTime(r.requestedAt || r.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasMore && (
          <div className="adm-toolbar adm-toolbar--center adm-toolbar--bordered adm-toolbar--gap-2">
            <button type="button" className="be-btn be-btn-secondary be-btn-sm" disabled={loading} onClick={loadMore}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TransactionsScreen;
