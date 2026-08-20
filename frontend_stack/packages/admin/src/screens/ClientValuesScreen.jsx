import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, TrendingUp } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import AdminReadError from '../data/AdminReadError.jsx';
import { useAdminCacheActions, useAdminFunds } from '../data/adminResources.js';
import useAdminList from '../hooks/useAdminList.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { fmtDateTime, fmtInt, fmtPaise, fmtPaiseSigned } from '../helpers/formatters.js';
import './admin-screens-shared.css';

/*
 * Client value management (spec §8.1, §8.2, §9.4, §11.1).
 *
 * This area adjusts CLIENT DISPLAYED VALUES ONLY. It never reads or writes fund
 * AUM, and the commit endpoints it calls are not allowed to. The banner stating
 * that boundary is part of the contract, not decoration.
 *
 *   POST /v1/admin/client-growth/individual
 *   POST /v1/admin/client-growth/collective/preview   (no Idempotency-Key)
 *   POST /v1/admin/client-growth/collective           (basisHash + Idempotency-Key)
 *
 * Collective growth is either one signed percentage applied independently to each
 * eligible client in ONE fund, or an explicit signed amount per client. There is
 * deliberately no "distribute one total" mode — that mechanism was retired.
 */

const VALUE_BOUNDARY_NOTE =
  'This changes client displayed values only. It does not change published AUM.';

const TABS = [
  { id: 'detail', label: 'Client detail', path: '/admin/client-values/detail' },
  { id: 'individual', label: 'Individual growth', path: '/admin/client-values/individual' },
  { id: 'collective', label: 'Collective growth by fund', path: '/admin/client-values/collective' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Rupees the operator typed -> signed integer paise string for the wire. */
function toSignedPaise(direction, rupees) {
  const value = Number(rupees);
  if (!Number.isFinite(value) || value <= 0) return null;
  const magnitude = Math.round(value * 100);
  return String(direction === 'loss' ? -magnitude : magnitude);
}

/** Percent the operator typed -> signed integer basis points. */
function toSignedBasisPoints(direction, percent) {
  const value = Number(percent);
  if (!Number.isFinite(value) || value <= 0) return null;
  const points = Math.round(value * 100);
  return direction === 'loss' ? -points : points;
}

// The preview mirror of the server rule (spec §8.1). Non-authoritative: the commit
// recalculates from the current server basis and its response is the truth.
function previewDelta(currentValuePaise, mode, signedInput) {
  if (mode === 'amount') return Number(signedInput);
  const magnitude = Math.floor((Math.abs(Number(currentValuePaise) * signedInput) + 5000) / 10000);
  return Math.sign(signedInput) * magnitude;
}

function BoundaryNote() {
  return <p className="adm-screen-note"><strong>{VALUE_BOUNDARY_NOTE}</strong></p>;
}

/* -------------------------------------------------------------------------- */
/* Client detail                                                              */
/* -------------------------------------------------------------------------- */

function ClientDetailTab() {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { items: users, loading, error, reload } = useAdminList(
    '/v1/admin/users',
    { q: search },
    { limit: 25 },
  );

  return (
    <div className="adm-card adm-table">
      <div className="adm-card-head">
        <div>
          <span className="be-eyebrow">Client values</span>
          <h2 className="adm-card-title">Client detail</h2>
        </div>
        <div className="adm-payment-count">{fmtInt(users.length)} shown</div>
      </div>

      <p className="adm-screen-note">
        Find a client to inspect their contribution, current admin-adjusted value and growth
        history. Growth adjustments are made under Individual or Collective growth.
      </p>

      {error && (
        <div className="ash-load-note" role="alert">
          <span>{error}</span>
          <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" disabled={loading} onClick={reload}>
            {loading ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}

      <div className="adm-payment-filters">
        <label className="adm-search adm-search--grow">
          <I icon={Search} size={14} />
          <span className="adm-sr-only">Search clients</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or email"
          />
        </label>
      </div>

      <div className="adm-table-scroll">
        <table className="adm-table-cards">
          <thead>
            <tr>
              <th>Client</th><th className="adm-col-status">Account</th><th>Joined</th>
              <th className="adm-col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 && (
              <>
                <SkeletonTableRow columnCount={4} />
                <SkeletonTableRow columnCount={4} />
                <SkeletonTableRow columnCount={4} />
              </>
            )}
            {!loading && !error && users.length === 0 && (
              <EmptyTableRow colSpan={4}>No clients match this search.</EmptyTableRow>
            )}
            {users.map((user) => (
              <tr key={user.id}>
                <td data-label="Client">
                  <div className="adm-user-info">
                    <span className="adm-user-name">{user.name || 'Client'}</span>
                    {user.email && <span className="adm-cell-meta">{user.email}</span>}
                  </div>
                </td>
                <td className="adm-col-status" data-label="Account"><StateBadge state={user.status} /></td>
                <td className="be-num adm-cell-meta" data-label="Joined">{fmtDateTime(user.createdAt)}</td>
                <td className="adm-col-actions adm-payment-actions" data-label="">
                  <Link
                    className="be-btn be-btn-ghost be-btn-sm"
                    to={`/admin/users/directory/${encodeURIComponent(user.id)}`}
                  >
                    Open record
                  </Link>
                  <Link
                    className="be-btn be-btn-secondary be-btn-sm"
                    to={`/admin/client-values/individual?userId=${encodeURIComponent(user.id)}`}
                  >
                    Adjust growth
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Individual growth                                                          */
/* -------------------------------------------------------------------------- */

function IndividualGrowthTab() {
  const [params] = useSearchParams();
  const funds = useAdminFunds();
  const { invalidateClientGrowth } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();

  const [userId, setUserId] = useState(params.get('userId') || '');
  const [fundId, setFundId] = useState('');
  const [mode, setMode] = useState('amount'); // 'amount' | 'percentage'
  const [direction, setDirection] = useState('growth'); // 'growth' | 'loss'
  const [magnitude, setMagnitude] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [position, setPosition] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const lockRef = useRef(false);

  // The local preview needs the position's current value. Read it once both
  // identifiers are set; the commit never trusts this figure.
  useEffect(() => {
    if (!userId.trim() || !fundId) {
      setPosition(null);
      return undefined;
    }
    let cancelled = false;
    apiRequest(`/v1/admin/users/${encodeURIComponent(userId.trim())}/detail`, { scope: 'admin' })
      .then((detail) => {
        if (cancelled) return;
        const found = (detail?.positions || []).find((candidate) => candidate.fundId === fundId);
        setPosition(found || null);
      })
      .catch(() => { if (!cancelled) setPosition(null); });
    return () => { cancelled = true; };
  }, [userId, fundId]);

  const preview = useMemo(() => {
    if (!position) return null;
    const signed = mode === 'amount'
      ? Number(toSignedPaise(direction, magnitude))
      : toSignedBasisPoints(direction, magnitude);
    if (!Number.isFinite(signed) || signed === null || signed === 0) return null;
    const delta = previewDelta(position.currentValuePaise ?? 0, mode, signed);
    return {
      before: Number(position.currentValuePaise ?? 0),
      delta,
      after: Number(position.currentValuePaise ?? 0) + delta,
    };
  }, [position, mode, direction, magnitude]);

  async function onSubmit(event) {
    event.preventDefault();
    if (lockRef.current) return;
    setError('');
    setResult(null);

    const body = {
      userId: userId.trim(),
      fundId,
      effectiveDate,
      reasonCode: reasonCode.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    // Exactly one instruction, signed; a loss is negative.
    const instruction = mode === 'amount'
      ? { growthPaise: toSignedPaise(direction, magnitude) }
      : { growthBasisPoints: toSignedBasisPoints(direction, magnitude) };
    let problem = '';
    if (!body.userId) problem = 'Enter the client user ID.';
    else if (!fundId) problem = 'Choose the fund the position belongs to.';
    else if (!Object.values(instruction)[0]) problem = 'Enter a non-zero amount or percentage.';
    else if (!body.reasonCode) problem = 'Enter a reason code. It is recorded on the audit entry.';
    if (problem) {
      setError(problem);
      return;
    }
    Object.assign(body, instruction);

    lockRef.current = true;
    setBusy(true);
    try {
      const payload = await apiRequest('/v1/admin/client-growth/individual', {
        method: 'POST',
        scope: 'admin',
        body,
        headers: { 'Idempotency-Key': idempotencyKeyFor('individual', body) },
      });
      // The commit response is authoritative; the local preview never was.
      setResult(payload);
      setMagnitude('');
      setNote('');
      invalidateClientGrowth();
    } catch (submitError) {
      setError(
        submitError?.status === 409
          ? 'This position changed while you were working. Reload it and try again.'
          : submitError?.message || 'The growth adjustment was not accepted.',
      );
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="adm-card">
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card-head">
        <div>
          <h2 className="adm-card-title"><I icon={TrendingUp} size={16} /> Individual growth</h2>
          <div className="adm-card-sub">
            Adjust one client&apos;s value in one fund. Their total investment (principal) is
            unchanged.
          </div>
        </div>
      </div>

      <BoundaryNote />

      <form className="adm-form-grid" onSubmit={onSubmit}>
        <label className="adm-field">
          <span>Client user ID</span>
          <input
            type="text"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="Pick a client under Client detail"
          />
        </label>

        <label className="adm-field">
          <span>Fund</span>
          <select value={fundId} onChange={(event) => setFundId(event.target.value)}>
            <option value="">Choose a fund</option>
            {funds.rows.map((fund) => (
              <option key={fund.id} value={fund.id}>{fund.name}</option>
            ))}
          </select>
        </label>

        <label className="adm-field">
          <span>Instruction</span>
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="amount">Amount (₹)</option>
            <option value="percentage">Percentage of current value</option>
          </select>
        </label>

        <label className="adm-field">
          <span>Direction</span>
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="growth">Growth (credit)</option>
            <option value="loss">Loss (debit)</option>
          </select>
        </label>

        <label className="adm-field">
          <span>{mode === 'amount' ? 'Amount (₹)' : 'Percentage (%)'}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step={mode === 'amount' ? '0.01' : '0.0001'}
            value={magnitude}
            onChange={(event) => setMagnitude(event.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>Effective date</span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>Reason code</span>
          <input
            type="text"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            placeholder="e.g. monthly_growth"
          />
        </label>

        <label className="adm-field adm-field--wide">
          <span>Private note (optional)</span>
          <input
            type="text"
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Admin-only; never shown to the client"
          />
        </label>

        {preview && (
          <div className="adm-field--wide adm-aum-projection">
            Preview only — the server recalculates on commit: current{' '}
            <strong className="be-money">{fmtPaise(String(preview.before))}</strong>, delta{' '}
            <strong className="be-money">{fmtPaiseSigned(String(preview.delta))}</strong>, after{' '}
            <strong className="be-money">{fmtPaise(String(preview.after))}</strong>.
          </div>
        )}

        {error && (
          <div className="be-error adm-field--wide" role="alert">{error}</div>
        )}

        {result && (
          <div className="adm-gain-result adm-field--wide" role="status">
            Adjustment committed.
            {(result.currentValuePaise ?? result?.position?.currentValuePaise) != null && (
              <>
                {' '}Current value is now{' '}
                <strong className="be-money">
                  {fmtPaise(result.currentValuePaise ?? result.position.currentValuePaise)}
                </strong>
              </>
            )}
            .
          </div>
        )}

        <div className="adm-field--wide">
          <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
            {busy ? 'Committing…' : 'Commit growth adjustment'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Collective growth by fund                                                  */
/* -------------------------------------------------------------------------- */

function CollectiveGrowthTab() {
  const funds = useAdminFunds();
  const { invalidateClientGrowth } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();

  const [fundId, setFundId] = useState('');
  const [mode, setMode] = useState('percentage'); // 'percentage' | 'explicit'
  const [direction, setDirection] = useState('growth');
  const [percent, setPercent] = useState('');
  const [items, setItems] = useState([{ userId: '', amount: '' }]);
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const lockRef = useRef(false);

  const buildBody = useCallback(() => {
    const body = {
      fundId,
      effectiveDate,
      reasonCode: reasonCode.trim(),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    if (mode === 'percentage') {
      const points = toSignedBasisPoints(direction, percent);
      if (!points) return { body: null, problem: 'Enter a non-zero percentage.' };
      body.growthBasisPoints = points;
      return { body };
    }
    const rows = items
      .map((item) => ({ userId: item.userId.trim(), amount: Number(item.amount) }))
      .filter((item) => item.userId || item.amount);
    if (rows.length === 0) return { body: null, problem: 'Add at least one client and amount.' };
    if (rows.some((item) => !item.userId || !Number.isFinite(item.amount) || item.amount === 0)) {
      return { body: null, problem: 'Every row needs a client user ID and a non-zero amount.' };
    }
    // Explicit signed deltas, one per client. Never a shared total to distribute.
    body.items = rows.map((item) => ({ userId: item.userId, growthPaise: String(Math.round(item.amount * 100)) }));
    return { body };
  }, [fundId, mode, direction, percent, items, effectiveDate, reasonCode, note]);

  async function onPreview(event) {
    event.preventDefault();
    const { body, problem } = buildBody();
    setPreview(null);
    setResult(null);
    if (!fundId) {
      setError('Choose the fund whose clients should be adjusted.');
      return;
    }
    if (!body.reasonCode) {
      setError('Enter a reason code. It is recorded on the audit entry.');
      return;
    }
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Preview writes nothing and needs no Idempotency-Key.
      const payload = await apiRequest('/v1/admin/client-growth/collective/preview', {
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
      const payload = await apiRequest('/v1/admin/client-growth/collective', {
        method: 'POST',
        scope: 'admin',
        body,
        headers: { 'Idempotency-Key': idempotencyKeyFor('collective', body) },
      });
      setResult(payload);
      setPreview(null);
      invalidateClientGrowth();
    } catch (commitError) {
      if (commitError?.status === 409) {
        // Stale basisHash: the positions moved since the preview. Discard it —
        // the operator must preview again rather than commit against old figures.
        setPreview(null);
        setError('Client values changed since this preview. Preview again before committing.');
      } else {
        setError(commitError?.message || 'The collective adjustment was not committed.');
      }
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  const previewTargets = preview?.targets ?? preview?.items ?? [];

  return (
    <div className="adm-card">
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card-head">
        <div>
          <h2 className="adm-card-title"><I icon={TrendingUp} size={16} /> Collective growth by fund</h2>
          <div className="adm-card-sub">
            One fund at a time. Either the same percentage applied independently to every eligible
            client, or an explicit amount per client — never one shared total split across clients.
          </div>
        </div>
      </div>

      <BoundaryNote />

      <form className="adm-form-grid" onSubmit={onPreview}>
        <label className="adm-field">
          <span>Fund</span>
          <select value={fundId} onChange={(event) => { setFundId(event.target.value); setPreview(null); }}>
            <option value="">Choose a fund</option>
            {funds.rows.map((fund) => (
              <option key={fund.id} value={fund.id}>{fund.name}</option>
            ))}
          </select>
        </label>

        <label className="adm-field">
          <span>Mode</span>
          <select value={mode} onChange={(event) => { setMode(event.target.value); setPreview(null); }}>
            <option value="percentage">Same percentage for every eligible client</option>
            <option value="explicit">Explicit amount per client</option>
          </select>
        </label>

        {mode === 'percentage' && (
          <>
            <label className="adm-field">
              <span>Direction</span>
              <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                <option value="growth">Growth</option>
                <option value="loss">Loss</option>
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
                placeholder="3.50"
              />
            </label>
          </>
        )}

        <label className="adm-field">
          <span>Effective date</span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>Reason code</span>
          <input
            type="text"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            placeholder="e.g. monthly_growth"
          />
        </label>

        <label className="adm-field adm-field--wide">
          <span>Private note (optional)</span>
          <input
            type="text"
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Admin-only; never shown to clients"
          />
        </label>

        {mode === 'explicit' && (
          <div className="adm-field--wide">
            <span className="adm-field-label">Per-client amounts (₹, negative for a loss)</span>
            {items.map((item, index) => (
              <div className="adm-toolbar adm-toolbar--gap-2" key={index}>
                <input
                  type="text"
                  aria-label={`Client user ID ${index + 1}`}
                  value={item.userId}
                  onChange={(event) => setItems((prev) => prev.map((row, i) => (
                    i === index ? { ...row, userId: event.target.value } : row
                  )))}
                  placeholder="user id"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  aria-label={`Amount ${index + 1}`}
                  value={item.amount}
                  onChange={(event) => setItems((prev) => prev.map((row, i) => (
                    i === index ? { ...row, amount: event.target.value } : row
                  )))}
                  placeholder="1500 or -800"
                />
                <button
                  type="button"
                  className="be-btn be-btn-ghost be-btn-sm"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  disabled={items.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="adm-toolbar adm-toolbar--gap-2 adm-m-t-2">
              <button
                type="button"
                className="be-btn be-btn-secondary be-btn-sm"
                onClick={() => setItems((prev) => [...prev, { userId: '', amount: '' }])}
              >
                Add client
              </button>
            </div>
          </div>
        )}

        <div className="adm-field--wide adm-form-actions">
          <button type="submit" className="be-btn" disabled={busy}>
            {busy ? 'Working…' : 'Preview adjustment'}
          </button>
        </div>
      </form>

      {preview && (
        <div className="adm-card adm-card--nested">
          <p className="adm-card-sub">
            Nothing has been committed yet.
            {preview.excludedCount != null && preview.excludedCount > 0 && (
              <> {fmtInt(preview.excludedCount)} zero-value or ineligible positions are excluded.</>
            )}
          </p>
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col" className="be-money">Before</th>
                  <th scope="col" className="be-money">Delta</th>
                  <th scope="col" className="be-money">After</th>
                </tr>
              </thead>
              <tbody>
                {previewTargets.map((target) => (
                  <tr key={target.userId}>
                    <td>{target.name || target.userId}</td>
                    <td className="be-money">
                      {fmtPaise(target.beforePaise ?? target.currentValuePaise)}
                    </td>
                    <td className="be-money">
                      {fmtPaiseSigned(target.deltaPaise ?? target.growthPaise)}
                    </td>
                    <td className="be-money">
                      {fmtPaise(target.afterPaise ?? target.newValuePaise)}
                    </td>
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
              {busy ? 'Committing…' : 'Commit adjustment'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className="adm-gain-result" role="status">
          Committed
          {result.targetCount != null && <> across {fmtInt(result.targetCount)} positions</>}
          {result.totalDeltaPaise != null && (
            <> for a total of <strong className="be-money">{fmtPaiseSigned(result.totalDeltaPaise)}</strong></>
          )}
          .
        </p>
      )}
      {error && <p className="be-error" role="alert">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function ClientValuesScreen({ tab = 'detail' }) {
  const active = TABS.some((item) => item.id === tab) ? tab : 'detail';
  return (
    <div className="adm-screen">
      <div className="adm-chip-row" role="group" aria-label="Client value sections">
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

      {active === 'detail' && <ClientDetailTab />}
      {active === 'individual' && <IndividualGrowthTab />}
      {active === 'collective' && <CollectiveGrowthTab />}
    </div>
  );
}

export { ClientDetailTab, IndividualGrowthTab, CollectiveGrowthTab, VALUE_BOUNDARY_NOTE };
