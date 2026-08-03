// Offline fixtures for the admin collections that have a canonical backend
// endpoint. They exist so the console renders a realistic screen in fixture mode
// (`VITE_BEO_API_MODE` unset) without reaching the network. Shapes match the
// admin wire contract emitted by `/v1/admin/*`, so switching to http mode is a
// transport change only.

const FIXTURE_COURSES = [
  {
    id: 'fixture-course-foundations',
    slug: 'market-foundations',
    name: 'Market Foundations',
    level: 'Beginner',
    format: 'Self-paced',
    outcome: 'Read a balance sheet and size a position',
    description: 'Eight modules covering instruments, order types, and risk basics.',
    pricePaise: 499000,
    sortOrder: 1,
    status: 'published',
    updatedAt: '2026-06-01T09:00:00.000Z',
  },
  {
    id: 'fixture-course-derivatives',
    slug: 'derivatives-primer',
    name: 'Derivatives Primer',
    level: 'Intermediate',
    format: 'Cohort',
    outcome: 'Hedge a portfolio with index options',
    description: 'Options and futures mechanics with worked Indian-market examples.',
    pricePaise: 1499000,
    sortOrder: 2,
    status: 'draft',
    updatedAt: '2026-06-14T09:00:00.000Z',
  },
];

const FIXTURE_PLANS = [
  {
    id: 'fixture-plan-core',
    slug: 'core',
    name: 'Core',
    tagline: 'Everything needed to start investing',
    pricePaise: 99900,
    cadence: 'monthly',
    features: ['Curated fund pools', 'Monthly research note', 'Email support'],
    ctaLabel: 'Get started',
    featured: false,
    sortOrder: 1,
    status: 'published',
  },
  {
    id: 'fixture-plan-premium',
    slug: 'premium',
    name: 'Premium',
    tagline: 'Deeper research and priority support',
    pricePaise: 249900,
    cadence: 'monthly',
    features: ['Everything in Core', 'Weekly research', 'Priority support', 'Quarterly review call'],
    ctaLabel: 'Upgrade',
    featured: true,
    sortOrder: 2,
    status: 'published',
  },
];

const FIXTURE_FAQS = [
  {
    id: 'fixture-faq-kyc',
    question: 'How long does verification take?',
    answer: 'Email verification is instant. Account approval is usually reviewed within one business day.',
    category: 'onboarding',
    order: 1,
    status: 'published',
  },
  {
    id: 'fixture-faq-withdraw',
    question: 'When can I withdraw?',
    answer: 'Redemption requests are processed on business days and settle to the registered bank account.',
    category: 'payments',
    order: 2,
    status: 'published',
  },
  {
    id: 'fixture-faq-fees',
    question: 'What fees apply?',
    answer: 'Plan pricing is shown on the plans page. There are no hidden exit fees.',
    category: 'general',
    order: 3,
    status: 'draft',
  },
];

// Keyed by the canonical collection path so a screen only needs its endpoint.
const FIXTURES_BY_PATH = {
  '/v1/admin/courses': FIXTURE_COURSES,
  '/v1/admin/plans': FIXTURE_PLANS,
  '/v1/admin/faqs': FIXTURE_FAQS,
};

/** Fixture rows for a collection path, or null when the path has no fixture. */
export function fixtureCollection(path) {
  const key = String(path || '').split('?')[0];
  const rows = FIXTURES_BY_PATH[key];
  return rows === undefined ? null : rows.map((row) => ({ ...row }));
}

export { FIXTURE_COURSES, FIXTURE_FAQS, FIXTURE_PLANS };
