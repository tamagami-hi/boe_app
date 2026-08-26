const STORAGE_KEY = 'boe.client.appConfig';
const CONFIG_EVENT = 'boe:app-config-updated';

export const COMPONENT_LIBRARY = {
  dashboard: [
    { id: 'portfolio_summary', label: 'Portfolio summary', description: 'Portfolio summary with invested amount and holdings.' },
    { id: 'active_sips', label: 'Active SIPs', description: 'Client recurring investment cards.' },
    { id: 'quick_actions', label: 'Quick actions', description: 'Shortcut buttons into investment and account flows.' },
    { id: 'research_context', label: 'Research context', description: 'Published allocation context rows.' },
    { id: 'risk_disclosure', label: 'Risk disclosure', description: 'Footer risk disclosure copy.' },
  ],
  explore: [
    { id: 'search', label: 'Search', description: 'Search input and filtering for published strategies.' },
    { id: 'product_catalog', label: 'Strategy catalog', description: 'Strategy cards, sparkline charts, and minimum amounts.' },
    { id: 'research_context', label: 'Research context', description: 'Allocation context rows on Explore.' },
    { id: 'performance_disclosure', label: 'Performance disclosure', description: 'Past performance disclosure below strategy cards.' },
    { id: 'allocation_disclosure', label: 'Allocation disclosure', description: 'Explanation below the research context.' },
  ],
  fundDetail: [
    { id: 'objective', label: 'Investment objective', description: 'Objective, risk, and horizon card.' },
    { id: 'minimums', label: 'Minimums', description: 'Minimum SIP, one-time amount, and lock-in row.' },
    { id: 'performance_chart', label: 'Performance chart', description: 'Performance metrics and charts.' },
    { id: 'sip_projection', label: 'SIP projection', description: 'Illustrative SIP calculator.' },
    { id: 'allocation_chart', label: 'Allocation chart', description: 'Allocation ring and legend.' },
    { id: 'portfolio_exposure', label: 'Portfolio exposure', description: 'Published exposure rows.' },
    { id: 'fees', label: 'Fees', description: 'Fee table from strategy configuration.' },
    { id: 'methodology_disclosure', label: 'Methodology disclosure', description: 'Strategy methodology and disclosure footer.' },
    { id: 'action_bar', label: 'Investment action bar', description: 'One-time and Start SIP buttons.' },
  ],
};

export const DEFAULT_APP_CONFIG = {
  version: 1,
  publishedAt: '',
  mobile: {
    products: [
      {
        id: 'strategy_slot_1',
        name: 'BeOnEdge Growth Fund',
        tagline: 'Long-term capital appreciation through diversified equity allocation.',
        objective: 'Designed to help clients review a balanced investment approach before making a decision.',
        categoryEyebrow: 'BeOnEdge strategy',
        status: 'active',
        lifecycleStage: 'active',
        riskLabel: 'moderate_high',
        minSip: 500,
        minLumpsum: 5000,
        minDurationMonths: 12,
        lockInText: 'None',
        allocation: [
          { label: 'Technology', pct: 35 },
          { label: 'Healthcare', pct: 25 },
          { label: 'Finance', pct: 20 },
          { label: 'Energy', pct: 20 },
        ],
        topHoldings: [
          { name: 'Infosys Ltd', pct: 10.5 },
          { name: 'HDFC Bank', pct: 10.0 },
          { name: 'Reliance Industries', pct: 8.0 },
          { name: 'Sun Pharma', pct: 7.5 },
          { name: 'TCS Ltd', pct: 7.0 },
        ],
        disclosureVersion: 'standard',
        methodology: 'Diversified allocation with periodic review and published disclosures.',
        fees: [],
        horizon: '3 years+',
        totalPoolSize: 50000000,
        sectors: [
          { id: 'sec_1', name: 'Technology', percentage: 35, color: '#4F46E5' },
          { id: 'sec_2', name: 'Healthcare', percentage: 25, color: '#10B981' },
          { id: 'sec_3', name: 'Finance', percentage: 20, color: '#F59E0B' },
          { id: 'sec_4', name: 'Energy', percentage: 20, color: '#EF4444' },
        ],
        investments: [
          { id: 'inv_1', companyName: 'Infosys Ltd', amount: 5250000, sectorId: 'sec_1' },
          { id: 'inv_2', companyName: 'TCS Ltd', amount: 3500000, sectorId: 'sec_1' },
          { id: 'inv_3', companyName: 'Sun Pharma', amount: 3750000, sectorId: 'sec_2' },
          { id: 'inv_4', companyName: 'HDFC Bank', amount: 5000000, sectorId: 'sec_3' },
          { id: 'inv_5', companyName: 'Reliance Industries', amount: 4000000, sectorId: 'sec_4' },
        ],
        chartConfig: { showSectorDistribution: true, showInvestmentBreakdown: true, showCompanyNames: true },
      },
      {
        id: 'strategy_slot_2',
        name: 'BeOnEdge Static Fund',
        tagline: 'Stable income generation through high-quality debt and fixed-income instruments.',
        objective: 'Designed to present focused investment ideas with clear risk and suitability context.',
        categoryEyebrow: 'BeOnEdge strategy',
        status: 'active',
        riskLabel: 'low',
        minSip: 1000,
        minLumpsum: 10000,
        minDurationMonths: 6,
        lockInText: 'None',
        allocation: [
          { label: 'Debt', pct: 40 },
          { label: 'Government Bonds', pct: 30 },
          { label: 'Corporate Bonds', pct: 20 },
          { label: 'Cash', pct: 10 },
        ],
        topHoldings: [
          { name: 'LIC Infrastructure Bonds', pct: 23.3 },
          { name: 'SBI Tax Saver Deposit', pct: 16.7 },
          { name: '10-Year G-Sec', pct: 16.7 },
          { name: 'RBI Floating Rate Bonds', pct: 13.3 },
          { name: 'Tata Steel Corporate Bonds', pct: 13.3 },
          { name: 'HDFC Ltd Debentures', pct: 6.7 },
          { name: 'Liquid Cash Reserve', pct: 10.0 },
        ],
        disclosureVersion: 'draft',
        methodology: 'Research-led selection with published rationale and risk notes.',
        fees: [],
        horizon: '5 years+',
        totalPoolSize: 30000000,
        sectors: [
          { id: 'sec_5', name: 'Debt', percentage: 40, color: '#6366F1' },
          { id: 'sec_6', name: 'Government Bonds', percentage: 30, color: '#8B5CF6' },
          { id: 'sec_7', name: 'Corporate Bonds', percentage: 20, color: '#EC4899' },
          { id: 'sec_8', name: 'Cash', percentage: 10, color: '#14B8A6' },
        ],
        investments: [
          { id: 'inv_6', companyName: 'LIC Infrastructure Bonds', amount: 7000000, sectorId: 'sec_5' },
          { id: 'inv_7', companyName: 'SBI Tax Saver Deposit', amount: 5000000, sectorId: 'sec_5' },
          { id: 'inv_8', companyName: '10-Year G-Sec', amount: 5000000, sectorId: 'sec_6' },
          { id: 'inv_9', companyName: 'RBI Floating Rate Bonds', amount: 4000000, sectorId: 'sec_6' },
          { id: 'inv_10', companyName: 'Tata Steel Corporate Bonds', amount: 4000000, sectorId: 'sec_7' },
          { id: 'inv_11', companyName: 'HDFC Ltd Debentures', amount: 2000000, sectorId: 'sec_7' },
          { id: 'inv_12', companyName: 'Liquid Cash Reserve', amount: 3000000, sectorId: 'sec_8' },
        ],
        chartConfig: { showSectorDistribution: true, showInvestmentBreakdown: true, showCompanyNames: true },
      },
      {
        id: 'strategy_slot_3',
        name: 'BeOnEdge Algo-Trade Fund',
        tagline: 'Systematic alpha generation through quantitative models and algorithmic execution.',
        objective: 'Designed to connect contribution habits, timelines, and strategy choices in one place.',
        categoryEyebrow: 'BeOnEdge strategy',
        status: 'coming_soon',
        lifecycleStage: 'published',
        riskLabel: 'very_high',
        minSip: 1000,
        minLumpsum: 10000,
        minDurationMonths: 24,
        lockInText: '12 months',
        allocation: [
          { label: 'Equity', pct: 50 },
          { label: 'Derivatives', pct: 30 },
          { label: 'Forex', pct: 20 },
        ],
        topHoldings: [
          { name: 'Nifty 50 Futures', pct: 40.0 },
          { name: 'Bank Nifty Options', pct: 25.0 },
          { name: 'USD/INR Hedging', pct: 20.0 },
          { name: 'EUR/USD Pairs', pct: 15.0 },
        ],
        disclosureVersion: 'draft',
        methodology: 'Goal-led allocation with clear assumptions and periodic review.',
        fees: [],
        horizon: 'Varies by goal',
        totalPoolSize: 20000000,
        sectors: [
          { id: 'sec_9', name: 'Equity', percentage: 50, color: '#F97316' },
          { id: 'sec_10', name: 'Derivatives', percentage: 30, color: '#3B82F6' },
          { id: 'sec_11', name: 'Forex', percentage: 20, color: '#8B5CF6' },
        ],
        investments: [
          { id: 'inv_13', companyName: 'Nifty 50 Futures', amount: 8000000, sectorId: 'sec_9' },
          { id: 'inv_14', companyName: 'Bank Nifty Options', amount: 5000000, sectorId: 'sec_10' },
          { id: 'inv_15', companyName: 'USD/INR Hedging', amount: 4000000, sectorId: 'sec_11' },
          { id: 'inv_16', companyName: 'EUR/USD Pairs', amount: 3000000, sectorId: 'sec_11' },
        ],
        chartConfig: { showSectorDistribution: true, showInvestmentBreakdown: true, showCompanyNames: true },
      },
    ],
    researchContext: [
    ],
    screens: {
      dashboard: {
        components: [
          { id: 'portfolio_summary', enabled: true },
          { id: 'active_sips', enabled: true },
          { id: 'quick_actions', enabled: true },
          { id: 'research_context', enabled: true },
          { id: 'risk_disclosure', enabled: true },
        ],
        copy: {
          portfolioTitle: 'Current value',
          activeSipsTitle: 'Active SIPs',
          viewAllLabel: 'View all',
          noActiveTitle: 'No active investments yet.',
          noActiveBody: 'Explore BeOnEdge strategies and start your first SIP.',
          noActiveCta: 'Explore strategies',
          researchTitle: 'How BeOnEdge invests',
          riskDisclosure: 'Past performance does not guarantee future returns. Investments are subject to market risk.',
        },
        quickActions: [
          { id: 'start_sip', label: 'Start SIP', icon: 'Plus', route: '/app/explore', enabled: true },
          { id: 'one_time', label: 'One-time', icon: 'Repeat', route: '/app/explore', enabled: true },
          { id: 'history', label: 'History', icon: 'Receipt', route: '/app/transactions', enabled: true },
          { id: 'products', label: 'Strategies', icon: 'Compass', route: '/app/explore', enabled: true },
        ],
      },
      explore: {
        components: [
          { id: 'search', enabled: true },
          { id: 'product_catalog', enabled: true },
          { id: 'performance_disclosure', enabled: true },
          { id: 'research_context', enabled: true },
          { id: 'allocation_disclosure', enabled: true },
        ],
        copy: {
          title: 'Explore',
          searchPlaceholder: 'Search strategies or goals',
          productsEyebrow: 'BeOnEdge strategies',
          noMatches: 'No strategies match this search. Try another term.',
          performanceDisclosure: 'Performance shown is past return. Past performance does not guarantee future returns.',
          researchEyebrow: 'Research context',
          allocationDisclosure: 'This explains how BeOnEdge allocates client investments across its strategies. It is allocation context only.',
        },
        charts: {
        },
      },
      fundDetail: {
        components: [
          { id: 'objective', enabled: true },
          { id: 'minimums', enabled: true },
          { id: 'performance_chart', enabled: true },
          { id: 'sip_projection', enabled: true },
          { id: 'allocation_chart', enabled: true },
          { id: 'portfolio_exposure', enabled: true },
          { id: 'fees', enabled: true },
          { id: 'methodology_disclosure', enabled: true },
          { id: 'action_bar', enabled: true },
        ],
        copy: {
          objectiveTitle: 'Investment objective',
          riskLabel: 'Risk',
          horizonLabel: 'Recommended horizon',
          minSipLabel: 'Min SIP',
          minLumpsumLabel: 'Min lumpsum',
          lockInLabel: 'Lock-in',
          performanceDisclosure: 'Past performance does not guarantee future returns. Published by BeOnEdge.',
          projectionTitle: 'SIP projection',
          projectionValueLabel: 'Projected value',
          projectionDisclosure: 'Projection uses published historical return data. Illustrative only. Not guaranteed.',
          exposureTitle: 'Portfolio exposure',
          exposureLinkLabel: 'View full allocation',
          feesTitle: 'Fees',
          feesDisclosure: 'See Legal and disclosures for fee details.',
          methodologyPrefix: 'Methodology',
          closedBanner: "This strategy is not accepting new investments right now.",
          oneTimeButton: 'One-time',
          sipButton: 'Start SIP',
        },
        charts: {
        },
        calculator: {
          defaultAmount: null,
          defaultMonths: null,
          amountPresets: [],
          durationMonths: [],
          fallbackReturnPct: null,
        },
        exposureLimit: null,
      },
      invest: {
        sip: {
          defaultAmount: null,
          defaultMonths: null,
          defaultDebitDay: null,
          amountPresets: [],
          durationMonths: [],
          debitDays: [],
          minDurationMonths: null,
          disclosures: {
            minimumPrefix: 'Minimum',
            stepUpTitle: 'Increase SIP every year',
            stepUpBody: 'Optional step-up. Default off.',
            riskConsent: 'I have read the Risk disclosure and understand market risk.',
            // Spec §6.2 fallback: the SIP is a schedule/reminder — each installment
            // is a fresh client-initiated PhonePe checkout; there is no mandate and
            // no automatic debit.
            scheduleConsent: 'I understand this SIP is a monthly schedule. Each installment is paid by me through a fresh checkout — no automatic debit is set up.',
            scheduleDisclosure: 'Each due installment is paid by you through a fresh PhonePe checkout. Nothing is debited automatically.',
          },
        },
        oneTime: {
          defaultAmount: null,
          amountPresets: [],
          // Spec §11.2: neutral processing status only — no NAV/units language and
          // no bank-verification/review/allocation concepts in client copy.
          paymentDisclosure: 'Payment runs through a secure PhonePe checkout. Once PhonePe confirms the payment, your investment is processed.',
        },
      },
    },
  },
};

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function storage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function remoteConfigEnabled() {
  return import.meta.env.VITE_BEO_API_MODE === 'http';
}

function dispatchConfig(config) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: config }));
  }
}

function persistAppConfig(config) {
  const next = normalizeAppConfig(config);
  const store = storage();
  if (store) store.setItem(STORAGE_KEY, JSON.stringify(next));
  dispatchConfig(next);
  return clone(next);
}

function normalizeScreen(screenId, screen = {}) {
  const library = COMPONENT_LIBRARY[screenId] || [];
  const existing = new Map((screen.components || []).map((item) => [item.id, item]));
  const components = library.map((item) => ({
    id: item.id,
    enabled: existing.get(item.id)?.enabled ?? true,
  }));

  return { ...screen, components };
}

export function normalizeAppConfig(config) {
  /*
   * A canonical payload (featureFlags + presentation, no `mobile`) is expanded back
   * into the builder document first, so the merge below sees published values rather
   * than only the defaults. Both readers go through here: `/v1/app-config` on the
   * client and `/v1/admin/app-config` in the console.
   */
  const source = config?.mobile === undefined && (config?.featureFlags || config?.presentation)
    ? { ...config, ...fromCanonicalAppConfig(config) }
    : config;

  const merged = {
    ...clone(DEFAULT_APP_CONFIG),
    ...source,
    mobile: {
      ...clone(DEFAULT_APP_CONFIG.mobile),
      ...(source?.mobile || {}),
      screens: {
        ...clone(DEFAULT_APP_CONFIG.mobile.screens),
        ...(source?.mobile?.screens || {}),
      },
    },
  };

  for (const key of ['dashboard', 'explore', 'fundDetail']) {
    merged.mobile.screens[key] = {
      ...clone(DEFAULT_APP_CONFIG.mobile.screens[key]),
      ...(source?.mobile?.screens?.[key] || {}),
      copy: {
        ...clone(DEFAULT_APP_CONFIG.mobile.screens[key].copy || {}),
        ...(source?.mobile?.screens?.[key]?.copy || {}),
      },
    };
  }

  merged.mobile.screens.invest = {
    ...clone(DEFAULT_APP_CONFIG.mobile.screens.invest),
    ...(source?.mobile?.screens?.invest || {}),
    sip: {
      ...clone(DEFAULT_APP_CONFIG.mobile.screens.invest.sip),
      ...(source?.mobile?.screens?.invest?.sip || {}),
      disclosures: {
        ...clone(DEFAULT_APP_CONFIG.mobile.screens.invest.sip.disclosures),
        ...(source?.mobile?.screens?.invest?.sip?.disclosures || {}),
      },
    },
    oneTime: {
      ...clone(DEFAULT_APP_CONFIG.mobile.screens.invest.oneTime),
      ...(source?.mobile?.screens?.invest?.oneTime || {}),
    },
  };

  merged.mobile.products = clone(source?.mobile?.products || DEFAULT_APP_CONFIG.mobile.products);
  merged.mobile.researchContext = clone(source?.mobile?.researchContext || DEFAULT_APP_CONFIG.mobile.researchContext);
  merged.mobile.screens.dashboard = normalizeScreen('dashboard', merged.mobile.screens.dashboard);
  merged.mobile.screens.explore = normalizeScreen('explore', merged.mobile.screens.explore);
  merged.mobile.screens.fundDetail = normalizeScreen('fundDetail', merged.mobile.screens.fundDetail);

  return merged;
}

export function loadAppConfig() {
  const store = storage();
  if (!store) return clone(DEFAULT_APP_CONFIG);

  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return clone(DEFAULT_APP_CONFIG);

  try {
    return normalizeAppConfig(JSON.parse(raw));
  } catch {
    return clone(DEFAULT_APP_CONFIG);
  }
}

export function saveAppConfig(config) {
  const next = normalizeAppConfig({ ...config, publishedAt: new Date().toISOString() });
  return persistAppConfig(next);
}

export async function loadRemoteAppConfig({ admin = false, persist = true, request } = {}) {
  if (!remoteConfigEnabled()) return null;
  if (typeof request !== 'function') throw new Error('App-config transport is not configured.');

  const payload = await request(admin ? '/v1/admin/app-config' : '/v1/app-config', {
    auth: admin,
    scope: admin ? 'admin' : 'client',
  });
  if (!payload?.config) return null;

  const next = normalizeAppConfig(payload.config);
  return persist ? persistAppConfig(next) : clone(next);
}

/*
 * The flat key scheme that carries the builder's editable presentation onto the
 * canonical payload.
 *
 * `app_config_versions.presentation` is `Record<string(<=80), string(<=500) | number
 * | boolean>` and `.strict()`, so anything published has to be flattened into
 * scalars. These prefixes are that flattening, and `fromCanonicalPresentation`
 * below is its exact inverse — the pair is what makes a publish survive a reload.
 *
 * Screen copy and dashboard shortcuts used to be edited in the App Builder and then
 * dropped on the floor: `toCanonicalAppConfig` mapped component toggles and passed
 * `presentation` through, and nothing else in the builder document had anywhere to
 * go. The operator changed a label, pressed Publish, saw "Published to active data
 * store", and no device ever saw it.
 */
const COPY_PREFIX = 'copy.';
const QUICK_ACTION_PREFIX = 'qa.';
const CHART_PREFIX = 'charts.';
const INVEST_PREFIX = 'invest.';
const COPY_SCREENS = ['dashboard', 'explore', 'fundDetail'];
const MAX_PRESENTATION_VALUE = 500;
const MAX_QUICK_ACTIONS = 8;

const csvOf = (values) => (Array.isArray(values) ? values.join(',') : '');

const numbersFrom = (value) => String(value ?? '')
  .split(',')
  .map((part) => part.trim())
  // Without this, an empty string split on ',' yields [''] and Number('') is 0 —
  // so a missing preset list became the list [0].
  .filter((part) => part !== '')
  .map(Number)
  .filter(Number.isFinite);

function toCanonicalPresentation(config) {
  const presentation = { ...(config?.presentation || {}) };
  const screens = config?.mobile?.screens || {};

  for (const screenId of COPY_SCREENS) {
    for (const [key, value] of Object.entries(screens[screenId]?.copy || {})) {
      if (typeof value !== 'string') continue;
      presentation[`${COPY_PREFIX}${screenId}.${key}`.slice(0, 80)] = value.slice(0, MAX_PRESENTATION_VALUE);
    }
  }

  const actions = (screens.dashboard?.quickActions || []).slice(0, MAX_QUICK_ACTIONS);
  presentation[`${QUICK_ACTION_PREFIX}count`] = actions.length;
  actions.forEach((action, index) => {
    const at = `${QUICK_ACTION_PREFIX}${index}.`;
    presentation[`${at}id`] = String(action.id || `action_${index}`).slice(0, MAX_PRESENTATION_VALUE);
    presentation[`${at}label`] = String(action.label || '').slice(0, MAX_PRESENTATION_VALUE);
    presentation[`${at}icon`] = String(action.icon || '').slice(0, MAX_PRESENTATION_VALUE);
    presentation[`${at}route`] = String(action.route || '').slice(0, MAX_PRESENTATION_VALUE);
    presentation[`${at}on`] = action.enabled !== false;
  });

  const fundDetailCharts = screens.fundDetail?.charts || {};
  presentation[`${CHART_PREFIX}fundDetail.periods`] = csvOf(fundDetailCharts.periods);
  presentation[`${CHART_PREFIX}fundDetail.default`] = String(fundDetailCharts.defaultPeriod || '');

  const sip = screens.invest?.sip || {};
  const oneTime = screens.invest?.oneTime || {};
  presentation[`${INVEST_PREFIX}sip.presets`] = csvOf(sip.amountPresets);
  presentation[`${INVEST_PREFIX}sip.durations`] = csvOf(sip.durationMonths);
  presentation[`${INVEST_PREFIX}sip.debitDays`] = csvOf(sip.debitDays);
  presentation[`${INVEST_PREFIX}oneTime.presets`] = csvOf(oneTime.amountPresets);

  return presentation;
}

/**
 * Rebuild the builder document's published half from a canonical payload.
 *
 * Without this, `featureFlags` was a one-way trip: the flag was written to the
 * server and read by nobody. `normalizeAppConfig` merged the canonical payload over
 * the defaults, `mobile.screens[].components` therefore came from the defaults, and
 * `isComponentEnabled` answered `true` for every component on every screen — so all
 * nineteen toggles in the App Builder had no effect on the client, and the editor
 * itself reset them to "on" on its next load.
 */
export function fromCanonicalAppConfig(payload) {
  const flags = payload?.featureFlags || {};
  const presentation = payload?.presentation || {};
  const screens = {};

  for (const [screenId, library] of Object.entries(COMPONENT_LIBRARY)) {
    const components = library.map((item) => {
      const flag = flags[`${screenId}_${item.id}`];
      return { id: item.id, enabled: flag === undefined ? true : flag !== false };
    });
    screens[screenId] = { components };
  }

  for (const screenId of COPY_SCREENS) {
    const copy = {};
    const prefix = `${COPY_PREFIX}${screenId}.`;
    for (const [key, value] of Object.entries(presentation)) {
      if (key.startsWith(prefix) && typeof value === 'string') copy[key.slice(prefix.length)] = value;
    }
    if (Object.keys(copy).length > 0) {
      screens[screenId] = { ...(screens[screenId] || {}), copy };
    }
  }

  const count = Number(presentation[`${QUICK_ACTION_PREFIX}count`]);
  if (Number.isFinite(count) && count > 0) {
    const quickActions = [];
    for (let index = 0; index < Math.min(count, MAX_QUICK_ACTIONS); index += 1) {
      const at = `${QUICK_ACTION_PREFIX}${index}.`;
      const route = presentation[`${at}route`];
      if (typeof route !== 'string' || route === '') continue;
      quickActions.push({
        id: String(presentation[`${at}id`] || `action_${index}`),
        label: String(presentation[`${at}label`] || ''),
        icon: String(presentation[`${at}icon`] || 'Compass'),
        route,
        enabled: presentation[`${at}on`] !== false,
      });
    }
    if (quickActions.length > 0) {
      screens.dashboard = { ...(screens.dashboard || {}), quickActions };
    }
  }

  const periods = String(presentation[`${CHART_PREFIX}fundDetail.periods`] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const defaultPeriod = presentation[`${CHART_PREFIX}fundDetail.default`];
  if (periods.length > 0 || defaultPeriod) {
    screens.fundDetail = {
      ...(screens.fundDetail || {}),
      charts: {
        ...(periods.length > 0 ? { periods } : {}),
        ...(defaultPeriod ? { defaultPeriod: String(defaultPeriod) } : {}),
      },
    };
  }

  const sipPresets = numbersFrom(presentation[`${INVEST_PREFIX}sip.presets`]);
  const sipDurations = numbersFrom(presentation[`${INVEST_PREFIX}sip.durations`]);
  const debitDays = numbersFrom(presentation[`${INVEST_PREFIX}sip.debitDays`]);
  const oneTimePresets = numbersFrom(presentation[`${INVEST_PREFIX}oneTime.presets`]);
  if (sipPresets.length || sipDurations.length || debitDays.length || oneTimePresets.length) {
    screens.invest = {
      sip: {
        ...(sipPresets.length ? { amountPresets: sipPresets } : {}),
        ...(sipDurations.length ? { durationMonths: sipDurations } : {}),
        ...(debitDays.length ? { debitDays } : {}),
      },
      oneTime: oneTimePresets.length ? { amountPresets: oneTimePresets } : {},
    };
  }

  return { mobile: { screens } };
}

/**
 * Project the local app-builder document onto the canonical
 * `app_config_versions` payload. The canonical contract is presentation and
 * feature-flag data only: fund/product catalogue data lives in `funds` and
 * monetary policy in `finance_policy_versions`, so the backend schema is strict
 * and rejects them.
 *
 * NOT published, and not publishable: `mobile.products` and
 * `mobile.researchContext`. Those are the offline fixture catalogue that
 * `fundsApi`/`researchApi` fall back to when `VITE_BEO_API_MODE` is not `http`;
 * with a backend they are irrelevant, because the client reads funds from
 * `/v1/client/funds`.
 */
export function toCanonicalAppConfig(config) {
  const featureFlags = {};
  const screens = config?.mobile?.screens || {};
  for (const [screenId, screen] of Object.entries(screens)) {
    for (const component of screen?.components || []) {
      if (!component?.id) continue;
      featureFlags[`${screenId}_${component.id}`.slice(0, 80)] = component.enabled !== false;
    }
  }
  return {
    featureFlags,
    minimumSupportedVersion: config?.minimumSupportedVersion || {},
    downloads: config?.downloads || {},
    maintenance: config?.maintenance || { enabled: false },
    presentation: toCanonicalPresentation(config),
  };
}

export async function publishAppConfig(config, { reason = 'Published from admin app builder.', request } = {}) {
  const next = normalizeAppConfig({ ...config, publishedAt: new Date().toISOString() });

  if (!remoteConfigEnabled()) {
    return persistAppConfig(next);
  }

  if (typeof request !== 'function') throw new Error('App-config transport is not configured.');

  await request('/v1/admin/app-config', {
    method: 'PATCH',
    auth: true,
    scope: 'admin',
    body: { config: toCanonicalAppConfig(next), reason },
  });

  return persistAppConfig(next);
}

export function resetAppConfig() {
  const store = storage();
  if (store) store.removeItem(STORAGE_KEY);
  const next = clone(DEFAULT_APP_CONFIG);
  dispatchConfig(next);
  return next;
}

export function subscribeToAppConfig(listener) {
  if (typeof window === 'undefined') return () => {};

  const onConfig = (event) => listener(event.detail || loadAppConfig());
  const onStorage = (event) => {
    if (event.key === STORAGE_KEY) listener(loadAppConfig());
  };

  window.addEventListener(CONFIG_EVENT, onConfig);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CONFIG_EVENT, onConfig);
    window.removeEventListener('storage', onStorage);
  };
}

export function isComponentEnabled(config, screenId, componentId) {
  const screen = config?.mobile?.screens?.[screenId];
  return screen?.components?.find((item) => item.id === componentId)?.enabled !== false;
}

export function visibleQuickActions(config) {
  return (config?.mobile?.screens?.dashboard?.quickActions || []).filter((item) => item.enabled !== false);
}

export function strategyById(config, strategyId) {
  return config?.mobile?.products?.find((item) => item.id === strategyId) || null;
}
