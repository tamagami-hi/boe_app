import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

/**
 * Guards the Option B money model: ownership is money on a dated ledger, not
 * units priced against a NAV.
 *
 * The unit-era modules are deleted and their tables are unread. Reintroducing
 * either would silently give the platform two disagreeing notions of what an
 * investor owns, so this fails the build rather than letting that happen.
 */

/** Modules removed when the money model changed, with their replacements. */
const DELETED_UNIT_ERA_MODULES: readonly string[] = [
  // Unit allotment/NAV arithmetic. Option B moves whole paise, so the scaled
  // decimal helpers and computeAllotmentUnits have no caller:
  // domain/client/portfolioLedger.ts derives every figure in integer paise.
  "finance/money.ts",
  "finance/money.test.ts",
  // Holdings/lots/movements + current-NAV lookup, replaced by
  // repositories/investorLedgerRepository.ts.
  "repositories/holdingRepository.ts",
]

/**
 * Tables retained for historical rows but never read or written by the
 * application. `db/types.ts` and `db/repositories.ts` still declare them so the
 * schema stays fully typed, and migrations obviously reference them; nothing else
 * may.
 */
const RETIRED_TABLES: readonly string[] = [
  "fund_nav_prices",
  "investment_executions",
  "holding_lots",
  "holding_lot_movements",
]

const SCHEMA_DECLARATION_FILES: readonly string[] = ["db/types.ts", "db/repositories.ts"]

const listSourceFiles = async (): Promise<readonly string[]> => {
  const root = fileURLToPath(new URL("./", import.meta.url))
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => `${entry.parentPath.slice(root.length)}/${entry.name}`.replace(/^\//u, ""))
}

describe("Option B money model guard", () => {
  test.each(DELETED_UNIT_ERA_MODULES)("%s remains deleted", (relativePath) => {
    const absolutePath = fileURLToPath(new URL(`./${relativePath}`, import.meta.url))
    expect(existsSync(absolutePath)).toBe(false)
  })

  test("no production module reads or writes a retired unit-era table", async () => {
    const files = await listSourceFiles()
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(".test.ts")) continue
      if (SCHEMA_DECLARATION_FILES.includes(file)) continue
      const source = await readFile(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8")
      // Strip comments: a doc comment explaining the retirement is not a read.
      const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "")
      for (const table of RETIRED_TABLES) {
        if (code.includes(table)) offenders.push(`${file}: ${table}`)
      }
    }

    expect(offenders).toEqual([])
  })

  test("the investor ledger is the only source of an investor's balances", async () => {
    const source = await readFile(
      fileURLToPath(new URL("./domain/client/portfolioLedger.ts", import.meta.url)),
      "utf8",
    )
    // Compare code only: the header comment explains what the model replaced.
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "")
    expect(code).not.toMatch(/\bnav\b/iu)
    expect(code).not.toMatch(/\bunits\b/iu)
  })
})
