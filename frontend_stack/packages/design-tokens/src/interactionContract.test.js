import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'packages');
const APP_SRC = path.resolve(process.cwd(), 'app/src');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'ui-kits']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}

function shippedJsx() {
  return [...walk(ROOT), ...walk(APP_SRC)]
    .filter((f) => f.endsWith('.jsx') && !f.includes('.test.'));
}

function code(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function openingTags(source, tagName) {
  const tags = [];
  const needle = '<' + tagName;
  let pos = 0;
  let idx;
  while ((idx = source.indexOf(needle, pos)) !== -1) {
    const after = source[idx + needle.length];
    if (after && /[A-Za-z0-9_-]/.test(after)) { pos = idx + needle.length; continue; }
    let depth = 0;
    let quote = null;
    let end = -1;
    for (let i = idx + needle.length; i < source.length; i++) {
      const c = source[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { end = i; break; }
    }
    if (end === -1) break;
    tags.push({ text: source.slice(idx, end + 1), index: idx });
    pos = end + 1;
  }
  return tags;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

describe('interaction contract', () => {
  it('every <button> declares a type', () => {
    const offenders = [];
    for (const file of shippedJsx()) {
      const source = code(file);
      for (const tag of openingTags(source, 'button')) {
        if (!/\btype=/.test(tag.text)) {
          offenders.push(path.relative(process.cwd(), file) + ':' + lineOf(source, tag.index));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no shipped screen swallows a read failure into an empty collection', () => {
    const offenders = [];
    for (const file of [...shippedJsx(), ...walk(ROOT).filter((f) => f.endsWith('.js') && !f.includes('.test.'))]) {
      const source = code(file);
      const re = /\.catch\(\(\)\s*=>\s*set[A-Za-z0-9_]*\(\s*(\[\s*\]|\{\s*\})\s*\)\s*\)/g;
      let m;
      while ((m = re.exec(source))) {
        offenders.push(path.relative(process.cwd(), file) + ':' + lineOf(source, m.index));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the two money-path reads that regressed keep an explicit failure branch', () => {
    const lumpsum = code(path.join(ROOT, 'client/src/pages/LumpsumSheet.jsx'));
    expect(lumpsum).toMatch(/setLoadError/);
    expect(lumpsum).toMatch(/<ErrorState/);
    expect(lumpsum).not.toMatch(/catch\(\(\)\s*=>\s*setFund\(null\)\)/);

    const support = code(path.join(ROOT, 'client/src/pages/Support.jsx'));
    expect(support).toMatch(/<ErrorState/);
    expect(support).toMatch(/loadError/);
  });

  it('a failed KYC read is distinguishable from KYC not started', () => {
    const profile = code(path.join(ROOT, 'client/src/pages/Profile.jsx'));
    expect(profile).toMatch(/kycUnavailable/);
    expect(profile).toMatch(/Status unavailable/);
  });
});
