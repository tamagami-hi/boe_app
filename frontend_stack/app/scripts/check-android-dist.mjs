import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const variant = (process.argv.find((arg) => arg.startsWith('--variant=')) || '--variant=client').split('=')[1];
if (!['client', 'admin'].includes(variant)) {
  console.error(`check-android-dist: --variant must be client or admin, got '${variant}'`);
  process.exit(1);
}

const assetsDir = join(process.cwd(), 'dist', 'assets');
const files = readdirSync(assetsDir);

const FORBIDDEN = [
  /admin/i,
  /website/i,
  /landing/i,
  /browserroot/i,
];

const BUDGETS = [
  { label: 'largest JS chunk', match: /\.js$/, maxBytes: 320 * 1024 },
  { label: 'largest CSS file', match: /\.css$/, maxBytes: 160 * 1024 },
  { label: 'all assets', match: /./, maxBytes: 1400 * 1024, total: true },
];

const problems = [];

if (variant === 'client') {
  for (const name of files) {
    if (FORBIDDEN.some((pattern) => pattern.test(name))) {
      problems.push(`non-client asset in the Android build: ${name}`);
    }
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

const fonts = files.filter((name) => /\.woff2?$/.test(name));
const legacyFonts = fonts.filter((name) => name.endsWith('.woff'));
if (legacyFonts.length > 0) {
  problems.push(`woff fallbacks are packaged but never used: ${legacyFonts.join(', ')}`);
}
const wideSubsets = fonts.filter((name) => /(cyrillic|greek|vietnamese)/i.test(name));
if (wideSubsets.length > 0) {
  problems.push(`font subsets the app cannot render: ${wideSubsets.join(', ')}`);
}

function staticImportsOf(name) {
  const source = readFileSync(join(assetsDir, name), 'utf8');
  const found = new Set();
  const patterns = [
    /from\s*["']\.\/([^"']+)["']/g,
    /(?:^|[\s;}])import\s*["']\.\/([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) found.add(match[1]);
  }
  return [...found];
}

const jsFiles = files.filter((name) => name.endsWith('.js'));
const graph = new Map(jsFiles.map((name) => [name, staticImportsOf(name).filter((dep) => jsFiles.includes(dep))]));

const cycles = [];
for (const start of jsFiles) {
  const stack = [[start, [start]]];
  const seen = new Set();
  while (stack.length > 0) {
    const [node, path] = stack.pop();
    for (const dep of graph.get(node) || []) {
      if (dep === start) {
        cycles.push([...path, dep].join(' -> '));
        continue;
      }
      if (seen.has(dep)) continue;
      seen.add(dep);
      stack.push([dep, [...path, dep]]);
    }
  }
}

if (cycles.length > 0) {
  const unique = [...new Set(cycles.map((cycle) => cycle.split(' -> ').slice(0, -1).sort().join('|')))];
  problems.push(
    `chunks import each other, so a binding can be read before its chunk initialises: ${unique.join(' ; ')}`,
  );
}

if (problems.length > 0) {
  console.error('Android artifact check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

const totalBytes = files.reduce((sum, name) => sum + sizeOf(name), 0);
console.log(`Android artifact OK (${variant}): ${files.length} assets, ${kb(totalBytes)} total, chunk graph acyclic.`);
