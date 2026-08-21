import { AUM_OPENING_REASONS, todayInIndia } from '../../helpers/aumReasons.js';

export const FUND_STATES = ['draft', 'review_pending', 'published', 'paused', 'archived'];

export const LIFECYCLE_ACTIONS = ['published', 'paused', 'archived'];

export const ALLOWED_TRANSITIONS = {
  draft: ['published', 'archived'],
  review_pending: ['published', 'archived'],
  published: ['paused', 'archived'],
  paused: ['published', 'archived'],
  archived: [],
};

export function lifecycleActionsFor(state) {
  return ALLOWED_TRANSITIONS[state] ?? [];
}

export const STATE_DESCRIPTIONS = {
  draft: 'Not visible to clients. Publish the fund when its terms and stock list are ready.',
  review_pending: 'Awaiting review. Not visible to clients.',
  published: 'Visible to clients and open to new investment.',
  paused: 'Visible to clients, closed to new investment.',
  archived: 'Hidden from clients and permanently closed to further changes.',
};

export const LIFECYCLE_CONSEQUENCES = {
  published: 'Clients will see this fund and be able to invest in it.',
  paused: 'Clients keep seeing the fund and their holdings, but cannot add money.',
  archived:
    'Clients will no longer see the fund. This is final: an archived fund cannot be published, paused, edited, or given new AUM. Its records stay in the catalogue and in history.',
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

export const FUND_CATEGORIES = [
  { value: 'equity', label: 'Equity' },
  { value: 'debt', label: 'Debt' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'multi_asset', label: 'Multi asset' },
  { value: 'index', label: 'Index' },
  { value: 'liquid', label: 'Liquid' },
  { value: 'thematic', label: 'Thematic' },
];

export const EMPTY_PROFILE = {
  name: '',
  category: 'equity',
  objective: '',
  riskLevel: 'moderate',
  returnTier: '',
  minSip: '',
  minLumpsum: '',
  minimumDurationMonths: '',
  recommendedHoldingMonths: '',
  disclosureTitle: '',
  disclosureBody: '',
  openingAum: '',
  openingAumAsOfDate: todayInIndia(),
  openingAumReasonCode: AUM_OPENING_REASONS[0].value,
  openingAumNote: '',
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

export function toPaiseString(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return String(Math.round(amount * 100));
}

export function profileFromDetail(detail) {
  const fund = detail?.fund || {};
  const disclosure = (detail?.disclosures || [])[0] || {};
  const version = (detail?.versions || [])[0] || {};
  return {
    ...EMPTY_PROFILE,
    name: fund.name || '',
    category: fund.category || 'equity',
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

export function versionPayloadFromProfile(profile) {
  const body = {
    name: profile.name.trim(),
    category: profile.category.trim() || 'equity',
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

export function createPayloadFromProfile(profile) {
  const note = profile.openingAumNote.trim();
  return {
    slug: slugify(profile.name),
    terms: versionPayloadFromProfile(profile),
    openingAum: {
      aumPaise: toPaiseString(profile.openingAum) ?? '0',
      asOfDate: profile.openingAumAsOfDate,
      reasonCode: profile.openingAumReasonCode,
      ...(note ? { note } : {}),
    },
  };
}

export function validateProfile(profile, { requireOpeningAum = false } = {}) {
  const errors = {};
  if (!profile.name.trim()) errors.name = 'A fund needs a name.';
  else if (profile.name.trim().length > 200) errors.name = 'Keep the name under 200 characters.';
  if (!FUND_CATEGORIES.some((category) => category.value === profile.category)) {
    errors.category = 'Choose a category.';
  }
  if (profile.objective.trim().length > 20000) {
    errors.objective = 'Keep the objective under 20,000 characters.';
  }
  if (!RISK_LEVELS.some((level) => level.value === profile.riskLevel)) {
    errors.riskLevel = 'Choose a risk level.';
  }
  if (profile.disclosureTitle.trim().length > 200) {
    errors.disclosureTitle = 'Keep the title under 200 characters.';
  }
  if (!profile.disclosureBody.trim()) {
    errors.disclosureBody = 'The disclosure clients read cannot be empty.';
  } else if (profile.disclosureBody.trim().length > 20000) {
    errors.disclosureBody = 'Keep the disclosure under 20,000 characters.';
  }
  for (const key of ['minSip', 'minLumpsum']) {
    if (profile[key] !== '' && !(Number(profile[key]) >= 0)) {
      errors[key] = 'Enter an amount in rupees, or leave it blank.';
    }
  }
  for (const key of ['minimumDurationMonths', 'recommendedHoldingMonths']) {
    if (profile[key] === '') continue;
    const months = Number(profile[key]);
    if (!Number.isInteger(months) || months < 1 || months > 1200) {
      errors[key] = 'Enter a whole number of months between 1 and 1200.';
    }
  }
  if (requireOpeningAum) {
    if (toPaiseString(profile.openingAum) === null || profile.openingAum === '') {
      errors.openingAum = 'Enter the opening fund size in rupees. Zero is allowed; negative is not.';
    }
    if (!profile.openingAumAsOfDate) {
      errors.openingAumAsOfDate = 'Choose the date this figure is effective from.';
    }
    if (!AUM_OPENING_REASONS.some((reason) => reason.value === profile.openingAumReasonCode)) {
      errors.openingAumReasonCode = 'Choose a reason.';
    }
    if (profile.openingAumNote.trim().length > 2000) {
      errors.openingAumNote = 'Keep the note under 2,000 characters.';
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
