import { lazy, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAdminSession } from '@beonedge/client/store/AdminSessionContext.jsx';
import I from '../../components/I.jsx';
import { useApprovalsQueue } from '../../data/ApprovalsQueueProvider.jsx';
import AdminReadError from '../../data/AdminReadError.jsx';
import {
  useAdminAuditLogs,
  useAdminFunds,
  useAdminMandateDetail,
  useAdminMandates,
  useAdminPayments,
} from '../../data/adminResources.js';
import { useFundMutations } from '../../data/useFundMutations.js';
import { useMandateMutations } from '../../data/useMandateMutations.js';
import { hasAnyPermission } from '../../navigation/nav.js';
import { useAdminNavigation } from '../../navigation/useAdminNavigation.js';

const ApprovalsScreen = lazy(() => import('../../screens/ApprovalsScreen.jsx'));
const AppBuilderScreen = lazy(() => import('../../screens/appBuilder/AppBuilderScreen.jsx'));
const AumScreen = lazy(() => import('../../screens/AumScreen.jsx'));
const ClientValuesScreen = lazy(() => import('../../screens/ClientValuesScreen.jsx'));
const FundCreateScreen = lazy(() => import('../../screens/fundOps/FundCreateScreen.jsx'));
const FundsListScreen = lazy(() => import('../../screens/fundOps/FundsListScreen.jsx'));
const FundWorkspace = lazy(() => import('../../screens/fundOps/FundWorkspace.jsx'));
const InvestmentReviewScreen = lazy(() => import('../../screens/InvestmentReviewScreen.jsx'));
const AuditLogScreen = lazy(() => import('../../screens/AuditLogScreen.jsx'));
const EmailDeliveriesScreen = lazy(() => import('../../screens/EmailDeliveriesScreen.jsx'));
const EnvironmentScreen = lazy(() => import('../../screens/EnvironmentScreen.jsx'));
const PaymentsScreen = lazy(() => import('../../screens/PaymentsScreen.jsx'));
const MandatesScreen = lazy(() => import('../../screens/MandatesScreen.jsx'));
const MandateDetailScreen = lazy(() => import('../../screens/MandateDetailScreen.jsx'));
const UserDetailScreen = lazy(() => import('../../screens/UserDetailScreen.jsx'));
const UserDetailsListScreen = lazy(() => import('../../screens/UserDetailsListScreen.jsx'));

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
  const [stateFilter, setStateFilter] = useState('all');
  const [search, setSearch] = useState('');
  const funds = useAdminFunds({ state: stateFilter, search });
  const { user } = useAdminSession();
  const canWrite = hasAnyPermission(user, ['funds.write']);
  return (
    <>
      <AdminReadError resources={[{ label: 'fund catalogue', ...funds }]} />
      <FundsListScreen
        funds={funds.rows}
        summary={funds.summary}
        loading={funds.isLoading}
        stateFilter={stateFilter}
        onStateFilterChange={setStateFilter}
        search={search}
        onSearchChange={setSearch}
        hasMore={funds.hasMore}
        loadingMore={funds.loadingMore}
        onLoadMore={funds.loadMore}
        canWrite={canWrite}
      />
    </>
  );
}

export function FundCreateRoute() {
  const { handleCreateFund } = useFundMutations();
  return <FundCreateScreen onCreate={handleCreateFund} />;
}

export function FundWorkspaceRoute() {
  const { handlePublishVersion, handleFundLifecycle } = useFundMutations();
  const { user } = useAdminSession();
  return (
    <FundWorkspace
      onPublishVersion={handlePublishVersion}
      onLifecycle={handleFundLifecycle}
      canWrite={hasAnyPermission(user, ['funds.write'])}
    />
  );
}

export function InvestmentReviewsRoute({ tab }) {
  return <InvestmentReviewScreen tab={tab} />;
}

export function ClientValuesRoute({ tab }) {
  return <ClientValuesScreen tab={tab} />;
}

export function AumRoute({ tab }) {
  return <AumScreen tab={tab} />;
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
  const [state, setState] = useState('');
  const [attention, setAttention] = useState(false);
  const mandates = useAdminMandates({ state, attention });
  return (
    <>
      <AdminReadError resources={[{ label: 'AutoPay mandates', ...mandates }]} />
      <MandatesScreen
        rows={mandates.rows}
        loading={mandates.isLoading}
        state={state}
        attention={attention}
        onStateChange={setState}
        onAttentionChange={setAttention}
      />
    </>
  );
}

export function MandateDetailRoute() {
  const { mandateId } = useParams();
  const detail = useAdminMandateDetail(mandateId);
  const operations = useMandateMutations();
  const { user } = useAdminSession();
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const canOperate = hasAnyPermission(user, ['finance.operate']);

  async function run(key, operation) {
    setBusy(key);
    setActionError('');
    try {
      await operation();
      await detail.refresh();
    } catch (error) {
      setActionError(error?.message || 'The operator action could not be completed.');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <AdminReadError resources={[{ label: 'AutoPay mandate detail', ...detail }]} />
      {detail.isLoading && !detail.data && <div className="adm-card be-pad-5">Loading mandate trace…</div>}
      {detail.data && (
        <MandateDetailScreen
          detail={detail.data}
          canOperate={canOperate}
          busy={busy}
          actionError={actionError}
          onReconcileMandate={(reason) => run('mandate', () => operations.reconcileMandate(mandateId, reason))}
          onReconcileCollection={(collectionId, reason) => run(`collection:${collectionId}`, () => operations.reconcileCollection(collectionId, reason))}
          onCancelMandate={(reason) => run('cancel', () => operations.cancelMandate(mandateId, reason))}
        />
      )}
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

export function AppBuilderRoute() {
  return <AppBuilderScreen />;
}

export function EnvironmentRoute() {
  return <EnvironmentScreen />;
}
