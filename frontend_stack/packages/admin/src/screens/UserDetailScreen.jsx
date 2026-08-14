import { useCallback, useEffect, useRef, useState } from 'react';
import {
  User, PieChart, Briefcase, CreditCard, Repeat, LayoutGrid, TrendingUp,
  CheckCircle2, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { apiRequest } from '@beonedge/client/services/_util.js';
import './admin-screens-shared.css';
import I from '../components/I.jsx';
import EmptyState from '@beonedge/shared/components/EmptyState.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import GainAllocationForm from './GainAllocationForm.jsx';
import StateBadge from '../components/StateBadge.jsx';
import { fmtDateTime, fmtPaise as rupees, fmtPaiseSigned as signedRupees, humanizeState, initials } from '../helpers/formatters.js';

// Money goes through the one shared formatter (see helpers/formatters.js): paise in,
// an INR string out, and '—' for a missing value. Every table here used
// `₹{(row.amount || 0)}` against a payload that carries `amountPaise`, so every
// payment, mandate and plan was reported as ₹0.
function date(value) {
  return value ? fmtDateTime(value) : '—';
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'investments', label: 'Investments', icon: TrendingUp },
  { id: 'payments', label: 'Payments', icon: CreditCard },
];

/*
 * `GET /v1/admin/users/:id/detail` returns user, roles, the latest KYC case, recent
 * orders, payments, mandates and SIP plans, plus derived positions and portfolio
 * totals. That is the whole payload.
 *
 * Four tables and two lists here were fed from hardcoded `[]`: redemption requests,
 * SIP control requests, support tickets, notifications and per-user audit logs. Each
 * rendered "No redemption requests." / "No support tickets." on every user, which is
 * a statement about that person's record that nothing had ever asked the server for.
 * Two of them (support tickets, SIP control requests) are retired features with no
 * schema at all. They are gone, and with them the Support tab that held them.
 *
 * `orders` was in the payload and rendered nowhere — the investor's actual activity,
 * including redemptions, was the one thing missing. It now has a table.
 */
function UserDetailScreen({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const tablistRef = useRef(null);
  // Bumped after an allocation so the derived figures refetch.
  const [refreshToken, setRefreshToken] = useState(0);
  const reload = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiRequest(`/v1/admin/users/${encodeURIComponent(userId)}/detail`, { scope: 'admin' })
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load user details.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId, refreshToken]);

  const user = data?.user || {};
  const kyc = data?.kyc || null;
  const sipPlans = data?.sips || [];
  const orders = data?.orders || [];
  const payments = data?.payments || [];
  const mandates = data?.mandates || [];
  const positions = data?.positions || [];
  const portfolio = data?.portfolio || null;

  /*
   * A user with no KYC case at all used to be reported as having "No blocking
   * reasons", because the check only looked at a case that was present. Account
   * state was not considered either, so a suspended account read as clear.
   */
  const blockingReasons = [];
  if (kyc === null) blockingReasons.push('No KYC case on record');
  else if (kyc.status !== 'approved') blockingReasons.push(`KYC is ${humanizeState(kyc.status).toLowerCase()}`);
  if (user.status && user.status !== 'active') blockingReasons.push(`Account is ${user.status}`);
  const hasBlocking = blockingReasons.length > 0;

  /*
   * Arrow-key navigation is what makes a roving tabindex usable. Inactive tabs carry
   * tabIndex -1, so without this a keyboard user could reach the active tab and had
   * no way to move off it: the tab strip was unoperable by keyboard entirely.
   */
  function onTabKeyDown(event) {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex = null;
    if (event.key in keys) nextIndex = (index + keys[event.key] + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveTab(TABS[nextIndex].id);
    tablistRef.current?.querySelector(`#user-detail-tab-${TABS[nextIndex].id}`)?.focus();
  }

  function renderInfoCard(title, icon, fields) {
    return (
      <div className="adm-card">
        <div className="adm-card-head">
          <h2 className="adm-card-title"><I icon={icon} size={16} /> {title}</h2>
        </div>
        <div className="adm-info-grid">
          {fields.map(({ label, value }) => (
            <div key={label} className="adm-field-readonly">
              <span className="adm-field-readonly__label">{label}</span>
              <strong className="adm-field-readonly__value">{value}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /*
   * Cells are returned as an array so each one is emitted with the `data-label` of
   * its own column. The card view on a phone reads those labels; hand-written rows
   * drift from their headers, and these tables are five and six columns wide.
   */
  function renderTable(title, icon, columns, rows, cellsFor, emptyMsg, keyFor) {
    return (
      <div className="adm-card adm-table">
        <div className="adm-card-head">
          <h2 className="adm-card-title"><I icon={icon} size={16} /> {title}</h2>
        </div>
        {rows.length === 0 ? (
          <EmptyState description={emptyMsg} />
        ) : (
          <div className="adm-table-scroll">
            <table className="adm-table-cards">
              <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={keyFor?.(row, index) ?? row.id ?? index}>
                    {cellsFor(row).map((cell, cellIndex) => (
                      <td
                        key={columns[cellIndex]}
                        data-label={columns[cellIndex]}
                        className={cell?.className}
                      >
                        {cell?.node ?? cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="adm-screen adm-screen--narrow">
      {loading && !data && (
        <div className="adm-card be-pad-5 be-stack-2">
          <Skeleton width="40%" height="1.5rem" />
          <Skeleton width="100%" height="4rem" />
          <Skeleton width="100%" height="4rem" />
        </div>
      )}

      {error && (
        <div className="ash-load-note" role="alert">
          <span>{error}</span>
          <button type="button" className="ash-btn ash-btn-secondary ash-btn-sm" disabled={loading} onClick={reload}>
            <I icon={RefreshCw} size={13} />
            {loading ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div
            ref={tablistRef}
            role="tablist"
            aria-label="User detail sections"
            className="adm-sticky-tabs"
            onKeyDown={onTabKeyDown}
          >
            <div className="adm-chip-row">
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`user-detail-tab-${tab.id}`}
                    aria-controls={`user-detail-tabpanel-${tab.id}`}
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={`adm-chip ${isActive ? 'is-active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <I icon={tab.icon} size={14} /> {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {TABS.map((tab) => (
            <div
              key={tab.id}
              role="tabpanel"
              id={`user-detail-tabpanel-${tab.id}`}
              aria-labelledby={`user-detail-tab-${tab.id}`}
              hidden={activeTab !== tab.id}
            >
              {tab.id === 'overview' && (
                <div className="be-stack-4">
                  <div className="adm-review-head">
                    <div className="adm-user">
                      <div className="adm-avatar adm-avatar-lg">{initials(user.name, 'CL')}</div>
                      <div>
                        <h2>{user.name || 'Client'}</h2>
                        <div className="adm-review-email">{user.email}</div>
                      </div>
                    </div>
                  </div>

                  {hasBlocking ? (
                    <div className="adm-validation-banner adm-validation-banner--error">
                      <I icon={AlertTriangle} size={14} />
                      <span><strong>Blocked:</strong> {blockingReasons.join('; ')}</span>
                    </div>
                  ) : (
                    <div className="adm-validation-banner adm-validation-banner--success">
                      <I icon={CheckCircle2} size={14} />
                      <span>No blocking reasons</span>
                    </div>
                  )}

                  {/* Risk profile was retired with the risk-profiling feature; the
                      field it read does not exist in the projection, so it always
                      printed a dash. */}
                  {renderInfoCard('Basic info', User, [
                    { label: 'Name', value: user.name || '—' },
                    { label: 'Email', value: user.email || '—' },
                    { label: 'Phone', value: user.phone || '—' },
                    { label: 'Account', value: user.status ? <StateBadge state={user.status} /> : '—' },
                    { label: 'KYC', value: kyc ? <StateBadge state={kyc.status} /> : 'No case' },
                    { label: 'Signed up', value: date(user.createdAt) },
                    { label: 'Approved', value: date(user.activatedAt) },
                  ])}

                  {portfolio && renderInfoCard('Portfolio summary', PieChart, [
                    { label: 'Pools held', value: portfolio.poolCount ?? '—' },
                    {
                      label: 'Total investment (SIP + lump sum)',
                      value: <span className="be-money">{rupees(portfolio.totalInvestmentPaise)}</span>,
                    },
                    {
                      label: 'Current value',
                      value: <span className="be-money">{rupees(portfolio.currentValuePaise)}</span>,
                    },
                    {
                      label: 'Total return',
                      value: (
                        <span className="be-money">
                          {signedRupees(portfolio.totalReturnPaise)}
                          {portfolio.returnPercent === null || portfolio.returnPercent === undefined
                            ? ''
                            : ` (${portfolio.returnPercent.toFixed(2)}%)`}
                        </span>
                      ),
                    },
                    {
                      label: 'Returns allocated to date',
                      value: <span className="be-money">{rupees(portfolio.allocatedGainPaise)}</span>,
                    },
                    { label: 'SIP installments paid', value: portfolio.sipInstallmentCount ?? 0 },
                    { label: 'Lump sums', value: portfolio.lumpSumCount ?? 0 },
                  ])}
                </div>
              )}

              {tab.id === 'investments' && (
                <div className="be-stack-4">
                  {/* Option B: one row per pool, derived from this investor's
                      ledger. These are the same figures the client is shown. */}
                  {renderTable(
                    'Pool positions',
                    PieChart,
                    ['Pool', 'Total investment', 'Current value', 'Return', 'SIP / lump sum', 'Last activity'],
                    positions,
                    (position) => [
                      {
                        node: (
                          <>
                            <div className="adm-cell-main">{position.fundName || position.fundSlug || '—'}</div>
                            {position.firstInvestmentDate && (
                              <div className="adm-cell-sub">since {position.firstInvestmentDate}</div>
                            )}
                          </>
                        ),
                      },
                      { node: rupees(position.totalInvestmentPaise), className: 'be-money' },
                      { node: rupees(position.currentValuePaise), className: 'be-money' },
                      {
                        node: (
                          <>
                            {signedRupees(position.totalReturnPaise)}
                            {position.returnPercent === null || position.returnPercent === undefined
                              ? ''
                              : ` (${position.returnPercent.toFixed(2)}%)`}
                          </>
                        ),
                        className: 'be-money',
                      },
                      {
                        node: `${position.sipInstallmentCount ?? 0} / ${position.lumpSumCount ?? 0}`,
                        className: 'be-num',
                      },
                      { node: position.lastActivityDate || '—', className: 'adm-cell-meta' },
                    ],
                    'No pool positions yet.',
                    (position, index) => position.fundId || index,
                  )}

                  <GainAllocationForm userId={userId} positions={positions} onAllocated={reload} />

                  {renderTable(
                    'SIP plans',
                    Briefcase,
                    ['Pool', 'Installment', 'Debit day', 'Status', 'Next due', 'Paid'],
                    sipPlans,
                    (plan) => [
                      plan.fundSlug || plan.fundId || '—',
                      { node: rupees(plan.amountPaise), className: 'be-money' },
                      { node: plan.debitDay ?? '—', className: 'be-num' },
                      { node: <StateBadge state={plan.status} /> },
                      { node: plan.nextDueDate || '—', className: 'adm-cell-meta' },
                      { node: plan.installments ?? 0, className: 'be-num' },
                    ],
                    'No SIP plans.',
                  )}

                  {/* Orders are the investor's actual activity, redemptions included.
                      They were fetched and then never rendered. */}
                  {renderTable(
                    'Order activity',
                    TrendingUp,
                    ['Pool', 'Type', 'Amount', 'Status', 'Requested', 'Booked'],
                    orders,
                    (order) => [
                      order.fundName || order.fundSlug || '—',
                      humanizeState(order.type),
                      { node: rupees(order.amountPaise), className: 'be-money' },
                      {
                        node: (
                          <>
                            <StateBadge state={order.status} />
                            {order.failureCode && (
                              <div className="adm-cell-sub">{order.failureCode}</div>
                            )}
                          </>
                        ),
                      },
                      { node: date(order.requestedAt || order.createdAt), className: 'adm-cell-meta' },
                      { node: date(order.bookedAt), className: 'adm-cell-meta' },
                    ],
                    'No orders yet.',
                  )}
                </div>
              )}

              {tab.id === 'payments' && (
                <div className="be-stack-4">
                  {renderTable(
                    'Payments',
                    CreditCard,
                    ['Reference', 'Amount', 'Provider', 'Status', 'Created', 'Settled'],
                    payments,
                    (p) => [
                      { node: <code className="adm-code">{p.id || '—'}</code> },
                      { node: rupees(p.amountPaise), className: 'be-money' },
                      {
                        node: (
                          <>
                            <div>{p.provider || '—'}</div>
                            {p.providerReference && (
                              <div className="adm-cell-sub">{p.providerReference}</div>
                            )}
                          </>
                        ),
                      },
                      {
                        node: (
                          <>
                            <StateBadge state={p.status} />
                            {p.attemptCount > 1 && (
                              <div className="adm-cell-sub">{p.attemptCount} attempts</div>
                            )}
                          </>
                        ),
                      },
                      { node: date(p.createdAt), className: 'adm-cell-meta' },
                      { node: date(p.succeededAt || p.failedAt), className: 'adm-cell-meta' },
                    ],
                    'No payments.',
                  )}

                  {/* Was `m.amount` / `m.day` / `m.last` / `m.next`: four columns of
                      nothing on every mandate. There is no last-debit or next-debit
                      field in the projection, so the validity window stands in. */}
                  {renderTable(
                    'Mandates',
                    Repeat,
                    ['Reference', 'Max debit', 'Debit day', 'Status', 'Valid from', 'Valid to'],
                    mandates,
                    (m) => [
                      { node: <code className="adm-code">{m.providerMandateId || m.id || '—'}</code> },
                      { node: rupees(m.maxAmountPaise), className: 'be-money' },
                      { node: m.debitDay ?? '—', className: 'be-num' },
                      { node: <StateBadge state={m.status} /> },
                      { node: date(m.validFrom), className: 'adm-cell-meta' },
                      { node: date(m.validTo), className: 'adm-cell-meta' },
                    ],
                    'No mandates.',
                  )}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default UserDetailScreen;
