import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, RotateCcw, Wallet, TrendingUp } from 'lucide-react';
import * as fundsApi from '../services/fundsApi.js';
import { usePortfolio, useClientCacheActions } from '../data/clientResources.js';
import { buildPath } from '../navigation/routes.js';
import { fmtMoney, fmtPct, fmtDate } from '../utils/format.js';
import { EmptyState, ErrorState } from '@beonedge/shared';
import PageSheet from '../layout/PageSheet.jsx';

// Option B portfolio screen.
//
//   My Investment      current value, total investment, total return (₹ and %),
//                      return since the first investment, last updated
//   Investment Summary SIP installments paid + total, lump sums + total
//   Pools              the same figures per fund
//   Redeem             full / returns only / 50% / custom amount
//
// Every figure comes from `GET /v1/client/portfolio`, which derives them from the
// investor's ledger on each read. There are no units and no NAV to display.

// Manifest paths, so a route rename cannot leave a dead button here.
const EXPLORE_PATH = buildPath('explore');
const ACTIVITY_PATH = buildPath('activity');
const WITHDRAWALS_PATH = buildPath('withdrawals');

const REDEMPTION_MODES = [
  { value: 'full', label: 'Redeem full amount' },
  { value: 'returns_only', label: 'Redeem returns only' },
  { value: 'half', label: 'Redeem 50%' },
  { value: 'custom', label: 'Redeem custom amount' },
];

export default function Portfolio() {
  // Same cache entry Dashboard reads, so arriving here from Home performs no
  // request at all unless the valuation has gone stale.
  const {
    data: portfolio,
    error: portfolioError,
    isLoading,
    isRefreshing,
    refresh: refreshPortfolio,
  } = usePortfolio();
  const { invalidateMoney } = useClientCacheActions();
  const [sheet, setSheet] = useState(null);
  const [mode, setMode] = useState('full');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [receipt, setReceipt] = useState(null);

  function openRedeem(pool) {
    setSheet(pool);
    setMode('full');
    setAmount('');
    setMessage(null);
    setReceipt(null);
  }

  function closeRedeem() {
    if (submitting) return;
    setSheet(null);
    setReceipt(null);
  }

  async function onSubmitRedemption() {
    if (!sheet || submitting) return;
    if (mode === 'custom') {
      const requested = Number(amount);
      if (!Number.isFinite(requested) || requested <= 0) {
        setMessage({ type: 'error', text: 'Enter the amount you want to redeem.' });
        return;
      }
      if (requested > (sheet.currentValue ?? 0)) {
        setMessage({ type: 'error', text: 'That is more than your current value.' });
        return;
      }
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await fundsApi.submitRedemption({ fundId: sheet.fundId, mode, amount });
      setReceipt(result);
      // Requesting does not change the valuation, but it does add a record and can
      // race a concurrent allocation. Invalidating the money domain marks the
      // portfolio, history and payment queues stale WITHOUT discarding what is on
      // screen, so the figures the user is reading stay put while they refetch.
      invalidateMoney();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'We could not submit that redemption.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="apk-screen">
        <div className="be-card apk-portfolio-skeleton">Loading your investment…</div>
      </div>
    );
  }

  // A failed read used to fall through to the branch below and render
  // "No investments yet" — telling an investor with money that they have none.
  if (portfolioError && !portfolio) {
    return (
      <div className="apk-screen">
        <ErrorState
          title="We could not load your investment"
          description="Your holdings are unaffected. This screen could not reach the server."
          onRetry={refreshPortfolio}
          busy={isRefreshing}
        />
      </div>
    );
  }

  if (!portfolio || (portfolio.invested === 0 && portfolio.currentValue === 0)) {
    return (
      <div className="apk-screen">
        <EmptyState
          icon={<Wallet size={40} strokeWidth={1.5} />}
          title="No investments yet"
          description="Once your first SIP or lump sum is recorded, your investment appears here."
          action={
            <Link className="be-btn be-btn-primary" to={EXPLORE_PATH}>
              Browse strategies
            </Link>
          }
        />
      </div>
    );
  }

  const summary = portfolio.summary || {};
  const gained = (portfolio.totalReturn ?? 0) >= 0;

  return (
    <div className="apk-screen">
      {/* ── My Investment ─────────────────────────────────────────────────── */}
      <div className="be-card apk-invest-card">
        <div className="be-eyebrow">My Investment</div>
        <div className="apk-invest-label">Current portfolio value</div>
        <div className="apk-invest-value be-money">{fmtMoney(portfolio.currentValue, { decimals: 2 })}</div>

        <div className="apk-invest-grid">
          <div>
            <div className="apk-invest-mini-l">Total investment (SIP + lump sum)</div>
            <div className="apk-invest-mini-v be-money">{fmtMoney(portfolio.invested, { decimals: 2 })}</div>
          </div>
          <div>
            <div className="apk-invest-mini-l">Total return</div>
            <div className={`apk-invest-mini-v be-money ${gained ? 'is-gain' : 'is-loss'}`}>
              {gained ? '+' : '−'}{fmtMoney(Math.abs(portfolio.totalReturn ?? 0), { decimals: 2 })}
              {portfolio.returnPercent !== null && portfolio.returnPercent !== undefined && (
                <span className="apk-invest-pct"> ({fmtPct(portfolio.returnPercent, { decimals: 2 })})</span>
              )}
            </div>
          </div>
          <div>
            <div className="apk-invest-mini-l">Return since first investment</div>
            <div className="apk-invest-mini-v">{portfolio.returnSince ? fmtDate(portfolio.returnSince) : '—'}</div>
          </div>
          <div>
            <div className="apk-invest-mini-l">Last updated</div>
            <div className="apk-invest-mini-v">
              {portfolio.lastUpdated ? fmtDate(portfolio.lastUpdated) : '—'}
              {/* Stated, not hidden: a cached valuation shown as though it were
                  live is the one thing a money screen must never do. */}
              {isRefreshing && <span className="apk-invest-pct"> · refreshing</span>}
            </div>
          </div>
        </div>

        <div className="apk-invest-actions">
          <Link className="be-btn be-btn-primary be-btn-lg" to={EXPLORE_PATH}>
            Invest more
          </Link>
          <button type="button"
            className="be-btn be-btn-secondary be-btn-lg"
            onClick={() => openRedeem(portfolio.pools?.[0])}
            disabled={(portfolio.pools?.length ?? 0) === 0}
          >
            Redeem
          </button>
        </div>
      </div>

      {/* ── Investment Summary ────────────────────────────────────────────── */}
      <div className="be-card apk-summary-card">
        <div className="be-eyebrow">
          <PieChart size={14} strokeWidth={1.8} /> Investment Summary
        </div>
        <dl className="apk-summary-list">
          <div>
            <dt>Total SIP paid</dt>
            <dd>
              {summary.sipInstallments ?? 0} {summary.sipInstallments === 1 ? 'installment' : 'installments'}
            </dd>
          </div>
          <div>
            <dt>Total SIP amount</dt>
            <dd className="be-money">{fmtMoney(summary.sipTotal ?? 0)}</dd>
          </div>
          <div>
            <dt>Total lump sum investments</dt>
            <dd>{summary.lumpSumCount ?? 0}</dd>
          </div>
          <div>
            <dt>Total lump sum amount</dt>
            <dd className="be-money">{fmtMoney(summary.lumpSumTotal ?? 0)}</dd>
          </div>
          {(summary.redemptionCount ?? 0) > 0 && (
            <div>
              <dt>Redeemed</dt>
              <dd className="be-money">
                {fmtMoney(summary.redeemedTotal ?? 0)} ({summary.redemptionCount})
              </dd>
            </div>
          )}
          <div>
            <dt>Returns allocated</dt>
            <dd className="be-money">{fmtMoney(summary.allocatedGain ?? 0)}</dd>
          </div>
        </dl>
        <Link className="be-btn be-btn-ghost be-btn-block" to={ACTIVITY_PATH}>
          View all transactions
        </Link>
        <Link className="be-btn be-btn-ghost be-btn-block" to={WITHDRAWALS_PATH}>
          View withdrawal history
        </Link>
      </div>

      {/* ── Per-pool breakdown ────────────────────────────────────────────── */}
      {(portfolio.pools?.length ?? 0) > 1 && (
        <div className="be-card">
          <div className="be-eyebrow">
            <TrendingUp size={14} strokeWidth={1.8} /> By strategy
          </div>
          {portfolio.pools.map((pool) => (
            <div key={pool.fundId} className="apk-pool-row">
              <div>
                <div className="apk-pool-value be-money">{fmtMoney(pool.currentValue)}</div>
                <div className="apk-pool-meta">
                  Invested {fmtMoney(pool.invested)}
                  {pool.returnPercent !== null && pool.returnPercent !== undefined
                    ? ` · ${fmtPct(pool.returnPercent, { decimals: 2 })}`
                    : ''}
                </div>
              </div>
              <div className="apk-pool-actions">
                <Link className="be-btn be-btn-ghost be-btn-sm" to={buildPath('fund_detail', { fundId: pool.fundId })}>
                  View
                </Link>
                <button type="button" className="be-btn be-btn-secondary be-btn-sm" onClick={() => openRedeem(pool)}>
                  <RotateCcw size={13} /> Redeem
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Redemption sheet ──────────────────────────────────────────────── */}
      {/* Shared PageSheet wrapper. Two real fixes beyond the shared behaviour:
          this closed on `onMouseDown`, so a drag that started inside the panel and
          ended on the backdrop dismissed a part-entered redemption; and it is now
          `dismissible={!submitting}`, so Back and Escape cannot abandon a
          redemption request that has already been sent. */}
      <PageSheet
        open={Boolean(sheet)}
        onClose={closeRedeem}
        dismissible={!submitting}
        label={receipt ? 'Redemption submitted' : 'Redeem investment'}
      >
        {sheet && (
          <>
            <div className="apk-sheet-head">
              <h2>{receipt ? 'Redemption submitted' : 'Redeem investment'}</h2>
              <button type="button" className="apk-sheet-close" onClick={closeRedeem} aria-label="Close" disabled={submitting}>
                ×
              </button>
            </div>

            {receipt ? (
              <div className="apk-sheet-body">
                <p>
                  We have recorded your request for <strong>{fmtMoney(receipt.requestedAmount)}</strong>. Your
                  portfolio value changes once the redemption is settled.
                </p>
                <dl className="apk-summary-list">
                  <div>
                    <dt>From returns</dt>
                    <dd className="be-money">{fmtMoney(receipt.returnsComponent ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>From invested principal</dt>
                    <dd className="be-money">{fmtMoney(receipt.principalComponent ?? 0)}</dd>
                  </div>
                </dl>
                <button type="button" className="be-btn be-btn-primary be-btn-block" onClick={closeRedeem}>
                  Done
                </button>
              </div>
            ) : (
              <div className="apk-sheet-body">
                <div className="apk-sheet-amount">
                  <span>Available amount</span>
                  <strong className="be-money">{fmtMoney(sheet.currentValue)}</strong>
                </div>

                <fieldset className="apk-radio-group">
                  <legend className="apk-sr-only">Redemption type</legend>
                  {REDEMPTION_MODES.map((option) => (
                    <label key={option.value} className="apk-radio">
                      <input
                        type="radio"
                        name="redemption-mode"
                        value={option.value}
                        checked={mode === option.value}
                        onChange={() => setMode(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </fieldset>

                {mode === 'custom' && (
                  <label className="apk-field">
                    <span>Amount (₹)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="1"
                      max={sheet.currentValue ?? undefined}
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </label>
                )}

                {mode === 'returns_only' && (
                  <p className="be-disclosure">
                    Redeeming returns only leaves your invested principal untouched.
                  </p>
                )}

                {message && (
                  <div className={`apk-sheet-message apk-sheet-message--${message.type}`} role="alert">
                    {message.text}
                  </div>
                )}

                <button type="button"
                  className="be-btn be-btn-primary be-btn-block be-btn-lg"
                  onClick={onSubmitRedemption}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit redemption'}
                </button>
              </div>
            )}
          </>
        )}
      </PageSheet>
    </div>
  );
}
