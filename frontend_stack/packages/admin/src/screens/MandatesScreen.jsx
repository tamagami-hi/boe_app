import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Search } from 'lucide-react';
import I from '../components/I.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import { fmtDateTime, fmtPaise } from '../helpers/formatters.js';
import './admin-screens-shared.css';

const STATES = [
  'setup_pending', 'active', 'pause_pending', 'paused', 'cancel_pending', 'cancelled',
  'revoke_pending', 'revoked', 'expired', 'failed',
];

function searchable(row) {
  return [row.mandateId, row.sipPlanId, row.userId, row.userEmail, row.userName, row.fundId, row.fundName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function MandatesScreen({ rows = [], loading = false, state, attention, onStateChange, onAttentionChange }) {
  const [search, setSearch] = useState('');
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? rows.filter((row) => searchable(row).includes(query)) : rows;
  }, [rows, search]);

  return (
    <div className="adm-screen">
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">SIP AutoPay</span>
            <h2 className="adm-card-title">Mandate register</h2>
          </div>
          <span className="adm-payment-count">{visibleRows.length} / {rows.length}</span>
        </div>
        <p className="adm-screen-note">
          Provider authorization and debit outcomes are evidence. Reconciliation checks PhonePe;
          it never marks a payment successful from this screen.
        </p>
        <div className="adm-payment-filters">
          <label className="adm-search">
            <I icon={Search} size={14} />
            <span className="adm-sr-only">Search mandates</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client, fund, SIP or mandate" />
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Mandate state</span>
            <select value={state} onChange={(event) => onStateChange(event.target.value)}>
              <option value="">All mandate states</option>
              {STATES.map((value) => <option key={value} value={value}>{value.replace(/_/gu, ' ')}</option>)}
            </select>
          </label>
          <label className="adm-checkbox-field adm-chip">
            <input type="checkbox" checked={attention} onChange={(event) => onAttentionChange(event.target.checked)} />
            <span>Needs attention</span>
          </label>
        </div>
        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <th>Client</th><th>Fund and SIP</th><th>Amount</th><th>Mandate</th>
                <th>Latest operations</th><th>Last checked</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && <SkeletonTableRow columnCount={7} />}
              {!loading && rows.length === 0 && <EmptyTableRow colSpan={7}>No AutoPay mandates match this view.</EmptyTableRow>}
              {!loading && rows.length > 0 && visibleRows.length === 0 && <EmptyTableRow colSpan={7}>No loaded mandate matches this search.</EmptyTableRow>}
              {visibleRows.map((row) => (
                <tr key={row.mandateId}>
                  <td data-label="Client">
                    <div className="adm-user-info">
                      <span className="adm-user-name">{row.userName || row.userEmail || row.userId}</span>
                      {row.userEmail && row.userName && <span className="adm-cell-meta">{row.userEmail}</span>}
                    </div>
                  </td>
                  <td data-label="Fund and SIP">
                    <div className="adm-user-info">
                      <span>{row.fundName || row.fundId}</span>
                      <span className="adm-cell-meta">SIP {row.sipPlanId} · <StateBadge state={row.sipState} /></span>
                    </div>
                  </td>
                  <td className="be-money" data-label="Amount">
                    {fmtPaise(row.amountPaise)}
                    {row.debitDay !== null && <span className="adm-cell-meta">day {row.debitDay}</span>}
                  </td>
                  <td data-label="Mandate">
                    <div className="adm-user-info">
                      <StateBadge state={row.mandateState} />
                      <code className="adm-code">{row.mandateId}</code>
                      {row.attentionReason && <span className="adm-cell-meta"><I icon={AlertTriangle} size={12} /> {row.attentionReason}</span>}
                    </div>
                  </td>
                  <td data-label="Latest operations">
                    <div className="adm-detail-tags">
                      {row.setupState && <StateBadge state={row.setupState} />}
                      {row.collectionState && <StateBadge state={row.collectionState} />}
                      {row.cancelState && <StateBadge state={row.cancelState} />}
                      {!row.setupState && !row.collectionState && !row.cancelState && '—'}
                    </div>
                  </td>
                  <td className="adm-cell-meta" data-label="Last checked">
                    {row.lastStatusCheckedAt ? fmtDateTime(row.lastStatusCheckedAt) : 'Not checked'}
                  </td>
                  <td className="adm-col-actions" data-label="">
                    <Link className="be-btn be-btn-ghost be-btn-sm" to={`/admin/payments/mandates/${encodeURIComponent(row.mandateId)}`}>View trace</Link>
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
