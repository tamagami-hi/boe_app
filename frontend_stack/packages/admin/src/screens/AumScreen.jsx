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
import { parseAumPreview, parseCollectiveCommit } from '../data/fundContracts.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { AUM_ADJUSTMENT_REASONS, todayInIndia } from '../helpers/aumReasons.js';
import {
  MAX_GROWTH_PERCENT,
  parseSignedBasisPoints,
  parseSignedPaiseFromInput,
} from '../helpers/signedAmounts.js';
import FormField from '../components/FormField.jsx';
import { fmtInt, fmtPaise, fmtPaiseSigned } from '../helpers/formatters.js';
import FundAumPanel, { AUM_BOUNDARY_NOTE } from './FundAumPanel.jsx';
import FundAumHistoryPanel from './FundAumHistoryPanel.jsx';
import './admin-screens-shared.css';
import './admin-aum.css';

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
          No fund can take an AUM publication yet. Create one under Funds — its opening AUM is
          published with it. Archived funds are excluded permanently.
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
  const [errors, setErrors] = useState({});
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

  const clearError = (key) => setErrors(
    (previous) => (previous[key] ? { ...previous, [key]: undefined } : previous),
  );

  const change = (setter, key) => (value) => {
    discardPreview();
    if (key) clearError(key);
    setter(value);
  };

  function toggleFund(id) {
    discardPreview();
    clearError('funds');
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
      const parsed = parseSignedBasisPoints(direction, percent);
      if (!parsed.ok) return { body: null, fieldErrors: { percent: parsed.problem } };
      return { body: { ...common, fundIds: selected, growthBasisPoints: parsed.value } };
    }
    const fieldErrors = {};
    const entries = [];
    for (const fundId of selected) {
      const parsed = parseSignedPaiseFromInput(deltas[fundId]);
      if (parsed.ok) entries.push({ fundId, growthPaise: parsed.value });
      else fieldErrors[`delta:${fundId}`] = parsed.problem;
    }
    if (Object.keys(fieldErrors).length > 0) return { body: null, fieldErrors };
    return { body: { ...common, items: entries } };
  }, [asOfDate, deltas, direction, mode, note, percent, reasonCode, selected]);

  async function onPreview(event) {
    event.preventDefault();
    setPreview(null);
    setResult(null);
    const found = {};
    if (selected.length === 0) found.funds = 'Select at least one fund.';
    if (!asOfDate) found.asOfDate = 'Choose the as-of date the figures apply to.';
    if (!AUM_ADJUSTMENT_REASONS.some((reason) => reason.value === reasonCode)) {
      found.reasonCode = 'Choose a reason. It is recorded on the audit entry.';
    }
    const { body, fieldErrors } = buildBody();
    Object.assign(found, fieldErrors ?? {});
    setErrors(found);
    if (Object.keys(found).length > 0 || body === null) {
      setError('Some details need attention before this can be previewed.');
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
      setResult(parseCollectiveCommit(payload));
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

        <form className="adm-form-grid" onSubmit={onPreview} noValidate>
          <fieldset
            className="adm-fieldset adm-field--wide"
            aria-describedby={errors.funds ? 'aum-collective-funds-error' : undefined}
          >
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
            {errors.funds && (
              <small className="adm-field-error" id="aum-collective-funds-error" role="alert">
                {errors.funds}
              </small>
            )}
          </fieldset>

          <FormField id="aum-collective-mode" label="Mode">
            {(props) => (
              <select value={mode} onChange={(event) => change(setMode, 'percent')(event.target.value)} {...props}>
                <option value="percentage">Same percentage for each selected fund</option>
                <option value="explicit">Explicit amount per fund</option>
              </select>
            )}
          </FormField>

          {mode === 'percentage' && (
            <>
              <FormField id="aum-collective-direction" label="Direction">
                {(props) => (
                  <select
                    value={direction}
                    onChange={(event) => change(setDirection, 'percent')(event.target.value)}
                    {...props}
                  >
                    <option value="increase">Increase</option>
                    <option value="decrease">Decrease</option>
                  </select>
                )}
              </FormField>
              <FormField
                id="aum-collective-percent"
                label="Percentage (%)"
                error={errors.percent}
                hint={`Up to ${MAX_GROWTH_PERCENT}%, to the nearest 0.01%.`}
              >
                {(props) => (
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={MAX_GROWTH_PERCENT}
                    step="0.01"
                    value={percent}
                    onChange={(event) => change(setPercent, 'percent')(event.target.value)}
                    placeholder="2.50"
                    {...props}
                  />
                )}
              </FormField>
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
                    <FormField
                      key={fundId}
                      id={`aum-collective-delta-${fundId}`}
                      label={nameById.get(fundId) || fundId}
                      error={errors[`delta:${fundId}`]}
                    >
                      {(props) => (
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={deltas[fundId] ?? ''}
                          onChange={(event) => {
                            discardPreview();
                            clearError(`delta:${fundId}`);
                            setDeltas((previous) => ({ ...previous, [fundId]: event.target.value }));
                          }}
                          placeholder="250000 or -100000"
                          {...props}
                        />
                      )}
                    </FormField>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          <FormField id="aum-collective-as-of" label="As-of date" error={errors.asOfDate}>
            {(props) => (
              <input
                type="date"
                value={asOfDate}
                onChange={(event) => change(setAsOfDate, 'asOfDate')(event.target.value)}
                {...props}
              />
            )}
          </FormField>

          <FormField id="aum-collective-reason" label="Reason" error={errors.reasonCode}>
            {(props) => (
              <select
                value={reasonCode}
                onChange={(event) => change(setReasonCode, 'reasonCode')(event.target.value)}
                {...props}
              >
                <option value="">Choose a reason</option>
                {AUM_ADJUSTMENT_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>{reason.label}</option>
                ))}
              </select>
            )}
          </FormField>

          <FormField id="aum-collective-note" label="Internal note (optional)" wide>
            {(props) => (
              <textarea
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => change(setNote)(event.target.value)}
                {...props}
              />
            )}
          </FormField>

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
