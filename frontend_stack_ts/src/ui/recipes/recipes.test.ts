import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const RECIPE_DIR = join("src", "ui", "recipes")
const SOURCE_ROOT = "src"

const collect = (directory: string, predicate: (name: string) => boolean): string[] => {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...collect(path, predicate))
    } else if (predicate(entry)) {
      found.push(path)
    }
  }
  return found
}

const recipeFiles = (): string[] => [
  ...readdirSync(RECIPE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(RECIPE_DIR, name)),
  ...collect(SOURCE_ROOT, (name) => name.endsWith(".recipe.ts")),
]

type Constant = Readonly<{ qualified: string; value: string }>

const SINGLE = /export const ([A-Z0-9_]+)\s*=\s*"([^"]*)"/gu
const JOINED = /export const ([A-Z0-9_]+)\s*=\s*\[([\s\S]*?)\]\.join\(" "\)/gu
const LITERAL = /"([^"]*)"/gu

const constantsOf = (path: string): Constant[] => {
  const source = readFileSync(path, "utf8")
  const found: Constant[] = []
  for (const match of source.matchAll(SINGLE)) {
    const value = match[2]?.trim() ?? ""
    if (value !== "") found.push({ qualified: `${path}::${match[1] ?? ""}`, value })
  }
  for (const match of source.matchAll(JOINED)) {
    const parts = [...(match[2] ?? "").matchAll(LITERAL)].map((part) => (part[1] ?? "").trim())
    const value = parts.join(" ").trim()
    if (value !== "") found.push({ qualified: `${path}::${match[1] ?? ""}`, value })
  }
  return found
}

const STRUCTURAL = new Set([
  "flex",
  "grid",
  "inline-flex",
  "flex-col",
  "flex-row",
  "flex-wrap",
  "flex-none",
  "flex-1",
  "items-center",
  "items-start",
  "items-end",
  "items-baseline",
  "items-stretch",
  "justify-between",
  "justify-center",
  "justify-end",
  "justify-start",
  "list-none",
  "m-0",
  "p-0",
  "relative",
  "min-w-0",
  "self-start",
  "text-right",
  "text-left",
  "text-center",
])

const isStructural = (value: string): boolean =>
  value
    .split(/\s+/u)
    .every(
      (token) =>
        STRUCTURAL.has(token) ||
        /^(?:gap|gap-x|gap-y|grid-cols|col-span|row-span|auto-cols|grid-flow)-/u.test(token),
    )

const ALLOWED_DUPLICATES: readonly Readonly<{ names: readonly string[]; reason: string }>[] = [
  {
    names: [
      "src/ui/recipes/field.ts::SWITCH_LABEL",
      "src/ui/recipes/field.ts::RADIO_LABEL",
      "src/features/funds/funds.recipe.ts::FUND_TABLE_NAME",
    ],
    reason:
      "A control label and a table cell name coincide today but answer to different owners: control labels track the form system, table names track the fund table's density.",
  },
  {
    names: ["src/ui/recipes/field.ts::FIELD_HINT", "src/ui/recipes/text.ts::META_TEXT"],
    reason:
      "A form hint is bound to the field system and must be able to change tone independently of generic metadata text.",
  },
  {
    names: ["src/ui/recipes/field.ts::TEXTAREA_INVALID", "src/ui/recipes/field.ts::AMOUNT_INVALID"],
    reason:
      "Both currently reduce to the shared invalid ring utility, but the amount input carries a larger control and may need a heavier invalid treatment.",
  },
  {
    names: [
      "src/ui/recipes/field.ts::RADIO_MARK_REST",
      "src/features/device-security/device-security.recipe.ts::PIN_DOT_EMPTY",
    ],
    reason:
      "A radio mark and an unfilled PIN dot are unrelated components that happen to share a resting ring.",
  },
  {
    names: [
      "src/ui/recipes/state.ts::STATE_TITLE",
      "src/features/profile/profile.recipe.ts::IDENTITY_NAME",
    ],
    reason:
      "An empty/error panel title and the account holder's name are independent typographic roles.",
  },
  {
    names: [
      "src/features/sip/sip.recipe.ts::SIP_SUMMARY",
      "src/features/statements/statements.recipe.ts::STATEMENT_FLOW",
    ],
    reason:
      "Two summary grids with the same column rhythm today; they describe different data shapes and are expected to diverge.",
  },
]

const allowKey = (names: readonly string[]): string => [...names].sort().join("|")

const ALLOWED_KEYS = new Set(ALLOWED_DUPLICATES.map((entry) => allowKey(entry.names)))

describe("recipe vocabulary", () => {
  const files = recipeFiles()
  const constants = files.flatMap((path) => constantsOf(path))

  it("finds the recipe layer", () => {
    expect(files.length).toBeGreaterThan(10)
    expect(constants.length).toBeGreaterThan(100)
  })

  it("declares every constant name exactly once across the recipe layer", () => {
    const byName = new Map<string, string[]>()
    for (const entry of constants) {
      const name = entry.qualified.split("::")[1] ?? ""
      byName.set(name, [...(byName.get(name) ?? []), entry.qualified])
    }
    const collisions = [...byName.entries()].filter(([, where]) => where.length > 1)
    expect(collisions).toEqual([])
  })

  it("does not define the same non-structural class string under two names", () => {
    const byValue = new Map<string, string[]>()
    for (const entry of constants) {
      if (isStructural(entry.value)) continue
      byValue.set(entry.value, [...(byValue.get(entry.value) ?? []), entry.qualified])
    }
    const offenders = [...byValue.entries()]
      .filter(([, names]) => names.length > 1)
      .filter(([, names]) => !ALLOWED_KEYS.has(allowKey(names)))
      .map(([value, names]) => `${names.join(" == ")}  ->  "${value}"`)

    expect(offenders).toEqual([])
  })

  it("never reads env(safe-area-inset-*) outside the token layer", () => {
    const offenders = files.filter((path) => readFileSync(path, "utf8").includes("env(safe-area-"))
    expect(offenders).toEqual([])
  })

  it("never hard-codes a hex colour", () => {
    const offenders = files.filter((path) => /#[0-9a-fA-F]{3,8}\b/u.test(readFileSync(path, "utf8")))
    expect(offenders).toEqual([])
  })

  it("uses only the four canonical breakpoints", () => {
    const offenders: string[] = []
    for (const path of files) {
      const source = readFileSync(path, "utf8")
      for (const match of source.matchAll(/\b(2xl|3xl|min-\[|max-\[)[:[]/gu)) {
        offenders.push(`${path}: ${match[1] ?? ""}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("keeps every allowlisted duplicate justified and still present", () => {
    const present = new Set(constants.map((entry) => entry.qualified))
    for (const entry of ALLOWED_DUPLICATES) {
      expect(entry.reason.length, entry.names.join(" == ")).toBeGreaterThan(40)
      for (const name of entry.names) {
        expect(present.has(name), `stale allowlist entry: ${name}`).toBe(true)
      }
    }
  })
})
