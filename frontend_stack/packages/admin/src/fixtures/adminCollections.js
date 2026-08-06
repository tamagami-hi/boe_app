// Offline fixtures for the admin collections that have a canonical backend
// endpoint. They exist so the console renders a realistic screen in fixture mode
// (`VITE_BEO_API_MODE` unset) without reaching the network. Shapes match the
// admin wire contract emitted by `/v1/admin/*`, so switching to http mode is a
// transport change only.

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
    answer: 'There are no hidden exit fees. Applicable charges are shown before you confirm a transaction.',
    category: 'general',
    order: 3,
    status: 'draft',
  },
];

// Keyed by the canonical collection path so a screen only needs its endpoint.
const FIXTURES_BY_PATH = {
  '/v1/admin/faqs': FIXTURE_FAQS,
};

/** Fixture rows for a collection path, or null when the path has no fixture. */
export function fixtureCollection(path) {
  const key = String(path || '').split('?')[0];
  const rows = FIXTURES_BY_PATH[key];
  return rows === undefined ? null : rows.map((row) => ({ ...row }));
}

export { FIXTURE_FAQS };
