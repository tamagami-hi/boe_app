import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import { useAdminCacheActions } from '../data/adminResources.js';
import { useIdempotencyKeys } from '../helpers/idempotencyKeys.js';
import { fmtPaise as rupees } from '../helpers/formatters.js';

/*
 * One fund's published AUM (spec §8.3, §9.5).
 *
 * AUM is an absolute, admin-published snapshot — not a roll-forward of client
 * money. The movement fields of the old form (new investments, redemptions,
 * portfolio gain/loss) are gone entirely: no AUM request contains a user, order,
 * payment, contribution or redemption field, and publishing AUM changes no client
 * investment value.
 *
 *   POST /v1/admin/aum/funds/:fundId/initialize   { amountPaise, asOfDate, reasonCode, note? }
 *   POST /v1/admin/aum/funds/:fundId/growth       { growthPaise | growthBasisPoints, asOfDate, reasonCode, note? }
 *   GET  /v1/admin/aum/funds/:fundId/history
 *
 * The first publication is a separate initialize command because there is no prior
 * basis to grow from. Amounts are decimal strings on the wire; every commit sends
 * an Idempotency-Key and the CSRF token apiRequest attaches.
 */

export const AUM_BOUNDARY_NOTE =
  'This changes published fund AUM only. It does not change any client investment value.';

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Non-negative rupees input -> integer paise string, or null. */
function toAbsolutePaise(value) {
  const rupeesValue = Number(value);
  if (!Number.isFinite(rupeesValue) || rupeesValue < 0) return null;
  return String(Math.round(rupeesValue * 100));
}

/** Signed growth input: direction + magnitude -> signed paise string / basis points. */
function toSignedPaise(direction, value) {
  const rupeesValue = Number(value);
  if (!Number.isFinite(rupeesValue) || rupeesValue <= 0) return null;
  const magnitude = Math.round(rupeesValue * 100);
  return String(direction === 'decrease' ? -magnitude : magnitude);
}

function toSignedBasisPoints(direction, value) {
  const percentValue = Number(value);
  if (!Number.isFinite(percentValue) || percentValue <= 0) return null;
  const points = Math.round(percentValue * 100);
  return direction === 'decrease' ? -points : points;
}

// Local mirror of the server rule, for the preview line only. The commit
// recalculates from the fund's latest snapshot and its response is authoritative.
function previewDelta(basisPaise, mode, signed) {
  if (mode === 'amount') return Number(signed);
  const magnitude = Math.floor((Math.abs(Number(basisPaise) * signed) + 5000) / 10000);
  return Math.sign(signed) * magnitude;
}

export default function FundAumPanel({ fundId }) {
  const { invalidateAum } = useAdminCacheActions();
  const idempotencyKeyFor = useIdempotencyKeys();

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');

  const [mode, setMode] = useState('amount'); // 'amount' | 'percentage' (growth only)
  const [direction, setDirection] = useState('increase'); // 'increase' | 'decrease'
  const [magnitude, setMagnitude] = useState('');
  const [initialAmount, setInitialAmount] = useState('');
  const [asOfDate, setAsOfDate] = useState(today());
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lockRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiRequest(`/v1/admin/aum/funds/${encodeURIComponent(fundId)}/history`, {
        scope: 'admin',
      });
      setHistory(Array.isArray(payload) ? payload : payload?.items ?? []);
      setReadError('');
    } catch (loadError) {
      setReadError(loadError?.message || 'Could not load the AUM history.');
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The history endpoint returns latest first (as_of_date DESC, revision DESC, …).
  const latest = history[0] ?? null;
  const isInitialize = !loading && history.length === 0;

  const preview = useMemo(() => {
    if (isInitialize || !latest) return null;
    const signed = mode === 'amount'
      ? Number(toSignedPaise(direction, magnitude))
      : toSignedBasisPoints(direction, magnitude);
    if (!signed) return null;
    const delta = previewDelta(latest.aumPaise ?? 0, mode, signed);
    return { delta, after: Number(latest.aumPaise ?? 0) + delta };
  }, [isInitialize, latest, mode, direction, magnitude]);

  async function onSubmit(event) {
    event.preventDefault();
    if (lockRef.current) return;
    setError('');
    setMessage('');

    const trimmedReason = reasonCode.trim();
    let body;
    let path;
    if (isInitialize) {
      const amountPaise = toAbsolutePaise(initialAmount);
      if (amountPaise === null) {
        setError('Enter the initial AUM in rupees. Zero is allowed; negative is not.');
        return;
      }
      body = { amountPaise };
      path = `/v1/admin/aum/funds/${encodeURIComponent(fundId)}/initialize`;
    } else {
      const instruction = mode === 'amount'
        ? { growthPaise: toSignedPaise(direction, magnitude) }
        : { growthBasisPoints: toSignedBasisPoints(direction, magnitude) };
      if (!Object.values(instruction)[0]) {
        setError('Enter a non-zero amount or percentage.');
        return;
      }
      Object.assign(body = {}, instruction);
      path = `/v1/admin/aum/funds/${encodeURIComponent(fundId)}/growth`;
    }
    if (!asOfDate) {
      setError('Enter the as-of date the figure applies to.');
      return;
    }
    if (!trimmedReason) {
      setError('Enter a reason code. It is recorded on the audit entry.');
      return;
    }
    Object.assign(body, {
      asOfDate,
      reasonCode: trimmedReason,
      ...(note.trim() ? { note: note.trim() } : {}),
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
      setInitialAmount('');
      setMagnitude('');
      setNote('');
      // AUM commit: refresh the catalogue AUM caches and the audit log — never any
      // client portfolio/value cache, which this write does not affect.
      invalidateAum();
      await load();
    } catch (submitError) {
      setError(
        submitError?.status === 409
          ? 'This fund\u2019s AUM changed while you were working. The history was refreshed — review it and try again.'
          : submitError?.message || 'The AUM publication was not accepted.',
      );
      if (submitError?.status === 409) await load();
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
            <I icon={Layers} size={16} /> {isInitialize ? 'Initialize published AUM' : 'Adjust published AUM'}
          </h3>
          <div className="adm-card-sub">
            An absolute figure published by an admin. Clients see the latest value and its as-of
            date.
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

      {readError && (
        <div className="be-error" role="alert">{readError}</div>
      )}

      {!loading && (
        <form className="adm-form-grid" onSubmit={onSubmit}>
          {isInitialize ? (
            <label className="adm-field">
              <span>Initial AUM (₹)</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={initialAmount}
                onChange={(event) => setInitialAmount(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="adm-field">
                <span>Instruction</span>
                <select value={mode} onChange={(event) => setMode(event.target.value)}>
                  <option value="amount">Amount (₹)</option>
                  <option value="percentage">Percentage of current AUM</option>
                </select>
              </label>

              <label className="adm-field">
                <span>Direction</span>
                <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
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
            </>
          )}

          <label className="adm-field">
            <span>As-of date</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
            />
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

          <div className="adm-field--wide">
            <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
              {busy ? 'Publishing…' : isInitialize ? 'Publish initial AUM' : 'Publish AUM adjustment'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
