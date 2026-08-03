import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Share2, ArrowLeft, Wallet, Activity,
  Calendar, Shield, Bell,
  Briefcase, CheckCircle, AlertTriangle, FileText, MessageSquare,
} from 'lucide-react';
import AppBar from '../layout/AppBar.jsx';
import * as fundsApi from '../services/fundsApi.js';
import * as disclosureApi from '../services/disclosureApi.js';
import { AllocationRing, PieChart3D, LineComparisonChart, DonutChart } from '../components/Charts.jsx';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { isComponentEnabled } from '@beonedge/shared/appConfig.js';
import { fmtMoney, fmtNum, fmtPct, fmtDate } from '../utils/format.js';
import { formatReturnPct, formatNavDate, returnTone } from '../utils/fundDisplay.js';
import MoneyValue from '@beonedge/shared/components/MoneyValue.jsx';
import { FadeIn, Skeleton } from '@beonedge/shared';

const RISK_LABELS = {
  low: 'Low', low_moderate: 'Low-Moderate', moderate: 'Moderate',
  moderate_high: 'Moderate-High', high: 'High',
};

const LIFECYCLE_LABELS = {
  published: 'Preview',
  active: 'Active Fund',
  paused: 'Paused',
  closed: 'Closed',
};

const DONUT_PALETTE = [
  '#1F7A4D', '#B5894A', '#5C6470', '#A8741C', '#4AA9D8',
  '#7A9E3A', '#C0563E', '#8A929D', '#3E7C8C', '#9C7339',
];

const ADVANCED_RATIO_ROWS = [
  { key: 'pe', label: 'P/E' },
  { key: 'pb', label: 'P/B' },
  { key: 'beta', label: 'Beta' },
  { key: 'alpha', label: 'Alpha' },
  { key: 'sharpe', label: 'Sharpe' },
  { key: 'sortino', label: 'Sortino' },
];

function withPaletteColors(items) {
  return items.map((it, i) => ({ ...it, color: it.color || DONUT_PALETTE[i % DONUT_PALETTE.length] }));
}

function AllocationLegend({ items }) {
  return (
    <div className="apk-ha-legend">
      {items.map((it, i) => (
        <span key={i} className="apk-ha-legend-item">
          <span className="apk-ha-dot" style={{ '--sector-color': it.color }} />
          <span className="apk-ha-legend-label">{it.label}</span>
          <span className="apk-ha-legend-pct be-num">{Number(it.percentage).toFixed(2)}%</span>
        </span>
      ))}
    </div>
  );
}

function PerformanceSection({ fund }) {
  const summary = fund.performanceSummary || {};
  const series = Array.isArray(fund.performanceSeries) ? fund.performanceSeries : [];
  const periods = Array.isArray(fund.performancePeriods) ? fund.performancePeriods : [];
  const [activeKey, setActiveKey] = useState(summary.selectedPeriod || periods[0]?.key || 'ALL');

  const headline = formatReturnPct(summary.annualizedReturnPct, { decimals: 2 });
  const oneDay = formatReturnPct(summary.oneDayReturnPct, { decimals: 2 });
  const hasSeries = series.length >= 2;
  if (!headline && !hasSeries) return null;
  const active = periods.find((p) => p.key === activeKey);

  return (
    <FadeIn direction="up" distance={14} duration={450}>
      <div className="be-card apk-pf">
        {headline && (
          <div className="apk-pf-head">
            <span className={`apk-pf-return apk-tone-${returnTone(summary.annualizedReturnPct)}`}>{headline}</span>
            {summary.selectedPeriod && <span className="apk-pf-period">{summary.selectedPeriod} annualised</span>}
            {oneDay && (
              <span className={`apk-pf-oneday apk-tone-${returnTone(summary.oneDayReturnPct)}`}>
                {oneDay} <span className="apk-pf-oneday-l">1D</span>
              </span>
            )}
          </div>
        )}
        {hasSeries ? (
          <LineComparisonChart series={series} width={340} height={150} padding={8} strokeWidth={2}
            showLegend legendFundLabel="Fund" legendBenchmarkLabel="Nifty 50" />
        ) : (
          <div className="apk-pf-pending">Performance data pending.</div>
        )}
        {periods.length > 0 && (
          <div className="apk-pf-chips" role="tablist" aria-label="Performance period">
            {periods.map((p) => (
              <button key={p.key} type="button" role="tab" aria-selected={activeKey === p.key}
                className={`apk-pf-chip ${activeKey === p.key ? 'is-active' : ''}`}
                onClick={() => setActiveKey(p.key)}>{p.label}</button>
            ))}
          </div>
        )}
        {active && (
          <div className="apk-pf-chip-detail">
            <span>Fund <strong className={`apk-tone-${returnTone(active.fundReturnPct)}`}>{formatReturnPct(active.fundReturnPct, { decimals: 2 })}</strong></span>
            <span>Nifty 50 <strong>{formatReturnPct(active.niftyReturnPct, { decimals: 2, sign: false })}</strong></span>
          </div>
        )}
        <p className="apk-pf-disclaimer">
          Returns are admin-published and indicative. Investments are subject to market risk.
          Past performance is not indicative of future returns.
        </p>
      </div>
    </FadeIn>
  );
}

function HoldingsAnalysis({ fund }) {
  const assetAllocation = withPaletteColors(Array.isArray(fund.assetAllocation) ? fund.assetAllocation : []);
  const sectors = withPaletteColors(
    (Array.isArray(fund.sectors) ? fund.sectors : []).map((s) => ({ label: s.name, percentage: s.percentage, color: s.color })),
  );
  const ratios = fund.advancedRatios || {};
  const ratioRows = ADVANCED_RATIO_ROWS.filter((r) => Number.isFinite(Number(ratios[r.key])));

  const hasAsset = assetAllocation.length > 0;
  const hasSectors = sectors.length > 0;
  const hasRatios = ratioRows.length > 0;
  if (!hasAsset && !hasSectors && !hasRatios) return null;
  const poolLabel = fund.totalPoolSize ? fmtMoney(fund.totalPoolSize) : '';

  return (
    <FadeIn direction="up" distance={14} duration={450}>
      <div className="be-card apk-ha">
        <div className="be-eyebrow">Holdings analysis</div>

        {hasAsset && (
          <div className="apk-ha-block">
            <h4 className="apk-ha-title">Equity / Debt / Cash split</h4>
            <DonutChart data={assetAllocation} size={184} thickness={28} centerLabel={poolLabel}
              ariaLabel="Equity debt cash split" />
            <AllocationLegend items={assetAllocation} />
          </div>
        )}

        {hasSectors && (
          <div className="apk-ha-block">
            <h4 className="apk-ha-title">Equity sector allocation</h4>
            <DonutChart data={sectors} size={184} thickness={28} ariaLabel="Equity sector allocation" />
            <AllocationLegend items={sectors} />
          </div>
        )}

        {hasRatios && (
          <div className="apk-ha-block">
            <h4 className="apk-ha-title">Advanced ratios</h4>
            <div className="apk-ha-ratios">
              {ratioRows.map((r) => (
                <div key={r.key} className="apk-ha-ratio">
                  <span>{r.label}</span>
                  <strong className="be-num">{Number(ratios[r.key]).toFixed(2)}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {fund.holdingsAsOf && <div className="apk-ha-asof">*Holdings as of {formatNavDate(fund.holdingsAsOf)}</div>}
      </div>
    </FadeIn>
  );
}

function FundDetailSkeleton() {
  return (
    <div className="apk-detail-stack">
      <div className="apk-detail-main">
        <div className="apk-detail-hero">
          <Skeleton variant="text" width="30%" height={16} />
          <Skeleton variant="text" width="80%" height={36} delay={40} />
          <Skeleton variant="text" width="60%" height={14} delay={80} />
        </div>
        <div className="be-card apk-detail-skel-card">
          <Skeleton variant="text" width="40%" height={20} />
          <Skeleton variant="text" width="100%" height={120} delay={40} />
        </div>
        <div className="be-card apk-detail-skel-card">
          <Skeleton variant="text" width="50%" height={20} />
          <Skeleton variant="text" width="100%" height={80} delay={40} />
        </div>
        <div className="be-card apk-detail-skel-card">
          <Skeleton variant="text" width="40%" height={20} />
          <Skeleton variant="text" width="100%" height={60} delay={40} />
        </div>
      </div>
    </div>
  );
}

export default function FundDetail() {
  const { fundId } = useParams();
  const navigate = useNavigate();
  const appConfig = useAppConfig();
  const screen = appConfig.mobile.screens.fundDetail;
  const copy = screen.copy;
  const [fund, setFund] = useState(null);
  const [disclosures, setDisclosures] = useState(null);
  const [sipAmount, setSipAmount] = useState(screen.calculator.defaultAmount ?? '');
  const [sipMonths, setSipMonths] = useState(screen.calculator.defaultMonths ?? '');

  useEffect(() => {
    let cancelled = false;
    fundsApi.getFund(fundId).then((data) => {
      if (!cancelled) setFund(data);
    }).catch(() => {
      if (!cancelled) setFund(null);
    });
    return () => { cancelled = true; };
  }, [fundId, appConfig.publishedAt]);

  useEffect(() => {
    let cancelled = false;
    disclosureApi.getDisclosures().then((data) => {
      if (!cancelled) setDisclosures(data);
    }).catch(() => {
      if (!cancelled) setDisclosures(null);
    });
    return () => { cancelled = true; };
  }, [appConfig.publishedAt]);

  const projectedInvested = useMemo(() => {
    const n = Number(sipMonths) || 0;
    const amount = Number(sipAmount) || 0;
    return amount * n;
  }, [sipAmount, sipMonths]);

  function onShare() {
    const url = window.location.href;
    if (navigator.share) navigator.share({ title: fund?.name, url }).catch(() => {});
    else navigator.clipboard?.writeText(url);
  }

  if (!fund) {
    return (
      <>
        <AppBar title="" />
        <div className="apk-screen apk-fund-detail">
          <FundDetailSkeleton />
        </div>
      </>
    );
  }

  const isActive = fund.status === 'active';
  const analytics = fund.analytics || {};
  const chartConfig = fund.chartConfig || {};
  const sectors = fund.sectors || [];
  const investments = fund.investments || [];
  const largestSector = sectors.reduce((max, s) => (s.percentage > (max?.percentage || 0) ? s : max), null);

  const lifecycleLabel = LIFECYCLE_LABELS[fund.lifecycleStage] || LIFECYCLE_LABELS.published;
  const heroBg = largestSector?.color ? `${largestSector.color}0D` : 'transparent';

  return (
    <>
      <AppBar title={fund.name} rightIcon={Share2} onRight={onShare} rightAriaLabel="Share" />
      <div className="apk-screen apk-fund-detail">
        {/* Hero */}
        <FadeIn direction="up" distance={16} duration={500}>
          <div className="apk-detail-hero" style={{ '--hero-bg': heroBg }}>
            <button className="apk-back-link" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} strokeWidth={1.5} />
              <span>Back to funds</span>
            </button>
            <div className="apk-detail-hero-top">
              <div className="apk-detail-hero-text">
                <div className="apk-detail-hero-badges">
                  <div className="be-eyebrow">{fund.categoryEyebrow}</div>
                  <span className="apk-lifecycle-badge">{lifecycleLabel}</span>
                </div>
                <h1 className="apk-h apk-detail-hero-title">{fund.name}</h1>
                <p className="apk-detail-hero-tagline">{fund.tagline}</p>
                <div className="apk-detail-hero-trust">
                  <span className="apk-trust-badge"><CheckCircle size={12} strokeWidth={2} /> SEBI Registered</span>
                  <span className="apk-trust-sep">·</span>
                  <span className="apk-trust-badge"><CheckCircle size={12} strokeWidth={2} /> Disclosure Compliant</span>
                  <span className="apk-trust-sep">·</span>
                  <span className="apk-trust-badge"><CheckCircle size={12} strokeWidth={2} /> Audited Holdings</span>
                </div>
                <p className="apk-detail-hero-quote">Investments are subject to market risks. Past performance is not indicative of future returns.</p>
              </div>
              <div className="apk-detail-status">
                {isActive ? (
                  <span className="be-badge be-badge-active">
                    <span className="be-badge-dot" />
                    Active
                  </span>
                ) : (
                  <span className="be-badge be-badge-gold">
                    <span className="be-badge-dot" />
                    Coming Soon
                  </span>
                )}
              </div>
            </div>
          </div>
        </FadeIn>

        <div className="apk-detail-stack">
          <div className="apk-detail-main">
            {/* Performance vs Nifty */}
            <PerformanceSection fund={fund} />

            {/* Objective */}
            {isComponentEnabled(appConfig, 'fundDetail', 'objective') && (
              <FadeIn direction="up" distance={12} duration={400} delay={80}>
                <div className="be-card apk-fund-obj">
                  <div className="be-eyebrow">{copy.objectiveTitle}</div>
                  <p>{fund.objective}</p>
                  <div className="apk-fund-obj-meta">
                    <div><strong>{copy.riskLabel}</strong>{RISK_LABELS[fund.riskLabel]}</div>
                    <div><strong>{copy.horizonLabel}</strong>{fund.horizon}</div>
                  </div>
                </div>
              </FadeIn>
            )}

            {/* Key Stats */}
            {isComponentEnabled(appConfig, 'fundDetail', 'key_stats') && (
              <FadeIn direction="up" distance={12} duration={400} delay={120}>
                <div className="be-card apk-key-stats">
                  <div className="be-eyebrow">{copy.keyStatsTitle || 'Key Metrics'}</div>
                  <div className="apk-key-stats-grid">
                    <div className="apk-stat-card">
                      <div className="apk-stat-card-icon apk-stat-card-icon--green">
                        <Briefcase size={18} strokeWidth={2} />
                      </div>
                      {/* Option B "Fund Overview": the latest published monthly
                          AUM. Investors see only the closing figure and when it
                          was last updated — there is no per-unit price. */}
                      <div className="apk-stat-card-label">Fund Size (AUM)</div>
                      <div className="apk-stat-card-value be-money">
                        <MoneyValue
                          amount={fund.totalPoolSize}
                          source={fund.source || 'mock'}
                          asOf={fund.fundSizeUpdatedAt || new Date().toISOString()}
                        />
                      </div>
                      {fund.fundSizeUpdatedAt && (
                        <div className="apk-stat-card-note">
                          Last updated {fmtDate(fund.fundSizeUpdatedAt)}
                        </div>
                      )}
                    </div>
                    <div className="apk-stat-card">
                      <div className="apk-stat-card-icon apk-stat-card-icon--gold">
                        <Calendar size={18} strokeWidth={2} />
                      </div>
                      <div className="apk-stat-card-label">Min SIP</div>
                      <div className="apk-stat-card-value be-money"><MoneyValue amount={fund.minSip} source={fund.source || 'mock'} asOf={new Date().toISOString()} showBadge={false} /></div>
                    </div>
                    <div className="apk-stat-card">
                      <div className="apk-stat-card-icon apk-stat-card-icon--red">
                        <Shield size={18} strokeWidth={2} />
                      </div>
                      <div className="apk-stat-card-label">Risk Level</div>
                      <div className="apk-stat-card-value">{RISK_LABELS[fund.riskLabel]}</div>
                    </div>
                    {analytics.fundAge && (
                      <div className="apk-stat-card">
                        <div className="apk-stat-card-icon apk-stat-card-icon--gold-soft">
                          <Calendar size={18} strokeWidth={2} />
                        </div>
                        <div className="apk-stat-card-label">Fund Age</div>
                        <div className="apk-stat-card-value be-num">{analytics.fundAge.display}</div>
                      </div>
                    )}
                  </div>
                  <div className="apk-key-stats-divider" />
                  <div className="apk-key-stats-row">
                    <span>Horizon</span>
                    <span>{fund.horizon}</span>
                  </div>
                  <div className="apk-key-stats-row">
                    <span>Risk</span>
                    <span className="be-badge be-badge-neutral apk-key-stats-badge">{RISK_LABELS[fund.riskLabel]}</span>
                  </div>
                </div>
              </FadeIn>
            )}

            {/* Sector Distribution */}
            {isComponentEnabled(appConfig, 'fundDetail', 'allocation_chart') && chartConfig.showSectorDistribution !== false && sectors.length > 0 && (
              <FadeIn direction="up" distance={12} duration={400} delay={160}>
                <div className="be-card apk-alloc apk-sector-chart-3d">
                  <div className="apk-sector-chart-wrap">
                    <PieChart3D
                      data={sectors.map((s) => ({ label: s.name, percentage: s.percentage, color: s.color }))}
                      size={180}
                      depth={18}
                    />
                  </div>
                  <div className="apk-sector-legend">
                    <div className="be-eyebrow">Sector Allocation</div>
                    {sectors.map((s) => (
                      <div key={s.id} className="apk-sector-legend-item">
                        <span className="apk-sector-color" style={{ '--sector-color': s.color }} />
                        <span>{s.name}</span>
                        <span className="be-num">{s.percentage}%</span>
                      </div>
                    ))}
                    {largestSector && (
                      <div className="apk-concentration-note">Largest concentration: {largestSector.name}</div>
                    )}
                  </div>
                </div>
              </FadeIn>
            )}

            {/* Investment Breakdown */}
            {isComponentEnabled(appConfig, 'fundDetail', 'portfolio_exposure') && chartConfig.showInvestmentBreakdown !== false && investments.length > 0 && (
              <FadeIn direction="up" distance={12} duration={400} delay={200}>
                <div className="be-card apk-investment-breakdown">
                  <div className="be-eyebrow">{copy.exposureTitle || 'Investment Breakdown'}</div>
                  {sectors.map((sector) => {
                    const sectorInvestments = investments.filter((inv) => inv.sectorId === sector.id);
                    if (sectorInvestments.length === 0) return null;
                    return (
                      <div key={sector.id} className="apk-investment-sector">
                        <div className="apk-investment-sector-header">
                          <span className="apk-sector-color" style={{ '--sector-color': sector.color }} />
                          <strong>{sector.name}</strong>
                          <span className="be-num">({sector.percentage}%)</span>
                        </div>
                        <div className="apk-investment-list">
                          {sectorInvestments.map((inv, idx) => (
                            <div key={inv.id || idx} className="apk-investment-item">
                              <span className="apk-investment-item-name">
                                {chartConfig.showCompanyNames !== false ? inv.companyName : `Company ${idx + 1}`}
                              </span>
                              <div className="apk-investment-item-right">
                                <div className="apk-investment-progress">
                                  <div className="apk-investment-progress-track">
                                    <div
                                      className="apk-investment-progress-fill"
                                      style={{ '--pct': Math.min(1, ((inv.percentage ?? 0) / (sector.percentage || 1))) }}
                                    />
                                  </div>
                                </div>
                                <span className="be-num apk-investment-item-pct">{fmtPct((inv.percentage ?? 0) / 100, { sign: false, decimals: 1 })}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </FadeIn>
            )}

            {/* Fund Portfolio — the administrator-curated stock list. */}
            {isComponentEnabled(appConfig, 'fundDetail', 'portfolio_exposure') && (fund.stocks?.length ?? 0) > 0 && (
              <FadeIn direction="up" distance={12} duration={400} delay={240}>
                <div className="be-card apk-holding">
                  <div className="be-eyebrow">Fund Portfolio</div>
                  <div className="apk-holding-head">
                    <span>Stock name</span>
                    <span>Quarter added</span>
                  </div>
                  {fund.stocks.map((stock) => (
                    <div key={`${stock.name}-${stock.quarterAdded}`} className="apk-holding-row">
                      <div>
                        <div className="apk-holding-name">{stock.name}</div>
                        {stock.weight !== null && stock.weight !== undefined && (
                          <div className="apk-holding-sub be-num">
                            {fmtPct(stock.weight / 100, { sign: false, decimals: 2 })}
                          </div>
                        )}
                      </div>
                      <div className="apk-holding-pct">{stock.quarterAdded}</div>
                    </div>
                  ))}
                  <div className="be-disclosure apk-disclosure-tight">Updated quarterly</div>
                </div>
              </FadeIn>
            )}

            {/* Fees */}
            {isActive && isComponentEnabled(appConfig, 'fundDetail', 'fees') && fund.fees?.length > 0 && (
              <FadeIn direction="up" distance={12} duration={400} delay={280}>
                <div className="be-card apk-fund-fees">
                  <div className="be-eyebrow">{copy.feesTitle}</div>
                  {fund.fees.map((f) => (
                    <div key={f.label} className="apk-fund-fees-row"><span>{f.label}</span><span>{f.value}</span></div>
                  ))}
                  <div className="be-disclosure apk-card-note">{copy.feesDisclosure}</div>
                </div>
              </FadeIn>
            )}

            {/* SEBI / AMFI Disclosure Block */}
            {disclosures && (
              <FadeIn direction="up" distance={12} duration={400} delay={320}>
                <div className="be-card apk-disclosure-block">
                  <div className="be-eyebrow">Regulatory Disclosures</div>

                  <div className="apk-riskometer">
                    <div className="apk-riskometer-label">
                      <span className="apk-riskometer-badge" style={{ '--riskometer-color': disclosures.riskometer?.color || 'var(--be-slate)' }}>
                        <AlertTriangle size={12} strokeWidth={2} />
                        {disclosures.riskometer?.label || disclosures.riskometer?.level}
                      </span>
                      <span className="apk-riskometer-level">Risk-o-meter</span>
                    </div>
                    <div className="apk-riskometer-bar">
                      {['low', 'moderate', 'high', 'very_high'].map((lvl) => (
                        <div
                          key={lvl}
                          className={`apk-riskometer-segment ${disclosures.riskometer?.level === lvl ? 'is-active' : ''}`}
                          style={{ '--riskometer-segment-bg': disclosures.riskometer?.level === lvl ? (disclosures.riskometer?.color || 'var(--be-slate)') : 'var(--be-border)' }}
                        />
                      ))}
                    </div>
                    <p className="apk-riskometer-desc">{disclosures.riskometer?.description}</p>
                  </div>

                  <div className="apk-disclosure-rows">
                    <div className="apk-disclosure-row">
                      <span className="apk-disclosure-row-label">Scheme Category</span>
                      <span className="apk-disclosure-row-value">{disclosures.schemeCategory}</span>
                    </div>
                    <div className="apk-disclosure-row">
                      <span className="apk-disclosure-row-label">Expense Ratio</span>
                      <span className="apk-disclosure-row-value">{disclosures.expenseRatio}</span>
                    </div>
                    <div className="apk-disclosure-row">
                      <span className="apk-disclosure-row-label">Exit Load</span>
                      <span className="apk-disclosure-row-value">{disclosures.exitLoad}</span>
                    </div>
                  </div>

                  <div className="apk-sebi-text">
                    <AlertTriangle size={14} strokeWidth={2} />
                    <span>{disclosures.sebiDisclosure}</span>
                  </div>

                  <div className="apk-disclosure-links">
                    <Link className="apk-disclosure-link" to={disclosures.investorCharterUrl}>
                      <FileText size={14} strokeWidth={2} />
                      Investor Charter
                    </Link>
                    <Link className="apk-disclosure-link" to={disclosures.grievanceUrl}>
                      <MessageSquare size={14} strokeWidth={2} />
                      Grievance Redressal
                    </Link>
                  </div>
                </div>
              </FadeIn>
            )}

            {/* Holdings analysis */}
            <HoldingsAnalysis fund={fund} />

            {/* Investment Flow CTA */}
            <FadeIn direction="up" distance={14} duration={450} delay={120}>
              <div className="be-card apk-invest-cta-card">
                {isActive ? (
                  <>
                    <div className="apk-invest-cta-icon">
                      <Wallet size={28} strokeWidth={1.5} />
                    </div>
                    <h3>Ready to invest?</h3>
                    <p>Start building your portfolio with this fund today.</p>
                    <div className="apk-invest-cta-actions">
                      <button className="be-btn be-btn-primary be-btn-lg apk-invest-cta-btn" onClick={() => navigate(`/app/invest/sip/${fund.id}`)}>
                        Start SIP
                      </button>
                      <button className="be-btn be-btn-secondary be-btn-lg apk-invest-cta-btn" onClick={() => navigate(`/app/invest/lumpsum/${fund.id}`)}>
                        One-time Investment
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="apk-invest-cta-icon apk-invest-cta-icon--muted">
                      <Bell size={28} strokeWidth={1.5} />
                    </div>
                    <h3>Coming Soon</h3>
                    <p>This fund is not currently accepting investments. You&apos;ll be notified when it opens.</p>
                    <button className="be-btn be-btn-primary be-btn-lg apk-invest-cta-btn apk-invest-cta-btn--narrow">
                      <Bell size={16} strokeWidth={2} /> Notify me
                    </button>
                  </>
                )}
              </div>
            </FadeIn>

            {/* Methodology disclosure */}
            {isComponentEnabled(appConfig, 'fundDetail', 'methodology_disclosure') && (
              <div className="be-disclosure">{copy.methodologyPrefix} · {fund.methodology} Disclosure {fund.disclosureVersion}. Past performance does not guarantee future returns.</div>
            )}

            {/* Bottom Disclaimer */}
            <FadeIn direction="up" distance={10} duration={400} delay={160}>
              <div className="apk-fund-disclaimer-card">
                <div className="apk-disclaimer-icon">ⓘ</div>
                <p><strong>Important Disclaimer:</strong> Past performance is not indicative of future returns. All investments are subject to market risks. Please read all scheme-related documents carefully before investing.</p>
              </div>
            </FadeIn>
          </div>

          <div className="apk-detail-side">
            {/* Minimums */}
            {isComponentEnabled(appConfig, 'fundDetail', 'minimums') && (
              <FadeIn direction="up" distance={10} duration={400} delay={80}>
                <div className="apk-fund-mins">
                  <div><div className="apk-fund-mins-l">{copy.minSipLabel}</div><div className="apk-fund-mins-v be-money"><MoneyValue amount={fund.minSip} source={fund.source || 'mock'} asOf={new Date().toISOString()} showBadge={false} /></div></div>
                  <div><div className="apk-fund-mins-l">{copy.minLumpsumLabel}</div><div className="apk-fund-mins-v be-money"><MoneyValue amount={fund.minLumpsum} source={fund.source || 'mock'} asOf={new Date().toISOString()} showBadge={false} /></div></div>
                  <div><div className="apk-fund-mins-l">{copy.lockInLabel}</div><div className="apk-fund-mins-v">{fund.lockInText}</div></div>
                </div>
              </FadeIn>
            )}

            {/* Calculator */}
            {isActive && isComponentEnabled(appConfig, 'fundDetail', 'sip_projection') && (
              <FadeIn direction="up" distance={10} duration={400} delay={120}>
                <div className="be-card apk-fund-calc">
                  <div className="be-eyebrow">{copy.projectionTitle}</div>
                  <div className="be-field">
                    <label>Monthly SIP amount</label>
                    <div className="apk-amount-row">
                      <span className="apk-amount-symbol">₹</span>
                      <input className="be-input be-num" type="number" min={fund.minSip ?? 0} value={sipAmount ?? ''} onChange={(e) => setSipAmount(e.target.value === '' ? '' : Number(e.target.value))} />
                    </div>
                    <div className="apk-chip-row apk-field-chips">
                      {screen.calculator.amountPresets.map((v) => (
                        <button key={v} className={'apk-chip' + (sipAmount === v ? ' is-active' : '')} onClick={() => setSipAmount(v)}>{fmtMoney(v)}</button>
                      ))}
                    </div>
                  </div>
                  <div className="be-field">
                    <label>Duration</label>
                    <div className="apk-chip-row">
                      {screen.calculator.durationMonths.map((m) => (
                        <button key={m} className={'apk-chip' + (sipMonths === m ? ' is-active' : '')} onClick={() => setSipMonths(m)}>{m} mo</button>
                      ))}
                    </div>
                  </div>
                  {projectedInvested > 0 && (
                    <div className="apk-fund-calc-out">
                      <div className="apk-fund-calc-out-l">Total invested at end of {sipMonths || 'configured'} months</div>
                      <div className="apk-fund-calc-out-v be-money"><MoneyValue amount={projectedInvested} source="derived" asOf={new Date().toISOString()} showBadge={false} /></div>
                    </div>
                  )}
                  <div className="be-disclosure">{copy.projectionDisclosure}</div>
                </div>
              </FadeIn>
            )}
          </div>
        </div>

        {isActive && isComponentEnabled(appConfig, 'fundDetail', 'action_bar') && (
          <div className="apk-action-bar apk-fund-action">
            <button className="be-btn be-btn-secondary be-btn-lg" onClick={() => navigate(`/app/invest/lumpsum/${fund.id}`)}>{copy.oneTimeButton}</button>
            <button className="be-btn be-btn-primary be-btn-lg" onClick={() => navigate(`/app/invest/sip/${fund.id}`)}>{copy.sipButton}</button>
          </div>
        )}
        {!isActive && (
          <div className="apk-banner">{copy.closedBanner || 'This fund is coming soon.'}</div>
        )}
      </div>
    </>
  );
}
