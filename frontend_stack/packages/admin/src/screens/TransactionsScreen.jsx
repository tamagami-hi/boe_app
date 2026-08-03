import { useState, useMemo, useEffect } from 'react';
import { Search } from 'lucide-react';
import '../styles/desktop/admin.css';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import useAdminList from '../hooks/useAdminList.js';
import { fmtInt } from '../helpers/formatters.js';
import { fmtMoney } from '@beonedge/shared/format.js';
import './admin-screens-shared.css';

const TXN_TYPES = {
  sip: 'SIP',
  sip_installment: 'SIP',
  lumpsum: 'Lumpsum',
  one_time: 'Lumpsum',
};

const TXN_STATUS_BADGES = {
  submitted: <span className="be-badge be-badge-paused"><span className="be-badge-dot"/>Submitted</span>,
  payment_confirmed: <span className="be-badge be-badge-active"><span className="be-badge-dot"/>Confirmed</span>,
  awaiting_approval: <span className="be-badge be-badge-paused"><span className="be-badge-dot"/>Awaiting approval</span>,
  approved: <span className="be-badge be-badge-active"><span className="be-badge-dot"/>Approved</span>,
  payment_failed: <span className="be-badge be-badge-failed"><span className="be-badge-dot"/>Failed</span>,
  approval_rejected: <span className="be-badge be-badge-failed"><span className="be-badge-dot"/>Approval rejected</span>,
};

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

  const { items: rows, loading, error, hasMore, loadMore } = useAdminList(
    '/v1/admin/transactions',
    { fundId: fundFilter, status: statusFilter, type: typeFilter, q: search },
    { limit: 25 },
  );

  const stats = useMemo(() => {
    // `amountPaise` is a string from the canonical projection: rupees for display.
    const totalAmount = rows.reduce((sum, r) => sum + Number(r.amountPaise || 0) / 100, 0);
    const confirmed = rows.filter((r) => r.status === 'payment_confirmed' || r.status === 'booked').length;
    const failed = rows.filter((r) => r.status === 'payment_failed' || r.status === 'rejected').length;
    return { totalAmount, confirmed, failed };
  }, [rows]);

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Loaded transactions" value={fmtInt(rows.length)} />
        <StatTile label="Total amount" value={`${fmtMoney(stats.totalAmount)}`} />
        <StatTile label="Confirmed" value={fmtInt(stats.confirmed)} />
        <StatTile label="Failed" value={fmtInt(stats.failed)} />
      </div>

      {error && <div className="adm-load-note" role="alert">{error}</div>}

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Transactions</span>
            <h2 className="adm-card-title">All client transactions</h2>
          </div>
          <div className="adm-card-actions adm-card-actions--responsive">
            <div className="adm-search">
              <I icon={Search} size={14} />
              <input
                type="text"
                placeholder="Search user, fund, ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select className="be-select be-select-sm" value={fundFilter} onChange={(e) => setFundFilter(e.target.value)}>
              <option value="all">All fund pools</option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>{f.name || f.id}</option>
              ))}
            </select>
            <select className="be-select be-select-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="awaiting_approval">Awaiting approval</option>
              <option value="payment_confirmed">Confirmed</option>
              <option value="approved">Approved</option>
              <option value="payment_failed">Failed</option>
              <option value="approval_rejected">Approval rejected</option>
            </select>
            <select className="be-select be-select-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              <option value="sip">SIP</option>
              <option value="lumpsum">Lumpsum</option>
            </select>
          </div>
        </div>

        <table>
          <thead><tr>
            <th>ID</th><th>User</th><th>Fund</th><th>Type</th><th>Amount</th><th>Status</th><th>Date</th>
          </tr></thead>
          <tbody>
            {loading && (
              <>
                <SkeletonTableRow colSpan={7} />
                <SkeletonTableRow colSpan={7} />
                <SkeletonTableRow colSpan={7} />
              </>
            )}
            {!loading && rows.length === 0 && (
              <EmptyTableRow colSpan={7}>No transactions found.</EmptyTableRow>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td><code className="adm-code">{String(r.id).slice(0, 8)}...</code></td>
                <td>
                  <div>{r.userName || r.userEmail || '—'}</div>
                  {r.userEmail && <div className="adm-cell-meta">{r.userEmail}</div>}
                </td>
                <td>{r.fundName || '—'}</td>
                <td>{TXN_TYPES[r.type] || r.type || '—'}</td>
                <td className="be-money">{fmtMoney(Number(r.amountPaise || 0) / 100)}</td>
                <td>{TXN_STATUS_BADGES[r.status] || r.status || '—'}</td>
                <td className="be-num adm-cell-meta">{String(r.createdAt || '').slice(0, 19).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {hasMore && (
          <div className="adm-pagination">
            <button className="be-btn be-btn-ghost be-btn-sm" disabled={loading} onClick={loadMore}>
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TransactionsScreen;
