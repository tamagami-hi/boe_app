import { Link } from 'react-router-dom';
import { UserCheck, CreditCard, HelpCircle, History, Layers, Users, ArrowRight } from 'lucide-react';
import { useLegacyAdminData } from '../context/LegacyAdminDataContext.jsx';
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
    path: '/admin/users/payments',
    icon: CreditCard,
    title: 'Check payments',
    // Not "approve": payments are confirmed by the provider webhook, and this
    // screen is the evidence trail. The old copy promised an action that has no
    // endpoint behind it.
    description: 'Inspect the payment record and settlement evidence.',
  },
  {
    path: '/admin/ops/funds',
    icon: Layers,
    title: 'Manage fund pools',
    description: 'Publish pool sizes, stock lists and gain allocations.',
  },
  {
    path: '/admin/system/audit-log',
    icon: History,
    title: 'Read the audit log',
    // Replaces an "Answer support" card that pointed at /admin/system/support —
    // a route that only redirects here, because support tickets have no schema.
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
  const { adminData, loading } = useLegacyAdminData();

  /*
   * Counted from the collections this console actually loaded.
   *
   * These tiles previously read `counts.users`, `counts.payments` and
   * `counts.support` from an overview payload that no endpoint produces, with
   * `?? 0` as the fallback — so the landing screen of the admin console stated
   * that there were zero registered users and zero payments, as facts, forever.
   * "Open support tickets" was worse: support tickets have no schema at all, so
   * that number could never be anything but zero.
   */
  const approvals = adminData.approvals || [];
  const payments = adminData.payments || [];
  const paymentsInFlight = payments.filter((row) =>
    ['created', 'gateway_initiated', 'pending'].includes(row.status),
  ).length;

  return (
    <Page>
      <Section aria-label="Key counts">
        <ContentGrid cols={4} minColWidth="200px">
          {loading ? (
            Array.from({ length: 3 }, (_, index) => <div key={index} className="ash-stat ash-skel-block" aria-hidden="true" />)
          ) : (
            <>
              <StatCard label="Applications waiting" value={approvals.length} hint="Sign-ups not yet decided" />
              <StatCard label="Payments in flight" value={paymentsInFlight} hint="Not yet settled by the provider" />
              <StatCard label="Fund pools" value={(adminData.funds || []).length} hint="Draft and published" />
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
