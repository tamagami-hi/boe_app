import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import { fmtDateTime, fmtInt } from '../helpers/formatters.js';
import { fmtMoney } from '@beonedge/shared/format.js';
import './admin-screens-shared.css';

/*
 * What a pool holds is the administrator-curated stock list — there is no market
 * feed and no per-unit price in this model.
 *
 * This screen used to read `fund.currentValue`, `fund.sectors` and
 * `fund.investments`. The funds projection sends none of them:
 * `normalizeFundRow` hardcodes `sectors: []` and `investments: []` and exposes the
 * pool size as `totalPoolSize`. So a screen titled "Holdings by fund" reported
 * ₹0 AUM, 0 sectors and 0 holdings for every pool, and expanding a row always said
 * "No investment holdings recorded for this fund" no matter how many stocks were
 * disclosed.
 *
 * Expanding a pool now reads its real list from
 * `GET /v1/admin/funds/:id/stocks`, one request, only when asked for.
 */
const VISIBLE_STAGES = ['published', 'paused'];

function StockList({ fundId }) {
  const [state, setState] = useState({ status: 'loading', stocks: [], error: '' });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading', error: '' }));
    try {
      const payload = await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/stocks`, {
        scope: 'admin',
      });
      setState({ status: 'ready', stocks: payload?.items ?? [], error: '' });
    } catch (error) {
      setState({ status: 'error', stocks: [], error: error?.message || 'Could not load the stock list.' });
    }
  }, [fundId]);

  useEffect(() => { void load(); }, [load]);

  if (state.status === 'loading') {
    return <p className="adm-cell-meta">Reading the disclosed stock list…</p>;
  }

  if (state.status === 'error') {
    return (
      <div className="ash-load-note" role="alert">
        <span>{state.error}</span>
        <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" onClick={load}>
          <I icon={RefreshCw} size={13} />
          Try again
        </button>
      </div>
    );
  }

  const active = state.stocks.filter((stock) => stock.state === 'active');
  const exited = state.stocks.filter((stock) => stock.state !== 'active');

  if (active.length === 0) {
    return (
      <p className="adm-cell-meta">
        No stocks disclosed for this pool yet. They are added by hand, per quarter, under Fund
        operations.
      </p>
    );
  }

  return (
    <>
      <ul className="adm-stream">
        {active.map((stock) => (
          <li key={stock.id} className="adm-list-item">
            <div className="adm-list-item__header">
              <span className="adm-list-item__title">{stock.stockName}</span>
              <span className="adm-cell-meta">
                {stock.weightPercent === null || stock.weightPercent === undefined
                  ? stock.quarterLabel
                  : `${Number(stock.weightPercent).toFixed(2)}% · ${stock.quarterLabel}`}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {exited.length > 0 && (
        <p className="adm-cell-meta adm-m-t-2">
          {fmtInt(exited.length)} exited {exited.length === 1 ? 'holding' : 'holdings'} are kept in the
          disclosure history.
        </p>
      )}
    </>
  );
}

function HoldingsScreen({ funds = [], loading = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [openId, setOpenId] = useState('');

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return funds;
    return funds.filter((f) => String(f.name || '').toLowerCase().includes(q));
  }, [funds, searchQuery]);

  // `totalPoolSize` is the latest published monthly closing AUM, in rupees.
  const totalAum = useMemo(
    () => funds.reduce((sum, f) => sum + (Number(f.totalPoolSize) || 0), 0),
    [funds],
  );

  return (
    <div className="adm-screen">
      <div className="adm-stats">
        <StatTile label="Fund pools" value={fmtInt(funds.length)} />
        <StatTile label="Published AUM" value={fmtMoney(totalAum)} />
        <StatTile
          label="Visible to clients"
          value={fmtInt(funds.filter((f) => VISIBLE_STAGES.includes(f.status)).length)}
        />
      </div>

      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">Portfolio</span>
            <h2 className="adm-card-title">Holdings by pool</h2>
          </div>
          <div className="adm-card-actions">
            <label className="adm-search">
              <I icon={Search} size={14} />
              <span className="adm-sr-only">Search pools</span>
              <input
                type="text"
                placeholder="Search pools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </label>
          </div>
        </div>

        <p className="adm-screen-note">
          A pool&rsquo;s size is the monthly AUM figure published under Fund operations, and its
          composition is the disclosed stock list. There is no unit price in this model.
        </p>

        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead><tr>
              <th>Pool</th><th className="adm-col-status">Stage</th><th>Stocks</th>
              <th>Published AUM</th><th>As of</th><th className="adm-col-actions"></th>
            </tr></thead>
            <tbody>
              {loading && funds.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={6} />
                  <SkeletonTableRow columnCount={6} />
                  <SkeletonTableRow columnCount={6} />
                </>
              )}
              {!loading && filtered.length === 0 && (
                <EmptyTableRow colSpan={6}>
                  {funds.length === 0
                    ? 'No fund pools exist yet. Create one under Fund operations.'
                    : 'No pools match this search.'}
                </EmptyTableRow>
              )}
              {filtered.map((f) => {
                const isOpen = openId === f.id;
                const panelId = `holdings-detail-${f.id}`;
                return [
                  <tr key={f.id} className={isOpen ? 'is-expanded' : ''}>
                    <td data-label="Pool">
                      <div className="adm-cell-main">{f.name}</div>
                      {f.tagline && <div className="adm-cell-sub">{f.tagline}</div>}
                    </td>
                    <td className="adm-col-status" data-label="Stage"><StateBadge state={f.status} /></td>
                    <td className="be-num" data-label="Stocks">{fmtInt(f.stockCount)}</td>
                    <td className="be-money" data-label="Published AUM">{fmtMoney(f.totalPoolSize)}</td>
                    <td className="adm-cell-meta" data-label="As of">
                      {f.aumPeriodStart ? String(f.aumPeriodStart).slice(0, 7) : 'Not published'}
                    </td>
                    <td className="adm-col-actions" data-label="">
                      <button
                        type="button"
                        className="be-btn be-btn-ghost be-btn-sm"
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        onClick={() => setOpenId(isOpen ? '' : f.id)}
                      >
                        {isOpen ? 'Hide holdings' : 'View holdings'}
                      </button>
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${f.id}-detail`} className="adm-detail-row">
                      <td colSpan={6} id={panelId}>
                        <div className="adm-detail-panel">
                          <h3 className="adm-detail-title">{f.name} — disclosed holdings</h3>
                          <StockList fundId={f.id} />
                          {f.aumUpdatedAt && (
                            <p className="adm-cell-meta adm-m-t-2">
                              AUM last published {fmtDateTime(f.aumUpdatedAt)}.
                            </p>
                          )}
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

export default HoldingsScreen;
