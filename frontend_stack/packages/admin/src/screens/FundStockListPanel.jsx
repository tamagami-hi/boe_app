import { useCallback, useEffect, useState } from 'react';
import { PieChart, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';

// Fund Portfolio — the administrator-curated stock list (Option B module 6).
//
// Entirely manual: no market data feed. Each entry records the company and the
// reporting quarter it entered, with an optional published weight. Removing a
// stock records an exit rather than deleting the row, because the list is
// disclosure history shown to investors.
//
// GET/POST /v1/admin/funds/:fundId/stocks, PATCH/DELETE .../stocks/:stockId

const QUARTER_PATTERN = /^Q[1-4] FY\d{2}$/;

function defaultQuarter() {
  // Indian fiscal year starts in April: Jan–Mar belongs to Q4 of the FY that
  // began the previous April.
  const now = new Date();
  const month = now.getUTCMonth(); // 0 = January
  const fiscalIndex = Math.floor(((month + 9) % 12) / 3) + 1;
  const fiscalYearEnd = month >= 3 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return `Q${fiscalIndex} FY${String(fiscalYearEnd).slice(-2)}`;
}

export default function FundStockListPanel({ fundId }) {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stockName, setStockName] = useState('');
  const [quarterLabel, setQuarterLabel] = useState(defaultQuarter());
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmExit, setConfirmExit] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/stocks`, {
        scope: 'admin',
      });
      setStocks(payload?.items ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the stock list.');
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(event) {
    event.preventDefault();
    if (busy) return;
    if (!stockName.trim()) {
      setError('Enter the stock name.');
      return;
    }
    if (!QUARTER_PATTERN.test(quarterLabel.trim())) {
      setError("Quarter must look like 'Q1 FY27'.");
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/stocks`, {
        method: 'POST',
        scope: 'admin',
        body: {
          stockName: stockName.trim(),
          quarterLabel: quarterLabel.trim(),
          ...(weight === '' ? {} : { weightPercent: Number(weight) }),
          sortOrder: stocks.filter((stock) => stock.state === 'active').length + 1,
        },
      });
      setStockName('');
      setWeight('');
      await load();
    } catch (addError) {
      setError(addError?.message || 'The stock was not added.');
    } finally {
      setBusy(false);
    }
  }

  async function onExit(stock) {
    if (confirmExit !== stock.id) {
      setConfirmExit(stock.id);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/stocks/${encodeURIComponent(stock.id)}`, {
        method: 'DELETE',
        scope: 'admin',
      });
      setConfirmExit(null);
      await load();
    } catch (exitError) {
      setError(exitError?.message || 'The stock could not be marked as exited.');
    } finally {
      setBusy(false);
    }
  }

  const active = stocks.filter((stock) => stock.state === 'active');
  const exited = stocks.filter((stock) => stock.state !== 'active');

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <div>
          <h3 className="adm-card-title">
            <I icon={PieChart} size={16} /> Fund portfolio (stock list)
          </h3>
          <div className="adm-card-sub">
            Shown to investors with the quarter each holding entered. Updated quarterly, by hand.
          </div>
        </div>
      </div>

      <form className="adm-form-grid" onSubmit={onAdd}>
        <label className="adm-field">
          <span>Stock name</span>
          <input
            type="text"
            value={stockName}
            onChange={(event) => setStockName(event.target.value)}
            placeholder="SJS Enterprises"
          />
        </label>
        <label className="adm-field">
          <span>Quarter</span>
          <input
            type="text"
            value={quarterLabel}
            onChange={(event) => setQuarterLabel(event.target.value)}
            placeholder="Q1 FY27"
          />
        </label>
        <label className="adm-field">
          <span>Weight % (optional)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </label>
        <div className="adm-field">
          <span className="adm-sr-only">Add</span>
          <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
            <I icon={Plus} size={14} /> Add stock
          </button>
        </div>

        {error && (
          <div className="be-error adm-field--wide" role="alert">
            {error}
          </div>
        )}
      </form>

      <div className="adm-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Stock name</th>
              <th>Quarter added</th>
              <th>Weight</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4}>Loading…</td>
              </tr>
            )}
            {!loading && active.length === 0 && (
              <tr>
                <td colSpan={4}>No stocks disclosed yet.</td>
              </tr>
            )}
            {active.map((stock) => (
              <tr key={stock.id}>
                <td>{stock.stockName}</td>
                <td>{stock.quarterLabel}</td>
                <td className="be-num">
                  {stock.weightPercent === null || stock.weightPercent === undefined
                    ? '—'
                    : `${Number(stock.weightPercent).toFixed(2)}%`}
                </td>
                <td className="adm-cell-actions">
                  <button
                    type="button"
                    className={`be-btn be-btn-sm ${confirmExit === stock.id ? 'be-btn-danger' : 'be-btn-secondary'}`}
                    onClick={() => onExit(stock)}
                    disabled={busy}
                  >
                    <I icon={Trash2} size={13} /> {confirmExit === stock.id ? 'Confirm exit' : 'Mark exited'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {exited.length > 0 && (
        <details className="adm-exited-stocks">
          <summary>Exited holdings ({exited.length})</summary>
          <ul>
            {exited.map((stock) => (
              <li key={stock.id}>
                {stock.stockName} · {stock.quarterLabel}
                {stock.exitedAt ? ` · exited ${String(stock.exitedAt).slice(0, 10)}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
