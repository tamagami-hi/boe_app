import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layers, PieChart, TrendingUp } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import { Page } from '../layout/primitives/index.js';
import EmptyTableRow from '../components/EmptyTableRow.jsx';
import SkeletonTableRow from '../components/SkeletonTableRow.jsx';
import StateBadge from '../components/StateBadge.jsx';
import AdminReadError from '../data/AdminReadError.jsx';
import { useAdminCacheActions, useAdminFunds } from '../data/adminResources.js';
import { parseAumPreview } from '../data/fundContracts.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { AUM_ADJUSTMENT_REASONS, todayInIndia } from '../helpers/aumReasons.js';
import {
  MAX_GROWTH_PERCENT,
  signedPaiseFromInput,
  toSignedBasisPoints,
} from '../helpers/signedAmounts.js';
import { fmtInt, fmtPaise, fmtPaiseSigned } from '../helpers/formatters.js';
import FundAumPanel, { AUM_BOUNDARY_NOTE } from './FundAumPanel.jsx';
import FundAumHistoryPanel from './FundAumHistoryPanel.jsx';
import './admin-screens-shared.css';

function eligibleFunds(rows) {
  return rows.filter((fund) => fund.status !== 'archived');
}

function LoadMoreFunds({ funds }) {
  if (!funds.hasMore) return null;
  return (
    <div className="adm-picker-more">
      <span className="adm-cell-meta">
        Showing the {fmtInt(funds.rows.length)} most recent funds.
      </span>
      <button
        type="button"
        className="be-btn be-btn-secondary be-btn-sm"
        onClick={() => funds.loadMore()}
        disabled={funds.loadingMore}
      >
        {funds.loadingMore ? 'Loading…' : 'Load more funds'}
      </button>
    </div>
  );
}

function FundPicker({ funds, value, onChange, label }) {
  const rows = eligibleFunds(funds.rows);
  return (
    <>
      <div className="adm-form-grid">
        <label className="adm-field">
          <span className="adm-field-label">{label}</span>
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">Choose a fund</option>
            {rows.map((fund) => (
              <option key={fund.id} value={fund.id}>{fund.name}</option>
            ))}
          </select>
        </label>
      </div>
      {!funds.isLoading && rows.length === 0 && (
        <p className="adm-screen-note">
          No fund can take an AUM publication yet. Create a fund under Funds, or un-archive one.
        </p>
      )}
      <LoadMoreFunds funds={funds} />
    </>
  );
}

function CurrentAumTab() {
  const funds = useAdminFunds();
  const rows = funds.rows;
  return (
    <>
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <div>
            <span className="be-eyebrow">AUM</span>
            <h2 className="adm-card-title">Current published AUM</h2>
            <div className="adm-card-sub">
              The latest absolute AUM published for each fund, with the date it is effective as of.
              Clients see this figure only for funds that are published to them.
            </div>
          </div>
          <div className="adm-payment-count">
            {funds.summary ? `${fmtInt(funds.summary.total)} funds` : ''}
          </div>
        </div>
        <div className="adm-table-scroll">
          <table className="adm-table-cards">
            <thead>
              <tr>
                <th scope="col">Fund</th>
                <th scope="col" className="adm-col-status">State</th>
                <th scope="col">Published AUM</th>
                <th scope="col">As of</th>
                <th scope="col" className="adm-col-actions"><span className="adm-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {funds.isLoading && rows.length === 0 && (
                <>
                  <SkeletonTableRow columnCount={5} />
                  <SkeletonTableRow columnCount={5} />
                  <SkeletonTableRow columnCount={5} />
                </>
              )}
              {!funds.isLoading && rows.length === 0 && (
                <EmptyTableRow colSpan={5}>
                  No funds exist yet. Create one under Funds; its opening AUM is published with it.
                </EmptyTableRow>
              )}
              {rows.map((fund) => (
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
                      Open fund<span className="adm-sr-only"> {fund.name}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {funds.hasMore && (
          <div className="adm-table-foot">
            <span className="adm-cell-meta">
              Showing {fmtInt(rows.length)}
              {funds.summary ? ` of ${fmtInt(funds.summary.total)}` : ''} funds.
            </span>
            <button
              type="button"
              className="be-btn be-btn-secondary be-btn-sm"
              onClick={() => funds.loadMore()}
              disabled={funds.loadingMore}
            >
              {funds.loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function useFundSelection() {
  const [params, setParams] = useSearchParams();
  const fundId = params.get('fund') ?? '';
  const setFundId = useCallback((next) => {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set('fund', next);
    else nextParams.delete('fund');
    setParams(nextParams, { replace: true });
  }, [params, setParams]);
  return [fundId, setFundId];
}

function ManageOneFundTab() {
  const funds = useAdminFunds();
  const [fundId, setFundId] = useFundSelection();
  const selected = funds.rows.find((fund) => fund.id === fundId) ?? null;
  return (
    <>
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2 className="adm-card-title"><I icon={PieChart} size={16} /> Adjust one fund</h2>
            <div className="adm-card-sub">
              A growth command calculates a new absolute snapshot from the fund&rsquo;s latest one.
              A fund&rsquo;s first figure is published when the fund is created.
            </div>
          </div>
        </div>
        <FundPicker funds={funds} value={fundId} onChange={setFundId} label="Fund" />
      </div>
      {fundId && <FundAumPanel key={fundId} fundId={fundId} fundName={selected?.name} />}
    </>
  );
}

function CollectiveAumTab() {
  const funds = useAdminFunds();
  const { invalidateAum } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();

  const [selected, setSelected] = useState([]);
  const [mode, setMode] = useState('percentage');
  const [direction, setDirection] = useState('increase');
  const [percent, setPercent] = useState('');
  const [deltas, setDeltas] = useState({});
  const [asOfDate, setAsOfDate] = useState(todayInIndia());
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const lockRef = useRef(false);

  const rows = eligibleFunds(funds.rows);
  const nameById = useMemo(
    () => new Map(funds.rows.map((fund) => [fund.id, fund.name])),
    [funds.rows],
  );

  const discardPreview = useCallback(() => {
    setPreview(null);
    setResult(null);
  }, []);

  const change = (setter) => (value) => {
    discardPreview();
    setter(value);
  };

  function toggleFund(id) {
    discardPreview();
    setSelected((previous) => (
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
    ));
  }

  const buildBody = useCallback(() => {
    const trimmedNote = note.trim();
    const common = {
      asOfDate,
      reasonCode,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    };
    if (mode === 'percentage') {
      const points = toSignedBasisPoints(direction, percent);
      if (points === null) {
        return {
          body: null,
          problem: `Enter a percentage above zero and no more than ${MAX_GROWTH_PERCENT}%. Very small values round to zero.`,
        };
      }
      return { body: { ...common, fundIds: selected, growthBasisPoints: points } };
    }
    const entries = selected.map((fundId) => ({
      fundId,
      growthPaise: signedPaiseFromInput(deltas[fundId]),
    }));
    if (entries.some((entry) => entry.growthPaise === null)) {
      return {
        body: null,
        problem: 'Enter a non-zero rupee amount for every selected fund.',
      };
    }
    return { body: { ...common, items: entries } };
  }, [asOfDate, deltas, direction, mode, note, percent, reasonCode, selected]);

  async function onPreview(event) {
    event.preventDefault();
    setPreview(null);
    setResult(null);
    if (selected.length === 0) {
      setError('Select at least one fund.');
      return;
    }
    if (!asOfDate) {
      setError('Choose the as-of date the figures apply to.');
      return;
    }
    if (!AUM_ADJUSTMENT_REASONS.some((reason) => reason.value === reasonCode)) {
      setError('Choose a reason. It is recorded on the audit entry.');
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
      const payload = await apiRequest('/v1/admin/aum/growth/collective/preview', {
        method: 'POST',
        scope: 'admin',
        body,
      });
      setPreview({ ...parseAumPreview(payload), requestBody: body });
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

  const previewItems = preview?.items ?? [];

  return (
    <>
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2 className="adm-card-title"><I icon={TrendingUp} size={16} /> Collective fund growth</h2>
            <div className="adm-card-sub">
              Each selected fund grows from its own latest snapshot: one common percentage applied
              independently, or an explicit amount per fund. There is no shared total to distribute.
            </div>
          </div>
        </div>

        <p className="adm-screen-note"><strong>{AUM_BOUNDARY_NOTE}</strong></p>

        <form className="adm-form-grid" onSubmit={onPreview}>
          <fieldset className="adm-fieldset adm-field--wide">
            <legend className="adm-fieldset-legend">Funds</legend>
            {!funds.isLoading && rows.length === 0 ? (
              <p className="adm-screen-note">No fund can take an AUM publication yet.</p>
            ) : (
              <div className="adm-check-row">
                {rows.map((fund) => (
                  <label key={fund.id} className={`adm-check-chip ${selected.includes(fund.id) ? 'is-active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(fund.id)}
                      onChange={() => toggleFund(fund.id)}
                    />
                    <span>{fund.name}</span>
                  </label>
                ))}
              </div>
            )}
            <LoadMoreFunds funds={funds} />
          </fieldset>

          <label className="adm-field">
            <span className="adm-field-label">Mode</span>
            <select value={mode} onChange={(event) => change(setMode)(event.target.value)}>
              <option value="percentage">Same percentage for each selected fund</option>
              <option value="explicit">Explicit amount per fund</option>
            </select>
          </label>

          {mode === 'percentage' && (
            <>
              <label className="adm-field">
                <span className="adm-field-label">Direction</span>
                <select value={direction} onChange={(event) => change(setDirection)(event.target.value)}>
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
                </select>
              </label>
              <label className="adm-field">
                <span className="adm-field-label">Percentage (%)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={MAX_GROWTH_PERCENT}
                  step="0.0001"
                  value={percent}
                  onChange={(event) => change(setPercent)(event.target.value)}
                  placeholder="2.50"
                />
              </label>
            </>
          )}

          {mode === 'explicit' && (
            <fieldset className="adm-fieldset adm-field--wide">
              <legend className="adm-fieldset-legend">
                Amount per fund (₹, negative for a decrease)
              </legend>
              {selected.length === 0 ? (
                <p className="adm-screen-note">Select funds above first.</p>
              ) : (
                <div className="adm-form-grid">
                  {selected.map((fundId) => (
                    <label className="adm-field" key={fundId}>
                      <span className="adm-field-label">{nameById.get(fundId) || fundId}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={deltas[fundId] ?? ''}
                        onChange={(event) => {
                          discardPreview();
                          setDeltas((previous) => ({ ...previous, [fundId]: event.target.value }));
                        }}
                        placeholder="250000 or -100000"
                      />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          <label className="adm-field">
            <span className="adm-field-label">As-of date</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(event) => change(setAsOfDate)(event.target.value)}
            />
          </label>

          <label className="adm-field">
            <span className="adm-field-label">Reason</span>
            <select value={reasonCode} onChange={(event) => change(setReasonCode)(event.target.value)}>
              <option value="">Choose a reason</option>
              {AUM_ADJUSTMENT_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
          </label>

          <label className="adm-field adm-field--wide">
            <span className="adm-field-label">Internal note (optional)</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(event) => change(setNote)(event.target.value)}
            />
          </label>

          <div className="adm-field--wide adm-form-actions adm-form-actions--start">
            <button type="submit" className="be-btn be-btn-primary" disabled={busy || selected.length === 0}>
              {busy ? 'Working…' : 'Preview growth'}
            </button>
          </div>
        </form>

        {result && (
          <p className="adm-gain-result" role="status">
            Committed
            {result.targetCount != null && <> across {fmtInt(result.targetCount)} funds</>}
            .
          </p>
        )}
        {error && <p className="be-error" role="alert">{error}</p>}
      </div>

      {preview && (
        <div className="adm-card adm-table">
          <div className="adm-card-head">
            <div>
              <h3 className="adm-card-title">Preview</h3>
              <div className="adm-card-sub">
                Nothing has been committed yet. Committing re-reads every fund under lock and
                rejects the command if any figure moved since this preview.
              </div>
            </div>
          </div>
          <div className="adm-table-scroll">
            <table className="adm-table-cards">
              <thead>
                <tr>
                  <th scope="col">Fund</th>
                  <th scope="col">Before</th>
                  <th scope="col">Change</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {previewItems.map((item) => (
                  <tr key={item.fundId}>
                    <td data-label="Fund">{nameById.get(item.fundId) || item.fundId}</td>
                    <td className="be-money" data-label="Before">{fmtPaise(item.beforeAumPaise)}</td>
                    <td className="be-money" data-label="Change">{fmtPaiseSigned(item.deltaPaise)}</td>
                    <td className="be-money" data-label="After">{fmtPaise(item.afterAumPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="adm-table-foot">
            <button type="button" className="be-btn be-btn-secondary" onClick={discardPreview}>
              Discard
            </button>
            <button type="button" className="be-btn be-btn-primary" onClick={onCommit} disabled={busy}>
              {busy ? 'Committing…' : 'Commit growth'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function HistoryTab() {
  const funds = useAdminFunds();
  const [fundId, setFundId] = useFundSelection();
  const selected = funds.rows.find((fund) => fund.id === fundId) ?? null;
  return (
    <>
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <div className="adm-card">
        <div className="adm-card-head">
          <div>
            <h2 className="adm-card-title"><I icon={Layers} size={16} /> History and corrections</h2>
            <div className="adm-card-sub">
              Every published snapshot for one fund, newest first. A correction writes a new
              revision for the same date; the earlier snapshot is preserved.
            </div>
          </div>
        </div>
        <FundPicker funds={funds} value={fundId} onChange={setFundId} label="Fund" />
      </div>
      {fundId && <FundAumHistoryPanel key={fundId} fundId={fundId} fundName={selected?.name} />}
    </>
  );
}

export default function AumScreen({ tab = 'current' }) {
  return (
    <Page>
      {tab === 'manage' && <ManageOneFundTab />}
      {tab === 'collective' && <CollectiveAumTab />}
      {tab === 'history' && <HistoryTab />}
      {tab !== 'manage' && tab !== 'collective' && tab !== 'history' && <CurrentAumTab />}
    </Page>
  );
}

export { CurrentAumTab, ManageOneFundTab, CollectiveAumTab, HistoryTab };
