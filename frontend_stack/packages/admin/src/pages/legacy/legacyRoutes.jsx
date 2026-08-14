import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import I from '../../components/I.jsx';
import { useApprovalsQueue } from '../../data/ApprovalsQueueProvider.jsx';
import AdminReadError from '../../data/AdminReadError.jsx';
import {
  useAdminAuditLogs,
  useAdminFunds,
  useAdminMandates,
  useAdminPayments,
} from '../../data/adminResources.js';
import { useFundMutations } from '../../data/useFundMutations.js';
import { useAdminNavigation } from '../../navigation/useAdminNavigation.js';
import ApprovalsScreen from '../../screens/ApprovalsScreen.jsx';
import AppBuilderScreen from '../../screens/appBuilder/AppBuilderScreen.jsx';
import FundsListScreen from '../../screens/fundOps/FundsListScreen.jsx';
import FundWorkspace from '../../screens/fundOps/FundWorkspace.jsx';
import RedemptionsScreen from '../../screens/RedemptionsScreen.jsx';
import AuditLogScreen from '../../screens/AuditLogScreen.jsx';
import EmailDeliveriesScreen from '../../screens/EmailDeliveriesScreen.jsx';
import EnvironmentScreen from '../../screens/EnvironmentScreen.jsx';
import HoldingsScreen from '../../screens/HoldingsScreen.jsx';
import MandatesScreen from '../../screens/MandatesScreen.jsx';
import PaymentsScreen from '../../screens/PaymentsScreen.jsx';
import TransactionsScreen from '../../screens/TransactionsScreen.jsx';
import UserDetailScreen from '../../screens/UserDetailScreen.jsx';
import UserDetailsListScreen from '../../screens/UserDetailsListScreen.jsx';

// Thin route wrappers. Each now reads only the domains its screen shows, instead of
// pulling slices out of one shell-wide six-collection provider.
//
// Retired here (canonical decisions, session-2 audit §C): risk profiles, the
// reconciliation ledger and capital-transaction tab, the SIP control-request queue,
// support tickets, and the manual KYC review queue.

export function ApprovalsRoute() {
  const queue = useApprovalsQueue();
  const { navigateToUsers } = useAdminNavigation();
  return (
    <ApprovalsScreen
      rows={queue.approvals}
      loading={queue.loading}
      onApprove={queue.handleApproveUser}
      onReject={queue.handleRejectUser}
      onNavigateToUsers={navigateToUsers}
      busy={queue.decisionBusy}
      meta={queue.meta}
      onRefresh={queue.refreshApprovals}
    />
  );
}

export function FundsRoute() {
  const funds = useAdminFunds();
  const { handleCreateFund } = useFundMutations();
  return (
    <>
      <AdminReadError resources={[{ label: 'fund pools', ...funds }]} />
      <FundsListScreen funds={funds.rows} loading={funds.isLoading} onCreate={handleCreateFund} />
    </>
  );
}

// The pool workspace owns its own read (`GET /v1/admin/funds/:id`), because the list
// projection carries no disclosure, no version history and no investor totals.
export function FundWorkspaceRoute() {
  const { handlePublishVersion, handleFundLifecycle, handleDeleteFund } = useFundMutations();
  return (
    <FundWorkspace
      onPublishVersion={handlePublishVersion}
      onLifecycle={handleFundLifecycle}
      onDelete={handleDeleteFund}
    />
  );
}

export function RedemptionsRoute() {
  const { openUserDetail } = useAdminNavigation();
  return <RedemptionsScreen onUserDetail={openUserDetail} />;
}

export function PaymentsRoute() {
  const payments = useAdminPayments();
  const { openUserDetail } = useAdminNavigation();
  return (
    <>
      <AdminReadError resources={[
        { label: 'payments', ...payments },
      ]} />
      <PaymentsScreen rows={payments.rows} loading={payments.isLoading} onUserDetail={openUserDetail} />
    </>
  );
}

export function MandatesRoute() {
  const mandates = useAdminMandates();
  const { openUserDetail } = useAdminNavigation();
  return (
    <>
      <AdminReadError resources={[{ label: 'mandates', ...mandates }]} />
      <MandatesScreen rows={mandates.rows} loading={mandates.isLoading} onUserDetail={openUserDetail} />
    </>
  );
}

export function UserDirectoryRoute() {
  const { openUserDetail } = useAdminNavigation();
  return <UserDetailsListScreen onUserDetail={openUserDetail} />;
}

export function UserDetailRoute() {
  const { userId } = useParams();
  const navigate = useNavigate();

  // Deliberately NOT passing `onClose`: UserDetailScreen used to switch into a
  // hand-rolled modal presentation when given one, which is wrong for a screen that
  // owns a URL and contradicted the canonical overlay contract. That branch is gone.
  // `replace` keeps directory <-> detail trips out of the back stack.
  return (
    <div className="adm-screen adm-screen--narrow">
      <button
        type="button"
        className="be-btn be-btn-ghost be-btn-sm"
        onClick={() => navigate('/admin/users/directory', { replace: true })}
      >
        <I icon={ArrowLeft} size={14} />
        Back to directory
      </button>
      <UserDetailScreen userId={userId} />
    </div>
  );
}

export function AuditLogRoute() {
  const auditLogs = useAdminAuditLogs();
  return (
    <>
      <AdminReadError resources={[{ label: 'audit log', ...auditLogs }]} />
      <AuditLogScreen rows={auditLogs.rows} loading={auditLogs.isLoading} />
    </>
  );
}

export function EmailDeliveriesRoute() {
  return <EmailDeliveriesScreen />;
}

export function HoldingsRoute() {
  const funds = useAdminFunds();
  return (
    <>
      <AdminReadError resources={[{ label: 'fund pools', ...funds }]} />
      <HoldingsScreen funds={funds.rows} loading={funds.isLoading} />
    </>
  );
}

export function TransactionsRoute() {
  // The screen paginates transactions itself via useAdminList; it only needs funds
  // for the pool filter.
  const funds = useAdminFunds();
  return (
    <>
      <AdminReadError resources={[{ label: 'fund pools', ...funds }]} />
      <TransactionsScreen funds={funds.rows} />
    </>
  );
}

export function AppBuilderRoute() {
  return <AppBuilderScreen />;
}

export function EnvironmentRoute() {
  return <EnvironmentScreen />;
}
