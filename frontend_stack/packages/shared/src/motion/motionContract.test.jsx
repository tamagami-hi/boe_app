// Motion is now a contract, not a default. These tests exist to stop the
// whole-route reveal and the mass staged FadeIn from coming back.
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PageTransition from './PageTransition.jsx';
import FadeIn from './FadeIn.jsx';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function setReducedMotion(reduced) {
  window.matchMedia = (query) => ({
    matches: reduced,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

/** Controllable IntersectionObserver. */
let observers = [];
function installObserver() {
  observers = [];
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {}
    unobserve() {}
    disconnect() {}
    trigger(isIntersecting) { this.cb([{ isIntersecting }]); }
  };
}

beforeEach(() => {
  setReducedMotion(false);
  installObserver();
});

afterEach(() => {
  delete globalThis.IntersectionObserver;
});

describe('PageTransition does not hide route content', () => {
  test('children are rendered with no opacity or transform applied', () => {
    const { container } = render(
      <MemoryRouter><PageTransition><p>Balance</p></PageTransition></MemoryRouter>,
    );
    expect(screen.getByText('Balance')).toBeVisible();
    const wrapper = container.querySelector('.be-page-transition');
    expect(wrapper.getAttribute('style')).toBeNull();
    expect(wrapper.className).toBe('be-page-transition');
  });

  test('it does not promote a layer, so it cannot become the containing block for fixed children', () => {
    const css = read(path.join('packages', 'shared', 'src', 'motion', 'PageTransition.css'));
    expect(css).not.toMatch(/will-change/);
    expect(css).not.toMatch(/transform|opacity|animation/);
  });

  test('nothing in the app imports gsap any more', () => {
    // PageTransition was the only importer; the client vendor chunk carried it.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (['node_modules', 'dist', 'build', 'android'].includes(entry.name)) continue;
          walk(path.join(dir, entry.name));
        } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
          const file = path.join(dir, entry.name);
          const text = fs.readFileSync(file, 'utf8');
          if (/from ['"]@?gsap/.test(text)) offenders.push(path.relative(ROOT, file));
        }
      }
    };
    for (const base of ['packages', path.join('app', 'src')]) {
      const abs = path.join(ROOT, base);
      if (fs.existsSync(abs)) walk(abs);
    }
    expect(offenders).toEqual([]);
  });
});

describe('no page performs a staged reveal', () => {
  test('no client page or admin screen wraps content in FadeIn', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (['node_modules', 'dist', 'build'].includes(entry.name)) continue;
          walk(path.join(dir, entry.name));
        } else if (entry.name.endsWith('.jsx') && !entry.name.endsWith('.test.jsx')) {
          const file = path.join(dir, entry.name);
          if (/<FadeIn\b/.test(fs.readFileSync(file, 'utf8'))) {
            offenders.push(path.relative(ROOT, file));
          }
        }
      }
    };
    for (const base of [
      path.join('packages', 'client', 'src'),
      path.join('packages', 'admin', 'src'),
      path.join('app', 'src'),
    ]) {
      const abs = path.join(ROOT, base);
      if (fs.existsSync(abs)) walk(abs);
    }
    // Dashboard had 9, Explore 11 and FundDetail 14, each starting at opacity 0
    // with delays up to 400ms, so a primary tab rendered empty then assembled.
    expect(offenders).toEqual([]);
  });
});

describe('FadeIn, for the rare purposeful case', () => {
  test('reduced motion renders visible with no transition at all', () => {
    setReducedMotion(true);
    const { container } = render(<FadeIn><p>Now</p></FadeIn>);
    const el = container.firstChild;
    expect(el.style.opacity).toBe('');
    expect(el.style.transition).toBe('');
    expect(el.style.transform).toBe('');
  });

  test('will-change is dropped once the reveal has run', () => {
    const { container } = render(<FadeIn><p>Later</p></FadeIn>);
    const el = container.firstChild;
    expect(el.style.willChange).toBe('opacity, transform');
    expect(el.style.opacity).toBe('0');

    act(() => { observers[0].trigger(true); });
    expect(el.style.opacity).toBe('1');
    expect(el.style.willChange).toBe('');
  });

  test('content is shown when the platform has no IntersectionObserver', () => {
    delete globalThis.IntersectionObserver;
    const { container } = render(<FadeIn><p>Fallback</p></FadeIn>);
    // Previously this left the element at opacity 0 permanently.
    expect(container.firstChild.style.opacity).toBe('1');
  });

  test('a missing matchMedia does not throw the subtree away', () => {
    delete window.matchMedia;
    expect(() => render(<FadeIn><p>Safe</p></FadeIn>)).not.toThrow();
    expect(screen.getByText('Safe')).toBeInTheDocument();
  });
});

describe('charts state proportions honestly', () => {
  test('the 3D pie and its perspective helpers are gone', () => {
    const charts = read(path.join('packages', 'client', 'src', 'components', 'Charts.jsx'));
    // A perspective pie distorts slice AREA, which is the one thing an allocation
    // chart exists to communicate.
    expect(charts).not.toMatch(/PieChart3D/);
    expect(charts).not.toMatch(/Elliptical/);
    expect(charts).not.toMatch(/createSideFacePath/);
    // The flat charts are still there.
    for (const name of ['AllocationRing', 'DonutChart', 'LineComparisonChart']) {
      expect(charts).toMatch(new RegExp(`export function ${name}`));
    }
  });

  test('FundDetail renders a flat donut for sector allocation', () => {
    const page = read(path.join('packages', 'client', 'src', 'pages', 'FundDetail.jsx'));
    expect(page).not.toMatch(/PieChart3D/);
    expect(page).toMatch(/DonutChart/);
  });
});
