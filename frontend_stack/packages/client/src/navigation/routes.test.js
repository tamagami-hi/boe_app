// Tests for the canonical client route manifest and its destination resolver.
//
// Two things are locked here. First, the manifest must stay in sync with the
// route table actually mounted by ClientApp — a manifest that drifts from the
// router is worse than no manifest, because other code starts trusting it.
// Second, `resolveDestination` is a trust boundary: notification payloads,
// admin-published config and content documents all flow through it, so its
// refusals matter as much as its successes.
import { describe, expect, test } from 'vitest';
import {
  APP_BAR_MODE,
  BACK_POLICY,
  CLIENT_ROUTES,
  CLIENT_ROUTE_ALIASES,
  DESTINATION_KIND,
  HOME_PATH,
  buildPath,
  findRouteMeta,
  isKnownClientPath,
  matchClientRoute,
  parentPathOf,
  resolveDestination,
  resolveInternalPath,
  showsBottomNav,
} from './routes.js';

/* ---- manifest integrity --------------------------------------------------- */

describe('manifest integrity', () => {
  test('destination ids are unique', () => {
    const ids = CLIENT_ROUTES.map((r) => r.destinationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('paths are unique', () => {
    const paths = CLIENT_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test('every route is under the /app scope', () => {
    for (const route of CLIENT_ROUTES) {
      expect(route.path.startsWith('/app/')).toBe(true);
    }
  });

  test('every declared parent is itself a known route template', () => {
    const templates = new Set(CLIENT_ROUTES.map((r) => r.path));
    for (const route of CLIENT_ROUTES) {
      if (route.parent) expect(templates.has(route.parent)).toBe(true);
    }
  });

  test('every route declares a complete shell/back contract', () => {
    const barModes = new Set(Object.values(APP_BAR_MODE));
    const policies = new Set(Object.values(BACK_POLICY));
    for (const route of CLIENT_ROUTES) {
      expect(barModes.has(route.appBarMode)).toBe(true);
      expect(policies.has(route.backPolicy)).toBe(true);
      expect(typeof route.showsBottomNav).toBe('boolean');
      expect(typeof route.isTransactional).toBe('boolean');
      expect(Array.isArray(route.permissions)).toBe(true);
    }
  });

  test('exactly the five primary destinations show the bottom nav', () => {
    const primary = CLIENT_ROUTES.filter((r) => r.showsBottomNav).map((r) => r.path);
    expect(primary.sort()).toEqual([
      '/app/dashboard',
      '/app/explore',
      '/app/portfolio',
      '/app/profile',
      '/app/transactions',
    ]);
  });

  test('every transactional route is gated on eligibility and hides the nav', () => {
    for (const route of CLIENT_ROUTES.filter((r) => r.isTransactional)) {
      expect(route.requiresEligibility).toBe(true);
      expect(route.showsBottomNav).toBe(false);
      expect(route.backPolicy).toBe(BACK_POLICY.TRANSACTIONAL);
    }
  });

  test('HOME_PATH is a real primary route', () => {
    expect(findRouteMeta(HOME_PATH)?.showsBottomNav).toBe(true);
  });
});

/* ---- path matching -------------------------------------------------------- */

describe('matchClientRoute', () => {
  test('matches a static path', () => {
    expect(matchClientRoute('/app/portfolio').route.destinationId).toBe('portfolio');
  });

  test('extracts and decodes dynamic params', () => {
    const match = matchClientRoute('/app/funds/fund%2Fone');
    expect(match.route.destinationId).toBe('fund_detail');
    expect(match.params.fundId).toBe('fund/one');
  });

  test('does not match a missing dynamic segment', () => {
    // This is what sends `/app/funds/` to Not Found instead of rendering a
    // detail screen with an undefined id.
    expect(matchClientRoute('/app/funds/')).toBeNull();
    expect(matchClientRoute('/app/mandates/')).toBeNull();
  });

  test('does not match an extra trailing segment', () => {
    expect(matchClientRoute('/app/portfolio/extra')).toBeNull();
  });

  test('ignores query and hash', () => {
    expect(matchClientRoute('/app/transactions?tab=sip#top').route.destinationId).toBe('activity');
  });

  test('the plan detail template matches a plan id', () => {
    expect(matchClientRoute('/app/mandates/m1').route.destinationId).toBe('mandate_detail');
    // There is no mandate-authorization route: the SIP fallback (spec §6.2) has
    // no mandate to authorize, so this historical path resolves nowhere.
    expect(matchClientRoute('/app/mandates/m1/authorize')).toBeNull();
  });

  test('rejects non-strings', () => {
    expect(matchClientRoute(undefined)).toBeNull();
    expect(matchClientRoute(null)).toBeNull();
  });
});

describe('isKnownClientPath', () => {
  test('accepts real routes and deliberate aliases', () => {
    expect(isKnownClientPath('/app/dashboard')).toBe(true);
    for (const alias of Object.keys(CLIENT_ROUTE_ALIASES)) {
      expect(isKnownClientPath(alias)).toBe(true);
    }
  });

  test('rejects the known historical defects', () => {
    // Never had a route; a button navigated to it anyway.
    expect(isKnownClientPath('/app/orders')).toBe(false);
    // Disclosure defaults shipped without the /app prefix.
    expect(isKnownClientPath('/investor-charter')).toBe(false);
    expect(isKnownClientPath('/grievance')).toBe(false);
  });
});

/* ---- builders and parents ------------------------------------------------- */

describe('buildPath', () => {
  test('builds a static path from its id', () => {
    expect(buildPath('activity')).toBe('/app/transactions');
  });

  test('URL-encodes params', () => {
    expect(buildPath('fund_detail', { fundId: 'a/b c' })).toBe('/app/funds/a%2Fb%20c');
  });

  test('refuses a missing param instead of building a broken path', () => {
    expect(() => buildPath('fund_detail', {})).toThrow(/Missing route param/);
    expect(() => buildPath('fund_detail', { fundId: '' })).toThrow(/Missing route param/);
  });

  test('refuses an unknown id', () => {
    expect(() => buildPath('nope')).toThrow(/Unknown client destination id/);
  });
});

describe('parentPathOf', () => {
  test('primary destinations have no parent', () => {
    expect(parentPathOf('/app/dashboard')).toBeNull();
  });

  test('secondary screens resolve to their logical parent', () => {
    expect(parentPathOf('/app/statements')).toBe('/app/profile');
    expect(parentPathOf('/app/notifications')).toBe('/app/dashboard');
  });

  test('a parameterised parent keeps the concrete id', () => {
    expect(parentPathOf('/app/invest/sip/f1')).toBe('/app/funds/f1');
    expect(parentPathOf('/app/mandates/m1')).toBe('/app/portfolio');
  });
});

/* ---- bottom nav visibility ----------------------------------------------- */

describe('showsBottomNav', () => {
  test('true for the five primary tabs', () => {
    for (const path of [
      '/app/dashboard', '/app/explore', '/app/portfolio', '/app/transactions', '/app/profile',
    ]) {
      expect(showsBottomNav(path)).toBe(true);
    }
  });

  test('false for Profile children — the prefix-matching bug', () => {
    // Prefix matching kept the bar on all of these because they start with
    // `/app/profile`, even though they are pushed secondary screens.
    for (const path of [
      '/app/profile/kyc', '/app/profile/security', '/app/profile/support', '/app/profile/legal',
    ]) {
      expect(showsBottomNav(path)).toBe(false);
    }
  });

  test('false for secondary and transactional screens', () => {
    for (const path of [
      '/app/statements', '/app/notifications', '/app/funds/f1',
      '/app/invest/sip/f1', '/app/payment/p1', '/app/mandates/m1',
    ]) {
      expect(showsBottomNav(path)).toBe(false);
    }
  });

  test('false for unknown paths', () => {
    expect(showsBottomNav('/app/orders')).toBe(false);
  });
});

/* ---- destination resolution (trust boundary) ----------------------------- */

describe('resolveDestination — internal', () => {
  test('resolves a stable destination id', () => {
    const result = resolveDestination('portfolio');
    expect(result.kind).toBe(DESTINATION_KIND.INTERNAL);
    expect(result.path).toBe('/app/portfolio');
  });

  test('resolves a destination id needing params', () => {
    expect(resolveDestination('fund_detail', { fundId: 'f1' }).path).toBe('/app/funds/f1');
  });

  test('refuses a destination id whose params are missing', () => {
    const result = resolveDestination('fund_detail');
    expect(result.kind).toBe(DESTINATION_KIND.UNSAFE);
    expect(result.reason).toBe('missing-params');
  });

  test('resolves a legacy raw internal path still in published payloads', () => {
    expect(resolveDestination('/app/explore').path).toBe('/app/explore');
    expect(resolveDestination('/app/funds/f1').path).toBe('/app/funds/f1');
  });

  test('honours a deliberate alias', () => {
    expect(resolveDestination('/app/start').path).toBe('/app/dashboard');
  });

  test('strips query and hash rather than passing them to the router', () => {
    expect(resolveDestination('/app/transactions?tab=sip#x').path).toBe('/app/transactions');
  });
});

describe('resolveDestination — refusals', () => {
  const refusals = [
    ['javascript:alert(1)', 'dangerous-scheme'],
    ['JavaScript:alert(1)', 'dangerous-scheme'],
    ['data:text/html,<script>', 'dangerous-scheme'],
    ['blob:https://x/y', 'dangerous-scheme'],
    ['file:///etc/passwd', 'dangerous-scheme'],
    ['//evil.example/path', 'protocol-relative'],
    ['/app/orders', 'unknown-internal-path'],
    ['/investor-charter', 'unknown-internal-path'],
    ['/admin/overview', 'unknown-internal-path'],
    ['not_a_real_id', 'unknown-destination-id'],
    ['http://beonedge.in', 'insecure-scheme'],
    ['https://localhost/app/funds/f1', 'webview-local-origin'],
    ['https://127.0.0.1/x', 'webview-local-origin'],
    ['', 'empty'],
    ['   ', 'empty'],
  ];

  for (const [value, reason] of refusals) {
    test(`refuses ${JSON.stringify(value)} (${reason})`, () => {
      const result = resolveDestination(value);
      expect(result.kind).toBe(DESTINATION_KIND.UNSAFE);
      expect(result.reason).toBe(reason);
    });
  }

  test('refuses non-strings without throwing', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(resolveDestination(value).kind).toBe(DESTINATION_KIND.UNSAFE);
    }
  });

  test('a cross-scope admin path never resolves as internal', () => {
    expect(resolveInternalPath('/admin/users/approvals')).toBeNull();
  });
});

describe('resolveDestination — external and system actions', () => {
  test('accepts an https URL', () => {
    const result = resolveDestination('https://scores.sebi.gov.in');
    expect(result.kind).toBe(DESTINATION_KIND.EXTERNAL);
    expect(result.host).toBe('scores.sebi.gov.in');
  });

  test('accepts mailto and tel', () => {
    expect(resolveDestination('mailto:grievance@beonedge.example')).toMatchObject({
      kind: DESTINATION_KIND.EMAIL,
      email: 'grievance@beonedge.example',
    });
    expect(resolveDestination('tel:+91-80-1234-5679').kind).toBe(DESTINATION_KIND.PHONE);
  });

  test('refuses a malformed mailto or tel', () => {
    expect(resolveDestination('mailto:nope').reason).toBe('invalid-email');
    expect(resolveDestination('tel:ab').reason).toBe('invalid-phone');
  });
});

describe('resolveInternalPath', () => {
  test('returns a path for internal destinations only', () => {
    expect(resolveInternalPath('home')).toBe('/app/dashboard');
    expect(resolveInternalPath('https://beonedge.in')).toBeNull();
    expect(resolveInternalPath('javascript:alert(1)')).toBeNull();
  });
});
