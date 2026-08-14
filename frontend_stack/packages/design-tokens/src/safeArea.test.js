// The safe-area inset contract has exactly one owner.
//
// Two mechanisms report insets and they cover different devices: Capacitor 8's
// SystemBars plugin injects `--safe-area-inset-*` on Android 15+ (where a Chromium
// bug makes `env()` wrong), and `env(safe-area-inset-*)` is the platform value
// everywhere else. Any stylesheet that reads only one of them is wrong on some real
// device — which is why page and component CSS must consume the `--be-safe-*`
// tokens instead, and only tokens-core.css may name `env(safe-area-inset-*)`.
//
// This is a source guard, not runtime proof. It cannot tell you the insets are
// applied correctly on a device; it only stops the contract being bypassed again.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

// Paths are derived from the vitest root (frontend_stack) rather than
// `import.meta.url`: under the jsdom environment that URL is not a file:// URL,
// so fileURLToPath rejects it.
const ROOT = process.cwd();
const packagesDir = join(ROOT, 'packages');
const appSrcDir = join(ROOT, 'app', 'src');
const indexHtml = join(ROOT, 'app', 'index.html');

const TOKEN_OWNER = join('design-tokens', 'src', 'tokens-core.css');
const EDGES = ['top', 'right', 'bottom', 'left'];

function cssFilesUnder(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.css')) found.push(full);
    }
  };
  walk(dir);
  return found;
}

const allCss = [...cssFilesUnder(packagesDir), ...cssFilesUnder(appSrcDir)];

// Prose explaining the contract legitimately names the patterns this file forbids,
// so only real declarations are scanned. Comments are documentation, not behavior.
const cssCode = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const htmlCode = (file) => readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

const relative = (file) => file.replace(ROOT + '/', '');

describe('safe-area token contract', () => {
  test('finds stylesheets to check (guards the walker itself)', () => {
    expect(allCss.length).toBeGreaterThan(10);
  });

  test('tokens-core.css defines all four edges with the layered fallback', () => {
    const owner = allCss.find((file) => file.endsWith(TOKEN_OWNER));
    expect(owner).toBeDefined();
    const css = readFileSync(owner, 'utf8');

    for (const edge of EDGES) {
      // Capacitor's variable first, `env()` second, `0px` last. Order matters:
      // `var(--safe-area-inset-x, env(...))` only uses env() when Capacitor has
      // not injected a value.
      expect(css).toContain(
        `--be-safe-${edge}: var(--safe-area-inset-${edge}, env(safe-area-inset-${edge}, 0px));`,
      );
    }
  });

  test('no other stylesheet reads env(safe-area-inset-*) directly', () => {
    const offenders = allCss
      .filter((file) => !file.endsWith(TOKEN_OWNER))
      .filter((file) => /env\(\s*safe-area-inset-/.test(cssCode(file)))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  test('no stylesheet redeclares the --be-safe-* tokens', () => {
    // A second declaration shadows the contract depending on import order, which
    // is how the client sheet silently ignored Capacitor's values.
    const offenders = allCss
      .filter((file) => !file.endsWith(TOKEN_OWNER))
      .filter((file) => /--be-safe-(top|right|bottom|left)\s*:/.test(cssCode(file)))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  test('the dead --be-safe-area-* alias set is gone', () => {
    const offenders = allCss
      .filter((file) => /--be-safe-area-/.test(cssCode(file)))
      .map(relative);

    expect(offenders).toEqual([]);
  });
});

describe('viewport meta', () => {
  test('index.html keeps viewport-fit=cover', () => {
    // Capacitor's SystemBars plugin greps the viewport meta for this exact token
    // and skips inset injection entirely without it, so removing it disables the
    // Android 15+ path with no visible error.
    const html = htmlCode(indexHtml);
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
  });

  test('index.html does not disable user scaling', () => {
    // Page zoom is handled by capacitor.config.json `zoomEnabled: false`, which
    // leaves OS text scaling alone. `user-scalable=no` here would also affect the
    // browser builds and is an accessibility regression.
    const html = htmlCode(indexHtml);
    expect(html).not.toMatch(/user-scalable\s*=\s*no/);
  });
});
