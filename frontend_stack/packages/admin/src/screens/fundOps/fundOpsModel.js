// The fund catalogue as the backend actually models it (Option B, spec 04 §3.2).
//
// The old editor invented a six-stage lifecycle — draft, published, active, paused,
// closed, archived — and a second "user status" field derived from it. Neither
// exists. `fund_state` is the five values below, `PATCH /v1/admin/funds/:id` accepts
// exactly three of them, and there is no separate user-facing status: a published
// pool is visible, a paused one is visible but closed to new money, an archived one
// is hidden. Offering `active` and `closed` meant two of the six stages were
// rejected by the route, and the editor's own save path never sent the change at all.

export const FUND_STATES = ['draft', 'review_pending', 'published', 'paused', 'archived'];

// What the operator can move a pool TO. `draft` and `review_pending` are entry
// states the pool starts in; there is no route back to them.
export const LIFECYCLE_ACTIONS = ['published', 'paused', 'archived'];

export const STATE_DESCRIPTIONS = {
  draft: 'Not visible to clients. Publish a version, then publish the pool.',
  review_pending: 'Awaiting review. Not visible to clients.',
  published: 'Visible to clients and open to new investment.',
  paused: 'Visible to clients, closed to new investment.',
  archived: 'Hidden from clients. Existing positions are unaffected.',
};

export const LIFECYCLE_CONSEQUENCES = {
  published: 'Clients will see this pool and be able to invest in it.',
  paused: 'Clients keep seeing the pool and their holdings, but cannot add money.',
  archived: 'Clients will no longer see the pool. Existing positions are unaffected.',
};

export const RISK_LEVELS = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
  { value: 'very_high', label: 'Very high' },
];

export const RETURN_TIERS = [
  { value: '', label: 'Not stated' },
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
];

export const EMPTY_PROFILE = {
  name: '',
  category: '',
  objective: '',
  riskLevel: 'moderate',
  returnTier: '',
  minSip: '',
  minLumpsum: '',
  minimumDurationMonths: '',
  recommendedHoldingMonths: '',
  disclosureTitle: '',
  disclosureBody: '',
};

const paise = (rupees) => {
  const value = Number(rupees);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
};

const rupees = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  return Number.isFinite(amount) ? amount / 100 : '';
};

const positiveInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
};

/** Prefill from the admin fund detail: `{ fund, disclosures, versions }`. */
export function profileFromDetail(detail) {
  const fund = detail?.fund || {};
  const disclosure = (detail?.disclosures || [])[0] || {};
  const version = (detail?.versions || [])[0] || {};
  return {
    name: fund.name || '',
    category: fund.category || '',
    objective: fund.objective || '',
    riskLevel: fund.riskLevel || 'moderate',
    returnTier: fund.returnTier || '',
    minSip: rupees(fund.minimumSipPaise),
    minLumpsum: rupees(fund.minimumPurchasePaise),
    minimumDurationMonths: version.minimumDurationMonths ?? '',
    recommendedHoldingMonths: version.recommendedHoldingMonths ?? '',
    disclosureTitle: disclosure.title || '',
    disclosureBody: disclosure.body || '',
  };
}

/**
 * The body of `POST /v1/admin/funds/:id/versions`, and nothing else.
 *
 * That route's schema is `.strict()`. The old editor collected initial investment,
 * current value, launch date, NAV, a star rating, a performance summary, a
 * performance series, performance periods, an asset allocation, six advanced ratios,
 * six chart toggles, sectors and per-company investment amounts — then sent name,
 * category, objective, riskLevel, the two minimums and the disclosure. Everything
 * else was collected, acknowledged with a success toast, and dropped. The client
 * payload has no field for any of it either.
 */
export function versionPayloadFromProfile(profile) {
  const body = {
    name: profile.name.trim(),
    category: profile.category.trim() || 'general',
    objective: profile.objective.trim(),
    riskLevel: profile.riskLevel,
    minimumSipPaise: paise(profile.minSip),
    minimumPurchasePaise: paise(profile.minLumpsum),
    disclosure: {
      title: profile.disclosureTitle.trim() || `${profile.name.trim()} disclosure`,
      body: profile.disclosureBody.trim(),
    },
  };
  if (profile.returnTier) body.returnTier = profile.returnTier;
  const duration = positiveInt(profile.minimumDurationMonths);
  if (duration !== null) body.minimumDurationMonths = duration;
  const holding = positiveInt(profile.recommendedHoldingMonths);
  if (holding !== null) body.recommendedHoldingMonths = holding;
  return body;
}

/** Field-level validation, matching the route's schema so a save is not a guess. */
export function validateProfile(profile) {
  const errors = {};
  if (!profile.name.trim()) errors.name = 'A pool needs a name.';
  else if (profile.name.trim().length > 200) errors.name = 'Keep the name under 200 characters.';
  if (profile.category.trim().length > 200) errors.category = 'Keep the category under 200 characters.';
  if (!RISK_LEVELS.some((level) => level.value === profile.riskLevel)) {
    errors.riskLevel = 'Choose a risk level.';
  }
  // The route requires a non-empty disclosure body; a blank one is rejected with a
  // validation error the operator cannot interpret.
  if (!profile.disclosureBody.trim()) {
    errors.disclosureBody = 'The disclosure clients read cannot be empty.';
  }
  for (const key of ['minSip', 'minLumpsum']) {
    if (profile[key] !== '' && !(Number(profile[key]) >= 0)) {
      errors[key] = 'Enter an amount in rupees, or leave it blank.';
    }
  }
  return errors;
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
}
