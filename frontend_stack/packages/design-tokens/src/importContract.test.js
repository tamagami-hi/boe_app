import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.vite']);

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

function workspacePackages() {
  const packages = {};
  const packagesDir = path.join(ROOT, 'packages');
  for (const name of fs.readdirSync(packagesDir)) {
    const manifest = path.join(packagesDir, name, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    packages[parsed.name] = {
      dir: path.join(packagesDir, name),
      exports: parsed.exports || {},
    };
  }
  return packages;
}

function sourceFiles() {
  return [...walk(path.join(ROOT, 'packages')), ...walk(path.join(ROOT, 'app/src'))]
    .filter((file) => /\.(js|jsx)$/.test(file));
}

function specifiersIn(source) {
  const found = [];
  const patterns = [
    /from\s*["'](@beonedge\/[^"']+)["']/g,
    /import\s*\(\s*["'](@beonedge\/[^"']+)["']\s*\)/g,
    /import\s*["'](@beonedge\/[^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) found.push(match[1]);
  }
  return found;
}

function resolvesThroughExports(pkg, subpath) {
  for (const key of Object.keys(pkg.exports)) {
    if (key === subpath) return true;
    if (key.endsWith('/*')) {
      const prefix = key.slice(0, -1);
      if (subpath.startsWith(prefix)) return true;
    }
  }
  return false;
}

describe('workspace import contract', () => {
  const packages = workspacePackages();
  const files = sourceFiles();

  it('finds the workspace packages and sources', () => {
    expect(Object.keys(packages).length).toBeGreaterThan(2);
    expect(files.length).toBeGreaterThan(50);
  });

  it('every @beonedge import resolves through its package exports map', () => {
    const offenders = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of specifiersIn(source)) {
        const parts = specifier.split('/');
        const name = parts.slice(0, 2).join('/');
        const subpath = parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.';
        const pkg = packages[name];
        const relative = path.relative(ROOT, file);
        if (!pkg) {
          offenders.push(`${relative}: unknown workspace package ${specifier}`);
          continue;
        }
        if (!resolvesThroughExports(pkg, subpath)) {
          offenders.push(`${relative}: ${specifier} is not exported by ${name}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('every @beonedge import points at a file that exists', () => {
    const offenders = [];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const specifier of specifiersIn(source)) {
        const parts = specifier.split('/');
        const name = parts.slice(0, 2).join('/');
        const pkg = packages[name];
        if (!pkg) continue;
        const rest = parts.slice(2).join('/');
        const target = rest ? path.join(pkg.dir, 'src', rest) : path.join(pkg.dir, 'src/index.js');
        if (!fs.existsSync(target)) {
          offenders.push(`${path.relative(ROOT, file)}: ${specifier} -> missing ${path.relative(ROOT, target)}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
