import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AdminShell from '../layout/AdminShell.jsx';
import LegacyTabRedirect from './LegacyTabRedirect.jsx';
import OverviewPage from './OverviewPage.jsx';
import {
  ApprovalsRoute,
  MandatesRoute,
  PaymentsRoute,
  UserDirectoryRoute,
  UserDetailRoute,
  FundsRoute,
  FundWorkspaceRoute,
  RedemptionsRoute,
  HoldingsRoute,
  TransactionsRoute,
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

export default function Admin() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<LegacyTabRedirect />} />
        <Route path="overview" element={<Permitted><OverviewPage /></Permitted>} />

        <Route path="users/approvals" element={<Permitted><ApprovalsRoute /></Permitted>} />
        <Route path="users/subscriptions" element={<Permitted><MandatesRoute /></Permitted>} />
        <Route path="users/payments" element={<Permitted><PaymentsRoute /></Permitted>} />
        <Route path="users/directory" element={<Permitted><UserDirectoryRoute /></Permitted>} />
        <Route path="users/directory/:userId" element={<Permitted><UserDetailRoute /></Permitted>} />
        {/* Retired by canonical decisions: no client risk profiling, and no
            manual KYC review — KYC is the in-app OTP email verification. */}
        <Route path="users/kyc" element={<Navigate to="/admin/users/approvals" replace />} />
        <Route path="users/risk-profiles" element={<Navigate to="/admin/users/approvals" replace />} />

        <Route path="site/faqs" element={<Permitted><FaqsPage /></Permitted>} />

        <Route path="app/builder" element={<Permitted><AppBuilderRoute /></Permitted>} />

        <Route path="ops/funds" element={<Permitted><FundsRoute /></Permitted>} />
        <Route path="ops/funds/:fundId" element={<Permitted><FundWorkspaceRoute /></Permitted>} />
        <Route path="ops/redemptions" element={<Permitted><RedemptionsRoute /></Permitted>} />
        <Route path="ops/holdings" element={<Permitted><HoldingsRoute /></Permitted>} />
        <Route path="ops/transactions" element={<Permitted><TransactionsRoute /></Permitted>} />
        {/* Retired: the synthetic reconciliation ledger and the SIP control-request
            inbox were both removed by the canonical schema/decisions. Transactions
            is the reconciliation view; SIP changes are commands on the plan. */}
        <Route path="ops/ledger" element={<Navigate to="/admin/ops/transactions" replace />} />
        <Route path="ops/sip-control" element={<Navigate to="/admin/ops/transactions" replace />} />

        {/* Support tickets are postponed (out of MVP, no schema). */}
        <Route path="system/support" element={<Navigate to="/admin/system/audit-log" replace />} />
        <Route path="system/audit-log" element={<Permitted><AuditLogRoute /></Permitted>} />
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
