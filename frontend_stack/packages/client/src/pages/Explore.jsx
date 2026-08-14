import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X, TrendingUp, ArrowRight, SlidersHorizontal, Bell, BarChart3, Layers } from 'lucide-react';
import { useFundList, useResearchContext } from '../data/clientResources.js';
import { buildPath } from '../navigation/routes.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { isComponentEnabled } from '@beonedge/shared/appConfig.js';
import { fmtMoney } from '../utils/format.js';
import { RiskBadge } from '@beonedge/shared/components/Badges.jsx';
import { SectorMiniBar } from '@beonedge/shared/components/SectorMiniBar.jsx';
import { LineComparisonChart } from '../components/Charts.jsx';
import { fundMonogram, formatReturnPct, formatNavDate, returnTone } from '../utils/fundDisplay.js';
import { Skeleton, EmptyState } from '@beonedge/shared';

const RISK_CHIP_ORDER = ['Growth', 'Balanced', 'Conservative'];

const SORT_OPTIONS = [
  { key: 'trending', label: 'Trending' },
  { key: 'aum_desc', label: 'Highest AUM' },
  { key: 'risk_asc', label: 'Lowest Risk' },
  { key: 'newest', label: 'Newest' },
];

const RISK_TEXT = {
  low: 'Lower risk',
  low_moderate: 'Low–moderate risk',
  moderate: 'Moderate risk',
  moderate_high: 'Moderate–high risk',
  high: 'Higher risk',
};

function FundCard({ fund, onNotify }) {
  const isActive = fund.status === 'active';

  const perf = fund.performanceSummary || {};
  const series = Array.isArray(fund.performanceSeries) ? fund.performanceSeries : [];
  const hasChart = series.length >= 2;
  const headline = formatReturnPct(perf.annualizedReturnPct, { decimals: 2 });
  const oneDay = formatReturnPct(perf.oneDayReturnPct, { decimals: 2 });
  const niftyPct = formatReturnPct(perf.niftyReturnPct, { decimals: 2, sign: false });
  const periodLabel = perf.selectedPeriod ? `${perf.selectedPeriod} annualised` : null;

  const riskDisplay = fund.riskText || RISK_TEXT[fund.riskLabel] || '';
  const metaBits = [riskDisplay, fund.category, fund.subCategory].filter(Boolean);
  const nav = fund.nav || null;
  const rating = fund.rating || null;
  const sectors = fund.sectors || [];

  return (
    <div className={`be-card apk-fc ${isActive ? 'apk-fc--active' : 'apk-fc--soon'}`}>
      <div className="apk-fc-top">
        <span className="apk-fc-mono" aria-hidden="true">{fundMonogram(fund.name)}</span>

        <div className="apk-fc-id">
          <h3 className="apk-fc-name">{fund.name}</h3>

          {metaBits.length > 0 && <div className="apk-fc-meta">{metaBits.join(' · ')}</div>}

        </div>

        <span className={`apk-fund-status apk-fund-status--${fund.status}`}>
          {isActive ? 'Active' : 'Coming Soon'}
        </span>

      </div>

      {headline ? (
        <div className="apk-fc-perf">
          <span className={`apk-fc-return apk-tone-${returnTone(perf.annualizedReturnPct)}`}>{headline}</span>

          {periodLabel && <span className="apk-fc-period">{periodLabel}</span>}

          {oneDay && (
            <span className={`apk-fc-oneday apk-tone-${returnTone(perf.oneDayReturnPct)}`}>
              {oneDay} <span className="apk-fc-oneday-l">1D</span>

            </span>
          )}
        </div>
      ) : (
        fund.tagline && <p className="apk-fc-tagline">{fund.tagline}</p>
      )}

      {hasChart && (
        <div className="apk-fc-chart">
          <LineComparisonChart series={series} width={320} height={56} padding={4} strokeWidth={1.75} />

          {niftyPct && <div className="apk-fc-bench">Nifty <span>{niftyPct}</span></div>}
        </div>
      )}

      <div className="apk-fc-grid">
        {nav?.value != null && (
          <div>
            <span className="apk-fc-grid-l">NAV{nav.asOf ? ` · ${formatNavDate(nav.asOf)}` : ''}</span>

            <span className="apk-fc-grid-v be-money">{fmtMoney(nav.value)}</span>

          </div>
        )}
        {rating?.value != null && (
          <div>
            <span className="apk-fc-grid-l">Rating</span>

            <span className="apk-fc-grid-v">{rating.value}<span className="apk-fc-star">★</span></span>
          </div>
        )}
        <div>
          <span className="apk-fc-grid-l">Min SIP</span>

          <span className="apk-fc-grid-v be-money">{fmtMoney(fund.minSip)}</span>

        </div>

        <div>
          <span className="apk-fc-grid-l">Fund size</span>

          <span className="apk-fc-grid-v be-money">{fmtMoney(fund.totalPoolSize)}</span>

        </div>

      </div>

      {!headline && !hasChart && sectors.length > 0 && (
        <SectorMiniBar sectors={sectors} height={6} className="apk-fc-sectors" />
      )}

      <div className="apk-fc-foot">
        {isActive ? (
          <Link className="apk-fc-cta apk-stretched-link" to={buildPath('fund_detail', { fundId: fund.id })}>
            View details &rarr;
          </Link>
        ) : (
          <button
            type="button"
            className="be-btn be-btn-primary be-btn-sm apk-fc-notify-btn"
            onClick={() => onNotify?.(`We'll notify you when ${fund.name} opens for investment.`)}
          >
            <Bell size={14} strokeWidth={2} /> Notify me when open

          </button>
        )}
      </div>

      <div className="apk-fc-disclaimer">Past performance is not indicative of future returns.</div>

    </div>
  );
}

function FeaturedCard({ fund }) {
  return (
    <div className="be-card apk-featured-card">
      <div className="apk-fund-header">
        <div>
          <h3>{fund.name}</h3>

          <p className="apk-fund-tagline apk-featured-tagline">{fund.tagline}</p>

        </div>

        <span className={`apk-fund-status apk-fund-status--${fund.status}`}>
          {fund.status === 'active' ? 'Active' : 'Coming Soon'}
        </span>

      </div>

      <div className="apk-fund-metrics">
        <span className="apk-fund-pool">{fmtMoney(fund.totalPoolSize)}</span>

        <span className="apk-fund-sectors">{(fund.sectors?.length || 0)} sectors</span>

      </div>

      <div className="apk-featured-foot">
        <RiskBadge riskLabel={fund.riskLabel} size="sm" />
        <Link className="apk-featured-link apk-stretched-link" to={buildPath('fund_detail', { fundId: fund.id })}>
          View Details <ArrowRight size={14} strokeWidth={2} />

        </Link>

      </div>

    </div>
  );
}

export default function Explore() {
  const appConfig = useAppConfig();
  const screen = appConfig.mobile.screens.explore;
  const copy = screen.copy;
  const fundsResource = useFundList();
  const researchResource = useResearchContext();
  const funds = fundsResource.data ?? (fundsResource.error ? [] : null);
  const research = researchResource.data ?? (researchResource.error ? [] : null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [riskFilter, setRiskFilter] = useState('All');
  const [sortKey, setSortKey] = useState('trending');
  const [notifyToast, setNotifyToast] = useState('');

  const filtered = useMemo(() => {
    if (!funds) return null;
    let result = funds;
    const t = q.trim().toLowerCase();
    if (t) {
      result = result.filter((f) => f.name.toLowerCase().includes(t) || f.tagline.toLowerCase().includes(t));
    }
    if (statusFilter !== 'All') {
      const map = { Active: 'active', 'Coming Soon': 'coming_soon' };
      result = result.filter((f) => f.status === map[statusFilter]);
    }
    if (riskFilter !== 'All') {
      const reverseMap = { Growth: ['high', 'moderate_high'], Balanced: ['moderate', 'low_moderate'], Conservative: ['low'] };
      result = result.filter((f) => reverseMap[riskFilter]?.includes(f.riskLabel));
    }
    const sorted = [...result];
    switch (sortKey) {
      case 'aum_desc':
        sorted.sort((a, b) => (b.totalPoolSize ?? 0) - (a.totalPoolSize ?? 0));
        break;
      case 'risk_asc': {
        const riskOrder = { low: 0, low_moderate: 1, moderate: 2, moderate_high: 3, high: 4 };
        sorted.sort((a, b) => (riskOrder[a.riskLabel] ?? 99) - (riskOrder[b.riskLabel] ?? 99));
        break;
      }
      case 'newest':
        sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        break;
      case 'trending':
      default:
        sorted.sort((a, b) => {
          const aActive = a.status === 'active' ? 1 : 0;
          const bActive = b.status === 'active' ? 1 : 0;
          if (aActive !== bActive) return bActive - aActive;
          return (b.totalPoolSize ?? 0) - (a.totalPoolSize ?? 0);
        });
        break;
    }
    return sorted;
  }, [funds, q, statusFilter, riskFilter, sortKey]);

  const trending = useMemo(() => {
    if (!funds) return [];
    return funds
      .filter((f) => f.status === 'active')
      .slice()
      .sort((a, b) => (b.totalPoolSize ?? 0) - (a.totalPoolSize ?? 0))
      .slice(0, 3);
  }, [funds]);

  const stats = useMemo(() => {
    if (!funds) return null;
    const totalFunds = funds.length;
    const totalAum = funds.reduce((s, f) => s + (Number(f.totalPoolSize) || 0), 0);
    const activeFunds = funds.filter((f) => f.status === 'active').length;
    return { totalFunds, totalAum, activeFunds };
  }, [funds]);

  return (
    <div className="apk-screen">
      <h1 className="apk-h">{copy.title}</h1>

      {}
      {trending.length > 0 && (
        <div className="apk-explore-hero">
          <div className="apk-explore-hero-head">
            <TrendingUp size={16} strokeWidth={2} />

            Trending Funds
          </div>

          <div className="apk-featured-row">
            {trending.map((f) => (
              <FeaturedCard key={f.id} fund={f} />
            ))}
          </div>

        </div>
      )}

      {}
      {isComponentEnabled(appConfig, 'explore', 'search') && (
        <div className="apk-search">
          <Search size={20} strokeWidth={1.5} />

          <input
            className="be-input"
            placeholder={copy.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
          {q.length > 0 && (
            <button
              className="apk-search-clear"
              onClick={() => setQ('')}
              aria-label="Clear search"
              type="button"
            >
              <X size={16} strokeWidth={2} />

            </button>
          )}
        </div>
      )}

      <div className="apk-filter-bar">
        <div className="apk-filter-group">
          {['All', 'Active', 'Coming Soon'].map((chip) => (
            <button
              key={chip}
              className={`apk-filter-chip ${statusFilter === chip ? 'apk-filter-chip--active' : ''}`}
              onClick={() => setStatusFilter(chip)}
              type="button"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="apk-filter-group">
          {['All', ...RISK_CHIP_ORDER].map((chip) => (
            <button
              key={chip}
              className={`apk-filter-chip ${riskFilter === chip ? 'apk-filter-chip--active' : ''}`}
              onClick={() => setRiskFilter(chip)}
              type="button"
            >
              {chip}
            </button>
          ))}
        </div>

      </div>

      {}
      {stats && (
        <div className="apk-stats-bar">
          <div className="apk-stat-tile">
            <Layers size={14} strokeWidth={2} />

            <span className="apk-stat-tile-v">{stats.totalFunds}</span>

            <span className="apk-stat-tile-l">Funds</span>

          </div>

          <div className="apk-stat-tile">
            <BarChart3 size={14} strokeWidth={2} />

            <span className="apk-stat-tile-v">{fmtMoney(stats.totalAum)}</span>

            <span className="apk-stat-tile-l">Total AUM</span>

          </div>

          <div className="apk-stat-tile">
            <TrendingUp size={14} strokeWidth={2} />

            <span className="apk-stat-tile-v">{stats.activeFunds}</span>

            <span className="apk-stat-tile-l">Active</span>

          </div>

        </div>
      )}

      {}
      {filtered && filtered.length > 1 && (
        <div className="apk-sort-bar">
          <SlidersHorizontal size={14} strokeWidth={2} />

          <span className="be-eyebrow apk-sort-eyebrow">Sort by</span>

          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`apk-sort-chip ${sortKey === opt.key ? 'apk-sort-chip--active' : ''}`}
              onClick={() => setSortKey(opt.key)}
              type="button"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {isComponentEnabled(appConfig, 'explore', 'product_catalog') && (
        <>
          {!filtered ? (
            <div className="apk-strategy-grid">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="be-card apk-fc-skeleton">
                  <Skeleton variant="text" width="30%" height={14} />

                  <Skeleton variant="text" width="50%" height={28} delay={40} />

                  <Skeleton variant="text" width="100%" height={56} delay={80} />

                  <div className="apk-fc-skeleton-grid">
                    <Skeleton variant="text" width="80%" height={14} delay={120} />

                    <Skeleton variant="text" width="80%" height={14} delay={120} />

                    <Skeleton variant="text" width="80%" height={14} delay={160} />

                    <Skeleton variant="text" width="80%" height={14} delay={160} />

                  </div>

                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Search size={24} strokeWidth={1.5} />}

              title="No funds found"
              description={copy.noMatches || 'No funds match your filters.'}
              action={
                <button type="button"
                  className="be-btn be-btn-secondary be-btn-sm"
                  onClick={() => { setQ(''); setStatusFilter('All'); setRiskFilter('All'); setSortKey('trending'); }}
                >
                  Clear all filters
                </button>
              }
            />
          ) : (
            <div className="apk-strategy-grid">
              {filtered.map((f) => (
                <FundCard key={f.id} fund={f} onNotify={(msg) => { setNotifyToast(msg); setTimeout(() => setNotifyToast(''), 3000); }} />
              ))}
            </div>
          )}
        </>
      )}

      <hr className="be-rule" />

      {isComponentEnabled(appConfig, 'explore', 'research_context') && (research === null || research.length > 0) && (
        <>
        <div className="be-eyebrow">{copy.researchEyebrow}</div>

        <div className="be-card apk-research-card">
          {!research ? (
            <div className="apk-research-grid">
              {[0,1,2].map(i => (
                <div key={i} className="apk-research-skel-item">
                  <Skeleton variant="text" width="40%" height={14} />

                  <Skeleton variant="text" width="60%" height={12} delay={40} />

                  <Skeleton variant="text" width="30%" height={18} delay={80} />

                </div>
              ))}
            </div>
          ) : (
            <div className="apk-research-grid">
              {research.map((item) => {
                const pct = parseInt(item.value, 10);
                const hasPct = !Number.isNaN(pct) && item.value.includes('%');
                return (
                  <div key={item.label} className="apk-research-row">
                    <div className="apk-research-meta">
                      <div className="apk-research-label">{item.label}</div>

                      <div className="apk-research-note">{item.note}</div>

                    </div>

                    <div className="apk-research-value-wrap">
                      {hasPct && (
                        <div className="apk-research-bar-track">
                          <div
                            className="apk-research-bar-fill"
                            style={{ '--w': `${Math.min(Math.max(pct, 0), 100)}%` }}
                          />

                        </div>
                      )}
                      <div className="apk-research-value be-num">{item.value}</div>

                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

        </>
      )}

      {isComponentEnabled(appConfig, 'explore', 'performance_disclosure') && (
        <div className="apk-disclaimer-banner">
          <div className="apk-disclaimer-icon">ⓘ</div>

          <div className="apk-disclaimer-text">
            <strong>Important:</strong> Past performance is not indicative of future returns.

            All investments carry risk. Please read the disclosure documents carefully before investing.
          </div>

        </div>
      )}

      {isComponentEnabled(appConfig, 'explore', 'allocation_disclosure') && (
        <div className="be-disclosure">{copy.allocationDisclosure}</div>
      )}
      <div className="be-disclosure">
        Investments are subject to market risk. Please read all scheme-related documents carefully before investing.
      </div>

      {notifyToast && (
        <div className="apk-toast" role="status">{notifyToast}</div>
      )}
    </div>
  );
}
