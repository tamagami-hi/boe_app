import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import AdminShell from '../layout/AdminShell.jsx';
import LegacyTabRedirect from './LegacyTabRedirect.jsx';
import OverviewPage from './OverviewPage.jsx';
import {
  ApprovalsRoute,
  PaymentsRoute,
  UserDirectoryRoute,
  UserDetailRoute,
  FundsRoute,
  FundWorkspaceRoute,
  InvestmentReviewsRoute,
  ClientValuesRoute,
  AumRoute,
  AppBuilderRoute,
  AuditLogRoute,
  EmailDeliveriesRoute,
  EnvironmentRoute,
} from './legacy/legacyRoutes.jsx';
import FaqsPage from '../features/site/FaqsPage.jsx';
import NotFound from './NotFound.jsx';
import Forbidden from './Forbidden.jsx';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import { canAccessPath } from '../navigation/nav.js';
import '../styles/desktop/admin.css';
import '../styles/desktop/shell.css';
import '../styles/desktop/site.css';

/**
 * Renders a screen only if the principal holds one of the permissions the
 * destination declares, otherwise an explicit Forbidden.
 *
 * The sidebar already hides unauthorised destinations; this covers the other way
 * in — a typed URL, a bookmark, or a stale link from when the account had wider
 * access. Without it those land on a screen whose every request 403s, which reads
 * as the app being broken rather than the account being limited.
 *
 * PRESENTATION ONLY. The backend enforces the same codes on every request and is
 * the authority. This must never be the reason something is safe.
 */
function Permitted({ children }) {
  const { user } = useAdminSession();
  const location = useLocation();

  if (!canAccessPath(user, location.pathname)) return <Forbidden />;
  return children;
}

// `Navigate` cannot carry route params, so the retired ops workspace path needs a
// tiny component to forward :fundId to the canonical /admin/funds location.
function LegacyFundRedirect() {
  const { fundId } = useParams();
  return <Navigate to={`/admin/funds/${fundId}`} replace />;
}

export default function Admin() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<LegacyTabRedirect />} />
        <Route path="overview" element={<Permitted><OverviewPage /></Permitted>} />

        <Route path="users/approvals" element={<Permitted><ApprovalsRoute /></Permitted>} />
        <Route path="users/directory" element={<Permitted><UserDirectoryRoute /></Permitted>} />
        <Route path="users/directory/:userId" element={<Permitted><UserDetailRoute /></Permitted>} />
        {/* Retired by canonical decisions: no client risk profiling, and no
            manual KYC review — KYC is the in-app OTP email verification. */}
        <Route path="users/kyc" element={<Navigate to="/admin/users/approvals" replace />} />
        <Route path="users/risk-profiles" element={<Navigate to="/admin/users/approvals" replace />} />
        {/* Retired: subscriptions/mandates became the investment-review queue, and
            payments moved out of the users domain to a top-level ledger. */}
        <Route path="users/subscriptions" element={<Navigate to="/admin/reviews/awaiting" replace />} />
        <Route path="users/payments" element={<Navigate to="/admin/payments" replace />} />

        <Route path="funds" element={<Permitted><FundsRoute /></Permitted>} />
        <Route path="funds/:fundId" element={<Permitted><FundWorkspaceRoute /></Permitted>} />

        <Route path="reviews" element={<Navigate to="/admin/reviews/awaiting" replace />} />
        <Route path="reviews/awaiting" element={<Permitted><InvestmentReviewsRoute tab="awaiting" /></Permitted>} />
        <Route path="reviews/accepted" element={<Permitted><InvestmentReviewsRoute tab="accepted" /></Permitted>} />
        <Route path="reviews/refunds" element={<Permitted><InvestmentReviewsRoute tab="refunds" /></Permitted>} />

        <Route path="client-values" element={<Navigate to="/admin/client-values/detail" replace />} />
        <Route path="client-values/detail" element={<Permitted><ClientValuesRoute tab="detail" /></Permitted>} />
        <Route path="client-values/individual" element={<Permitted><ClientValuesRoute tab="individual" /></Permitted>} />
        <Route path="client-values/collective" element={<Permitted><ClientValuesRoute tab="collective" /></Permitted>} />

        <Route path="aum" element={<Navigate to="/admin/aum/current" replace />} />
        <Route path="aum/current" element={<Permitted><AumRoute tab="current" /></Permitted>} />
        <Route path="aum/manage" element={<Permitted><AumRoute tab="manage" /></Permitted>} />
        <Route path="aum/collective" element={<Permitted><AumRoute tab="collective" /></Permitted>} />
        <Route path="aum/history" element={<Permitted><AumRoute tab="history" /></Permitted>} />

        <Route path="payments" element={<Permitted><PaymentsRoute /></Permitted>} />
        <Route path="audit" element={<Permitted><AuditLogRoute /></Permitted>} />

        <Route path="site/faqs" element={<Permitted><FaqsPage /></Permitted>} />

        <Route path="app/builder" element={<Permitted><AppBuilderRoute /></Permitted>} />

        {/* Retired ops paths: funds and the workspace moved to /admin/funds, the
            redemptions/transactions/ledger/SIP views were replaced by the payments
            ledger and the investment-review queue, and holdings became published
            AUM under /admin/aum. */}
        <Route path="ops/funds" element={<Navigate to="/admin/funds" replace />} />
        <Route path="ops/funds/:fundId" element={<LegacyFundRedirect />} />
        <Route path="ops/redemptions" element={<Navigate to="/admin/payments" replace />} />
        <Route path="ops/transactions" element={<Navigate to="/admin/payments" replace />} />
        <Route path="ops/ledger" element={<Navigate to="/admin/payments" replace />} />
        <Route path="ops/sip-control" element={<Navigate to="/admin/payments" replace />} />
        <Route path="ops/holdings" element={<Navigate to="/admin/aum/current" replace />} />

        {/* Support tickets are postponed (out of MVP, no schema). */}
        <Route path="system/support" element={<Navigate to="/admin/audit" replace />} />
        <Route path="system/audit-log" element={<Navigate to="/admin/audit" replace />} />
        <Route path="system/emails" element={<Permitted><EmailDeliveriesRoute /></Permitted>} />
        <Route path="system/environment" element={<Permitted><EnvironmentRoute /></Permitted>} />

        {/*
          Unknown admin paths render Not Found instead of silently redirecting to
          Overview. Every intentionally retired route above is an explicit
          `Navigate`, so anything reaching this wildcard is genuinely unknown —
          and an operator following a stale link deserves to be told that rather
          than being dropped on a working page that isn't what they asked for.
        */}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
