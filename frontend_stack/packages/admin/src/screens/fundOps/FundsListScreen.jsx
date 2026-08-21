import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus, Search } from 'lucide-react';
import I from '../../components/I.jsx';
import StatTile from '../../components/StatTile.jsx';
import StateBadge from '../../components/StateBadge.jsx';
import EmptyTableRow from '../../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../../components/SkeletonTableRow.jsx';
import { fmtDateTime, fmtInt, fmtPaise, humanizeState } from '../../helpers/formatters.js';
import { FUND_STATES } from './fundOpsModel.js';
import '../admin-screens-shared.css';

const COLUMN_COUNT = 7;

export default function FundsListScreen({
  funds = [],
  summary = null,
  loading = false,
  stateFilter = 'all',
  onStateFilterChange,
  search = '',
  onSearchChange,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  canWrite = false,
}) {
  const [draftSearch, setDraftSearch] = useState(search);

  useEffect(() => {
    if (draftSearch === search) return undefined;
    const timer = setTimeout(() => onSearchChange?.(draftSearch), 300);
    return () => clearTimeout(timer);
  }, [draftSearch, search, onSearchChange]);

  const byState = summary?.byState ?? null;
  const filtered = stateFilter !== 'all' || search.trim() !== '';

  return (
    <div className="adm-screen">
      <div className="adm-stats adm-stats--3">
        <StatTile
          label="Funds"
          value={summary ? fmtInt(summary.total) : '—'}
          icon={Layers}
          tone="slate"
        />
        <StatTile
          label="Published"
          value={byState ? fmtInt(byState.published) : '—'}
          icon={Layers}
        />
        <StatTile
          label="Draft or in review"
          value={byState ? fmtInt(byState.draft + byState.review_pending) : '—'}
          icon={Layers}
        />
      </div>

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Fund operations</span>
            <h2 className="adm-card-title">Issued funds</h2>
            <div className="adm-card-sub">
              Terms, lifecycle and the latest published AUM for every fund in the catalogue.
            </div>
          </div>
          {canWrite && (
            <div className="adm-card-actions">
              <Link className="be-btn be-btn-primary be-btn-sm" to="/admin/funds/new">
                <I icon={Plus} size={14} /> New fund
              </Link>
            </div>
          )}
        </div>

        <div className="adm-payment-filters">
          <label className="adm-search adm-search--grow">
            <I icon={Search} size={14} />
            <span className="adm-sr-only">Search funds</span>
            <input
              type="text"
              placeholder="Search by name or slug"
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
            />
          </label>
          <label className="adm-filter">
            <span className="adm-sr-only">Fund state</span>
            <select
              value={stateFilter}
              onChange={(event) => onStateFilterChange?.(event.target.value)}
            >
              <option value="all">All states</option>
              {FUND_STATES.map((state) => (
                <option key={state} value={state}>{humanizeState(state)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <th scope="col">Fund</th>
                <th scope="col" className="adm-col-status">State</th>
                <th scope="col">Published AUM</th>
                <th scope="col">As of</th>
                <th scope="col">Stocks</th>
                <th scope="col">Version</th>
                <th scope="col" className="adm-col-actions"><span className="adm-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && funds.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={COLUMN_COUNT} />
                  <SkeletonTableRow columnCount={COLUMN_COUNT} />
                  <SkeletonTableRow columnCount={COLUMN_COUNT} />
                </>
              )}
              {!loading && funds.length === 0 && (
                <EmptyTableRow colSpan={COLUMN_COUNT}>
                  {filtered
                    ? 'No funds match this search or state.'
                    : 'No funds yet. Create one to publish its terms and opening AUM.'}
                </EmptyTableRow>
              )}
              {funds.map((fund) => (
                <tr key={fund.id}>
                  <td data-label="Fund">
                    <div className="adm-cell-main">{fund.name}</div>
                    <div className="adm-cell-sub">{fund.slug}</div>
                  </td>
                  <td className="adm-col-status" data-label="State">
                    <StateBadge state={fund.status} />
                  </td>
                  <td className="be-money" data-label="Published AUM">
                    {fund.aumPaise === null ? 'Not published' : fmtPaise(fund.aumPaise)}
                  </td>
                  <td className="adm-cell-meta" data-label="As of">
                    {fund.aumAsOfDate || 'Not published'}
                  </td>
                  <td className="be-num" data-label="Stocks">{fmtInt(fund.stockCount)}</td>
                  <td className="be-num adm-cell-meta" data-label="Version">
                    {fund.currentVersion ?? '—'}
                    {fund.aumUpdatedAt && (
                      <div className="adm-cell-sub">AUM {fmtDateTime(fund.aumUpdatedAt)}</div>
                    )}
                  </td>
                  <td className="adm-col-actions" data-label="">
                    <Link className="be-btn be-btn-secondary be-btn-sm" to={`/admin/funds/${fund.id}`}>
                      Open<span className="adm-sr-only"> {fund.name}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="adm-table-foot">
          <span className="adm-cell-meta">
            {!summary ? '' : filtered
              ? `Showing ${fmtInt(funds.length)} matching fund${funds.length === 1 ? '' : 's'}${hasMore ? ' so far' : ''}`
              : `Showing ${fmtInt(funds.length)} of ${fmtInt(summary.total)} funds`}
          </span>
          {hasMore && (
            <button
              type="button"
              className="be-btn be-btn-secondary be-btn-sm"
              onClick={() => onLoadMore?.()}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
