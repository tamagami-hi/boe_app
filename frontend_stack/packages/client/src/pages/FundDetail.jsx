import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Share2, Wallet,
  Calendar, Shield, Bell,
  Briefcase, CheckCircle, AlertTriangle, FileText, MessageSquare,
} from 'lucide-react';
import AppBar from '../layout/AppBar.jsx';
import * as fundsApi from '../services/fundsApi.js';
import * as disclosureApi from '../services/disclosureApi.js';
import { DonutChart } from '../components/Charts.jsx';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { isComponentEnabled } from '@beonedge/shared/appConfig.js';
import { fmtMoney, fmtPct, fmtDate } from '../utils/format.js';
import MoneyValue from '@beonedge/shared/components/MoneyValue.jsx';
import { RISK_LABELS, LIFECYCLE_LABELS } from './fundDetail/fundDetailModel.js';
import DisclosureLink from './fundDetail/DisclosureLink.jsx';
import PerformanceSection from './fundDetail/PerformanceSection.jsx';
import HoldingsAnalysis from './fundDetail/HoldingsAnalysis.jsx';
import FundDetailSkeleton from './fundDetail/FundDetailSkeleton.jsx';

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
        {/* Hero. No back button here: AppBar above already owns Back, and this one
            called the raw `navigate(-1)` that AppBar deliberately stopped using
            because it is dead on a deep link. Two Back controls, one broken. */}
        <div className="apk-detail-hero" style={{ '--hero-bg': heroBg }}>
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

        <div className="apk-detail-stack">
          <div className="apk-detail-main">
            {/* Performance vs Nifty */}
            <PerformanceSection fund={fund} />

            {/* Objective */}
            {isComponentEnabled(appConfig, 'fundDetail', 'objective') && (
              <div className="be-card apk-fund-obj">
                <div className="be-eyebrow">{copy.objectiveTitle}</div>
                <p>{fund.objective}</p>
                <div className="apk-fund-obj-meta">
                  <div><strong>{copy.riskLabel}</strong>{RISK_LABELS[fund.riskLabel]}</div>
                  <div><strong>{copy.horizonLabel}</strong>{fund.horizon}</div>
                </div>
              </div>
            )}

            {/* Key Stats */}
            {isComponentEnabled(appConfig, 'fundDetail', 'key_stats') && (
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
            )}

            {/* Sector Distribution */}
            {isComponentEnabled(appConfig, 'fundDetail', 'allocation_chart') && chartConfig.showSectorDistribution !== false && sectors.length > 0 && (
              <div className="be-card apk-alloc apk-sector-chart">
                <div className="apk-sector-chart-wrap">
                  {/* Flat donut, deliberately. A perspective pie distorts slice
                      AREA, so two sectors of equal weight do not look equal —
                      the one thing an allocation chart exists to communicate. */}
                  <DonutChart
                    data={sectors.map((s) => ({ label: s.name, percentage: s.percentage, color: s.color }))}
                    size={180}
                    thickness={28}
                    ariaLabel="Sector allocation"
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
            )}

            {/* Investment Breakdown */}
            {isComponentEnabled(appConfig, 'fundDetail', 'portfolio_exposure') && chartConfig.showInvestmentBreakdown !== false && investments.length > 0 && (
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
            )}

            {/* Fund Portfolio — the administrator-curated stock list. */}
            {isComponentEnabled(appConfig, 'fundDetail', 'portfolio_exposure') && (fund.stocks?.length ?? 0) > 0 && (
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
            )}

            {/* Fees */}
            {isActive && isComponentEnabled(appConfig, 'fundDetail', 'fees') && fund.fees?.length > 0 && (
              <div className="be-card apk-fund-fees">
                <div className="be-eyebrow">{copy.feesTitle}</div>
                {fund.fees.map((f) => (
                  <div key={f.label} className="apk-fund-fees-row"><span>{f.label}</span><span>{f.value}</span></div>
                ))}
                <div className="be-disclosure apk-card-note">{copy.feesDisclosure}</div>
              </div>
            )}

            {/* SEBI / AMFI Disclosure Block */}
            {disclosures && (
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

                {/* Typed destinations from the service edge. Both fields used
                    to be dropped straight into `<Link to={...}>`, which
                    accepted an unprefixed path (how `/investor-charter`
                    shipped), a cross-scope `/admin/...` path, or a
                    `javascript:` URL. A regulator-hosted charter is a
                    legitimate external target, so external is supported — but
                    it opens through the validated helper, not an anchor. */}
                <div className="apk-disclosure-links">
                  <DisclosureLink
                    destination={disclosures.investorCharter}
                    icon={FileText}
                    label="Investor Charter"
                  />
                  <DisclosureLink
                    destination={disclosures.grievance}
                    icon={MessageSquare}
                    label="Grievance Redressal"
                  />
                </div>
              </div>
            )}

            {/* Holdings analysis */}
            <HoldingsAnalysis fund={fund} />

            {/* Investment Flow CTA */}
            <div className="be-card apk-invest-cta-card">
              {isActive ? (
                <>
                  <div className="apk-invest-cta-icon">
                    <Wallet size={28} strokeWidth={1.5} />
                  </div>
                  <h3>Ready to invest?</h3>
                  <p>Start building your portfolio with this fund today.</p>
                  <div className="apk-invest-cta-actions">
                    <button type="button" className="be-btn be-btn-primary be-btn-lg apk-invest-cta-btn" onClick={() => navigate(`/app/invest/sip/${fund.id}`)}>
                      Start SIP
                    </button>
                    <button type="button" className="be-btn be-btn-secondary be-btn-lg apk-invest-cta-btn" onClick={() => navigate(`/app/invest/lumpsum/${fund.id}`)}>
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
                  <button type="button" className="be-btn be-btn-primary be-btn-lg apk-invest-cta-btn apk-invest-cta-btn--narrow">
                    <Bell size={16} strokeWidth={2} /> Notify me
                  </button>
                </>
              )}
            </div>

            {/* Methodology disclosure */}
            {isComponentEnabled(appConfig, 'fundDetail', 'methodology_disclosure') && (
              <div className="be-disclosure">{copy.methodologyPrefix} · {fund.methodology} Disclosure {fund.disclosureVersion}. Past performance does not guarantee future returns.</div>
            )}

            {/* Bottom Disclaimer */}
            <div className="apk-fund-disclaimer-card">
              <div className="apk-disclaimer-icon">ⓘ</div>
              <p><strong>Important Disclaimer:</strong> Past performance is not indicative of future returns. All investments are subject to market risks. Please read all scheme-related documents carefully before investing.</p>
            </div>
          </div>

          <div className="apk-detail-side">
            {/* Minimums */}
            {isComponentEnabled(appConfig, 'fundDetail', 'minimums') && (
              <div className="apk-fund-mins">
                <div><div className="apk-fund-mins-l">{copy.minSipLabel}</div><div className="apk-fund-mins-v be-money"><MoneyValue amount={fund.minSip} source={fund.source || 'mock'} asOf={new Date().toISOString()} showBadge={false} /></div></div>
                <div><div className="apk-fund-mins-l">{copy.minLumpsumLabel}</div><div className="apk-fund-mins-v be-money"><MoneyValue amount={fund.minLumpsum} source={fund.source || 'mock'} asOf={new Date().toISOString()} showBadge={false} /></div></div>
                <div><div className="apk-fund-mins-l">{copy.lockInLabel}</div><div className="apk-fund-mins-v">{fund.lockInText}</div></div>
              </div>
            )}

            {/* Calculator */}
            {isActive && isComponentEnabled(appConfig, 'fundDetail', 'sip_projection') && (
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
                      <button type="button" key={v} className={'apk-chip' + (sipAmount === v ? ' is-active' : '')} onClick={() => setSipAmount(v)}>{fmtMoney(v)}</button>
                    ))}
                  </div>
                </div>
                <div className="be-field">
                  <label>Duration</label>
                  <div className="apk-chip-row">
                    {screen.calculator.durationMonths.map((m) => (
                      <button type="button" key={m} className={'apk-chip' + (sipMonths === m ? ' is-active' : '')} onClick={() => setSipMonths(m)}>{m} mo</button>
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
            )}
          </div>
        </div>

        {isActive && isComponentEnabled(appConfig, 'fundDetail', 'action_bar') && (
          <div className="apk-action-bar apk-fund-action">
            <button type="button" className="be-btn be-btn-secondary be-btn-lg" onClick={() => navigate(`/app/invest/lumpsum/${fund.id}`)}>{copy.oneTimeButton}</button>
            <button type="button" className="be-btn be-btn-primary be-btn-lg" onClick={() => navigate(`/app/invest/sip/${fund.id}`)}>{copy.sipButton}</button>
          </div>
        )}
        {!isActive && (
          <div className="apk-banner">{copy.closedBanner || 'This fund is coming soon.'}</div>
        )}
      </div>
    </>
  );
}
