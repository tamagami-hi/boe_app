import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';

// Per-investor gain allocation (Option B module 2/3).
//
// This is how a portfolio moves: an administrator credits — or debits — one
// investor's value for a period. Total Investment never changes, so the entry
// only affects Total Return and Return %. Losses are entered as a negative
// amount and the backend refuses one larger than the investor's current value.
//
// POST /v1/admin/users/:userId/gain-allocations

const REASON_CODES = [
  { value: 'monthly_return', label: 'Monthly return' },
  { value: 'quarterly_return', label: 'Quarterly return' },
  { value: 'drawdown', label: 'Drawdown / loss' },
  { value: 'correction', label: 'Correction' },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function GainAllocationForm({ userId, positions = [], onAllocated }) {
  const [fundId, setFundId] = useState(positions[0]?.fundId ?? '');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState('gain');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reasonCode, setReasonCode] = useState('monthly_return');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const hasPositions = positions.length > 0;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const rupees = Number(amount);
    if (!fundId) {
      setError('Choose the pool to allocate against.');
      return;
    }
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError('Enter the amount to allocate, in rupees.');
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      // Rupees in the form, signed paise on the wire.
      const magnitude = Math.round(rupees * 100);
      const payload = await apiRequest(`/v1/admin/users/${encodeURIComponent(userId)}/gain-allocations`, {
        method: 'POST',
        scope: 'admin',
        body: {
          fundId,
          gainPaise: direction === 'loss' ? -magnitude : magnitude,
          effectiveDate,
          reasonCode,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setResult(payload);
      setAmount('');
      setNote('');
      onAllocated?.();
    } catch (allocationError) {
      setError(allocationError?.message || 'The allocation was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-card adm-gain-form">
      <div className="adm-card-head">
        <div>
          <h3 className="adm-card-title">
            <I icon={TrendingUp} size={16} /> Allocate return
          </h3>
          <div className="adm-card-sub">
            Moves this investor&apos;s current value for a period. Their total investment is unchanged.
          </div>
        </div>
      </div>

      {!hasPositions ? (
        <div className="adm-load-note">
          This investor has no money in any pool yet, so there is nothing to allocate against.
        </div>
      ) : (
        <form className="adm-form-grid" onSubmit={onSubmit}>
          <label className="adm-field">
            <span>Pool</span>
            <select value={fundId} onChange={(event) => setFundId(event.target.value)}>
              {positions.map((position) => (
                <option key={position.fundId} value={position.fundId}>
                  {position.fundName || position.fundSlug}
                </option>
              ))}
            </select>
          </label>

          <label className="adm-field">
            <span>Direction</span>
            <select value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="gain">Gain (credit)</option>
              <option value="loss">Loss (debit)</option>
            </select>
          </label>

          <label className="adm-field">
            <span>Amount (₹)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
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
            <span>Reason</span>
            <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
              {REASON_CODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="adm-field adm-field--wide">
            <span>Note (optional)</span>
            <input
              type="text"
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Shown in the audit trail"
            />
          </label>

          {error && (
            <div className="be-error adm-field--wide" role="alert">
              {error}
            </div>
          )}

          {result && (
            <div className="adm-gain-result adm-field--wide" role="status">
              Allocated. Current value is now{' '}
              <strong className="be-money">
                ₹{(Number(result.currentValuePaise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </strong>
              {result.returnPercent === null || result.returnPercent === undefined
                ? ''
                : ` (${result.returnPercent.toFixed(2)}% return)`}
              .
            </div>
          )}

          <div className="adm-field--wide">
            <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>
              {busy ? 'Allocating…' : 'Allocate'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
