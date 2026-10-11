import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import type { CompleteIdempotencyInput, IdempotencyRepository, Transaction } from "../db/repositories.js"
import { resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { recordContribution } from "../domain/admin/recordContribution.js"
import { createApplication } from "../runtime/application.js"
import {
  registerAdminClientPositionRoutes,
  type AdminClientPositionDeps,
} from "./adminClientPositionRoutes.js"

vi.mock("../domain/admin/adminAccess.js", () => ({
  resolveAdminPrincipal: vi.fn(),
  requireAnyPermission: vi.fn(),
}))
vi.mock("../domain/admin/recordContribution.js", () => ({ recordContribution: vi.fn() }))

interface Envelope {
  readonly data: Record<string, unknown> | null
  readonly error: { readonly code: string; readonly fields?: Record<string, readonly string[]> } | null
}

const NOW = new Date("2026-10-11T09:30:00.000Z")
const CLIENT_ID = "3f1c2a54-8d3e-4b7a-9c61-5e2d7f0a1b94"
const FUND_ID = "7a9d4c1e-2b6f-4e83-8a15-0c3e9f7b2d46"
const SIGNED_BIGINT_MAX = 2n ** 63n - 1n
const VALID_BODY = {
  fundId: FUND_ID,
  amountPaise: "500000",
  effectiveDate: "2025-12-01",
  reasonCode: "recorded_offline_investment",
}

const idempotencyRepository: IdempotencyRepository = {
  tryAcquireTransactionLock: () => Promise.resolve(true),
  findCompleted: () => Promise.resolve(null),
  hasExpiredRecord: () => Promise.resolve(false),
  insertCompleted: (_tx: Transaction, input: CompleteIdempotencyInput) =>
    Promise.resolve({
      request_hash: input.requestHash,
      response_status: input.responseStatus,
      response_body: input.responseBody,
      expires_at: new Date(input.expiresAt),
    } as never),
}

let app: FastifyInstance
let keySequence = 0

const post = async (payload: object) => {
  keySequence += 1
  const response = await app.inject({
    method: "POST",
    url: `/v1/admin/clients/${CLIENT_ID}/recorded-contributions`,
    headers: { "idempotency-key": `contribution-validation-${String(keySequence)}` },
    payload,
  })
  return { status: response.statusCode, envelope: response.json<Envelope>() }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveAdminPrincipal).mockResolvedValue({ userId: "admin-1" } as unknown as Awaited<
    ReturnType<typeof resolveAdminPrincipal>
  >)
  vi.mocked(recordContribution).mockResolvedValue({
    entryId: "d4a8b2c6-1e5f-4a73-9b0d-6c2e8f4a1b35",
    orderId: "e5b9c3d7-2f60-4b84-8c1e-7d3f9a5b2c46",
    paymentId: "f6c0d4e8-3a71-4c95-9d2f-8e4a0b6c3d57",
    allocationId: "a7d1e5f9-4b82-4da6-8e30-9f5b1c7d4e68",
    fundVersionId: "b8e2f6a0-5c93-4eb7-9f41-0a6c2d8e5f79",
    fundVersionHistorical: true,
    principalPaise: 500000n,
    currentValuePaise: 500000n,
  })
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminClientPositionRoutes(instance, {
        unitOfWork: { execute: (work: (tx: unknown) => Promise<unknown>) => work({}) },
        idempotencyRepository,
        clock: () => NOW,
        webAuth: {},
        config: { idempotencyTtlMs: 86_400_000 },
      } as unknown as AdminClientPositionDeps)
    },
  })
})

afterEach(async () => {
  await app.close()
})

describe("recorded contribution effective date", () => {
  test.each([
    { date: "2025-02-29", why: "2025 is not a leap year" },
    { date: "1900-02-29", why: "a century year not divisible by 400 is not a leap year" },
    { date: "2026-02-30", why: "February never has 30 days" },
    { date: "2025-04-31", why: "April has 30 days" },
    { date: "2025-06-31", why: "June has 30 days" },
    { date: "2025-09-31", why: "September has 30 days" },
    { date: "2025-11-31", why: "November has 30 days" },
    { date: "2025-13-01", why: "there is no thirteenth month" },
    { date: "2025-00-10", why: "there is no month zero" },
    { date: "2025-01-00", why: "there is no day zero" },
    { date: "2025-01-32", why: "no month has 32 days" },
  ])("rejects $date because $why, before writing anything", async ({ date }) => {
    const result = await post({ ...VALID_BODY, effectiveDate: date })

    expect(result.status).toBe(400)
    expect(result.envelope.error?.code).toBe("VALIDATION_FAILED")
    expect(result.envelope.error?.fields?.effectiveDate).toBeDefined()
    expect(recordContribution).not.toHaveBeenCalled()
  })

  test.each([
    { date: "2024-02-29", why: "2024 is a leap year" },
    { date: "2000-02-29", why: "a century year divisible by 400 is a leap year" },
    { date: "2025-12-31", why: "December has 31 days" },
  ])("accepts $date because $why", async ({ date }) => {
    const result = await post({ ...VALID_BODY, effectiveDate: date })

    expect(result.status).toBe(201)
    expect(recordContribution).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordContribution).mock.calls[0]?.[2]).toMatchObject({ effectiveDate: date })
  })

  test("still rejects a real date after today", async () => {
    const result = await post({ ...VALID_BODY, effectiveDate: "2026-10-12" })

    expect(result.status).toBe(400)
    expect(result.envelope.error?.code).toBe("VALIDATION_FAILED")
    expect(recordContribution).not.toHaveBeenCalled()
  })
})

describe("recorded contribution amount", () => {
  test("accepts the largest amount a signed 64-bit ledger column can hold", async () => {
    const result = await post({ ...VALID_BODY, amountPaise: SIGNED_BIGINT_MAX.toString() })

    expect(result.status).toBe(201)
    expect(vi.mocked(recordContribution).mock.calls[0]?.[2]).toMatchObject({ amountPaise: SIGNED_BIGINT_MAX })
  })

  test.each([
    { amount: (SIGNED_BIGINT_MAX + 1n).toString(), why: "one paisa beyond the signed 64-bit maximum" },
    { amount: "9999999999999999999", why: "the largest 19-digit value" },
    { amount: "0", why: "zero is not an investment" },
    { amount: "-500000", why: "a negative amount is not an investment" },
    { amount: "0500000", why: "a leading zero is not canonical paise" },
    { amount: "5000.50", why: "paise are whole numbers" },
    { amount: "1e6", why: "exponent notation is not paise" },
  ])("rejects $amount because $why, before writing anything", async ({ amount }) => {
    const result = await post({ ...VALID_BODY, amountPaise: amount })

    expect(result.status).toBe(400)
    expect(result.envelope.error?.code).toBe("VALIDATION_FAILED")
    expect(result.envelope.error?.fields?.amountPaise).toBeDefined()
    expect(recordContribution).not.toHaveBeenCalled()
  })
})
