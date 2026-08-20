import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Plus, Search } from 'lucide-react';
import I from '../../components/I.jsx';
import StatTile from '../../components/StatTile.jsx';
import StateBadge from '../../components/StateBadge.jsx';
import EmptyTableRow from '../../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../../components/SkeletonTableRow.jsx';
import { fmtDateTime, fmtInt } from '../../helpers/formatters.js';
import { fmtMoney } from '@beonedge/shared/format.js';
import { FUND_STATES, EMPTY_PROFILE, slugify } from './fundOpsModel.js';
import FundProfileForm from './FundProfileForm.jsx';
import '../admin-screens-shared.css';

/*
 * The issued fund catalogue, and creating one.
 *
 * This was tab 2 of a four-tab screen whose other tabs were an overview, a
 * pool-picker hosting three panels, and the redemption queue — 1,304 lines in one
 * file with five hand-rolled modals. A fund now has a routed workspace
 * (`/admin/funds/:fundId`) for its terms, stock list and version history. AUM
 * lives under the AUM area and client growth under Client values: a funds.read
 * surface never lists investors or their balances.
 *
 * Creating a fund is two writes the backend keeps separate: a draft (slug only),
 * then its first published version. The form does both and then opens the new
 * fund's workspace.
 */
export default function FundsListScreen({
  funds = [],
  loading = false,
  onCreate,
}) {
  const [stateFilter, setStateFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return funds.filter((fund) => {
      if (stateFilter !== 'all' && (fund.status || 'draft') !== stateFilter) return false;
      if (!q) return true;
      return `${fund.name || ''} ${fund.slug || ''}`.toLowerCase().includes(q);
    });
  }, [funds, stateFilter, query]);

  const countIn = (states) => funds.filter((fund) => states.includes(fund.status)).length;

  async function create(payload, profile) {
    setBusy(true);
    try {
      // The list is a cached read; onCreate invalidates it and returns the new id so
      // the operator lands in the workspace rather than hunting for the pool.
      await onCreate?.({ ...payload, slug: slugify(profile.name) });
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Fund pools" value={fmtInt(funds.length)} icon={Layers} tone="slate" />
        <StatTile label="Published pools" value={fmtInt(countIn(['published']))} />
        <StatTile label="Draft or in review" value={fmtInt(countIn(['draft', 'review_pending']))} />
      </div>

      {creating ? (
        <FundProfileForm
          initial={EMPTY_PROFILE}
          submitLabel="Create pool and publish version 1"
          busy={busy}
          onSubmit={create}
          onCancel={() => setCreating(false)}
        >
          <p className="adm-screen-note">
            The pool is created as a draft. Publish it to clients from its workspace, once its fund
            size and stock list are in place.
          </p>
        </FundProfileForm>
      ) : (
        <div className="adm-card adm-table">
          <div className="adm-card-head">
            <div>
              <span className="be-eyebrow">Fund operations</span>
              <h2 className="adm-card-title">AUM pools</h2>
            </div>
            <div className="adm-card-actions">
              <button type="button" className="be-btn be-btn-primary be-btn-sm" onClick={() => setCreating(true)}>
                <I icon={Plus} size={14} /> New pool
              </button>
            </div>
          </div>

          <div className="adm-payment-filters">
            <label className="adm-search adm-search--grow">
              <I icon={Search} size={14} />
              <span className="adm-sr-only">Search pools</span>
              <input
                type="text"
                placeholder="Search by name or slug"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="adm-filter">
              <span className="adm-sr-only">Pool state</span>
              <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
                <option value="all">All states</option>
                {FUND_STATES.map((state) => (
                  <option key={state} value={state}>{state.replace(/_/gu, ' ')}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="adm-table-scroll">
            <table className="adm-table-cards">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th className="adm-col-status">State</th>
                  <th>Published AUM</th>
                  <th>As of</th>
                  <th>Stocks</th>
                  <th>Version</th>
                  <th className="adm-col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {loading && funds.length === 0 && (
                  <>
                    <SkeletonTableRow columnCount={7} />
                    <SkeletonTableRow columnCount={7} />
                    <SkeletonTableRow columnCount={7} />
                  </>
                )}
                {!loading && visible.length === 0 && (
                  <EmptyTableRow colSpan={7}>
                    {funds.length === 0
                      ? 'No fund pools yet. Create one to publish its first version.'
                      : 'No pools match this filter.'}
                  </EmptyTableRow>
                )}
                {visible.map((fund) => (
                  <tr key={fund.id}>
                    <td data-label="Pool">
                      <div className="adm-cell-main">{fund.name}</div>
                      <div className="adm-cell-sub">{fund.slug}</div>
                    </td>
                    <td className="adm-col-status" data-label="State">
                      <StateBadge state={fund.status} />
                    </td>
                    {/* Was `{f.totalPoolSize ?? f.aum ?? 0}` — a bare number with no
                        currency and no grouping, in a column headed "Pool Size". */}
                    <td className="be-money" data-label="Published AUM">{fmtMoney(fund.totalPoolSize)}</td>
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
        </div>
      )}
    </div>
  );
}
