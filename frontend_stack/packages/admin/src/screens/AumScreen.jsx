import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, PieChart, TrendingUp } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import StatTile from '../components/StatTile.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import AdminReadError from '../data/AdminReadError.jsx';
import { useAdminCacheActions, useAdminFunds } from '../data/adminResources.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { fmtInt, fmtPaise, fmtPaiseSigned } from '../helpers/formatters.js';
import FundAumPanel, { AUM_BOUNDARY_NOTE } from './FundAumPanel.jsx';
import FundAumHistoryPanel from './FundAumHistoryPanel.jsx';
import './admin-screens-shared.css';

/*
 * Fund AUM management (spec §8.3, §8.4, §9.5, §11.1).
 *
 * AUM is published by admins as absolute snapshots. Nothing on these screens reads
 * or writes a client value, and the AUM endpoints are not allowed to. A collective
 * command is either one common signed percentage per selected fund or explicit
 * per-fund deltas — NEVER one shared total distributed across funds, so there is
 * no such field here.
 *
 *   POST /v1/admin/aum/growth/collective/preview   (no Idempotency-Key)
 *   POST /v1/admin/aum/growth/collective           (basisHash + Idempotency-Key)
 */

const TABS = [
  { id: 'current', label: 'Current published AUM', path: '/admin/aum/current' },
  { id: 'manage', label: 'Initialize or adjust one fund', path: '/admin/aum/manage' },
  { id: 'collective', label: 'Collective fund growth', path: '/admin/aum/collective' },
  { id: 'history', label: 'History and corrections', path: '/admin/aum/history' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function FundPicker({ funds, value, onChange, label }) {
  return (
    <label className="adm-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose a fund</option>
        {funds.map((fund) => (
          <option key={fund.id} value={fund.id}>{fund.name}</option>
        ))}
      </select>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Current published AUM                                                      */
/* -------------------------------------------------------------------------- */

function CurrentAumTab() {
  const funds = useAdminFunds();
  return (
    <>
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">AUM</span>
            <h2 className="adm-card-title">Current published AUM</h2>
          </div>
          <div className="adm-payment-count">{fmtInt(funds.rows.length)} funds</div>
        </div>
        <p className="adm-screen-note">
          What clients see per fund: the latest admin-published absolute AUM and its as-of date.
          This is display-only; it is never compared against client values.
        </p>
        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <th>Fund</th>
                <th className="adm-col-status">State</th>
                <th>Published AUM</th>
                <th>As of</th>
                <th className="adm-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {funds.isLoading && funds.rows.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={5} />
                  <SkeletonTableRow columnCount={5} />
                  <SkeletonTableRow columnCount={5} />
                </>
              )}
              {!funds.isLoading && funds.rows.length === 0 && (
                <EmptyTableRow colSpan={5}>
                  No funds exist yet. Issue one under Funds before publishing AUM.
                </EmptyTableRow>
              )}
              {funds.rows.map((fund) => (
                <tr key={fund.id}>
                  <td data-label="Fund">
                    <div className="adm-cell-main">{fund.name}</div>
                    <div className="adm-cell-sub">{fund.slug}</div>
                  </td>
                  <td className="adm-col-status" data-label="State"><StateBadge state={fund.status} /></td>
                  <td className="be-money" data-label="Published AUM">
                    {fund.aumPaise != null ? fmtPaise(fund.aumPaise) : 'Not published'}
                  </td>
                  <td className="adm-cell-meta" data-label="As of">{fund.aumAsOfDate || '—'}</td>
                  <td className="adm-col-actions" data-label="">
                    <Link className="be-btn be-btn-ghost be-btn-sm" to={`/admin/funds/${fund.id}`}>
                      Open fund
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Initialize / adjust one fund                                               */
/* -------------------------------------------------------------------------- */

function ManageOneFundTab() {
  const funds = useAdminFunds();
  const [fundId, setFundId] = useState('');
  return (
    <>
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2 className="adm-card-title"><I icon={PieChart} size={16} /> Initialize or adjust one fund</h2>
            <div className="adm-card-sub">
              A fund with no snapshot is initialized with an absolute figure; after that, growth
              commands calculate a new absolute snapshot from the latest one.
            </div>
          </div>
        </div>
        <div className="adm-form-grid">
          <FundPicker funds={funds.rows} value={fundId} onChange={setFundId} label="Fund" />
        </div>
      </div>
      {fundId && <FundAumPanel key={fundId} fundId={fundId} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Collective fund growth                                                     */
/* -------------------------------------------------------------------------- */

function CollectiveAumTab() {
  const funds = useAdminFunds();
  const { invalidateAum } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();

  const [selected, setSelected] = useState([]);
  const [mode, setMode] = useState('percentage'); // 'percentage' | 'explicit'
  const [direction, setDirection] = useState('increase');
  const [percent, setPercent] = useState('');
  const [deltas, setDeltas] = useState({}); // fundId -> signed rupees string
  const [asOfDate, setAsOfDate] = useState(today());
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const lockRef = useRef(false);

  const nameById = useMemo(
    () => new Map(funds.rows.map((fund) => [fund.id, fund.name])),
    [funds.rows],
  );

  function toggleFund(id) {
    setPreview(null);
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  const buildBody = useCallback(() => {
    const body = {
      fundIds: selected,
      asOfDate,
      reasonCode: reasonCode.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    if (mode === 'percentage') {
      const value = Number(percent);
      if (!Number.isFinite(value) || value <= 0) {
        return { body: null, problem: 'Enter a non-zero percentage.' };
      }
      const points = Math.round(value * 100);
      body.growthBasisPoints = direction === 'decrease' ? -points : points;
      return { body };
    }
    // Explicit signed delta per selected fund. Each fund grows from its OWN basis.
    const rows = selected.map((fundId) => ({ fundId, value: Number(deltas[fundId]) }));
    if (rows.some((row) => !Number.isFinite(row.value) || row.value === 0)) {
      return { body: null, problem: 'Enter a non-zero amount for every selected fund.' };
    }
    body.items = rows.map((row) => ({
      fundId: row.fundId,
      growthPaise: String(Math.round(row.value * 100)),
    }));
    return { body };
  }, [selected, mode, direction, percent, deltas, asOfDate, reasonCode, note]);

  async function onPreview(event) {
    event.preventDefault();
    setPreview(null);
    setResult(null);
    if (selected.length === 0) {
      setError('Select at least one fund.');
      return;
    }
    if (!asOfDate) {
      setError('Enter the as-of date the figures apply to.');
      return;
    }
    if (!reasonCode.trim()) {
      setError('Enter a reason code. It is recorded on the audit entry.');
      return;
    }
    const { body, problem } = buildBody();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Preview writes nothing and needs no Idempotency-Key.
      const payload = await apiRequest('/v1/admin/aum/growth/collective/preview', {
        method: 'POST',
        scope: 'admin',
        body,
      });
      setPreview({ ...payload, requestBody: body });
    } catch (previewError) {
      setError(previewError?.message || 'The preview was not computed.');
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (lockRef.current || !preview) return;
    lockRef.current = true;
    setBusy(true);
    setError('');
    const body = { ...preview.requestBody, basisHash: preview.basisHash };
    try {
      const payload = await apiRequest('/v1/admin/aum/growth/collective', {
        method: 'POST',
        scope: 'admin',
        body,
        headers: { 'Idempotency-Key': idempotencyKeyFor('aum-collective', body) },
      });
      setResult(payload);
      setPreview(null);
      invalidateAum();
    } catch (commitError) {
      if (commitError?.status === 409) {
        setPreview(null);
        setError('A fund\u2019s AUM changed since this preview. Preview again before committing.');
      } else {
        setError(commitError?.message || 'The collective adjustment was not committed.');
      }
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  const previewItems = preview?.items ?? preview?.targets ?? [];

  return (
    <div className="adm-card">
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card-head">
        <div>
          <h2 className="adm-card-title"><I icon={TrendingUp} size={16} /> Collective fund growth</h2>
          <div className="adm-card-sub">
            Each selected fund grows from its own latest snapshot: one common percentage applied
            independently, or an explicit delta per fund. There is no shared total to distribute.
          </div>
        </div>
      </div>

      <p className="adm-screen-note"><strong>{AUM_BOUNDARY_NOTE}</strong></p>

      <form className="adm-form-grid" onSubmit={onPreview}>
        <fieldset className="adm-field adm-field--wide">
          <legend className="adm-field-label">Funds</legend>
          <div className="adm-chip-row">
            {funds.rows.map((fund) => (
              <label key={fund.id} className="adm-chip">
                <input
                  type="checkbox"
                  checked={selected.includes(fund.id)}
                  onChange={() => toggleFund(fund.id)}
                />
                {' '}{fund.name}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="adm-field">
          <span>Mode</span>
          <select value={mode} onChange={(event) => { setMode(event.target.value); setPreview(null); }}>
            <option value="percentage">Same percentage for each selected fund</option>
            <option value="explicit">Explicit delta per fund</option>
          </select>
        </label>

        {mode === 'percentage' && (
          <>
            <label className="adm-field">
              <span>Direction</span>
              <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                <option value="increase">Increase</option>
                <option value="decrease">Decrease</option>
              </select>
            </label>
            <label className="adm-field">
              <span>Percentage (%)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.0001"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
                placeholder="2.50"
              />
            </label>
          </>
        )}

        {mode === 'explicit' && (
          <div className="adm-field--wide">
            <span className="adm-field-label">Per-fund deltas (₹, negative for a decrease)</span>
            {selected.length === 0 ? (
              <p className="adm-card-sub">Select funds above first.</p>
            ) : (
              selected.map((fundId) => (
                <label className="adm-field" key={fundId}>
                  <span>{nameById.get(fundId) || fundId}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={deltas[fundId] ?? ''}
                    onChange={(event) => setDeltas((prev) => ({ ...prev, [fundId]: event.target.value }))}
                    placeholder="250000 or -100000"
                  />
                </label>
              ))
            )}
          </div>
        )}

        <label className="adm-field">
          <span>As-of date</span>
          <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
        </label>

        <label className="adm-field">
          <span>Reason code</span>
          <input
            type="text"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            placeholder="e.g. monthly_valuation"
          />
        </label>

        <label className="adm-field adm-field--wide">
          <span>Private note (optional)</span>
          <input
            type="text"
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <div className="adm-field--wide adm-form-actions">
          <button type="submit" className="be-btn" disabled={busy || selected.length === 0}>
            {busy ? 'Working…' : 'Preview growth'}
          </button>
        </div>
      </form>

      {preview && (
        <div className="adm-card adm-card--nested">
          <p className="adm-card-sub">Nothing has been committed yet.</p>
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Fund</th>
                  <th scope="col" className="be-money">Before</th>
                  <th scope="col" className="be-money">Delta</th>
                  <th scope="col" className="be-money">After</th>
                </tr>
              </thead>
              <tbody>
                {previewItems.map((item) => (
                  <tr key={item.fundId}>
                    <td>{item.fundName || nameById.get(item.fundId) || item.fundId}</td>
                    <td className="be-money">{fmtPaise(item.beforePaise ?? item.currentAumPaise)}</td>
                    <td className="be-money">{fmtPaiseSigned(item.deltaPaise ?? item.growthPaise)}</td>
                    <td className="be-money">{fmtPaise(item.afterPaise ?? item.newAumPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="adm-field--wide adm-form-actions">
            <button type="button" className="be-btn" onClick={() => setPreview(null)}>
              Discard
            </button>
            <button type="button" className="be-btn be-btn-primary" onClick={onCommit} disabled={busy}>
              {busy ? 'Committing…' : 'Commit growth'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className="adm-gain-result" role="status">
          Committed
          {result.targetCount != null && <> across {fmtInt(result.targetCount)} funds</>}
          .
        </p>
      )}
      {error && <p className="be-error" role="alert">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* History and corrections                                                    */
/* -------------------------------------------------------------------------- */

function HistoryTab() {
  const funds = useAdminFunds();
  const [fundId, setFundId] = useState('');
  return (
    <>
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2 className="adm-card-title"><I icon={Layers} size={16} /> History and corrections</h2>
            <div className="adm-card-sub">
              Every published snapshot, newest first. A correction writes a new revision for the
              same fund and date; the earlier snapshot is preserved.
            </div>
          </div>
        </div>
        <div className="adm-form-grid">
          <FundPicker funds={funds.rows} value={fundId} onChange={setFundId} label="Fund" />
        </div>
      </div>
      {fundId && <FundAumHistoryPanel key={fundId} fundId={fundId} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

export default function AumScreen({ tab = 'current' }) {
  const active = TABS.some((item) => item.id === tab) ? tab : 'current';
  return (
    <div className="adm-screen">
      <div className="adm-chip-row" role="group" aria-label="AUM sections">
        {TABS.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            className={`adm-chip ${active === item.id ? 'is-active' : ''}`}
            aria-current={active === item.id ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {active === 'current' && <CurrentAumTab />}
      {active === 'manage' && <ManageOneFundTab />}
      {active === 'collective' && <CollectiveAumTab />}
      {active === 'history' && <HistoryTab />}
    </div>
  );
}

export { CurrentAumTab, ManageOneFundTab, CollectiveAumTab, HistoryTab };
