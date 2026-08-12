import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Repeat, Receipt, Compass, ShieldCheck, Bell, TrendingUp } from 'lucide-react';
import { useSession } from '../store/SessionContext.jsx';
import * as portfolioApi from '../services/portfolioApi.js';
import * as ordersApi from '../services/ordersApi.js';
import * as researchApi from '../services/researchApi.js';
import * as fundsApi from '../services/fundsApi.js';
import { getInvestingEligibility } from '../services/eligibilityApi.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { isComponentEnabled, visibleQuickActions } from '@beonedge/shared/appConfig.js';
import { fmtMoney, fmtPct, fmtDate } from '../utils/format.js';
import MoneyValue from '@beonedge/shared/components/MoneyValue.jsx';
import { Skeleton, EmptyState, FadeIn } from '@beonedge/shared';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const ACTION_ICONS = { Plus, Repeat, Receipt, Compass };

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useSession();
  const appConfig = useAppConfig();
  const screen = appConfig.mobile.screens.dashboard;
  const copy = screen.copy;
  const [portfolio, setPortfolio] = useState(null);
  const [orders, setOrders] = useState([]);
  const [research, setResearch] = useState([]);
  const [fundsById, setFundsById] = useState({});
  const [eligibility, setEligibility] = useState(null);

  useEffect(() => {
    portfolioApi.getPortfolio().then(setPortfolio).catch(() => setPortfolio(null));
    // Plans come from the SIP endpoint: a plan's own state (draft / pending mandate /
    // active / paused) lives on the plan, not on the orders it generates.
    ordersApi.listSips().then(setOrders).catch(() => setOrders([]));
    researchApi.getResearchContext().then(setResearch).catch(() => setResearch([]));
    fundsApi.listFunds().then((fs) => setFundsById(Object.fromEntries(fs.map((f) => [f.id, f])))).catch(() => setFundsById({}));
    // Derived server-side on every read; drives the "verify your email" prompt.
    getInvestingEligibility().then(setEligibility).catch(() => setEligibility(null));
  }, [appConfig.publishedAt]);

  const firstName = (user?.name || '').split(' ')[0];
  const activeSips = orders.filter((plan) =>
    ['active', 'paused', 'pending_mandate', 'draft'].includes(plan.status),
  );

  function sipBadgeClass(status) {
    switch (status) {
      case 'active': return 'be-badge-active';
      case 'paused': return 'be-badge-paused';
      case 'cancelled': return 'be-badge-failed';
      // A plan waiting on its mandate, or still a draft, is not yet collecting.
      case 'pending_mandate':
      case 'draft':
        return 'be-badge-paused';
      default: return 'be-badge-neutral';
    }
  }
  function sipBadgeLabel(status) {
    switch (status) {
      case 'active': return 'Active';
      case 'paused': return 'Paused';
      case 'cancelled': return 'Cancelled';
      case 'pending_mandate': return 'Awaiting mandate';
      case 'draft': return 'Not started';
      default: return status;
    }
  }

  const quickActions = visibleQuickActions(appConfig);

  return (
    <div className="apk-screen">
      <FadeIn direction="up" distance={12} duration={500}>
        <div className="apk-greet">
          <div className="apk-greet-eyebrow">{greeting()}</div>
          <h1 className="apk-greet-name">{firstName || 'Investor'}</h1>
          <div className="apk-greet-line" aria-hidden="true" />
        </div>
      </FadeIn>

      {eligibility && eligibility.canInvest === false && (
        <FadeIn direction="up" distance={10} duration={420}>
          <div className="be-card apk-approval-card apk-kyc-prompt">
            <div className="apk-approval-icon"><ShieldCheck size={20} strokeWidth={1.6} /></div>
            <div>
              <div className="be-eyebrow">Verification needed</div>
              <div className="apk-h-sm">Verify your email to start investing</div>
              <p>
                {eligibility.reason === 'kyc_required' || eligibility.kycState !== 'approved'
                  ? 'We send a 6-character code (case-sensitive) to your registered email address.'
                  : 'Your account needs one more check before investing unlocks.'}
              </p>
            </div>
            <button
              type="button"
              className="be-btn be-btn-primary be-btn-sm"
              onClick={() => navigate('/app/verify-email')}
            >
              Verify now
            </button>
          </div>
        </FadeIn>
      )}

      <div className="apk-dashboard-grid">
        {/* Portfolio */}
        {isComponentEnabled(appConfig, 'dashboard', 'portfolio_summary') && (
          <FadeIn direction="up" distance={16} duration={500} delay={150}>
            <div className="apk-grid-portfolio">
              {portfolio ? (
                <div className="be-card apk-portfolio" onClick={() => navigate('/app/portfolio')}>
                  {/* Option B: the headline is the current portfolio value, with
                      total investment and return beneath it. */}
                  <div className="apk-portfolio-eye">{copy.portfolioTitle}</div>
                  <div className="apk-portfolio-num be-money">
                    <MoneyValue amount={portfolio.currentValue} source={portfolio.source} asOf={portfolio.lastUpdated} showBadge={false} />
                  </div>
                  <div className="apk-portfolio-row">
                    <span className="apk-portfolio-label">Current portfolio value</span>
                  </div>
                  <div className="apk-portfolio-grid">
                    <div>
                      <div className="apk-portfolio-mini-l">Total invested</div>
                      <div className="apk-portfolio-mini-v be-money">{fmtMoney(portfolio.invested, { decimals: 2 })}</div>
                    </div>
                    <div>
                      <div className="apk-portfolio-mini-l">Total return</div>
                      <div className="apk-portfolio-mini-v be-money">
                        {portfolio.returnPercent === null || portfolio.returnPercent === undefined
                          ? `${fmtMoney(portfolio.totalReturn ?? 0, { decimals: 2 })}`
                          : `${fmtMoney(portfolio.totalReturn ?? 0, { decimals: 2 })} (${fmtPct(portfolio.returnPercent, { decimals: 2 })})`}
                      </div>
                    </div>
                  </div>
                  <div className="be-disclosure apk-disclosure-tight">
                    {portfolio.lastUpdated
                      ? `Last updated ${fmtDate(portfolio.lastUpdated)} · Published by BeOnEdge`
                      : 'Published by BeOnEdge'}
                  </div>
                </div>
              ) : (
                <div className="be-card apk-portfolio">
                  <div className="apk-portfolio-skeleton">
                    <Skeleton variant="text" width="30%" height={10} />
                    <Skeleton variant="text" width="55%" height={48} />
                    <Skeleton variant="text" width="40%" height={14} />
                    <div className="apk-portfolio-grid apk-portfolio-grid--tight">
                      <div>
                        <Skeleton variant="text" width="60%" height={10} />
                        <Skeleton variant="text" width="70%" height={18} delay={80} />
                      </div>
                      <div>
                        <Skeleton variant="text" width="50%" height={10} />
                        <Skeleton variant="text" width="60%" height={18} delay={80} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </FadeIn>
        )}

        {/* Quick actions — bento grid */}
        {isComponentEnabled(appConfig, 'dashboard', 'quick_actions') && quickActions.length > 0 && (
          <FadeIn direction="up" distance={16} duration={500} delay={200}>
            <div className="apk-grid-quick">
              <div className="apk-bento">
                {quickActions.map((action, index) => {
                  const Icon = ACTION_ICONS[action.icon] || Compass;
                  const isPrimary = index === 0;
                  return (
                    <button
                      key={action.id}
                      className={`apk-quick-btn${isPrimary ? ' apk-quick-btn--primary' : ''}`}
                      onClick={() => navigate(action.route)}
                      aria-label={action.label}
                      title={action.label}
                    >
                      <span className="apk-quick-icon-wrap">
                        <Icon size={isPrimary ? 24 : 20} strokeWidth={1.5} />
                      </span>
                      <span>{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </FadeIn>
        )}

        {/* Active SIPs */}
        {isComponentEnabled(appConfig, 'dashboard', 'active_sips') && (
          <div className="apk-grid-sips">
            <FadeIn direction="up" distance={10} duration={400} delay={250}>
              <div className="apk-section-head">
                <div className="be-eyebrow">{copy.activeSipsTitle}</div>
                <a className="apk-link" onClick={() => navigate('/app/portfolio')}>{copy.viewAllLabel}</a>
              </div>
            </FadeIn>
            {activeSips.length === 0 ? (
              <FadeIn direction="up" distance={10} duration={400} delay={300}>
                <EmptyState
                  icon={<TrendingUp size={22} strokeWidth={1.5} />}
                  title={copy.noActiveTitle}
                  description={copy.noActiveBody}
                  action={
                    <button className="be-btn be-btn-primary" onClick={() => navigate('/app/explore')}>
                      {copy.noActiveCta}
                    </button>
                  }
                />
              </FadeIn>
            ) : (
              activeSips.map((o, i) => (
                <FadeIn key={o.id} direction="up" distance={12} duration={400} delay={300 + i * 60}>
                  <div className="be-card apk-sip" onClick={() => navigate(`/app/funds/${o.fundId}`)}>
                    <div className="apk-sip-head">
                      <div>
                        <div className="apk-sip-name">{fundsById[o.fundId]?.name || 'BeOnEdge Strategy'}</div>
                        <div className="apk-sip-meta">SIP · {fmtMoney(o.amount, { source: o.source || 'mock', asOf: o.asOf || o.createdAt || new Date().toISOString() })} on day {o.debitDay} · UPI AutoPay</div>
                      </div>
                      <span className={'be-badge ' + sipBadgeClass(o.status)}>
                        <span className="be-badge-dot" />{sipBadgeLabel(o.status)}
                      </span>
                    </div>
                    <div className="apk-sip-row">
                      <div className="apk-sip-amt be-money"><MoneyValue amount={o.amount} source={o.source || 'mock'} asOf={o.asOf || o.createdAt || new Date().toISOString()} /></div>
                      <div className="apk-sip-next">Next debit · {fmtDate(o.nextDueDate)}</div>
                    </div>
                  </div>
                </FadeIn>
              ))
            )}
          </div>
        )}

        {/* Research context */}
        {isComponentEnabled(appConfig, 'dashboard', 'research_context') && research.length > 0 && (
          <FadeIn direction="up" distance={10} duration={400} delay={350}>
            <div className="apk-grid-research">
              <div className="apk-section-head">
                <div className="be-eyebrow">{copy.researchTitle}</div>
              </div>
              <div className="be-card apk-pulse">
                {research.map((item) => (
                  <div key={item.label} className="apk-pulse-row">
                    <div>
                      <div className="apk-pulse-name">{item.label}</div>
                      <div className="apk-pulse-note">{item.note}</div>
                    </div>
                    <div className="apk-pulse-val be-num">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        )}

        {/* Notifications */}
        <FadeIn direction="up" distance={10} duration={400} delay={400}>
          <div className="apk-grid-notifications">
            <div className="be-card apk-notifications">
              <div className="apk-section-head apk-section-head--pad-bottom">
                <div className="be-eyebrow">Notifications</div>
              </div>
              <div className="apk-notifications-empty">
                <Bell size={24} strokeWidth={1.5} />
                <p>You're all caught up.</p>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>

      {isComponentEnabled(appConfig, 'dashboard', 'risk_disclosure') && (
        <div className="be-disclosure">{copy.riskDisclosure}</div>
      )}
    </div>
  );
}
