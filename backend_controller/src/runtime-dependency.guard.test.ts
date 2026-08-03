import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

/**
 * Guards that every package imported by production code is declared in
 * `dependencies` — not `devDependencies`.
 *
 * The runtime image installs with `npm ci --omit=dev`, so a runtime import parked
 * in `devDependencies` type-checks, passes every local test, builds a green
 * image, and then fails at container start with `ERR_MODULE_NOT_FOUND`. That is
 * exactly what happened with `pg` and `kysely`: the API could not open a database
 * connection in any built image. Local runs hid it because dev dependencies are
 * installed there.
 */

const PACKAGE_ROOT = new URL("../", import.meta.url)

/** `@scope/name` keeps two segments; everything else keeps one. */
const packageNameOf = (specifier: string): string => {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier)
}

const listProductionSources = async (): Promise<readonly string[]> => {
  const root = fileURLToPath(new URL("./", import.meta.url))
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => `${entry.parentPath}/${entry.name}`)
}

describe("runtime dependency guard", () => {
  test("every package imported by src/ is a production dependency", async () => {
    const manifest = JSON.parse(
      await readFile(fileURLToPath(new URL("package.json", PACKAGE_ROOT)), "utf8"),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const dependencies = new Set(Object.keys(manifest.dependencies ?? {}))
    const devDependencies = new Set(Object.keys(manifest.devDependencies ?? {}))

    const offenders: string[] = []
    for (const file of await listProductionSources()) {
      const source = await readFile(file, "utf8")
      // Anchored to a statement so prose in a comment ("... from \"approved\" to ...")
      // is not mistaken for an import.
      for (const match of source.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+"([^"]+)"/gmu)) {
        const specifier = match[1] ?? ""
        // Relative paths and Node built-ins need no declaration.
        if (specifier.startsWith(".") || specifier.startsWith("node:")) continue
        const name = packageNameOf(specifier)
        if (dependencies.has(name)) continue
        offenders.push(
          `${name} (imported by ${file.slice(file.indexOf("/src/") + 1)}) is ${
            devDependencies.has(name) ? "a devDependency" : "undeclared"
          }`,
        )
      }
    }

    expect([...new Set(offenders)]).toEqual([])
  })

  test("the lockfile marks those packages as production too", async () => {
    // `npm ci --omit=dev` reads the lockfile, not package.json, so a stale lock
    // would still strip the package from the image.
    const lock = JSON.parse(
      await readFile(fileURLToPath(new URL("package-lock.json", PACKAGE_ROOT)), "utf8"),
    ) as { packages: Record<string, { dev?: boolean }> }
    const manifest = JSON.parse(
      await readFile(fileURLToPath(new URL("package.json", PACKAGE_ROOT)), "utf8"),
    ) as { dependencies?: Record<string, string> }

    const devOnly = Object.keys(manifest.dependencies ?? {}).filter(
      (name) => lock.packages[`node_modules/${name}`]?.dev === true,
    )
    expect(devOnly).toEqual([])
  })
})
