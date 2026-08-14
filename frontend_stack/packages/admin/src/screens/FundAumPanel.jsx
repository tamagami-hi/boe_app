import { useCallback, useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import { fmtPaise as rupees } from '../helpers/formatters.js';

// Monthly AUM update (Option B module 5).
//
//   closing = opening + new investments − redemptions ± portfolio gain/loss
//
// The opening balance is not editable: it is the previous month's closing, which
// the backend supplies. Only the first period ever states an opening figure. The
// closing figure is derived, so it can never be typed in inconsistently, and a
// published period cannot be re-published.
//
// POST /v1/admin/funds/:fundId/aum-updates


/** First day of the current month, the period an update usually closes. */
function currentPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

const toPaise = (value) => {
  const rupeeValue = Number(value);
  return Number.isFinite(rupeeValue) ? Math.round(rupeeValue * 100) : 0;
};

export default function FundAumPanel({ fundId }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [periodStart, setPeriodStart] = useState(currentPeriod());
  const [opening, setOpening] = useState('');
  const [newInvestments, setNewInvestments] = useState('');
  const [redemptions, setRedemptions] = useState('');
  const [gain, setGain] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}`, { scope: 'admin' });
      setHistory(payload?.aumHistory ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'Could not load the AUM history.');
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = history[0] ?? null;
  // The projected closing figure, shown live so the desk sees the result before
  // publishing. The backend recomputes it; this is presentation only.
  const projectedClosing =
    (latest ? Number(latest.closingAumPaise) : toPaise(opening)) +
    toPaise(newInvestments) -
    toPaise(redemptions) +
    toPaise(gain);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = {
        periodStart,
        newInvestmentsPaise: toPaise(newInvestments),
        redemptionsPaise: toPaise(redemptions),
        portfolioGainPaise: toPaise(gain),
        ...(note.trim() ? { note: note.trim() } : {}),
      };
      // Only the first period may declare an opening balance.
      if (!latest) body.openingAumPaise = toPaise(opening);
      const payload = await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/aum-updates`, {
        method: 'POST',
        scope: 'admin',
        body,
      });
      setMessage(`Published. Fund size is now ${rupees(payload?.aumUpdate?.closingAumPaise)}.`);
      setNewInvestments('');
      setRedemptions('');
      setGain('');
      setNote('');
      await load();
    } catch (submitError) {
      setError(submitError?.message || 'The AUM update was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <div>
          <h3 className="adm-card-title">
            <I icon={Layers} size={16} /> Fund size (AUM)
          </h3>
          <div className="adm-card-sub">
            Published monthly. Investors see the closing figure and the date it was last updated.
          </div>
        </div>
        {latest && (
          <div className="adm-aum-current">
            <div className="adm-cell-sub">Current</div>
            <div className="be-money adm-aum-value">{rupees(latest.closingAumPaise)}</div>
            <div className="adm-cell-sub">as of {latest.periodStart}</div>
          </div>
        )}
      </div>

      <form className="adm-form-grid" onSubmit={onSubmit}>
        <label className="adm-field">
          <span>Period (month start)</span>
          <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
        </label>

        <label className="adm-field">
          <span>Opening balance (₹)</span>
          <input
            type="number"
            step="0.01"
            value={latest ? Number(latest.closingAumPaise) / 100 : opening}
            onChange={(event) => setOpening(event.target.value)}
            // Carried forward from the last published period; only the first
            // period is ever entered by hand.
            disabled={Boolean(latest)}
          />
        </label>

        <label className="adm-field">
          <span>New investments (₹)</span>
          <input type="number" step="0.01" min="0" value={newInvestments} onChange={(e) => setNewInvestments(e.target.value)} />
        </label>

        <label className="adm-field">
          <span>Redemptions (₹)</span>
          <input type="number" step="0.01" min="0" value={redemptions} onChange={(e) => setRedemptions(e.target.value)} />
        </label>

        <label className="adm-field">
          <span>Portfolio gain / loss (₹)</span>
          <input
            type="number"
            step="0.01"
            value={gain}
            onChange={(event) => setGain(event.target.value)}
            placeholder="Negative for a loss"
          />
        </label>

        <label className="adm-field adm-field--wide">
          <span>Note (optional)</span>
          <input type="text" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>

        <div className="adm-field--wide adm-aum-projection">
          Closing fund size will be <strong className="be-money">{rupees(projectedClosing)}</strong>
        </div>

        {error && (
          <div className="be-error adm-field--wide" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="adm-gain-result adm-field--wide" role="status">
            {message}
          </div>
        )}

        <div className="adm-field--wide">
          <button type="submit" className="be-btn be-btn-primary" disabled={busy}>
            {busy ? 'Publishing…' : 'Publish AUM update'}
          </button>
        </div>
      </form>

      <h4 className="adm-section-title">History</h4>
      <div className="adm-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Opening</th>
              <th>New investments</th>
              <th>Redemptions</th>
              <th>Gain / loss</th>
              <th>Closing</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6}>Loading…</td>
              </tr>
            )}
            {!loading && history.length === 0 && (
              <tr>
                <td colSpan={6}>No AUM updates published yet.</td>
              </tr>
            )}
            {history.map((update) => (
              <tr key={update.id}>
                <td>{update.periodStart}</td>
                <td className="be-money">{rupees(update.openingAumPaise)}</td>
                <td className="be-money">{rupees(update.newInvestmentsPaise)}</td>
                <td className="be-money">{rupees(update.redemptionsPaise)}</td>
                <td className="be-money">{rupees(update.portfolioGainPaise)}</td>
                <td className="be-money">{rupees(update.closingAumPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
