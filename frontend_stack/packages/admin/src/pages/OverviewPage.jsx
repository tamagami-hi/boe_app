import { Link } from 'react-router-dom';
import { UserCheck, CreditCard, HelpCircle, History, Layers, ShieldCheck, Users, ArrowRight } from 'lucide-react';
import { useApprovalsQueue } from '../data/ApprovalsQueueProvider.jsx';
import { useAdminFunds, useAdminPayments } from '../data/adminResources.js';
import AdminReadError from '../data/AdminReadError.jsx';
import { Page, ContentGrid, Section } from '../layout/primitives/index.js';
import I from '../components/I.jsx';

const QUICK_LINKS = [
  {
    path: '/admin/users/approvals',
    icon: UserCheck,
    title: 'Review sign-ups',
    description: 'Approve or reject applications created on the public site.',
  },
  {
    path: '/admin/site/faqs',
    icon: HelpCircle,
    title: 'Update the FAQs',
    description: 'Edit the help answers clients read inside the app.',
  },
  {
    path: '/admin/funds-received/awaiting',
    icon: ShieldCheck,
    title: 'Acknowledge funds',
    description: 'Review confirmed funds and notify clients when receipt is acknowledged.',
  },
  {
    path: '/admin/payments',
    icon: CreditCard,
    title: 'Check payments',
    description: 'Inspect the payment record and settlement evidence.',
  },
  {
    path: '/admin/funds',
    icon: Layers,
    title: 'Manage fund pools',
    description: 'Issue funds, publish terms and stock lists.',
  },
  {
    path: '/admin/audit',
    icon: History,
    title: 'Read the audit log',
    description: 'Every admin action, with actor and reason.',
  },
  {
    path: '/admin/users/directory',
    icon: Users,
    title: 'Browse users',
    description: 'Search approved accounts and open a client record.',
  },
];

function StatCard({ label, value, hint }) {
  return (
    <div className="ash-stat">
      <div className="ash-stat-label">{label}</div>
      <div className="ash-stat-value">{value}</div>
      {hint && <div className="ash-stat-hint">{hint}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const queue = useApprovalsQueue();
  const payments = useAdminPayments();
  const funds = useAdminFunds();

  const paymentsInFlight = payments.rows.filter((row) =>
    ['created', 'provider_pending'].includes(row.status),
  ).length;
  const loading = queue.loading || payments.isLoading || funds.isLoading;

  return (
    <Page>
      <AdminReadError resources={[
        { label: 'payments', ...payments },
        { label: 'fund catalogue', ...funds },
      ]} />
      <Section aria-label="Key counts">
        <ContentGrid cols={4} minColWidth="200px">
          {loading ? (
            Array.from({ length: 3 }, (_, index) => <div key={index} className="ash-stat ash-skel-block" aria-hidden="true" />)
          ) : (
            <>
              <StatCard label="Applications waiting" value={queue.approvals.length} hint="Sign-ups not yet decided" />
              <StatCard label="Payments in flight" value={paymentsInFlight} hint="Not yet settled by the provider" />
              <StatCard label="Funds" value={funds.summary ? funds.summary.total : funds.rows.length} hint="Draft and published" />
            </>
          )}
        </ContentGrid>
      </Section>

      <Section title="Where to next" aria-label="Quick links">
        <ContentGrid cols={2} minColWidth="280px">
          {QUICK_LINKS.map((link) => (
            <Link key={link.path} to={link.path} className="ash-quicklink">
              <I icon={link.icon} size={18} />
              <div className="ash-quicklink-body">
                <div className="ash-quicklink-title">{link.title}</div>
                <div className="ash-quicklink-desc">{link.description}</div>
              </div>
              <I icon={ArrowRight} size={15} className="ash-quicklink-arrow" />
            </Link>
          ))}
        </ContentGrid>
      </Section>
    </Page>
  );
}
