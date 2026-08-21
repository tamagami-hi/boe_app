import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

const DELETED_MODULES: readonly string[] = [
  "domain/client/beginPayment.ts",
  "domain/client/bookOrder.ts",
  "domain/client/confirmPayment.ts",
  "domain/client/settlePayment.ts",
  "domain/client/allocateGain.ts",
  "domain/admin/poolGainDistribution.ts",
  "domain/admin/poolGainDistribution.test.ts",
  "domain/client/requestRedemption.ts",
  "domain/client/settleRedemption.ts",
  "domain/client/sip.ts",
  "domain/client/activateMandate.ts",
  "domain/client/generateSipInstallments.ts",
  "repositories/investorLedgerRepository.ts",
  "repositories/redemptionRepository.ts",
  "repositories/mandateRepository.ts",
  "repositories/sipRepository.ts",
  "repositories/paymentRepository.ts",
  "routes/paymentWebhookRoutes.ts",
  "routes/mandateWebhookRoutes.ts",
  "routes/clientSipRoutes.ts",
  "paymentWorker.ts",
  "paymentWorker.test.ts",
  "sipWorker.ts",
  "sipWorker.test.ts",
]

const DROPPED_TABLES: readonly string[] = [
  "fund_aum_updates",
  "investor_ledger_entries",
  "redemption_requests",
  "fund_nav_prices",
  "holding_lots",
  "holding_lot_movements",
  "investment_executions",
  "fund_positions",
  "approval_actions",
]

const CLIENT_FORBIDDEN_FIELDS: readonly string[] = [
  "allocationId",
  "bankVerified",
  "reviewer",
  "privateNote",
]

const listSourceFiles = async (): Promise<readonly string[]> => {
  const root = fileURLToPath(new URL("./", import.meta.url))
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => `${entry.parentPath.slice(root.length)}/${entry.name}`.replace(/^\//u, ""))
}

const codeOf = async (relativePath: string): Promise<string> =>
  (await readFile(fileURLToPath(new URL(`./${relativePath}`, import.meta.url)), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "")

const isPaymentModule = (path: string): boolean =>
  /^repositories\/payment/iu.test(path) ||
  /^routes\/payment/iu.test(path) ||
  /^domain\/[^/]+\/payment/iu.test(path) ||
  /^providers\//u.test(path)

const isAumModule = (path: string): boolean => /aum/iu.test(path)

const isClientGrowthModule = (path: string): boolean =>
  /clientGrowth/iu.test(path) || /client_growth/iu.test(path)

describe("investment architecture guard", () => {
  test.each(DELETED_MODULES)("%s remains deleted", (relativePath) => {
    const absolutePath = fileURLToPath(new URL(`./${relativePath}`, import.meta.url))
    expect(existsSync(absolutePath)).toBe(false)
  })

  test("no module references a dropped table", async () => {
    const files = await listSourceFiles()
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(".test.ts")) continue
      const code = await codeOf(file)
      for (const table of DROPPED_TABLES) {
        if (code.includes(table)) offenders.push(`${file}: ${table}`)
      }
      if (file === "db/seedContent.ts") continue
      if (/\bholdings\b/u.test(code)) offenders.push(`${file}: holdings`)
      if (/\bmandates\b/u.test(code)) offenders.push(`${file}: mandates`)
    }

    expect(offenders).toEqual([])
  })

  test("client route serializers never leak admin-only review fields", async () => {
    const files = await listSourceFiles()
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(".test.ts")) continue
      if (!/^routes\/client/iu.test(file)) continue
      const code = await codeOf(file)
      for (const field of CLIENT_FORBIDDEN_FIELDS) {
        if (code.includes(field)) offenders.push(`${file}: ${field}`)
      }
    }

    expect(offenders).toEqual([])
  })

  test("the §4.1 dependency walls hold: payments, AUM, and client growth stay separate", async () => {
    const files = await listSourceFiles()
    const offenders: string[] = []

    for (const file of files) {
      if (file.endsWith(".test.ts")) continue
      const code = await codeOf(file)
      if (isPaymentModule(file)) {
        if (/aum|clientValue|client_value|growth/iu.test(code)) offenders.push(`${file}: payment -> aum/value/growth`)
      } else if (isAumModule(file)) {
        if (/payment|review|allocation|clientValue|client_value/iu.test(code)) {
          offenders.push(`${file}: aum -> payment/review/allocation/client_value`)
        }
      } else if (isClientGrowthModule(file)) {
        if (/aum/iu.test(code)) offenders.push(`${file}: client growth -> aum`)
      }
    }

    expect(offenders).toEqual([])
  })

  test("both batch-growth orchestrations keep the same commit invariants", async () => {
    const modules = ["routes/adminAumRoutes.ts", "routes/adminClientGrowthRoutes.ts"]
    for (const file of modules) {
      const code = await codeOf(file)
      expect(code, `${file} must recompute the basis hash under lock`).toMatch(/computeAum\w*BasisHash|compute\w*BasisHash/u)
      expect(code, `${file} must compare the recomputed hash to the caller's`).toMatch(/basisHash !== body\.basisHash/u)
      expect(code, `${file} must require an Idempotency-Key`).toMatch(/requireIdempotencyKey/u)
      expect(code, `${file} must commit inside one transaction`).toMatch(/runAdminMutation|unitOfWork\.execute/u)
    }
  })

  test("the portfolio derivation is the only source of an investor's balances", async () => {
    const code = await codeOf("domain/client/portfolioLedger.ts")
    expect(code).not.toMatch(/\bnav\b/iu)
    expect(code).not.toMatch(/\bunits\b/iu)
  })
})
