// What the App Builder publishes must be what the client reads back.
//
// It was not. `toCanonicalAppConfig` mapped component toggles to flat feature flags
// and `normalizeAppConfig` never read them back, so:
//   - every one of the nineteen toggles in the App Builder had no effect on the
//     client (`isComponentEnabled` answered true for everything), and
//   - the editor reset them all to "on" the next time it loaded the published config.
// Screen copy and dashboard shortcuts had nowhere to go at all: they were edited,
// acknowledged with "Published to active data store", and dropped.
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_APP_CONFIG,
  fromCanonicalAppConfig,
  isComponentEnabled,
  normalizeAppConfig,
  toCanonicalAppConfig,
  visibleQuickActions,
} from './appConfig.js';

// The canonical payload schema (backend_controller adminContentRoutes
// `appConfigPayloadSchema`, `.strict()`).
const ALLOWED_KEYS = ['featureFlags', 'minimumSupportedVersion', 'downloads', 'maintenance', 'presentation'];

function edited() {
  const config = normalizeAppConfig(DEFAULT_APP_CONFIG);
  config.mobile.screens.dashboard.components = config.mobile.screens.dashboard.components.map(
    (item) => (item.id === 'active_sips' ? { ...item, enabled: false } : item),
  );
  config.mobile.screens.dashboard.copy.portfolioTitle = 'Your money';
  config.mobile.screens.dashboard.quickActions = [
    { id: 'start_sip', label: 'Begin a SIP', icon: 'Plus', route: '/app/explore', enabled: true },
    { id: 'history', label: 'History', icon: 'Receipt', route: '/app/transactions', enabled: false },
  ];
  config.mobile.screens.fundDetail.charts = { periods: ['1Y', '3Y'], defaultPeriod: '3Y' };
  config.mobile.screens.invest.sip.amountPresets = [500, 1000, 2500];
  return config;
}

describe('the canonical payload', () => {
  test('carries only the keys the route accepts', () => {
    expect(Object.keys(toCanonicalAppConfig(edited())).sort()).toEqual([...ALLOWED_KEYS].sort());
  });

  test('every presentation key and value is within the schema bounds', () => {
    const { presentation } = toCanonicalAppConfig(edited());
    for (const [key, value] of Object.entries(presentation)) {
      expect(key.length, key).toBeLessThanOrEqual(80);
      expect(['string', 'number', 'boolean'], `${key} is ${typeof value}`).toContain(typeof value);
      if (typeof value === 'string') expect(value.length, key).toBeLessThanOrEqual(500);
    }
  });

  test('a disabled component becomes a false feature flag', () => {
    const { featureFlags } = toCanonicalAppConfig(edited());
    expect(featureFlags.dashboard_active_sips).toBe(false);
    expect(featureFlags.dashboard_portfolio_summary).toBe(true);
  });

  test('the canonical payload excludes non-presentation data', () => {
    const payload = toCanonicalAppConfig(edited());
    expect(payload).not.toHaveProperty('mobile');
  });
});

describe('the round trip', () => {
  // The defect: publish -> reload used to lose every toggle.
  test('a published toggle is honoured after a reload', () => {
    const payload = toCanonicalAppConfig(edited());
    const reloaded = normalizeAppConfig(payload);
    expect(isComponentEnabled(reloaded, 'dashboard', 'active_sips')).toBe(false);
    expect(isComponentEnabled(reloaded, 'dashboard', 'portfolio_summary')).toBe(true);
  });

  test('published copy survives the reload', () => {
    const reloaded = normalizeAppConfig(toCanonicalAppConfig(edited()));
    expect(reloaded.mobile.screens.dashboard.copy.portfolioTitle).toBe('Your money');
    // A copy key the operator did not touch still falls back to the default.
    expect(reloaded.mobile.screens.dashboard.copy.viewAllLabel)
      .toBe(DEFAULT_APP_CONFIG.mobile.screens.dashboard.copy.viewAllLabel);
  });

  test('published shortcuts survive the reload, with their order and state', () => {
    const reloaded = normalizeAppConfig(toCanonicalAppConfig(edited()));
    const actions = reloaded.mobile.screens.dashboard.quickActions;
    expect(actions.map((action) => action.label)).toEqual(['Begin a SIP', 'History']);
    expect(actions[0].route).toBe('/app/explore');
    expect(visibleQuickActions(reloaded).map((action) => action.id)).toEqual(['start_sip']);
  });

  test('published amounts and chart periods survive the reload', () => {
    const reloaded = normalizeAppConfig(toCanonicalAppConfig(edited()));
    expect(reloaded.mobile.screens.fundDetail.charts.periods).toEqual(['1Y', '3Y']);
    expect(reloaded.mobile.screens.fundDetail.charts.defaultPeriod).toBe('3Y');
    expect(reloaded.mobile.screens.invest.sip.amountPresets).toEqual([500, 1000, 2500]);
  });

  test('an unpublished flag defaults to enabled rather than hidden', () => {
    const reloaded = normalizeAppConfig({ featureFlags: {}, presentation: {} });
    expect(isComponentEnabled(reloaded, 'explore', 'product_catalog')).toBe(true);
  });

  test('a builder document with `mobile` is left alone', () => {
    // localStorage holds the full document; only a canonical payload is expanded.
    const local = edited();
    const normalized = normalizeAppConfig(local);
    expect(isComponentEnabled(normalized, 'dashboard', 'active_sips')).toBe(false);
    expect(normalized.mobile.screens.dashboard.copy.portfolioTitle).toBe('Your money');
  });

  test('junk in a published payload cannot break the expansion', () => {
    const expanded = fromCanonicalAppConfig({
      featureFlags: { dashboard_active_sips: 'nope', unknown_thing: true },
      presentation: {
        'qa.count': 'three',
        'qa.0.route': '',
        'copy.dashboard.portfolioTitle': 42,
        'invest.sip.presets': 'a,b,c',
      },
    });
    const screens = expanded.mobile.screens;
    // A non-boolean flag is not `false`, so the component stays visible.
    expect(screens.dashboard.components.find((c) => c.id === 'active_sips').enabled).toBe(true);
    expect(screens.dashboard.quickActions).toBeUndefined();
    expect(screens.dashboard.copy).toBeUndefined();
    expect(screens.invest).toBeUndefined();
  });
});
