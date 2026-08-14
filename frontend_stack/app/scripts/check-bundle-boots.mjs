import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const distDir = resolve(process.cwd(), 'dist');
const assetsDir = join(distDir, 'assets');
const indexHtml = join(distDir, 'index.html');

function fail(message) {
  console.error(`bundle boot check failed: ${message}`);
  process.exit(1);
}

if (!existsSync(indexHtml) || !existsSync(assetsDir)) fail(`no build at ${distDir}`);

const html = readFileSync(indexHtml, 'utf8');
const entryMatch = html.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/);
if (!entryMatch) fail('index.html references no module entry');
const entry = entryMatch[1];

const present = readdirSync(assetsDir);
const referenced = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((m) => m[1]);
const missing = referenced.filter((name) => !present.includes(name));
if (missing.length > 0) fail(`index.html references assets that were not emitted: ${missing.join(', ')}`);

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://localhost/',
  pretendToBeVisual: true,
});

const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
  writable: true,
});
for (const key of [
  'location', 'history', 'localStorage', 'sessionStorage', 'HTMLElement', 'Element',
  'Node', 'Event', 'CustomEvent', 'MutationObserver', 'DOMParser', 'XMLHttpRequest',
]) {
  if (window[key] !== undefined) globalThis[key] = window[key];
}
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.matchMedia = () => ({
  matches: false,
  media: '',
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return false; },
});
globalThis.fetch = () => new Promise(() => {});

const failures = [];
process.on('unhandledRejection', (reason) => {
  failures.push(`unhandled rejection: ${reason?.message || reason}`);
});
window.addEventListener('error', (event) => {
  failures.push(`window error: ${event.error?.message || event.message}`);
});

const chunks = [entry, ...present.filter((name) => name.endsWith('.js') && name !== entry)];

for (const chunk of chunks) {
  try {
    await import(pathToFileURL(join(assetsDir, chunk)).href);
  } catch (error) {
    fail(`evaluating ${chunk} threw: ${error?.message || error}`);
  }
}

await new Promise((r) => setTimeout(r, 250));

if (failures.length > 0) fail(failures.join(' | '));

console.log(`Bundle boot OK: ${chunks.length} chunk(s) evaluated with no error, entry ${entry}.`);
process.exit(0);
