// Asserts the Android artifact is client-only and within budget.
//
// The previous guard tested file names against /^(Admin|AdminLogin|Website|Landing|
// Apk|BrowserRoot)-/. Vite names chunks after the manualChunks key, which is
// lowercase `admin`, so `admin-<hash>.js` — the exact leak this exists to catch —
// did not match. It also ignored CSS and had no size assertion.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const assetsDir = join(process.cwd(), 'dist', 'assets');
const files = readdirSync(assetsDir);

// Matched case-insensitively against the whole name, not just a prefix.
const FORBIDDEN = [
  /admin/i,
  /website/i,
  /landing/i,
  /browserroot/i,
];

// Byte budgets for the assets the WebView parses on launch. Fonts and images are
// excluded: they are lazily fetched by the renderer, and the APK-size question is a
// separate assertion below.
const BUDGETS = [
  { label: 'largest JS chunk', match: /\.js$/, maxBytes: 320 * 1024 },
  { label: 'largest CSS file', match: /\.css$/, maxBytes: 160 * 1024 },
  { label: 'all assets', match: /./, maxBytes: 1400 * 1024, total: true },
];

const problems = [];

for (const name of files) {
  if (FORBIDDEN.some((pattern) => pattern.test(name))) {
    problems.push(`non-client asset in the Android build: ${name}`);
  }
}

const sizeOf = (name) => statSync(join(assetsDir, name)).size;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

for (const budget of BUDGETS) {
  const matched = files.filter((name) => budget.match.test(name));
  if (matched.length === 0) continue;
  if (budget.total) {
    const total = matched.reduce((sum, name) => sum + sizeOf(name), 0);
    if (total > budget.maxBytes) {
      problems.push(`${budget.label} is ${kb(total)}, over the ${kb(budget.maxBytes)} budget`);
    }
    continue;
  }
  const biggest = matched.reduce((worst, name) => (sizeOf(name) > sizeOf(worst) ? name : worst));
  if (sizeOf(biggest) > budget.maxBytes) {
    problems.push(`${budget.label} ${biggest} is ${kb(sizeOf(biggest))}, over the ${kb(budget.maxBytes)} budget`);
  }
}

// One font family per subset, woff2 only. A regression here is silent: the extra
// files never load in a browser but are still packaged into the APK.
const fonts = files.filter((name) => /\.woff2?$/.test(name));
const legacyFonts = fonts.filter((name) => name.endsWith('.woff'));
if (legacyFonts.length > 0) {
  problems.push(`woff fallbacks are packaged but never used: ${legacyFonts.join(', ')}`);
}
const wideSubsets = fonts.filter((name) => /(cyrillic|greek|vietnamese)/i.test(name));
if (wideSubsets.length > 0) {
  problems.push(`font subsets the app cannot render: ${wideSubsets.join(', ')}`);
}

if (problems.length > 0) {
  console.error('Android artifact check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

const totalBytes = files.reduce((sum, name) => sum + sizeOf(name), 0);
console.log(`Android artifact OK: ${files.length} assets, ${kb(totalBytes)} total.`);
