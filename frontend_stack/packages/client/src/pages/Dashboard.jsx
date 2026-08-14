import React from 'react';
import { Link } from 'react-router-dom';
import { Plus, Repeat, Receipt, Compass, ShieldCheck, Bell, TrendingUp } from 'lucide-react';
import { useSession } from '../store/SessionContext.jsx';
import { buildPath } from '../navigation/routes.js';
import {
  useEligibility,
  useFundsById,
  usePortfolio,
  useResearchContext,
  useSipPlans,
} from '../data/clientResources.js';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { isComponentEnabled, visibleQuickActions } from '@beonedge/shared/appConfig.js';
import { fmtMoney, fmtPct, fmtDate } from '../utils/format.js';
import MoneyValue from '@beonedge/shared/components/MoneyValue.jsx';
import { Skeleton, EmptyState, ErrorState } from '@beonedge/shared';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const ACTION_ICONS = { Plus, Repeat, Receipt, Compass };

// Paths come from the manifest, never from a literal, so a route rename cannot
// leave a dead link on the home screen.
const PORTFOLIO_PATH = buildPath('portfolio');
const EXPLORE_PATH = buildPath('explore');
const VERIFY_EMAIL_PATH = buildPath('verify_email');

export default function Dashboard() {
  const { user } = useSession();
  const appConfig = useAppConfig();
  const screen = appConfig.mobile.screens.dashboard;
  const copy = screen.copy;

  // Five reads, but through the shared cache: a bottom-nav tap remounts this page,
  // and every one of these used to re-issue its request. They are now de-duplicated
  // with Explore and Portfolio (fund list, research, portfolio) and with the
  // investment-flow guard (eligibility), and a warm return refetches only what has
  // actually gone stale.
  const portfolio = usePortfolio();
  const { data: plans } = useSipPlans();
  const { data: research } = useResearchContext();
  const { data: fundsById } = useFundsById();
  const { data: eligibility } = useEligibility(user?.id);

  const firstName = (user?.name || '').split(' ')[0];
  const activeSips = (Array.isArray(plans) ? plans : []).filter((plan) =>
    ['active', 'paused', 'pending_mandate', 'draft'].includes(plan.status),
  );
  const researchItems = Array.isArray(research) ? research : [];

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
      <div className="apk-greet">
        <div className="apk-greet-eyebrow">{greeting()}</div>
        <h1 className="apk-greet-name">{firstName || 'Investor'}</h1>
        <div className="apk-greet-line" aria-hidden="true" />
      </div>

      {eligibility && eligibility.canInvest === false && (
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
          <Link className="be-btn be-btn-primary be-btn-sm" to={VERIFY_EMAIL_PATH}>
            Verify now
          </Link>
        </div>
      )}

      <div className="apk-dashboard-grid">
        {/* Portfolio */}
        {isComponentEnabled(appConfig, 'dashboard', 'portfolio_summary') && (
          <div>
            {portfolio.data ? (
              <Link
                to={PORTFOLIO_PATH}
                className="be-card apk-portfolio"
                aria-label="Portfolio — view your investment"
              >
                {/* Option B: the headline is the current portfolio value, with
                    total investment and return beneath it. */}
                <div className="apk-portfolio-eye">{copy.portfolioTitle}</div>
                <div className="apk-portfolio-num be-money">
                  <MoneyValue amount={portfolio.data.currentValue} source={portfolio.data.source} asOf={portfolio.data.lastUpdated} showBadge={false} />
                </div>
                <div className="apk-portfolio-row">
                  <span className="apk-portfolio-label">Current portfolio value</span>
                </div>
                <div className="apk-portfolio-grid">
                  <div>
                    <div className="apk-portfolio-mini-l">Total invested</div>
                    <div className="apk-portfolio-mini-v be-money">{fmtMoney(portfolio.data.invested, { decimals: 2 })}</div>
                  </div>
                  <div>
                    <div className="apk-portfolio-mini-l">Total return</div>
                    <div className="apk-portfolio-mini-v be-money">
                      {portfolio.data.returnPercent === null || portfolio.data.returnPercent === undefined
                        ? `${fmtMoney(portfolio.data.totalReturn ?? 0, { decimals: 2 })}`
                        : `${fmtMoney(portfolio.data.totalReturn ?? 0, { decimals: 2 })} (${fmtPct(portfolio.data.returnPercent, { decimals: 2 })})`}
                    </div>
                  </div>
                </div>
                {/* Money on screen states its own age. `isRefreshing` is shown
                    rather than blanking the card, so a background refresh never
                    replaces figures the user is reading with a spinner. */}
                <div className="be-disclosure apk-disclosure-tight">
                  {portfolio.data.lastUpdated
                    ? `Last updated ${fmtDate(portfolio.data.lastUpdated)} · Published by BeOnEdge`
                    : 'Published by BeOnEdge'}
                  {portfolio.isRefreshing ? ' · Refreshing' : ''}
                </div>
              </Link>
            ) : portfolio.error ? (
              /* Was an indefinite skeleton: a failed read set the value back to
                 null, so a hiccup looked like a load that never finished. */
              <div className="be-card apk-portfolio">
                <ErrorState
                  title="We could not load your investment"
                  description="Your money is unaffected — this screen could not reach the server."
                  onRetry={portfolio.refresh}
                  busy={portfolio.isRefreshing}
                />
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
        )}

        {/* Quick actions — bento grid */}
        {isComponentEnabled(appConfig, 'dashboard', 'quick_actions') && quickActions.length > 0 && (
          <div>
            <div className="apk-bento">
              {quickActions.map((action, index) => {
                const Icon = ACTION_ICONS[action.icon] || Compass;
                const isPrimary = index === 0;
                return (
                  <Link
                    key={action.id}
                    to={action.route}
                    className={`apk-quick-btn${isPrimary ? ' apk-quick-btn--primary' : ''}`}
                  >
                    <span className="apk-quick-icon-wrap" aria-hidden="true">
                      <Icon size={isPrimary ? 24 : 20} strokeWidth={1.5} />
                    </span>
                    <span>{action.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Active SIPs */}
        {isComponentEnabled(appConfig, 'dashboard', 'active_sips') && (
          <div>
            <div className="apk-section-head">
              <div className="be-eyebrow">{copy.activeSipsTitle}</div>
              <Link className="apk-link" to={PORTFOLIO_PATH}>{copy.viewAllLabel}</Link>
            </div>
            {activeSips.length === 0 ? (
              <EmptyState
                icon={<TrendingUp size={22} strokeWidth={1.5} />}
                title={copy.noActiveTitle}
                description={copy.noActiveBody}
                action={
                  <Link className="be-btn be-btn-primary" to={EXPLORE_PATH}>
                    {copy.noActiveCta}
                  </Link>
                }
              />
            ) : (
              activeSips.map((o) => {
                const fundName = fundsById[o.fundId]?.name || 'BeOnEdge Strategy';
                return (
                <Link
                  key={o.id}
                  to={buildPath('fund_detail', { fundId: o.fundId })}
                  className="be-card apk-sip"
                  aria-label={`${fundName} — plan details`}
                >
                  <div className="apk-sip-head">
                    <div>
                      <div className="apk-sip-name">{fundName}</div>
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
                </Link>
                );
              })
            )}
          </div>
        )}

        {/* Research context */}
        {isComponentEnabled(appConfig, 'dashboard', 'research_context') && researchItems.length > 0 && (
          <div>
            <div className="apk-section-head">
              <div className="be-eyebrow">{copy.researchTitle}</div>
            </div>
            <div className="be-card apk-pulse">
              {researchItems.map((item) => (
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
        )}

        {/* Notifications */}
        <div>
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
      </div>

      {isComponentEnabled(appConfig, 'dashboard', 'risk_disclosure') && (
        <div className="be-disclosure">{copy.riskDisclosure}</div>
      )}
    </div>
  );
}
