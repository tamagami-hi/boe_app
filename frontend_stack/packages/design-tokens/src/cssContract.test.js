// Enforces the design-system rules that CSS cannot enforce itself: one source of
// truth for tokens, semantic type roles, a semantic z-scale, and thumb-sized
// targets. Comments are stripped before scanning, since prose here legitimately
// names the patterns being banned.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const TOKENS_DIR = path.join('packages', 'design-tokens', 'src');

const SKIP_DIRS = ['node_modules', 'dist', 'build', 'android'];

function cssFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.includes(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.css')) {
        found.push(path.join(dir, entry.name));
      }
    }
  };
  for (const base of ['packages', path.join('app', 'src')]) {
    const abs = path.join(ROOT, base);
    if (fs.existsSync(abs)) walk(abs);
  }
  return found.map((p) => path.relative(ROOT, p));
}

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (file) => stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const isTokens = (file) => file.startsWith(TOKENS_DIR);

/** Flat list of { selector, body } for every brace block, at-rules excluded. */
function ruleBlocks(text) {
  const out = [];
  let depth = 0;
  let buffer = '';
  let selector = '';
  for (const char of text) {
    if (char === '{') {
      depth += 1;
      selector = buffer.trim();
      buffer = '';
    } else if (char === '}') {
      if (depth >= 1) out.push({ selector, body: buffer });
      depth -= 1;
      buffer = '';
      selector = '';
    } else {
      buffer += char;
    }
  }
  return out.filter((rule) => !rule.selector.startsWith('@'));
}

const ALL = cssFiles();

test('the scan finds the stylesheets it is meant to police', () => {
  expect(ALL.length).toBeGreaterThan(20);
  expect(ALL).toContain(path.join(TOKENS_DIR, 'tokens-core.css'));
  expect(ALL.some((f) => f.includes('mobile/base.css'))).toBe(true);
  expect(ALL.some((f) => f.includes('desktop/shell.css'))).toBe(true);
});

describe('one source of truth for tokens', () => {
  test('no stylesheet outside design-tokens declares a --be-* token on :root', () => {
    const offenders = [];
    for (const file of ALL) {
      if (isTokens(file)) continue;
      for (const rule of ruleBlocks(read(file))) {
        const rootScoped = /(^|,)\s*(:root|html|body)\s*$/.test(rule.selector);
        if (!rootScoped) continue;
        for (const match of rule.body.matchAll(/(--be-[\w-]+)\s*:/g)) {
          offenders.push(`${file}: ${match[1]}`);
        }
      }
    }
    // Component-scoped overrides (e.g. .adm-app resetting --be-page-pad-x) are
    // fine — they consume the scale rather than redefining it.
    expect(offenders).toEqual([]);
  });

  test('the client mobile short aliases resolve from the token sheet', () => {
    const tokens = read(path.join(TOKENS_DIR, 'tokens-core.css'));
    for (const name of ['--be-r-2', '--be-r-4', '--be-r-8', '--be-r-12', '--be-r-pill',
      '--be-d-1', '--be-d-2', '--be-d-3', '--be-d-4']) {
      expect(tokens).toContain(`${name}:`);
    }
  });

  test('no token is declared twice inside the token sheet', () => {
    const tokens = read(path.join(TOKENS_DIR, 'tokens-core.css'));
    const seen = new Map();
    for (const rule of ruleBlocks(tokens)) {
      if (!/(^|,)\s*:root\s*$/.test(rule.selector)) continue;
      for (const match of rule.body.matchAll(/(--be-[\w-]+)\s*:/g)) {
        seen.set(match[1], (seen.get(match[1]) || 0) + 1);
      }
    }
    expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([]);
  });
});

describe('type roles', () => {
  const FAMILY_TOKENS = ['--be-font-serif', '--be-font-sans', '--be-font-display', '--be-font-body'];

  test('stylesheets reference a role, not a family', () => {
    const offenders = [];
    for (const file of ALL) {
      if (isTokens(file)) continue;
      const text = read(file);
      for (const token of FAMILY_TOKENS) {
        if (text.includes(`var(${token})`)) offenders.push(`${file}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the roles exist and point at the intended families', () => {
    const tokens = read(path.join(TOKENS_DIR, 'tokens-core.css'));
    expect(tokens).toMatch(/--be-font-brand:\s*var\(--be-font-display\)/);
    expect(tokens).toMatch(/--be-font-ui:\s*var\(--be-font-body\)/);
    expect(tokens).toMatch(/--be-font-code:\s*var\(--be-font-mono\)/);
  });

  test('Fraunces stays a brand voice: only launch, auth hero, greeting and legal titles', () => {
    // The audit's rule is that task, navigation and data UI is stable sans. A new
    // serif heading on a task screen must be a deliberate decision, so adding one
    // means adding it here.
    const ALLOWED = new Set([
      '.apk-splash-name',      // launch identity
      '.apk-compat h1',        // unsupported-device screen
      '.apk-login-title',      // auth hero
      '.auth-copy h1',         // auth hero
      '.apk-greet-name',       // dashboard greeting
      '.apk-charter-header h1',   // legal document title page
      '.apk-grievance-header h1', // legal document title page
      '.apk-splash-role',      // admin launch identity
    ]);
    const offenders = [];
    for (const file of ALL) {
      for (const rule of ruleBlocks(read(file))) {
        if (!rule.body.includes('var(--be-font-brand)')) continue;
        for (const selector of rule.selector.split(',').map((s) => s.trim())) {
          if (!ALLOWED.has(selector)) offenders.push(`${file}: ${selector}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the operational admin sheets do not use the brand serif', () => {
    // The console is task UI end to end. desktop/admin.css is excluded because it
    // carries the admin launch splash, which is an identity moment; the allowlist
    // above is what governs that one selector.
    const adminSheets = ALL.filter((f) => f.includes(path.join('admin', 'src'))
      && !f.endsWith(path.join('desktop', 'admin.css')));
    expect(adminSheets.length).toBeGreaterThan(4);
    for (const file of adminSheets) {
      expect(read(file), file).not.toContain('var(--be-font-brand)');
    }
  });
});

describe('z-index is a semantic scale', () => {
  test('no stylesheet hardcodes a stacking level above a local one', () => {
    // 0 and 1 are local stacking inside a single component (a pseudo-element
    // background under its content) and carry no cross-component meaning.
    const offenders = [];
    for (const file of ALL) {
      if (isTokens(file)) continue;
      for (const match of read(file).matchAll(/z-index:\s*(-?\d+)/g)) {
        if (Math.abs(Number(match[1])) > 1) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the scale is strictly ordered', () => {
    const tokens = read(path.join(TOKENS_DIR, 'tokens-core.css'));
    const order = [
      'table-header', 'subnav', 'topbar', 'subnav-mobile', 'sticky-bar', 'overlay',
      'drawer', 'nav-toggle', 'dropdown', 'sticky', 'modal-backdrop', 'modal',
      'toast', 'tooltip',
    ];
    const values = order.map((name) => {
      const match = tokens.match(new RegExp(`--be-z-${name}:\\s*(\\d+)`));
      expect(match, `--be-z-${name} is missing`).toBeTruthy();
      return Number(match[1]);
    });
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i], `${order[i]} must sit above ${order[i - 1]}`).toBeGreaterThan(values[i - 1]);
    }
  });
});

describe('touch targets', () => {
  test('the target scale is declared', () => {
    const tokens = read(path.join(TOKENS_DIR, 'tokens-core.css'));
    expect(tokens).toMatch(/--be-target-comfortable:\s*48px/);
    expect(tokens).toMatch(/--be-target-min:\s*44px/);
    expect(tokens).toMatch(/--be-target-compact:\s*40px/);
    expect(tokens).toMatch(/--be-target-inline:\s*32px/);
  });

  test('no interactive rule fixes its own height below the minimum without expanding its hit area', () => {
    // A few controls must stay visually small — an icon button inside a text
    // field, the sidebar collapse pill. Those expand their hit area with a
    // pseudo-element instead, and are listed here so the exception is explicit.
    const HIT_AREA_EXPANDED = new Set([
      '.apk-search-clear',
      '.auth-password-toggle',
      '.ash-nav-collapse',
      // A 38x22 switch whose visible size is the design; ::after is its knob, so
      // the hit area is expanded with ::before.
      '.apk-toggle',
    ]);
    const offenders = [];
    for (const file of ALL) {
      if (isTokens(file)) continue;
      const text = read(file);
      for (const rule of ruleBlocks(text)) {
        const interactive = rule.body.includes('cursor: pointer')
          || /(^|[\s,>])(button|a)([\s.:[]|$)/.test(rule.selector);
        if (!interactive) continue;
        const selectors = rule.selector.split(',').map((s) => s.trim());
        for (const match of rule.body.matchAll(/(?:min-)?height:\s*(\d+)px/g)) {
          if (Number(match[1]) >= 44) continue;
          for (const selector of selectors) {
            if (HIT_AREA_EXPANDED.has(selector)) continue;
            offenders.push(`${file}: ${selector} ${match[0]}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every hit-area exception really does expand', () => {
    const text = ALL.map((file) => read(file)).join('\n');
    for (const selector of ['.apk-search-clear', '.auth-password-toggle', '.ash-nav-collapse', '.apk-toggle']) {
      // Either pseudo-element may carry the expansion; .apk-toggle uses ::before
      // because ::after is already its knob.
      const pattern = new RegExp(`\\${selector}::(after|before)\\s*\\{[^}]*inset:\\s*-\\d+px`);
      expect(text, `${selector} must expand its hit area`).toMatch(pattern);
    }
  });
});
