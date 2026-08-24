import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, PieChart, Plus, Trash2, X } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import { useAdminCacheActions } from '../data/adminResources.js';
import { parseFundStockList, parseFundStockWrite } from '../data/fundContracts.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';

const QUARTER_PATTERN = /^Q[1-4] FY\d{2}$/u;

function defaultQuarter() {
  const now = new Date();
  const month = now.getUTCMonth();
  const fiscalIndex = Math.floor(((month + 9) % 12) / 3) + 1;
  const fiscalYearEnd = month >= 3 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return `Q${fiscalIndex} FY${String(fiscalYearEnd).slice(-2)}`;
}

const EMPTY_DRAFT = { stockName: '', quarterLabel: '', weight: '' };

export default function FundStockListPanel({ fundId, initialStocks = null, canWrite = true }) {
  const { invalidateFunds } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();
  const [stocks, setStocks] = useState(initialStocks ?? []);
  const [loading, setLoading] = useState(initialStocks === null);
  const [addDraft, setAddDraft] = useState({ ...EMPTY_DRAFT, quarterLabel: defaultQuarter() });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmExit, setConfirmExit] = useState(null);
  const seededFundRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const payload = await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/stocks`, {
        scope: 'admin',
      });
      setStocks(parseFundStockList(payload).items);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the stock list.');
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    if (seededFundRef.current === fundId) return;
    seededFundRef.current = fundId;
    if (initialStocks !== null) {
      setStocks(initialStocks);
      setLoading(false);
      return;
    }
    setLoading(true);
    void load();
  }, [fundId, initialStocks, load]);

  function validate(draft) {
    if (!draft.stockName.trim()) return 'Enter the stock name.';
    if (!QUARTER_PATTERN.test(draft.quarterLabel.trim())) return "Quarter must look like 'Q1 FY27'.";
    if (draft.weight !== '') {
      const weight = Number(draft.weight);
      if (!Number.isFinite(weight) || weight < 0 || weight > 100) {
        return 'Weight must be between 0 and 100, or blank.';
      }
    }
    return '';
  }

  function bodyOf(draft, sortOrder) {
    return {
      stockName: draft.stockName.trim(),
      quarterLabel: draft.quarterLabel.trim(),
      ...(draft.weight === '' ? {} : { weightPercent: Number(draft.weight) }),
      sortOrder,
    };
  }

  async function afterWrite() {
    invalidateFunds();
    await load();
  }

  async function onAdd(event) {
    event.preventDefault();
    if (busy) return;
    const problem = validate(addDraft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = bodyOf(addDraft, stocks.filter((stock) => stock.state === 'active').length + 1);
      parseFundStockWrite(await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/stocks`, {
        method: 'POST',
        scope: 'admin',
        body,
        headers: { 'Idempotency-Key': idempotencyKeyFor(`stock-add:${fundId}`, body) },
      }));
      setAddDraft({ ...EMPTY_DRAFT, quarterLabel: defaultQuarter() });
      await afterWrite();
    } catch (addError) {
      setError(addError?.message || 'The stock was not added.');
    } finally {
      setBusy(false);
    }
  }

  function openEdit(stock) {
    setConfirmExit(null);
    setEditingId(stock.id);
    setEditDraft({
      stockName: stock.stockName ?? '',
      quarterLabel: stock.quarterLabel ?? '',
      weight: stock.weightPercent === null || stock.weightPercent === undefined
        ? ''
        : String(Number(stock.weightPercent)),
    });
    setError('');
  }

  async function onSaveEdit(stock) {
    if (busy) return;
    const problem = validate(editDraft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = bodyOf(editDraft, stock.sortOrder ?? 0);
      parseFundStockWrite(await apiRequest(
        `/v1/admin/funds/${encodeURIComponent(fundId)}/stocks/${encodeURIComponent(stock.id)}`,
        {
          method: 'PATCH',
          scope: 'admin',
          body,
          headers: { 'Idempotency-Key': idempotencyKeyFor(`stock-edit:${stock.id}`, body) },
        },
      ));
      setEditingId(null);
      await afterWrite();
    } catch (editError) {
      setError(editError?.message || 'The stock was not updated.');
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
      parseFundStockWrite(await apiRequest(
        `/v1/admin/funds/${encodeURIComponent(fundId)}/stocks/${encodeURIComponent(stock.id)}`,
        {
          method: 'DELETE',
          scope: 'admin',
          headers: { 'Idempotency-Key': idempotencyKeyFor(`stock-exit:${stock.id}`, null) },
        },
      ));
      setConfirmExit(null);
      await afterWrite();
    } catch (exitError) {
      setError(exitError?.message || 'The stock could not be marked as exited.');
    } finally {
      setBusy(false);
    }
  }

  const active = stocks.filter((stock) => stock.state === 'active');
  const exited = stocks.filter((stock) => stock.state !== 'active');
  const columnCount = canWrite ? 4 : 3;

  return (
    <div className="adm-card adm-table">
      <div className="adm-card-head">
        <div>
          <h3 className="adm-card-title">
            <I icon={PieChart} size={16} /> Stock list
          </h3>
          <div className="adm-card-sub">
            Shown to investors with the quarter each holding entered. Curated by hand; there is no
            market data feed.
          </div>
        </div>
      </div>

      {canWrite && (
        <form className="adm-form-grid adm-form-grid--inset" onSubmit={onAdd}>
          <label className="adm-field">
            <span className="adm-field-label">Stock name</span>
            <input
              type="text"
              value={addDraft.stockName}
              onChange={(event) => setAddDraft((d) => ({ ...d, stockName: event.target.value }))}
              placeholder="SJS Enterprises"
            />
          </label>
          <label className="adm-field">
            <span className="adm-field-label">Quarter</span>
            <input
              type="text"
              value={addDraft.quarterLabel}
              onChange={(event) => setAddDraft((d) => ({ ...d, quarterLabel: event.target.value }))}
              placeholder="Q1 FY27"
            />
          </label>
          <label className="adm-field">
            <span className="adm-field-label">Weight % (optional)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={addDraft.weight}
              onChange={(event) => setAddDraft((d) => ({ ...d, weight: event.target.value }))}
            />
          </label>
          <div className="adm-field adm-field--action">
            <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
              <I icon={Plus} size={14} /> Add stock
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="be-error adm-inline-error" role="alert">{error}</div>
      )}

      <div className="adm-table-scroll">
        <table className="adm-table-cards">
          <thead>
            <tr>
              <th scope="col">Stock name</th>
              <th scope="col">Quarter added</th>
              <th scope="col">Weight</th>
              {canWrite && (
                <th scope="col" className="adm-col-actions"><span className="adm-sr-only">Actions</span></th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <>
                <SkeletonTableRow columnCount={columnCount} />
                <SkeletonTableRow columnCount={columnCount} />
              </>
            )}
            {!loading && active.length === 0 && (
              <EmptyTableRow colSpan={columnCount}>
                No stocks disclosed yet.
                {canWrite ? ' Add the first holding above.' : ''}
              </EmptyTableRow>
            )}
            {!loading && active.map((stock) => (
              editingId === stock.id ? (
                <tr key={stock.id}>
                  <td data-label="Stock name">
                    <input
                      type="text"
                      aria-label={`Stock name for ${stock.stockName}`}
                      value={editDraft.stockName}
                      onChange={(event) => setEditDraft((d) => ({ ...d, stockName: event.target.value }))}
                    />
                  </td>
                  <td data-label="Quarter added">
                    <input
                      type="text"
                      aria-label={`Quarter for ${stock.stockName}`}
                      value={editDraft.quarterLabel}
                      onChange={(event) => setEditDraft((d) => ({ ...d, quarterLabel: event.target.value }))}
                    />
                  </td>
                  <td data-label="Weight">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      aria-label={`Weight for ${stock.stockName}`}
                      value={editDraft.weight}
                      onChange={(event) => setEditDraft((d) => ({ ...d, weight: event.target.value }))}
                    />
                  </td>
                  <td className="adm-col-actions" data-label="">
                    <button
                      type="button"
                      className="be-btn be-btn-primary be-btn-sm"
                      onClick={() => onSaveEdit(stock)}
                      disabled={busy}
                    >
                      <I icon={Check} size={13} /> Save
                    </button>
                    <button
                      type="button"
                      className="be-btn be-btn-ghost be-btn-sm"
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                    >
                      <I icon={X} size={13} /> Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={stock.id}>
                  <td data-label="Stock name">{stock.stockName}</td>
                  <td data-label="Quarter added">{stock.quarterLabel}</td>
                  <td className="be-num" data-label="Weight">
                    {stock.weightPercent === null || stock.weightPercent === undefined
                      ? '—'
                      : `${Number(stock.weightPercent).toFixed(2)}%`}
                  </td>
                  {canWrite && (
                    <td className="adm-col-actions" data-label="">
                      <button
                        type="button"
                        className="be-btn be-btn-secondary be-btn-sm"
                        onClick={() => openEdit(stock)}
                        disabled={busy}
                      >
                        Edit<span className="adm-sr-only"> {stock.stockName}</span>
                      </button>
                      {confirmExit === stock.id ? (
                        <>
                          <button
                            type="button"
                            className="be-btn be-btn-danger be-btn-sm"
                            onClick={() => onExit(stock)}
                            disabled={busy}
                          >
                            <I icon={Trash2} size={13} /> Confirm exit
                          </button>
                          <button
                            type="button"
                            className="be-btn be-btn-ghost be-btn-sm"
                            onClick={() => setConfirmExit(null)}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="be-btn be-btn-secondary be-btn-sm"
                          onClick={() => onExit(stock)}
                          disabled={busy}
                        >
                          Mark exited<span className="adm-sr-only"> {stock.stockName}</span>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
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
