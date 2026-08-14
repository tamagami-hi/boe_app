import { useCallback, useEffect, useMemo, useState } from 'react';
import { Percent, TrendingUp, Users } from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import I from '../components/I.jsx';
import GainAllocationForm from './GainAllocationForm.jsx';
import { fmtPaise as rupees } from '../helpers/formatters.js';

// Who holds money in a pool, and how a period's growth is credited to them
// (Option B module 2).
//
// Two ways to credit growth, both ending in one `gain_allocation` per investor:
//
//   • the whole pool at once — an amount to distribute, or the percentage the
//     pool grew; each investor receives the share their own money earned
//   • one investor at a time — for corrections and one-offs
//
// Distribution is previewed before it is committed: the preview is computed by
// the same code that writes, so what is shown is what lands. Every figure here is
// derived from the investor ledger, so this panel and the investor's own
// dashboard can never disagree.
//
// GET  /v1/admin/funds/:fundId/investors
// POST /v1/admin/funds/:fundId/gain-allocations


const percent = (value) =>
  value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}%`;

const toPaise = (value) => {
  const rupeeValue = Number(value);
  return Number.isFinite(rupeeValue) ? Math.round(rupeeValue * 100) : 0;
};

/** Basis points keep 3.5% exact on the wire: 350. */
const toBasisPoints = (value) => {
  const percentValue = Number(value);
  return Number.isFinite(percentValue) ? Math.round(percentValue * 100) : 0;
};

/** Today, in the ISO calendar form the API expects. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function FundInvestorsPanel({ fundId }) {
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Distribution form
  const [mode, setMode] = useState('percent'); // 'percent' | 'amount'
  const [amount, setAmount] = useState('');
  const [growth, setGrowth] = useState('');
  const [direction, setDirection] = useState('gain'); // 'gain' | 'loss'
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [reasonCode, setReasonCode] = useState('monthly_growth');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [perInvestor, setPerInvestor] = useState(null);

  const load = useCallback(async () => {
    if (!fundId) return;
    setLoading(true);
    setError('');
    try {
      const payload = await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/investors`, {
        scope: 'admin',
      });
      setPool(payload);
    } catch (loadError) {
      setError(loadError?.message || 'The pool investors could not be loaded.');
      setPool(null);
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    load();
  }, [load]);

  const investors = pool?.investors ?? [];
  const nameById = useMemo(
    () => new Map(investors.map((investor) => [investor.userId, investor.name])),
    [investors],
  );

  /** The signed instruction the API is given, in its own units. */
  const instruction = useMemo(() => {
    const sign = direction === 'loss' ? -1 : 1;
    if (mode === 'percent') {
      const points = toBasisPoints(growth);
      return points === 0 ? null : { growthBasisPoints: sign * points };
    }
    const paise = toPaise(amount);
    return paise === 0 ? null : { totalGainPaise: sign * paise };
  }, [mode, growth, amount, direction]);

  const send = useCallback(
    async (dryRun) => {
      if (!instruction) {
        setError(mode === 'percent' ? 'Enter a growth percentage.' : 'Enter an amount to distribute.');
        return null;
      }
      setBusy(true);
      setError('');
      setMessage('');
      try {
        return await apiRequest(`/v1/admin/funds/${encodeURIComponent(fundId)}/gain-allocations`, {
          method: 'POST',
          scope: 'admin',
          body: {
            effectiveDate,
            reasonCode: reasonCode.trim() || 'monthly_growth',
            ...(note.trim() ? { note: note.trim() } : {}),
            ...instruction,
            dryRun,
          },
        });
      } catch (sendError) {
        setError(sendError?.message || 'The distribution was not accepted.');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [instruction, mode, fundId, effectiveDate, reasonCode, note],
  );

  async function onPreview(event) {
    event.preventDefault();
    setPreview(null);
    const payload = await send(true);
    if (payload) setPreview(payload);
  }

  async function onCommit() {
    const payload = await send(false);
    if (!payload) return;
    setPreview(null);
    setAmount('');
    setGrowth('');
    setMessage(
      `Credited ${rupees(payload.allocatedPaise)} across ${payload.investorCount} ` +
        `${payload.investorCount === 1 ? 'investor' : 'investors'}.`,
    );
    await load();
  }

  if (!fundId) {
    return (
      <section className="adm-card">
        <p className="adm-card-sub">Select a pool to see who is invested in it.</p>
      </section>
    );
  }

  return (
    <>
      <section className="adm-card">
        <header className="adm-card-head">
          <h3 className="adm-card-title">
            <I icon={Users} size={14} /> Investors in this pool
          </h3>
          {pool && (
            <p className="adm-card-sub">
              {pool.investorCount} {pool.investorCount === 1 ? 'investor' : 'investors'} ·{' '}
              {rupees(pool.investedTotalPaise)} invested · {rupees(pool.currentValueTotalPaise)} current
              value · {rupees(pool.returnTotalPaise)} returns credited
            </p>
          )}
        </header>

        {loading ? (
          <p className="adm-card-sub">Loading investors…</p>
        ) : investors.length === 0 ? (
          <p className="adm-card-sub">
            Nobody has invested in this pool yet. Growth can be credited once there is money in it.
          </p>
        ) : (
          <div className="adm-table-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Investor</th>
                  <th scope="col" className="be-money">Invested</th>
                  <th scope="col" className="be-money">Current value</th>
                  <th scope="col" className="be-money">Return</th>
                  <th scope="col" className="be-money">Withdrawn</th>
                  <th scope="col">Allocate</th>
                </tr>
              </thead>
              <tbody>
                {investors.map((investor) => (
                  <tr key={investor.userId}>
                    <td>
                      <div>{investor.name}</div>
                      <div className="adm-cell-sub">{investor.email}</div>
                    </td>
                    <td className="be-money">{rupees(investor.totalInvestmentPaise)}</td>
                    <td className="be-money">{rupees(investor.currentValuePaise)}</td>
                    <td className="be-money">
                      {rupees(investor.totalReturnPaise)}
                      <div className="adm-cell-sub">{percent(investor.returnPercent)}</div>
                    </td>
                    <td className="be-money">{rupees(investor.redeemedTotalPaise)}</td>
                    <td>
                      <button
                        type="button"
                        className="be-btn"
                        onClick={() =>
                          setPerInvestor(perInvestor === investor.userId ? null : investor.userId)
                        }
                      >
                        {perInvestor === investor.userId ? 'Close' : 'Just this investor'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {perInvestor !== null && (
          <div className="adm-card adm-card--nested">
            <h4 className="adm-card-title">
              Allocate to {nameById.get(perInvestor) ?? 'this investor'}
            </h4>
            <GainAllocationForm
              userId={perInvestor}
              positions={investors
                .filter((investor) => investor.userId === perInvestor)
                .map((investor) => ({
                  fundId,
                  fundName: 'This pool',
                  currentValuePaise: investor.currentValuePaise,
                }))}
              onAllocated={() => {
                setPerInvestor(null);
                load();
              }}
            />
          </div>
        )}
      </section>

      <section className="adm-card">
        <header className="adm-card-head">
          <h3 className="adm-card-title">
            <I icon={TrendingUp} size={14} /> Credit this period's growth
          </h3>
          <p className="adm-card-sub">
            Split across the pool by each investor's current value. Every paisa is allocated — the parts
            always add up to the total.
          </p>
        </header>

        <form className="adm-form-grid" onSubmit={onPreview}>
          <>
            <label className="adm-field">
              <span className="adm-field-label">How</span>
              <select value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="percent">Pool grew by a percentage</option>
                <option value="amount">Distribute a total amount</option>
              </select>
            </label>

            <label className="adm-field">
              <span className="adm-field-label">Direction</span>
              <select
                value={direction}
                onChange={(event) => setDirection(event.target.value)}
              >
                <option value="gain">Gain</option>
                <option value="loss">Loss</option>
              </select>
            </label>

            {mode === 'percent' ? (
              <label className="adm-field">
                <span className="adm-field-label">
                  <I icon={Percent} size={12} /> Growth %
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={growth}
                  onChange={(event) => setGrowth(event.target.value)}
                  placeholder="3.50"
                />
              </label>
            ) : (
              <label className="adm-field">
                <span className="adm-field-label">Total amount (₹)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="450000"
                />
              </label>
            )}
          </>

          <>
            <label className="adm-field">
              <span className="adm-field-label">Effective date</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            </label>
            <label className="adm-field">
              <span className="adm-field-label">Reason code</span>
              <input
                value={reasonCode}
                onChange={(event) => setReasonCode(event.target.value)}
                placeholder="monthly_growth"
              />
            </label>
            <label className="adm-field adm-field--wide">
              <span className="adm-field-label">Note (optional)</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Shown on the investor's transaction"
              />
            </label>
          </>

          <div className="adm-field--wide adm-form-actions">
            <button type="submit" className="be-btn" disabled={busy || investors.length === 0}>
              {busy ? 'Working…' : 'Preview split'}
            </button>
          </div>
        </form>

        {preview !== null && (
          <div className="adm-card adm-card--nested">
            <p className="adm-card-sub">
              {rupees(preview.allocatedPaise)} across {rupees(preview.basisPaise)} of investor value.
              Nothing has been credited yet.
            </p>
            <div className="adm-table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Investor</th>
                    <th scope="col" className="be-money">Current value</th>
                    <th scope="col" className="be-money">Gets</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.shares ?? []).map((share) => (
                    <tr key={share.userId}>
                      <td>{share.name || nameById.get(share.userId) || share.userId}</td>
                      <td className="be-money">{rupees(share.currentValuePaise)}</td>
                      <td className="be-money">{rupees(share.gainPaise)}</td>
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
                {busy ? 'Crediting…' : 'Credit the pool'}
              </button>
            </div>
          </div>
        )}

        {message !== '' && <p className="adm-gain-result adm-field--wide">{message}</p>}
        {error !== '' && <p className="be-error adm-field--wide">{error}</p>}
      </section>
    </>
  );
}
