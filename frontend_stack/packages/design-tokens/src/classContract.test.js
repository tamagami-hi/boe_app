// Every design-system class a component asks for must exist in a stylesheet.
//
// This was written after finding 25 of them that did not. The damage was invisible
// in review and obvious on screen: `.adm-btn` was never defined, so three buttons on
// the email-delivery screen rendered as bare browser buttons; `.adm-badge is-green`
// left the whole status column as unstyled text; `.be-select` left five filter
// selects unstyled and below the phone target height; `.apk-alert-error` meant the
// error on the email-verification screen looked like body copy; `.ash-tooltip` had no
// `position`, so an "absolutely positioned" tooltip pushed the form around when it
// opened; and `.apk-sheet-close` left a bare "×" glyph as the only way out of the
// redemption sheet.
//
// A missing class cannot be caught by a build, a type check or a React test. It can
// be caught here.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Vitest runs from the workspace root (frontend_stack). `import.meta.url` is not
// usable in this harness — see the note in cssContract.test.js.
const ROOTS = ['packages', 'app/src'];

// Only our own namespaces. Third-party and utility classes are not our contract.
const OWNED = /^(adm|ash|be|apk)-[a-z0-9_-]+$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(path.join(process.cwd(), root)));
const stylesheets = files.filter((f) => f.endsWith('.css'));
const sources = files.filter(
  (f) => (f.endsWith('.jsx') || f.endsWith('.js')) && !f.includes('.test.'),
);

const allCss = stylesheets.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

/*
 * Classes that are deliberately unstyled. Keep this list SHORT and explain each
 * one; an entry here is a claim that the class carries no visual meaning.
 */
const INTENTIONALLY_UNSTYLED = new Set([]);

function classesIn(source) {
  const found = new Set();
  // Static `className="a b"` and simple template literals. Interpolated segments
  // are skipped rather than guessed at.
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`$]*)`\})/g)) {
    for (const token of (match[1] || match[2] || '').split(/\s+/)) {
      if (OWNED.test(token)) found.add(token);
    }
  }
  return found;
}

describe('class contract', () => {
  test('the scan actually has files to look at', () => {
    expect(stylesheets.length).toBeGreaterThan(10);
    expect(sources.length).toBeGreaterThan(50);
  });

  test('every design-system class used in a component is defined in a stylesheet', () => {
    const missing = [];
    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8');
      for (const token of classesIn(source)) {
        if (INTENTIONALLY_UNSTYLED.has(token)) continue;
        if (!allCss.includes(`.${token}`)) {
          missing.push(`${token} (${path.relative(process.cwd(), file)})`);
        }
      }
    }
    expect(missing, `undefined classes:\n${missing.join('\n')}`).toEqual([]);
  });

  test('the check would fail on a class that does not exist', () => {
    // Guards the scanner itself: a typo'd namespace must be detected.
    const probe = classesIn('<div className="adm-not-a-real-class be-money" />');
    expect(probe.has('adm-not-a-real-class')).toBe(true);
    expect(allCss.includes('.adm-not-a-real-class')).toBe(false);
  });
});
