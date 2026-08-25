// Tests for the admin nav metadata resolver.
//
// The fallback is the interesting case: before Task 4 an unmatched pathname
// resolved to title "Overview", so the shell's TopBar claimed to be Overview
// while the body rendered Not Found. That is the same silent-redirect confusion
// the wildcard change removed, so the fallback must stay neutral.
import { describe, expect, test } from 'vitest';
import {
  NAV_DOMAINS,
  allNavPermissions,
  canAccessPath,
  findNavMeta,
  hasAnyPermission,
  visibleNavDomains,
} from './nav.js';

describe('findNavMeta on canonical paths', () => {
  test('resolves every nav item to its own title', () => {
    for (const domain of NAV_DOMAINS) {
      for (const item of domain.items) {
        expect(findNavMeta(item.path).title).toBe(item.title);
      }
    }
  });

  test('resolves a child path to its parent nav item', () => {
    // e.g. /admin/users/directory/:userId belongs to Directory.
    expect(findNavMeta('/admin/users/directory/u1').title).toBe('User directory');
  });

  test('builds breadcrumbs with a linkable domain entry outside Overview', () => {
    const meta = findNavMeta('/admin/funds-received/acknowledged');
    expect(meta.crumbs).toEqual(['BeOnEdge', 'Funds received', 'Acknowledged']);
    expect(meta.crumbPaths).toEqual(['/admin/overview', '/admin/funds-received/awaiting', '/admin/funds-received/acknowledged']);
  });
});

describe('findNavMeta fallback', () => {
  test('does not claim an unknown path is Overview', () => {
    const meta = findNavMeta('/admin/this-page-does-not-exist');
    expect(meta.title).not.toBe('Overview');
    expect(meta.crumbs).not.toContain('Overview');
  });

  test('still returns a usable, non-empty breadcrumb for the TopBar', () => {
    const meta = findNavMeta('/admin/this-page-does-not-exist');
    expect(meta.crumbs.length).toBeGreaterThan(0);
    expect(meta.crumbPaths.length).toBe(meta.crumbs.length);
    expect(typeof meta.title).toBe('string');
    expect(meta.title.length).toBeGreaterThan(0);
  });

  test('a nav item path prefix does not match a sibling by accident', () => {
    // `/admin/users/directoryX` must not resolve to Directory.
    expect(findNavMeta('/admin/users/directoryX').title).not.toBe('User directory');
  });
});


/* ---- permissions (Task 15) ------------------------------------------------- */

describe('nav permission metadata', () => {
  test('every item declares a permissions array', () => {
    for (const domain of NAV_DOMAINS) {
      for (const item of domain.items) {
        expect(Array.isArray(item.permissions)).toBe(true);
      }
    }
  });

  test('only Overview is ungated', () => {
    // Overview aggregates whatever the principal may read and degrades per widget,
    // so it is the guaranteed entry point. Anything else being ungated would mean a
    // destination whose 403s the operator discovers by hitting them.
    const ungated = NAV_DOMAINS
      .flatMap((d) => d.items)
      .filter((item) => item.permissions.length === 0)
      .map((item) => item.path);

    expect(ungated).toEqual(['/admin/overview']);
  });

  test('permission codes use the backend vocabulary', () => {
    // These are copied from requireAnyPermission(...) calls in
    // backend_controller/src/routes/admin*Routes.ts. A code that is not in this set
    // would silently hide a destination from everyone, since no principal can hold
    // a code the server never grants.
    const BACKEND_CODES = new Set([
      'applications.read', 'applications.decide',
      'email_deliveries.read', 'email_deliveries.read_masked',
      'users.read', 'users.read_limited', 'users.suspend', 'users.close',
      'payments.read',
      'funds.receipts.read', 'funds.receipts.write',
      'refunds.write',
      'client_values.read', 'client_growth.write',
      'aum.read', 'aum.write',
      'funds.read', 'funds.write',
      'audit.read',
      'content.read', 'content.publish',
      'config.read', 'config.publish',
    ]);

    for (const code of allNavPermissions()) {
      expect(BACKEND_CODES.has(code)).toBe(true);
    }
  });
});

describe('hasAnyPermission mirrors requireAnyPermission', () => {
  test('is an OR across the list, not an AND', () => {
    expect(hasAnyPermission({ permissions: ['payments.read'] }, ['payments.read', 'funds.read'])).toBe(true);
    expect(hasAnyPermission({ permissions: ['funds.read'] }, ['payments.read', 'funds.read'])).toBe(true);
  });

  test('an empty requirement means any admin', () => {
    expect(hasAnyPermission({ permissions: [] }, [])).toBe(true);
    expect(hasAnyPermission(null, [])).toBe(true);
  });

  test('fails closed on a missing or malformed principal', () => {
    expect(hasAnyPermission(null, ['audit.read'])).toBe(false);
    expect(hasAnyPermission({}, ['audit.read'])).toBe(false);
    expect(hasAnyPermission({ permissions: null }, ['audit.read'])).toBe(false);
    expect(hasAnyPermission({ permissions: [] }, ['audit.read'])).toBe(false);
  });

  test('an unrelated permission does not grant access', () => {
    expect(hasAnyPermission({ permissions: ['content.publish'] }, ['audit.read'])).toBe(false);
  });
});

describe('canAccessPath', () => {
  test('gates a known destination on its own codes', () => {
    expect(canAccessPath({ permissions: ['audit.read'] }, '/admin/audit')).toBe(true);
    expect(canAccessPath({ permissions: ['payments.read'] }, '/admin/audit')).toBe(false);
  });

  test('covers a child path via its parent item', () => {
    expect(canAccessPath({ permissions: ['users.read'] }, '/admin/users/directory/u1')).toBe(true);
    expect(canAccessPath({ permissions: ['audit.read'] }, '/admin/users/directory/u1')).toBe(false);
  });

  test('an unknown path is NOT treated as forbidden', () => {
    // It is Not Found. Conflating the two tells an operator to request access to a
    // page that does not exist.
    expect(canAccessPath({ permissions: [] }, '/admin/no-such-page')).toBe(true);
  });
});

describe('visibleNavDomains', () => {
  test('a payments-only principal sees the payments ledger and Overview', () => {
    const domains = visibleNavDomains({ permissions: ['payments.read'] });
    const paths = domains.flatMap((d) => d.items.map((i) => i.path));

    expect(paths).toContain('/admin/overview');
    expect(paths).toContain('/admin/payments');
    expect(paths).not.toContain('/admin/audit');
    expect(paths).not.toContain('/admin/site/faqs');
  });

  test('drops domains that end up empty rather than showing an empty group', () => {
    const domains = visibleNavDomains({ permissions: ['audit.read'] });
    const ids = domains.map((d) => d.id);

    expect(ids).toContain('audit');
    expect(ids).not.toContain('site');
    expect(ids).not.toContain('funds');
  });

  test('a principal with no permissions still gets Overview', () => {
    const domains = visibleNavDomains({ permissions: [] });
    expect(domains.flatMap((d) => d.items.map((i) => i.path))).toEqual(['/admin/overview']);
  });

  test('a fully-permissioned principal sees every destination', () => {
    const domains = visibleNavDomains({ permissions: allNavPermissions() });
    const visible = domains.flatMap((d) => d.items.length);
    const total = NAV_DOMAINS.flatMap((d) => d.items.length);

    expect(visible.reduce((a, b) => a + b, 0)).toBe(total.reduce((a, b) => a + b, 0));
  });

  test('does not mutate the source tree', () => {
    const before = NAV_DOMAINS.map((d) => d.items.length);
    visibleNavDomains({ permissions: [] });
    expect(NAV_DOMAINS.map((d) => d.items.length)).toEqual(before);
  });
});
