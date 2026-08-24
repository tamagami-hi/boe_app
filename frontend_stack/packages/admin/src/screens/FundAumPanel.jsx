import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Layers, RefreshCw } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import FormField from '../components/FormField.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import { useAdminCacheActions } from '../data/adminResources.js';
import { parseAumMutation } from '../data/fundContracts.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import {
  AUM_ADJUSTMENT_REASONS,
  AUM_OPENING_REASONS,
  todayInIndia,
} from '../helpers/aumReasons.js';
import { fmtPaise as rupees } from '../helpers/formatters.js';
import {
  MAX_GROWTH_PERCENT,
  parseAbsolutePaise,
  parseSignedBasisPoints,
  parseSignedPaise,
} from '../helpers/signedAmounts.js';
import useAumHistory from './useAumHistory.js';

export const AUM_BOUNDARY_NOTE =
  'This changes published fund AUM only. It does not change any client investment value.';

function previewDelta(basisPaise, mode, signed) {
  const signedBig = BigInt(signed);
  if (mode === 'amount') return signedBig;
  const basis = BigInt(basisPaise);
  const product = basis * signedBig;
  const magnitude = (product < 0n ? -product : product);
  const rounded = (magnitude + 5000n) / 10000n;
  return product < 0n ? -rounded : rounded;
}

export default function FundAumPanel({ fundId, fundName }) {
  const { invalidateAum } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();
  const history = useAumHistory(fundId);

  const [mode, setMode] = useState('amount');
  const [direction, setDirection] = useState('increase');
  const [magnitude, setMagnitude] = useState('');
  const [openingAmount, setOpeningAmount] = useState('');
  const [asOfDate, setAsOfDate] = useState(todayInIndia());
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lockRef = useRef(false);

  const latest = history.rows[0] ?? null;
  const readFailed = history.error !== '';
  const isOpening = !history.loading && !readFailed && history.rows.length === 0;
  const reasons = isOpening ? AUM_OPENING_REASONS : AUM_ADJUSTMENT_REASONS;

  const clearError = (key) => setErrors(
    (previous) => (previous[key] ? { ...previous, [key]: undefined } : previous),
  );
  const edit = (setter, key) => (event) => {
    clearError(key);
    setter(event.target.value);
  };

  const preview = useMemo(() => {
    if (isOpening || !latest) return null;
    const parsed = mode === 'amount'
      ? parseSignedPaise(direction, magnitude)
      : parseSignedBasisPoints(direction, magnitude);
    if (!parsed.ok) return null;
    const delta = previewDelta(latest.aumPaise ?? '0', mode, parsed.value);
    return { delta, after: BigInt(latest.aumPaise ?? '0') + delta };
  }, [isOpening, latest, mode, direction, magnitude]);

  async function onSubmit(event) {
    event.preventDefault();
    if (lockRef.current) return;
    setError('');
    setMessage('');

    const found = {};
    let body;
    let path;
    if (isOpening) {
      const parsed = parseAbsolutePaise(openingAmount);
      if (!parsed.ok) found.openingAmount = parsed.problem;
      body = parsed.ok ? { aumPaise: parsed.value } : {};
      path = `/v1/admin/aum/funds/${encodeURIComponent(fundId)}/initialize`;
    } else {
      const parsed = mode === 'amount'
        ? parseSignedPaise(direction, magnitude)
        : parseSignedBasisPoints(direction, magnitude);
      if (!parsed.ok) found.magnitude = parsed.problem;
      body = parsed.ok
        ? (mode === 'amount' ? { growthPaise: parsed.value } : { growthBasisPoints: parsed.value })
        : {};
      path = `/v1/admin/aum/funds/${encodeURIComponent(fundId)}/growth`;
    }
    if (!asOfDate) found.asOfDate = 'Choose the as-of date this figure applies to.';
    if (!reasons.some((reason) => reason.value === reasonCode)) {
      found.reasonCode = 'Choose a reason. It is recorded on the audit entry.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setError('Some details need attention before this can be published.');
      return;
    }

    const trimmedNote = note.trim();
    Object.assign(body, {
      asOfDate,
      reasonCode,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    });

    lockRef.current = true;
    setBusy(true);
    try {
      const payload = await apiRequest(path, {
        method: 'POST',
        scope: 'admin',
        body,
        headers: { 'Idempotency-Key': idempotencyKeyFor(`aum:${fundId}`, body) },
      });
      const { snapshot } = parseAumMutation(payload);
      setMessage(
        `Published. Fund AUM is now ${rupees(snapshot.aumPaise)} as of ${snapshot.asOfDate}.`,
      );
      setOpeningAmount('');
      setMagnitude('');
      setNote('');
      invalidateAum();
      await history.reload();
    } catch (submitError) {
      setError(
        submitError?.status === 409
          ? 'This fund\u2019s AUM changed while you were working. The history was refreshed — review it and try again.'
          : submitError?.message || 'The AUM publication was not accepted.',
      );
      if (submitError?.status === 409) await history.reload();
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <div>
          <h3 className="adm-card-title">
            <I icon={Layers} size={16} /> {isOpening ? 'Publish opening AUM' : 'Adjust published AUM'}
          </h3>
          <div className="adm-card-sub">
            {fundName ? `${fundName} — ` : ''}
            an absolute figure published by an admin. Clients see the latest value and its as-of date.
          </div>
        </div>
        {latest && (
          <div className="adm-aum-current">
            <div className="adm-cell-sub">Current</div>
            <div className="be-money adm-aum-value">{rupees(latest.aumPaise)}</div>
            <div className="adm-cell-sub">as of {latest.asOfDate}</div>
          </div>
        )}
      </div>

      <p className="adm-screen-note"><strong>{AUM_BOUNDARY_NOTE}</strong></p>

      {history.loading && (
        <div className="be-pad-5 be-stack-2">
          <Skeleton width="30%" height="1rem" />
          <Skeleton width="100%" height="2.5rem" count={2} />
        </div>
      )}

      {readFailed && (
        <div className="adm-read-failure">
          <div
            className="adm-validation-banner adm-validation-banner--error adm-validation-banner--start"
            role="alert"
          >
            <I icon={AlertTriangle} size={14} /> {history.error}
          </div>
          <button
            type="button"
            className="be-btn be-btn-secondary be-btn-sm"
            onClick={() => history.reload()}
            disabled={history.loading}
          >
            <I icon={RefreshCw} size={13} /> Try again
          </button>
        </div>
      )}

      {!history.loading && !readFailed && (
        <form className="adm-form-grid" onSubmit={onSubmit} noValidate>
          {isOpening ? (
            <FormField
              id="aum-opening"
              label="Opening AUM (₹)"
              error={errors.openingAmount}
              hint="Zero is allowed. Two decimal places at most."
            >
              {(props) => (
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={openingAmount}
                  onChange={edit(setOpeningAmount, 'openingAmount')}
                  {...props}
                />
              )}
            </FormField>
          ) : (
            <>
              <FormField id="aum-mode" label="Instruction">
                {(props) => (
                  <select value={mode} onChange={edit(setMode, 'magnitude')} {...props}>
                    <option value="amount">Amount (₹)</option>
                    <option value="percentage">Percentage of current AUM</option>
                  </select>
                )}
              </FormField>

              <FormField id="aum-direction" label="Direction">
                {(props) => (
                  <select value={direction} onChange={edit(setDirection, 'magnitude')} {...props}>
                    <option value="increase">Increase</option>
                    <option value="decrease">Decrease</option>
                  </select>
                )}
              </FormField>

              <FormField
                id="aum-magnitude"
                label={mode === 'amount' ? 'Amount (₹)' : 'Percentage (%)'}
                error={errors.magnitude}
                hint={mode === 'amount'
                  ? 'Enter it unsigned; the direction above carries the sign.'
                  : `Up to ${MAX_GROWTH_PERCENT}%, to the nearest 0.01%.`}
              >
                {(props) => (
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={mode === 'amount' ? undefined : MAX_GROWTH_PERCENT}
                    step="0.01"
                    value={magnitude}
                    onChange={edit(setMagnitude, 'magnitude')}
                    {...props}
                  />
                )}
              </FormField>
            </>
          )}

          <FormField id="aum-as-of" label="As-of date" error={errors.asOfDate}>
            {(props) => (
              <input
                type="date"
                value={asOfDate}
                onChange={edit(setAsOfDate, 'asOfDate')}
                {...props}
              />
            )}
          </FormField>

          <FormField id="aum-reason" label="Reason" error={errors.reasonCode}>
            {(props) => (
              <select value={reasonCode} onChange={edit(setReasonCode, 'reasonCode')} {...props}>
                <option value="">Choose a reason</option>
                {reasons.map((reason) => (
                  <option key={reason.value} value={reason.value}>{reason.label}</option>
                ))}
              </select>
            )}
          </FormField>

          <FormField id="aum-note" label="Internal note (optional)" wide>
            {(props) => (
              <textarea
                rows={2}
                maxLength={2000}
                value={note}
                onChange={edit(setNote, 'note')}
                {...props}
              />
            )}
          </FormField>

          {preview && (
            <div className="adm-field--wide adm-aum-projection">
              Preview only — the server recalculates on commit: AUM will be{' '}
              <strong className="be-money">{rupees(preview.after.toString())}</strong>{' '}
              ({preview.delta >= 0n ? '+' : '−'}
              <span className="be-money">
                {rupees((preview.delta < 0n ? -preview.delta : preview.delta).toString())}
              </span>).
            </div>
          )}

          {error && (
            <div className="be-error adm-field--wide" role="alert">{error}</div>
          )}
          {message && (
            <div className="adm-gain-result adm-field--wide" role="status">{message}</div>
          )}

          <div className="adm-field--wide adm-form-actions adm-form-actions--start">
            <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
              {busy ? 'Publishing…' : isOpening ? 'Publish opening AUM' : 'Publish AUM adjustment'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
