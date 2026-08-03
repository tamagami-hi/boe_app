import { useParams } from 'react-router-dom';
import { useLegacyAdminData } from '../../context/LegacyAdminDataContext.jsx';
import ApprovalsScreen from '../../screens/ApprovalsScreen.jsx';
import AumScreen from '../../screens/AumScreen.jsx';
import AppBuilderScreen from '../../screens/AppBuilderScreen.jsx';
import AuditLogScreen from '../../screens/AuditLogScreen.jsx';
import EmailDeliveriesScreen from '../../screens/EmailDeliveriesScreen.jsx';
import EnvironmentScreen from '../../screens/EnvironmentScreen.jsx';
import HoldingsScreen from '../../screens/HoldingsScreen.jsx';
import KycReviewScreen from '../../screens/KycReviewScreen.jsx';
import MandatesScreen from '../../screens/MandatesScreen.jsx';
import PaymentsScreen from '../../screens/PaymentsScreen.jsx';
import TransactionsScreen from '../../screens/TransactionsScreen.jsx';
import UserDetailScreen from '../../screens/UserDetailScreen.jsx';
import UserDetailsListScreen from '../../screens/UserDetailsListScreen.jsx';

// Thin route wrappers: each mounts a pre-redesign screen with the exact
// props it received from the old monolithic Admin.jsx. They disappear one
// by one as domains get their full rebuild passes.
//
// Retired here (canonical decisions, session-2 audit §C): risk profiles (no
// client risk profiling), the reconciliation ledger and capital-transaction tab
// (spec §8 removed the synthetic ledger), the SIP control-request queue (SIP
// state changes are commands, not a request inbox), and support tickets
// (out of MVP, no schema). Their screens are deleted rather than left dark.

export function ApprovalsRoute() {
  const ctx = useLegacyAdminData();
  return (
    <ApprovalsScreen
      rows={ctx.adminData.approvals}
      stats={ctx.overview.stats || {}}
      loading={ctx.loading}
      onReview={ctx.openReview}
      onApprove={ctx.handleApproveUser}
      onUserDetail={ctx.openUserDetail}
      onNavigateToUsers={ctx.navigateToUsers}
      busy={ctx.reviewBusy}
    />
  );
}

export function FundsRoute() {
  const ctx = useLegacyAdminData();
  return (
    <AumScreen
      funds={ctx.adminData.funds}
      auditLogs={ctx.adminData.auditLogs}
      onCreate={ctx.handleCreateFund}
      onUpdate={ctx.handleUpdateFund}
      onLifecycle={ctx.handleFundLifecycle}
      onDelete={ctx.handleDeleteFund}
      onUserDetail={ctx.openUserDetail}
    />
  );
}

export function PaymentsRoute() {
  const ctx = useLegacyAdminData();
  return (
    <PaymentsScreen
      rows={ctx.adminData.payments}
      funds={ctx.adminData.funds}
      stats={ctx.overview.stats || {}}
      onUserDetail={ctx.openUserDetail}
    />
  );
}

export function MandatesRoute() {
  const ctx = useLegacyAdminData();
  return (
    <MandatesScreen
      rows={ctx.adminData.mandates}
      stats={ctx.overview.stats || {}}
      onUserDetail={ctx.openUserDetail}
    />
  );
}

export function UserDirectoryRoute() {
  const ctx = useLegacyAdminData();
  return <UserDetailsListScreen onUserDetail={ctx.openUserDetail} />;
}

export function UserDetailRoute() {
  const { userId } = useParams();
  return <UserDetailScreen userId={userId} />;
}

export function KycRoute() {
  const ctx = useLegacyAdminData();
  return (
    <KycReviewScreen
      rows={ctx.adminData.kycReview}
      stats={ctx.overview.stats || {}}
      loading={ctx.loading}
      onUserDetail={ctx.openUserDetail}
    />
  );
}

export function AuditLogRoute() {
  const ctx = useLegacyAdminData();
  return <AuditLogScreen rows={ctx.adminData.auditLogs} loading={ctx.loading} />;
}

export function EmailDeliveriesRoute() {
  return <EmailDeliveriesScreen />;
}

export function HoldingsRoute() {
  const ctx = useLegacyAdminData();
  return <HoldingsScreen funds={ctx.adminData.funds} loading={ctx.loading} />;
}

export function TransactionsRoute() {
  const ctx = useLegacyAdminData();
  return <TransactionsScreen funds={ctx.adminData.funds} />;
}

export function AppBuilderRoute() {
  return <AppBuilderScreen />;
}

export function EnvironmentRoute() {
  return <EnvironmentScreen />;
}
