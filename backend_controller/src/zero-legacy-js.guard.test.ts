import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

/**
 * BE-020 backend zero-JavaScript gate. Proves the authored backend source is
 * fully TypeScript: no `.js`/`.jsx`/`.cjs`/`.mjs` under `src/` or `scripts/`, and
 * no lingering legacy `#`-subpath alias imports. Generated output (`dist/`) and
 * `node_modules/` are excluded. This is the permanent successor to the
 * per-file legacy-deletion guard.
 */
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const SCANNED_DIRS = ["src", "scripts"] as const
const SKIP = new Set(["node_modules", "dist"])
const JS_PATTERN = /\.(?:js|jsx|cjs|mjs)$/u

const walk = (directory: string): string[] => {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walk(full))
    else found.push(full)
  }
  return found
}

const scannedFiles = SCANNED_DIRS.flatMap((dir) => walk(join(packageRoot, dir)))

describe("backend zero-JavaScript gate (BE-020)", () => {
  test("no authored .js/.jsx/.cjs/.mjs under src/ or scripts/", () => {
    const authoredJs = scannedFiles
      .filter((file) => JS_PATTERN.test(file))
      .map((file) => relative(packageRoot, file))
      .sort()
    expect(authoredJs).toEqual([])
  })

  test("no legacy #-subpath alias imports remain in TypeScript sources", () => {
    const aliasImport = /(?:from|import)\s*\(?\s*["']#/u
    // Read via the shared file list; only .ts/.tsx can carry TS imports.
    const offenders = scannedFiles
      .filter((file) => /\.tsx?$/u.test(file))
      .filter((file) => aliasImport.test(readFileSync(file, "utf8")))
      .map((file) => relative(packageRoot, file))
      .sort()
    expect(offenders).toEqual([])
  })
})
