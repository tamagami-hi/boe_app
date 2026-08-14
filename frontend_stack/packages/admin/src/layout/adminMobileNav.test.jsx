// The phone information architecture. The defect this replaces: all 13
// destinations in ONE horizontally scrolling strip at 40px targets, sharing the
// scroller with the brand and the signed-in chip.
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  NAV_DOMAINS,
  allNavPermissions,
  domainEntryPath,
  findNavDomain,
  mobileNavModel,
} from '../navigation/nav.js';
import AdminMobileNav from './AdminMobileNav.jsx';
import AdminDomainStrip from './AdminDomainStrip.jsx';

const ALL = allNavPermissions();
const admin = (permissions = ALL) => ({ id: 'a1', permissions });

// AdaptiveDialog reads useBreakpoint. jsdom has no matchMedia, and a phone
// viewport is what these tests are about.
beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

const renderAt = (ui, path) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe('the mobile model', () => {
  test('every domain declares its mobile metadata', () => {
    for (const domain of NAV_DOMAINS) {
      expect(domain.mobile, `${domain.id} has no mobile metadata`).toBeTruthy();
      expect(typeof domain.mobile.shortLabel).toBe('string');
      expect(domain.mobile.icon).toBeTruthy();
    }
  });

  test('the bar holds a handful of domains, not thirteen destinations', () => {
    const { primary, more } = mobileNavModel(admin());
    // The audit asks for 4-5 entry points. Primary domains plus More is the count.
    expect(primary.length).toBeGreaterThanOrEqual(2);
    expect(primary.length + 1).toBeLessThanOrEqual(5);
    // Nothing is lost: every domain is reachable from one list or the other.
    const covered = [...primary, ...more].map((d) => d.id).sort();
    expect(covered).toEqual(NAV_DOMAINS.map((d) => d.id).sort());
  });

  test('primary domains are ordered deliberately, not by declaration', () => {
    const { primary } = mobileNavModel(admin());
    const orders = primary.map((d) => d.mobile.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  test('a domain entry path is a real destination in that domain', () => {
    for (const domain of NAV_DOMAINS) {
      const path = domainEntryPath(domain);
      expect(domain.items.some((item) => item.path === path)).toBe(true);
      expect(findNavDomain(path).id).toBe(domain.id);
    }
  });

  test('a principal who can reach nothing in a primary domain does not get its tab', () => {
    // users -> applications.read | finance.read | users.read; ops -> funds/finance.
    const { primary } = mobileNavModel(admin(['audit.read']));
    expect(primary.map((d) => d.id)).not.toContain('users');
    expect(primary.map((d) => d.id)).not.toContain('ops');
    // Overview is ungated, so it survives and the operator keeps an entry point.
    expect(primary.map((d) => d.id)).toContain('overview');
  });

  test('a demoted primary domain is not silently dropped', () => {
    const model = mobileNavModel(admin(ALL.filter((c) => c !== 'audit.read')));
    const ids = [...model.primary, ...model.more].map((d) => d.id);
    expect(ids).toContain('system');
  });
});

describe('AdminMobileNav', () => {
  test('renders one tab per primary domain plus More', () => {
    renderAt(<AdminMobileNav user={admin()} />, '/admin/overview');
    const { primary } = mobileNavModel(admin());
    for (const domain of primary) {
      const tab = screen.getByRole('link', { name: new RegExp(domain.mobile.shortLabel) });
      expect(tab).toHaveAttribute('href', domainEntryPath(domain));
    }
    expect(screen.getByRole('button', { name: /More/ })).toBeInTheDocument();
  });

  test('a tab is current for any destination inside its domain, not just the entry', () => {
    // The old strip marked only the exact path, so on Holdings nothing was active.
    renderAt(<AdminMobileNav user={admin()} />, '/admin/ops/holdings');
    const opsTab = screen.getByRole('link', { name: /Ops/ });
    expect(opsTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Users/ })).not.toHaveAttribute('aria-current');
  });

  test('the approvals badge is summed onto its domain tab', () => {
    renderAt(<AdminMobileNav user={admin()} counts={{ approvals: 3 }} />, '/admin/overview');
    expect(screen.getByRole('link', { name: /Users/ })).toHaveTextContent('3');
  });

  test('a zero badge renders nothing', () => {
    renderAt(<AdminMobileNav user={admin()} counts={{ approvals: 0 }} />, '/admin/overview');
    expect(screen.getByRole('link', { name: /Users/ })).not.toHaveTextContent('0');
  });

  test('More opens a labelled hub listing the remaining domains', () => {
    renderAt(<AdminMobileNav user={admin()} />, '/admin/overview');
    const more = screen.getByRole('button', { name: /More/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    for (const domain of mobileNavModel(admin()).more) {
      expect(screen.getByRole('heading', { name: domain.label })).toBeInTheDocument();
      for (const item of domain.items) {
        expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.path);
      }
    }
  });

  test('More is marked active while one of its domains is on screen', () => {
    renderAt(<AdminMobileNav user={admin()} />, '/admin/system/audit-log');
    expect(screen.getByRole('button', { name: /More/ }).className).toMatch(/is-active/);
  });

  test('choosing a hub destination closes the hub', () => {
    renderAt(<AdminMobileNav user={admin()} />, '/admin/overview');
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(screen.getByRole('link', { name: 'Audit log' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('with nothing behind More the button is not rendered', () => {
    // Overview alone: every other domain is filtered out by permissions.
    renderAt(<AdminMobileNav user={admin([])} />, '/admin/overview');
    expect(screen.queryByRole('button', { name: /More/ })).not.toBeInTheDocument();
  });
});

describe('AdminDomainStrip', () => {
  test('shows the active domain siblings and marks the current one', () => {
    renderAt(<AdminDomainStrip user={admin()} />, '/admin/ops/holdings');
    const strip = screen.getByRole('navigation', { name: 'Operations sections' });
    expect(strip).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Holdings' })).toHaveClass('is-active');
    expect(screen.getByRole('link', { name: 'AUM pools' })).toHaveAttribute('href', '/admin/ops/funds');
  });

  test('renders nothing for a single-destination domain', () => {
    const { container } = renderAt(<AdminDomainStrip user={admin()} />, '/admin/overview');
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing on an unknown path', () => {
    const { container } = renderAt(<AdminDomainStrip user={admin()} />, '/admin/nonsense');
    expect(container).toBeEmptyDOMElement();
  });

  test('it only offers destinations the principal may reach', () => {
    // users.read gates Directory; the others in that domain need finance/applications.
    renderAt(<AdminDomainStrip user={admin(['users.read', 'applications.read'])} />, '/admin/users/approvals');
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Directory' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payments' })).not.toBeInTheDocument();
  });
});
