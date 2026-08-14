// Every component and icon a JSX file renders must be something that file can name.
//
// Written after finding `{ id: 'display', label: 'Display', icon: Star }` in the
// 1,304-line fund editor. `Star` was never imported. Referencing an undeclared
// identifier throws a ReferenceError when the expression is evaluated, so opening
// the fund editor — Create or Edit, the only two ways into it — took out the whole
// Fund operations screen. `vite build` does not fail on it (there is no eslint config
// in this workspace, so no `no-undef`), no type check covers .jsx here, and no test
// rendered that screen. It shipped.
//
// This is the narrow, dependency-free version of `no-undef`: it only looks at JSX
// element names and `icon` references, which is where a missing import turns into a
// crash rather than a silent `undefined`.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['packages', 'app/src'];

// Names that are always available, or are provided by the JSX runtime.
const AMBIENT = new Set([
  'React', 'Fragment', 'Suspense', 'StrictMode', 'Profiler',
  'Math', 'Object', 'Number', 'String', 'Array', 'JSON', 'Boolean', 'Date', 'Intl',
  'Set', 'Map', 'WeakMap', 'Promise', 'Error', 'RegExp', 'URL', 'URLSearchParams',
  'Blob', 'FormData', 'Image', 'Infinity', 'NaN',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Comments are stripped first: several files discuss a component by name in prose
// ("Replaces a silent `<Navigate to=...>`"), which is not a reference to it.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function declaredNames(source) {
  const names = new Set(AMBIENT);
  // Imports, default and named, including renames.
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]/g)) {
    for (const id of match[1].match(/[A-Za-z_$][\w$]*/g) || []) names.add(id);
  }
  // Local declarations.
  for (const match of source.matchAll(/(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  // Destructuring renames and shorthands, e.g. `const { icon: Icon } = props` or
  // `const { Icon } = view`. Restricted to destructuring patterns: an object
  // LITERAL's `icon: Star` is a reference to Star, not a declaration of it, and
  // treating the two alike is what would have let the original defect through.
  for (const pattern of source.matchAll(/\{([^{}]*)\}\s*(?:=[^=]|\)|\s*=>)/g)) {
    for (const rename of pattern[1].matchAll(/[A-Za-z_$][\w$]*\s*:\s*([A-Z][\w$]*)/g)) {
      names.add(rename[1]);
    }
    for (const shorthand of pattern[1].matchAll(/(?:^|[,{\s])([A-Z][\w$]*)\s*(?:[,}=]|$)/g)) {
      names.add(shorthand[1]);
    }
  }
  // A rename WITH a default (`{ as: Tag = 'div' }`) is unambiguously a destructuring
  // pattern: an object literal's value cannot be followed by `=`. This catches the
  // multi-line parameter lists the shared primitives use.
  for (const match of source.matchAll(/[A-Za-z_$][\w$]*\s*:\s*([A-Z][\w$]*)\s*=[^=]/g)) {
    names.add(match[1]);
  }
  return names;
}

function referencedNames(source) {
  const used = new Set();
  // <Component ...>, but not <div> and not <Foo.Bar> (the object is what matters).
  for (const match of source.matchAll(/<([A-Z][\w$]*)[\s/>]/g)) used.add(match[1]);
  // icon={Foo} and icon: Foo — the pattern the admin console uses everywhere.
  for (const match of source.matchAll(/icon(?:=\{|:\s*)([A-Z][\w$]*)/g)) used.add(match[1]);
  return used;
}

const files = ROOTS
  .flatMap((root) => walk(path.join(process.cwd(), root)))
  .filter((file) => file.endsWith('.jsx') && !file.includes('.test.'));

describe('component contract', () => {
  test('the scan has files to look at', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  test('every JSX component and icon reference resolves to a name in its file', () => {
    const missing = [];
    for (const file of files) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      const declared = declaredNames(source);
      for (const name of referencedNames(source)) {
        if (!declared.has(name)) missing.push(`${name} (${path.relative(process.cwd(), file)})`);
      }
    }
    expect(missing, `undeclared components or icons:\n${missing.join('\n')}`).toEqual([]);
  });

  test('the check would catch a missing icon import', () => {
    // The exact shape of the defect this exists for.
    const source = stripComments(`
      import { FileText } from 'lucide-react';
      export default function Nav() {
        const items = [{ id: 'display', label: 'Display', icon: Star }];
        return <FileText items={items} />;
      }
    `);
    const declared = declaredNames(source);
    expect(referencedNames(source).has('Star')).toBe(true);
    expect(declared.has('Star')).toBe(false);
    expect(declared.has('FileText')).toBe(true);
  });
});
