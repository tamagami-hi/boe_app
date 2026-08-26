import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PieChart, Wallet, TrendingUp } from 'lucide-react';
import { usePortfolio } from '../data/clientResources.js';
import { buildPath } from '../navigation/routes.js';
import { fmtMoney, fmtPct, fmtDate } from '../utils/format.js';
import { EmptyState, ErrorState } from '@beonedge/shared';

const EXPLORE_PATH = buildPath('explore');
const ACTIVITY_PATH = buildPath('activity');
export default function Portfolio() {
  const {
    data: portfolio,
    error: portfolioError,
    isLoading,
    isRefreshing,
    refresh: refreshPortfolio,
  } = usePortfolio();

  if (isLoading) {
    return (
      <div className="apk-screen">
        <div className="be-card apk-portfolio-skeleton">Loading your investment…</div>

      </div>
    );
  }

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
              {}
              {isRefreshing && <span className="apk-invest-pct"> · refreshing</span>}

            </div>

          </div>

        </div>

        <div className="apk-invest-actions">
          <Link className="be-btn be-btn-primary be-btn-lg" to={EXPLORE_PATH}>
            Invest more
          </Link>

        </div>

      </div>


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

          <div>
            <dt>Returns allocated</dt>

            <dd className="be-money">{fmtMoney(summary.allocatedGain ?? 0)}</dd>

          </div>

        </dl>

        <Link className="be-btn be-btn-ghost be-btn-block" to={ACTIVITY_PATH}>
          View all transactions
        </Link>

      </div>

      {}
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

              </div>

            </div>
          ))}
        </div>
      )}

      {}

    </div>
  );
}
