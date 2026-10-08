import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import type {
  CompleteIdempotencyInput,
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyScope,
  Transaction,
} from "../db/repositories.js"
import { resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { createClientAccount } from "../domain/admin/createClientAccount.js"
import { recordContribution } from "../domain/admin/recordContribution.js"
import { reverseLedgerEntry } from "../domain/admin/reverseLedgerEntry.js"
import { createApplication } from "../runtime/application.js"
import {
  registerAdminClientOnboardingRoutes,
  type AdminClientOnboardingDeps,
} from "./adminClientOnboardingRoutes.js"
import {
  registerAdminClientPositionRoutes,
  type AdminClientPositionDeps,
} from "./adminClientPositionRoutes.js"
import { sendPasswordInvite } from "./passwordRoutes.js"

vi.mock("../domain/admin/adminAccess.js", () => ({
  resolveAdminPrincipal: vi.fn(),
  requireAnyPermission: vi.fn(),
}))
vi.mock("../domain/admin/createClientAccount.js", () => ({ createClientAccount: vi.fn() }))
vi.mock("../domain/admin/recordContribution.js", () => ({ recordContribution: vi.fn() }))
vi.mock("../domain/admin/reverseLedgerEntry.js", () => ({ reverseLedgerEntry: vi.fn() }))
vi.mock("./passwordRoutes.js", () => ({ sendPasswordInvite: vi.fn() }))

interface StoredReceipt {
  readonly requestHash: Uint8Array
  readonly status: number
  readonly body: unknown
  readonly expiresAt: Date
}

class InMemoryIdempotencyRepository implements IdempotencyRepository {
  readonly receipts = new Map<string, StoredReceipt>()

  constructor(private readonly now: () => Date) {}

  private static identity(scope: IdempotencyScope): string {
    return [scope.actorScope, scope.method, scope.routeTemplate, scope.key].join("|")
  }

  private static record(receipt: StoredReceipt): IdempotencyRecord {
    return {
      request_hash: receipt.requestHash,
      response_status: receipt.status,
      response_body: receipt.body,
      expires_at: receipt.expiresAt,
    } as unknown as IdempotencyRecord
  }

  tryAcquireTransactionLock(): Promise<boolean> {
    return Promise.resolve(true)
  }

  findCompleted(_tx: Transaction, scope: IdempotencyScope): Promise<IdempotencyRecord | null> {
    const receipt = this.receipts.get(InMemoryIdempotencyRepository.identity(scope))
    if (receipt === undefined || receipt.expiresAt <= this.now()) return Promise.resolve(null)
    return Promise.resolve(InMemoryIdempotencyRepository.record(receipt))
  }

  hasExpiredRecord(_tx: Transaction, scope: IdempotencyScope): Promise<boolean> {
    const receipt = this.receipts.get(InMemoryIdempotencyRepository.identity(scope))
    return Promise.resolve(receipt !== undefined && receipt.expiresAt <= this.now())
  }

  insertCompleted(_tx: Transaction, input: CompleteIdempotencyInput): Promise<IdempotencyRecord> {
    const identity = InMemoryIdempotencyRepository.identity(input.scope)
    if (this.receipts.has(identity)) {
      return Promise.reject(new Error("duplicate key value violates unique constraint idempotency_records_scope_uk"))
    }
    const receipt: StoredReceipt = {
      requestHash: input.requestHash,
      status: input.responseStatus,
      body: JSON.parse(JSON.stringify(input.responseBody)) as unknown,
      expiresAt: new Date(input.expiresAt),
    }
    this.receipts.set(identity, receipt)
    return Promise.resolve(InMemoryIdempotencyRepository.record(receipt))
  }
}

interface Envelope {
  readonly ok: boolean
  readonly data: Record<string, unknown> | null
  readonly error: { readonly code: string; readonly retryable: boolean } | null
  readonly meta: { readonly idempotencyReplay?: boolean }
}

const T0 = Date.parse("2026-01-01T00:00:00.000Z")
const DAY_MS = 86_400_000
const WINDOW_MS = DAY_MS
const JUST_INSIDE_WINDOW_MS = WINDOW_MS - 1
const JUST_PAST_WINDOW_MS = WINDOW_MS + 1
const A_YEAR_PAST_WINDOW_MS = WINDOW_MS + 400 * DAY_MS

const CLIENT_ID = "3f1c2a54-8d3e-4b7a-9c61-5e2d7f0a1b94"
const FUND_ID = "7a9d4c1e-2b6f-4e83-8a15-0c3e9f7b2d46"
const LEDGER_ENTRY_ID = "b2e8f6a0-5c47-4d19-b3a2-9e1f6d8c0a57"
const REVERSAL_ENTRY_ID = "c9d3e7f1-6a28-4b50-8e4c-1f7a2b9d3c68"
const INVITE_TOKEN = "invite-secret-token-9d41"

const CREATE_CLIENT = {
  url: "/v1/admin/clients",
  key: "create-client-0001",
  payload: { fullName: "Asha Verma", email: "asha.verma@example.com", phone: "+919876543210" },
}
const RECORD_CONTRIBUTION = {
  url: `/v1/admin/clients/${CLIENT_ID}/recorded-contributions`,
  key: "record-contribution-0001",
  payload: { fundId: FUND_ID, amountPaise: "500000", effectiveDate: "2025-12-01", reasonCode: "earlier_investment" },
}
const REVERSE_ENTRY = {
  url: `/v1/admin/clients/${CLIENT_ID}/ledger-entries/${LEDGER_ENTRY_ID}/reversal`,
  key: "reverse-entry-0001",
  payload: { reasonCode: "entered_in_error" },
}

let nowMs = T0
let repository: InMemoryIdempotencyRepository
let app: FastifyInstance

const clock = (): Date => new Date(nowMs)
const unitOfWork = { execute: (work: (tx: unknown) => Promise<unknown>) => work({}) }

const buildApp = (): FastifyInstance =>
  createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminClientOnboardingRoutes(instance, {
        unitOfWork,
        idempotencyRepository: repository,
        clock,
        webAuth: {},
        emailSender: { send: vi.fn() },
        config: { idempotencyTtlMs: WINDOW_MS, resetUrlBase: null, supportAddress: null },
      } as unknown as AdminClientOnboardingDeps)
      registerAdminClientPositionRoutes(instance, {
        unitOfWork,
        idempotencyRepository: repository,
        clock,
        webAuth: {},
        config: { idempotencyTtlMs: WINDOW_MS },
      } as unknown as AdminClientPositionDeps)
    },
  })

const post = async (operation: { url: string; key: string }, payload: object) => {
  const response = await app.inject({
    method: "POST",
    url: operation.url,
    headers: { "idempotency-key": operation.key },
    payload,
  })
  return { status: response.statusCode, envelope: response.json<Envelope>() }
}

beforeEach(() => {
  vi.resetAllMocks()
  nowMs = T0
  repository = new InMemoryIdempotencyRepository(clock)
  vi.mocked(resolveAdminPrincipal).mockResolvedValue({ userId: "admin-1" } as unknown as Awaited<
    ReturnType<typeof resolveAdminPrincipal>
  >)
  vi.mocked(createClientAccount).mockResolvedValue({
    userId: CLIENT_ID,
    invite: {
      userId: CLIENT_ID,
      email: CREATE_CLIENT.payload.email,
      rawToken: INVITE_TOKEN,
      expiresAt: new Date(T0 + 7 * DAY_MS),
      purpose: "set",
    },
  })
  vi.mocked(recordContribution).mockResolvedValue({
    entryId: "d4a8b2c6-1e5f-4a73-9b0d-6c2e8f4a1b35",
    orderId: "e5b9c3d7-2f60-4b84-8c1e-7d3f9a5b2c46",
    paymentId: "f6c0d4e8-3a71-4c95-9d2f-8e4a0b6c3d57",
    allocationId: "a7d1e5f9-4b82-4da6-8e30-9f5b1c7d4e68",
    fundVersionId: "b8e2f6a0-5c93-4eb7-9f41-0a6c2d8e5f79",
    fundVersionHistorical: false,
    principalPaise: 500000n,
    currentValuePaise: 500000n,
  })
  vi.mocked(reverseLedgerEntry).mockResolvedValue({
    reversalEntryId: REVERSAL_ENTRY_ID,
    reversedEntryId: LEDGER_ENTRY_ID,
    fundId: FUND_ID,
    effectiveDate: "2025-12-01",
    principalDeltaPaise: -500000n,
    valueDeltaPaise: -500000n,
    principalPaise: 0n,
    currentValuePaise: 0n,
  })
  app = buildApp()
})

afterEach(async () => {
  await app.close()
})

describe.each([
  {
    name: "client creation",
    operation: CREATE_CLIENT,
    changedPayload: { ...CREATE_CLIENT.payload, fullName: "Asha V Verma" },
    mutation: createClientAccount,
  },
  {
    name: "recorded contribution",
    operation: RECORD_CONTRIBUTION,
    changedPayload: { ...RECORD_CONTRIBUTION.payload, amountPaise: "500001" },
    mutation: recordContribution,
  },
])("$name receipt", ({ operation, changedPayload, mutation }) => {
  test("is stored once and replays unchanged while the ordinary window is open", async () => {
    const first = await post(operation, operation.payload)
    expect(first.status).toBe(201)
    expect(first.envelope.meta.idempotencyReplay).toBeUndefined()

    nowMs = T0 + JUST_INSIDE_WINDOW_MS
    const retry = await post(operation, operation.payload)

    expect(retry.status).toBe(201)
    expect(retry.envelope.meta.idempotencyReplay).toBe(true)
    expect(retry.envelope.data).toEqual(first.envelope.data)
    expect(mutation).toHaveBeenCalledTimes(1)
  })

  test("rejects the same key with a different body while the ordinary window is open", async () => {
    await post(operation, operation.payload)

    nowMs = T0 + JUST_INSIDE_WINDOW_MS
    const conflicting = await post(operation, changedPayload)

    expect(conflicting.status).toBe(409)
    expect(conflicting.envelope.error?.code).toBe("IDEMPOTENCY_KEY_REUSED")
    expect(mutation).toHaveBeenCalledTimes(1)
  })

  test.each([
    { label: "just past the ordinary window", elapsedMs: JUST_PAST_WINDOW_MS },
    { label: "more than a year later", elapsedMs: A_YEAR_PAST_WINDOW_MS },
  ])("still replays the stored response $label without running the mutation again", async ({ elapsedMs }) => {
    const first = await post(operation, operation.payload)

    nowMs = T0 + elapsedMs
    const retry = await post(operation, operation.payload)

    expect(retry.status).toBe(201)
    expect(retry.envelope.meta.idempotencyReplay).toBe(true)
    expect(retry.envelope.data).toEqual(first.envelope.data)
    expect(mutation).toHaveBeenCalledTimes(1)
  })

  test("still rejects the same key with a different body after the ordinary window", async () => {
    await post(operation, operation.payload)

    nowMs = T0 + JUST_PAST_WINDOW_MS
    const conflicting = await post(operation, changedPayload)

    expect(conflicting.status).toBe(409)
    expect(conflicting.envelope.error?.code).toBe("IDEMPOTENCY_KEY_REUSED")
    expect(mutation).toHaveBeenCalledTimes(1)
  })
})

describe("client creation receipt contents", () => {
  test("keeps the invite token out of the stored receipt and never re-sends the invite on replay", async () => {
    const first = await post(CREATE_CLIENT, CREATE_CLIENT.payload)
    expect(first.envelope.data).toEqual({ userId: CLIENT_ID, accountState: "active", emailVerification: "pending" })

    nowMs = T0 + JUST_PAST_WINDOW_MS
    await post(CREATE_CLIENT, CREATE_CLIENT.payload)

    expect(sendPasswordInvite).toHaveBeenCalledTimes(1)
    expect(JSON.stringify([...repository.receipts.values()])).not.toContain(INVITE_TOKEN)
  })
})

describe("ledger reversal receipt (ordinary retention)", () => {
  test("replays unchanged while the ordinary window is open", async () => {
    const first = await post(REVERSE_ENTRY, REVERSE_ENTRY.payload)
    expect(first.status).toBe(201)

    nowMs = T0 + JUST_INSIDE_WINDOW_MS
    const retry = await post(REVERSE_ENTRY, REVERSE_ENTRY.payload)

    expect(retry.status).toBe(201)
    expect(retry.envelope.meta.idempotencyReplay).toBe(true)
    expect(retry.envelope.data).toEqual(first.envelope.data)
    expect(reverseLedgerEntry).toHaveBeenCalledTimes(1)
  })

  test.each([
    { label: "the same body", payload: REVERSE_ENTRY.payload },
    { label: "a different body", payload: { reasonCode: "client_request" } },
  ])("rejects $label after the ordinary window and does not run the mutation again", async ({ payload }) => {
    await post(REVERSE_ENTRY, REVERSE_ENTRY.payload)

    nowMs = T0 + JUST_PAST_WINDOW_MS
    const late = await post(REVERSE_ENTRY, payload)

    expect(late.status).toBe(409)
    expect(late.envelope.error).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", retryable: false })
    expect(reverseLedgerEntry).toHaveBeenCalledTimes(1)
  })
})
