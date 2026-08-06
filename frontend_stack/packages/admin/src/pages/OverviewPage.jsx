import { Link } from 'react-router-dom';
import { UserCheck, CreditCard, HelpCircle, LifeBuoy, ArrowRight } from 'lucide-react';
import { useLegacyAdminData } from '../context/LegacyAdminDataContext.jsx';
import { Page, ContentGrid, Section } from '../layout/primitives/index.js';
import I from '../components/I.jsx';

const QUICK_LINKS = [
  {
    path: '/admin/users/approvals',
    icon: UserCheck,
    title: 'Review sign-ups',
    description: 'Approve or reject learner accounts created on the public site.',
  },
  {
    path: '/admin/site/faqs',
    icon: HelpCircle,
    title: 'Update the FAQs',
    description: 'Edit the help answers clients read inside the app.',
  },
  {
    path: '/admin/users/payments',
    icon: CreditCard,
    title: 'Settle payments',
    description: 'Reconcile and approve payments waiting on review.',
  },
  {
    path: '/admin/system/support',
    icon: LifeBuoy,
    title: 'Answer support',
    description: 'Reply to open tickets from clients.',
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
  const { overview, loading } = useLegacyAdminData();
  const counts = overview.counts || {};
  const stats = overview.stats || {};

  return (
    <Page>
      <Section aria-label="Key counts">
        <ContentGrid cols={4} minColWidth="200px">
          {loading ? (
            Array.from({ length: 4 }, (_, index) => <div key={index} className="ash-stat ash-skel-block" aria-hidden="true" />)
          ) : (
            <>
              <StatCard label="Pending approvals" value={stats.pendingApprovals ?? counts.approvals ?? 0} hint="Sign-ups waiting on review" />
              <StatCard label="Registered users" value={counts.users ?? 0} hint="Learner and client accounts" />
              <StatCard label="Payments in queue" value={counts.payments ?? 0} hint="Awaiting reconciliation" />
              <StatCard label="Open support tickets" value={counts.support ?? 0} hint="Unresolved conversations" />
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
