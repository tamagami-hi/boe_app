import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Layers, RefreshCw } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import { useAdminCacheActions } from '../data/adminResources.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import {
  AUM_ADJUSTMENT_REASONS,
  AUM_OPENING_REASONS,
  todayInIndia,
} from '../helpers/aumReasons.js';
import { fmtPaise as rupees } from '../helpers/formatters.js';
import {
  MAX_GROWTH_PERCENT,
  toAbsolutePaise,
  toSignedBasisPoints,
  toSignedPaise,
} from '../helpers/signedAmounts.js';
import useAumHistory from './useAumHistory.js';

export const AUM_BOUNDARY_NOTE =
  'This changes published fund AUM only. It does not change any client investment value.';

function previewDelta(basisPaise, mode, signed) {
  if (mode === 'amount') return Number(signed);
  const magnitude = Math.floor((Math.abs(Number(basisPaise) * signed) + 5000) / 10000);
  return Math.sign(signed) * magnitude;
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
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lockRef = useRef(false);

  const latest = history.rows[0] ?? null;
  const readFailed = history.error !== '';
  const isOpening = !history.loading && !readFailed && history.rows.length === 0;
  const reasons = isOpening ? AUM_OPENING_REASONS : AUM_ADJUSTMENT_REASONS;

  const preview = useMemo(() => {
    if (isOpening || !latest) return null;
    const signed = mode === 'amount'
      ? Number(toSignedPaise(direction, magnitude))
      : toSignedBasisPoints(direction, magnitude);
    if (!signed) return null;
    const delta = previewDelta(latest.aumPaise ?? 0, mode, signed);
    return { delta, after: Number(latest.aumPaise ?? 0) + delta };
  }, [isOpening, latest, mode, direction, magnitude]);

  async function onSubmit(event) {
    event.preventDefault();
    if (lockRef.current) return;
    setError('');
    setMessage('');

    let body;
    let path;
    if (isOpening) {
      const aumPaise = toAbsolutePaise(openingAmount);
      if (aumPaise === null) {
        setError('Enter the opening AUM in rupees. Zero is allowed; negative is not.');
        return;
      }
      body = { aumPaise };
      path = `/v1/admin/aum/funds/${encodeURIComponent(fundId)}/initialize`;
    } else {
      const instruction = mode === 'amount'
        ? { growthPaise: toSignedPaise(direction, magnitude) }
        : { growthBasisPoints: toSignedBasisPoints(direction, magnitude) };
      if (!Object.values(instruction)[0]) {
        setError(
          mode === 'amount'
            ? 'Enter an amount above zero.'
            : `Enter a percentage above zero and no more than ${MAX_GROWTH_PERCENT}%.`,
        );
        return;
      }
      body = { ...instruction };
      path = `/v1/admin/aum/funds/${encodeURIComponent(fundId)}/growth`;
    }
    if (!asOfDate) {
      setError('Choose the as-of date this figure applies to.');
      return;
    }
    if (!reasons.some((reason) => reason.value === reasonCode)) {
      setError('Choose a reason. It is recorded on the audit entry.');
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
      const snapshot = payload?.snapshot ?? payload ?? null;
      setMessage(
        snapshot?.aumPaise != null
          ? `Published. Fund AUM is now ${rupees(snapshot.aumPaise)} as of ${snapshot.asOfDate ?? asOfDate}.`
          : 'Published.',
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
        <form className="adm-form-grid" onSubmit={onSubmit}>
          {isOpening ? (
            <label className="adm-field">
              <span className="adm-field-label">Opening AUM (₹)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={openingAmount}
                onChange={(event) => setOpeningAmount(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="adm-field">
                <span className="adm-field-label">Instruction</span>
                <select value={mode} onChange={(event) => setMode(event.target.value)}>
                  <option value="amount">Amount (₹)</option>
                  <option value="percentage">Percentage of current AUM</option>
                </select>
              </label>

              <label className="adm-field">
                <span className="adm-field-label">Direction</span>
                <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
                </select>
              </label>

              <label className="adm-field">
                <span className="adm-field-label">
                  {mode === 'amount' ? 'Amount (₹)' : 'Percentage (%)'}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={mode === 'amount' ? undefined : MAX_GROWTH_PERCENT}
                  step={mode === 'amount' ? '0.01' : '0.0001'}
                  value={magnitude}
                  onChange={(event) => setMagnitude(event.target.value)}
                />
              </label>
            </>
          )}

          <label className="adm-field">
            <span className="adm-field-label">As-of date</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
            />
          </label>

          <label className="adm-field">
            <span className="adm-field-label">Reason</span>
            <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
              <option value="">Choose a reason</option>
              {reasons.map((reason) => (
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
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {preview && (
            <div className="adm-field--wide adm-aum-projection">
              Preview only — the server recalculates on commit: AUM will be{' '}
              <strong className="be-money">{rupees(String(preview.after))}</strong>{' '}
              ({preview.delta >= 0 ? '+' : '−'}
              <span className="be-money">{rupees(String(Math.abs(preview.delta)))}</span>).
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
