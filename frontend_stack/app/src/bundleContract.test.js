// Bundle decisions that are invisible in review and easy to undo by accident.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
// Assertions are about code, not prose: several of these files explain the defect
// they fixed, and the explanation names the thing being forbidden.
const code = (relative) => read(relative)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const appPackage = JSON.parse(read('app/package.json'));

describe('dependencies', () => {
  // gsap went unused when the staged reveals were removed, and @beonedge/ui-kits is a
  // standalone preview kit that nothing in app/ or packages/ imports.
  test('nothing depends on gsap or the preview kit', () => {
    const declared = { ...appPackage.dependencies, ...appPackage.devDependencies };
    for (const dead of ['gsap', '@gsap/react', '@beonedge/ui-kits']) {
      expect(Object.keys(declared), dead).not.toContain(dead);
    }
    const shared = JSON.parse(read('packages/shared/package.json'));
    expect(shared.dependencies ?? {}).toEqual({});
  });

  test('the razorpay checkout script is not in the HTML shell', () => {
    // It loaded from a CDN on every cold launch of both targets, including the admin
    // console, which never takes a payment.
    expect(read('app/index.html')).not.toContain('checkout.razorpay.com');
    expect(code('packages/client/src/utils/razorpay.js')).toContain('checkout.razorpay.com');
  });

  test('the checkout loader reports failure instead of calling alert', () => {
    const source = code('packages/client/src/utils/razorpay.js');
    expect(source).not.toContain('alert(');
    expect(source).toContain('checkout_unavailable');
  });
});

describe('fonts', () => {
  const fonts = code('packages/design-tokens/src/fonts.css');

  test('only woff2 is referenced', () => {
    expect(fonts).not.toMatch(/\.woff['")]/u);
    expect(fonts).toContain('.woff2');
  });

  test('only latin and latin-ext subsets ship', () => {
    for (const subset of ['cyrillic', 'greek', 'vietnamese']) {
      expect(fonts, subset).not.toContain(subset);
    }
  });

  // The rupee sign is U+20B9, inside the latin-ext range. Dropping latin-ext would
  // make every amount in the app fall back to a system font.
  test('latin-ext covers the rupee sign', () => {
    const ranges = fonts.match(/unicode-range:[^;]+;/gu) || [];
    expect(ranges.some((range) => range.includes('U+20AD-20C0'))).toBe(true);
    expect((fonts.match(/@font-face/gu) || []).length).toBe(8);
  });

  test('the token entry point no longer pulls the fontsource barrels', () => {
    const tokens = code('packages/design-tokens/src/tokens.css');
    expect(tokens).toContain("@import './fonts.css'");
    expect(tokens).not.toContain('@fontsource-variable/instrument-sans\'');
  });
});

describe('chunking', () => {
  const config = code('app/vite.config.js');

  test('the build target is defined, so the unused target folds away', () => {
    // Without this the web build could not eliminate the client subtree, and the
    // admin entry preloaded the client screen chunk plus its 122 kB stylesheet.
    expect(config).toContain("'import.meta.env.VITE_BEO_APP_TARGET'");
  });

  test('client transport is chunked apart from client screens', () => {
    expect(config).toContain("return 'client-core'");
    expect(config).toContain("/packages/client/src/services/");
  });

  test('the retired preview-kit alias and chunk are gone', () => {
    expect(config).not.toContain('ui-kits');
  });
});

describe('the android artifact guard', () => {
  const guard = code('app/scripts/check-android-dist.mjs');

  test('it matches chunk names case-insensitively', () => {
    // Vite names chunks after the manualChunks key — lowercase `admin` — so a
    // prefix-anchored /^Admin-/ never matched the leak it existed to catch.
    expect(guard).toContain('/admin/i');
    expect(guard).not.toContain('^(Admin');
  });

  test('it asserts byte budgets and font hygiene, not just file names', () => {
    expect(guard).toContain('maxBytes');
    expect(guard).toContain('woff');
  });
});
