import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const SOURCE_ROOT = "src"
const TOKEN_OWNER = join("src", "ui", "tokens", "tokens-core.css")
const INDEX_HTML = "index.html"

const SAFE_AREA_EDGES = ["top", "right", "bottom", "left"] as const

const EXPECTED_DECLARATIONS = SAFE_AREA_EDGES.map(
  (edge) =>
    `--be-safe-${edge}: var(--safe-area-inset-${edge}, env(safe-area-inset-${edge}, 0px));`,
)

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//gu, "")

const collectStylesheets = (directory: string): string[] => {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...collectStylesheets(path))
    } else if (entry.endsWith(".css")) {
      found.push(path)
    }
  }
  return found
}

describe("safe-area token contract", () => {
  const stylesheets = collectStylesheets(SOURCE_ROOT)

  it("finds stylesheets to check", () => {
    expect(stylesheets.length).toBeGreaterThan(0)
    expect(stylesheets).toContain(TOKEN_OWNER)
  })

  it("declares all four edges in the owning stylesheet with the exact fallback chain", () => {
    const source = stripComments(readFileSync(TOKEN_OWNER, "utf8"))
    for (const declaration of EXPECTED_DECLARATIONS) {
      expect(source, declaration).toContain(declaration)
    }
  })

  it("reads env(safe-area-inset-*) nowhere except the owning stylesheet", () => {
    const offenders = stylesheets
      .filter((path) => path !== TOKEN_OWNER)
      .filter((path) => stripComments(readFileSync(path, "utf8")).includes("env(safe-area-inset-"))

    expect(offenders).toEqual([])
  })

  it("redeclares --be-safe-* nowhere except the owning stylesheet", () => {
    const offenders = stylesheets
      .filter((path) => path !== TOKEN_OWNER)
      .filter((path) => /--be-safe-(?:top|right|bottom|left)\s*:/u.test(stripComments(readFileSync(path, "utf8"))))

    expect(offenders).toEqual([])
  })

  it("keeps the retired --be-safe-area-* alias set out of the codebase", () => {
    const offenders = stylesheets.filter((path) =>
      stripComments(readFileSync(path, "utf8")).includes("--be-safe-area-"),
    )

    expect(offenders).toEqual([])
  })

  it("carries viewport-fit=cover in the document viewport meta", () => {
    const html = readFileSync(INDEX_HTML, "utf8")
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/u)
  })

  it("never disables user scaling", () => {
    const html = readFileSync(INDEX_HTML, "utf8")
    expect(html).not.toContain("user-scalable=no")
    expect(html).not.toContain("maximum-scale=1")
  })
})
