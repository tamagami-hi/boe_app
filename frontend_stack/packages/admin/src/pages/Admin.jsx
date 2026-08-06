import { Routes, Route, Navigate } from 'react-router-dom';
import AdminShell from '../layout/AdminShell.jsx';
import LegacyTabRedirect from './LegacyTabRedirect.jsx';
import OverviewPage from './OverviewPage.jsx';
import {
  ApprovalsRoute,
  MandatesRoute,
  PaymentsRoute,
  UserDirectoryRoute,
  UserDetailRoute,
  KycRoute,
  FundsRoute,
  HoldingsRoute,
  TransactionsRoute,
  AppBuilderRoute,
  AuditLogRoute,
  EmailDeliveriesRoute,
  EnvironmentRoute,
} from './legacy/legacyRoutes.jsx';
import FaqsPage from '../features/site/FaqsPage.jsx';
import '../styles/desktop/admin.css';
import '../styles/desktop/shell.css';
import '../styles/desktop/site.css';

export default function Admin() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<LegacyTabRedirect />} />
        <Route path="overview" element={<OverviewPage />} />

        <Route path="users/approvals" element={<ApprovalsRoute />} />
        <Route path="users/subscriptions" element={<MandatesRoute />} />
        <Route path="users/payments" element={<PaymentsRoute />} />
        <Route path="users/directory" element={<UserDirectoryRoute />} />
        <Route path="users/directory/:userId" element={<UserDetailRoute />} />
        <Route path="users/kyc" element={<KycRoute />} />
        {/* Retired by canonical decision: no client risk profiling. */}
        <Route path="users/risk-profiles" element={<Navigate to="/admin/users/kyc" replace />} />

        <Route path="site/faqs" element={<FaqsPage />} />

        <Route path="app/builder" element={<AppBuilderRoute />} />

        <Route path="ops/funds" element={<FundsRoute />} />
        <Route path="ops/holdings" element={<HoldingsRoute />} />
        <Route path="ops/transactions" element={<TransactionsRoute />} />
        {/* Retired: the synthetic reconciliation ledger and the SIP control-request
            inbox were both removed by the canonical schema/decisions. Transactions
            is the reconciliation view; SIP changes are commands on the plan. */}
        <Route path="ops/ledger" element={<Navigate to="/admin/ops/transactions" replace />} />
        <Route path="ops/sip-control" element={<Navigate to="/admin/ops/transactions" replace />} />

        {/* Support tickets are postponed (out of MVP, no schema). */}
        <Route path="system/support" element={<Navigate to="/admin/system/audit-log" replace />} />
        <Route path="system/audit-log" element={<AuditLogRoute />} />
        <Route path="system/emails" element={<EmailDeliveriesRoute />} />
        <Route path="system/environment" element={<EnvironmentRoute />} />

        <Route path="*" element={<Navigate to="/admin/overview" replace />} />
      </Route>
    </Routes>
  );
}
