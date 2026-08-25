import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import AdminShell from '../layout/AdminShell.jsx';
import LegacyTabRedirect from './LegacyTabRedirect.jsx';
import OverviewPage from './OverviewPage.jsx';
import {
  ApprovalsRoute,
  PaymentsRoute,
  MandatesRoute,
  MandateDetailRoute,
  UserDirectoryRoute,
  UserDetailRoute,
  FundsRoute,
  FundCreateRoute,
  FundWorkspaceRoute,
  FundReceiptsRoute,
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
import { aumEntryPathFor, canAccessPath } from '../navigation/nav.js';
import '../styles/desktop/admin.css';
import '../styles/desktop/shell.css';
import '../styles/desktop/site.css';

function Permitted({ children }) {
  const { user } = useAdminSession();
  const location = useLocation();

  if (!canAccessPath(user, location.pathname)) return <Forbidden />;
  return children;
}

function LegacyFundRedirect() {
  const { fundId } = useParams();
  return <Navigate to={`/admin/funds/${fundId}`} replace />;
}

function AumEntryRedirect() {
  const { user } = useAdminSession();
  const destination = aumEntryPathFor(user);
  return <Navigate to={destination} replace />;
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
        {}
        <Route path="users/kyc" element={<Navigate to="/admin/users/approvals" replace />} />
        <Route path="users/risk-profiles" element={<Navigate to="/admin/users/approvals" replace />} />
        {}
        <Route path="users/subscriptions" element={<Navigate to="/admin/payments/mandates" replace />} />
        <Route path="users/payments" element={<Navigate to="/admin/payments" replace />} />

        <Route path="funds" element={<Permitted><FundsRoute /></Permitted>} />
        <Route path="funds/new" element={<Permitted><FundCreateRoute /></Permitted>} />
        <Route path="funds/:fundId" element={<Permitted><FundWorkspaceRoute /></Permitted>} />

        <Route path="funds-received" element={<Navigate to="/admin/funds-received/awaiting" replace />} />
        <Route path="funds-received/awaiting" element={<Permitted><FundReceiptsRoute tab="awaiting" /></Permitted>} />
        <Route path="funds-received/acknowledged" element={<Permitted><FundReceiptsRoute tab="acknowledged" /></Permitted>} />
        <Route path="funds-received/refunds" element={<Permitted><FundReceiptsRoute tab="refunds" /></Permitted>} />

        <Route path="client-values" element={<Navigate to="/admin/client-values/detail" replace />} />
        <Route path="client-values/detail" element={<Permitted><ClientValuesRoute tab="detail" /></Permitted>} />
        <Route path="client-values/individual" element={<Permitted><ClientValuesRoute tab="individual" /></Permitted>} />
        <Route path="client-values/collective" element={<Permitted><ClientValuesRoute tab="collective" /></Permitted>} />

        <Route path="aum" element={<AumEntryRedirect />} />
        <Route path="aum/current" element={<Permitted><AumRoute tab="current" /></Permitted>} />
        <Route path="aum/manage" element={<Permitted><AumRoute tab="manage" /></Permitted>} />
        <Route path="aum/collective" element={<Permitted><AumRoute tab="collective" /></Permitted>} />
        <Route path="aum/history" element={<Permitted><AumRoute tab="history" /></Permitted>} />

        <Route path="payments" element={<Permitted><PaymentsRoute /></Permitted>} />
        <Route path="payments/mandates" element={<Permitted><MandatesRoute /></Permitted>} />
        <Route path="payments/mandates/:mandateId" element={<Permitted><MandateDetailRoute /></Permitted>} />
        <Route path="audit" element={<Permitted><AuditLogRoute /></Permitted>} />

        <Route path="site/faqs" element={<Permitted><FaqsPage /></Permitted>} />

        <Route path="app/builder" element={<Permitted><AppBuilderRoute /></Permitted>} />

        {}
        <Route path="ops/funds" element={<Navigate to="/admin/funds" replace />} />
        <Route path="ops/funds/:fundId" element={<LegacyFundRedirect />} />
        <Route path="ops/redemptions" element={<Navigate to="/admin/payments" replace />} />
        <Route path="ops/transactions" element={<Navigate to="/admin/payments" replace />} />
        <Route path="ops/ledger" element={<Navigate to="/admin/payments" replace />} />
        <Route path="ops/sip-control" element={<Navigate to="/admin/payments/mandates" replace />} />
        <Route path="ops/holdings" element={<Navigate to="/admin/aum/current" replace />} />

        {}
        <Route path="system/support" element={<Navigate to="/admin/audit" replace />} />
        <Route path="system/audit-log" element={<Navigate to="/admin/audit" replace />} />
        <Route path="system/emails" element={<Permitted><EmailDeliveriesRoute /></Permitted>} />
        <Route path="system/environment" element={<Permitted><EnvironmentRoute /></Permitted>} />

        {}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
