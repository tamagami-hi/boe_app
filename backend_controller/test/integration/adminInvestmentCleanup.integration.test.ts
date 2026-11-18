import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { adminHeaders } from "./adminSessionSupport.js"
import { allocationOf, seedGrowthEntry } from "./investmentBreakdownSupport.js"
import { CORRECTION, EARLIER, MONTHLY, RecordingCategoryHarness, envelopeOf } from "./recordingCategorySupport.js"

type Ref = Readonly<{ kind: "sip"; scheduleId: string } | { kind: "one_time"; allocationId: string }>
type Part = Readonly<{ ref: Ref; amountPaise: string }>

interface EarlierGrowth {
  readonly totalPaise: string
  readonly cutoffEntryId: string
  readonly needsConfirmation: boolean
  readonly proposal: readonly Part[]
  readonly confirmed: { readonly splitId: string; readonly parts: readonly Part[] } | null
}

interface InvestmentsFund {
  readonly fundId: string
  readonly status: string
  readonly investments: readonly { readonly ref: Ref; readonly label: string; readonly amountPaise: string }[]
  readonly uncategorised: readonly { readonly entryId: string; readonly reasonLabel: string }[]
  readonly earlierGrowth: EarlierGrowth | null
}

interface WaitingItem {
  readonly userId: string
  readonly waitingRecordings: number
  readonly fundsNeedingSplit: number
}

const WRITE_TABLES = ["client_earlier_growth_splits", "client_earlier_growth_split_parts", "audit_events", "email_deliveries"] as const

let harness: RecordingCategoryHarness

beforeAll(async () => {
  harness = await RecordingCategoryHarness.start()
}, 220_000)

afterAll(async () => {
  await harness.stop()
})

const writeCounts = (): Promise<number[]> => Promise.all(WRITE_TABLES.map((table) => harness.stack.count(table)))

const adminGet = async <T>(url: string): Promise<T> => {
  const response = await harness.app.inject({ method: "GET", url, headers: adminHeaders(harness.finance) })
  expect(response.statusCode).toBe(200)
  return envelopeOf<T>(response).data
}

const investmentsOf = async (userId: string, fundId: string): Promise<InvestmentsFund | undefined> =>
  (await adminGet<{ funds: InvestmentsFund[] }>(`/v1/admin/clients/${userId}/investments`)).funds.find((fund) => fund.fundId === fundId)

interface WaitingPage {
  readonly items: readonly WaitingItem[]
  readonly nextCursor: string | null
}

const waitingPage = async (after: string | null): Promise<WaitingPage> => {
  const response = await harness.app.inject({
    method: "GET",
    url: `/v1/admin/investments/to-categorise?limit=100${after === null ? "" : `&after=${after}`}`,
    headers: adminHeaders(harness.finance),
  })
  expect(response.statusCode).toBe(200)
  const body = response.json<{ data: { items: WaitingItem[] }; meta: { page: { nextCursor: string | null } } }>()
  return { items: body.data.items, nextCursor: body.meta.page.nextCursor }
}

const waitingOf = async (userId: string): Promise<WaitingItem | undefined> => {
  const items: WaitingItem[] = []
  let page = await waitingPage(null)
  items.push(...page.items)
  while (page.nextCursor !== null) {
    page = await waitingPage(page.nextCursor)
    items.push(...page.items)
  }
  return items.find((item) => item.userId === userId)
}

const confirm = (userId: string, fundId: string, body: Readonly<{ cutoffEntryId: string; parts: readonly Part[] }>, key = `split-${randomUUID()}`) =>
  harness.app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/funds/${fundId}/earlier-growth-split`,
    headers: adminHeaders(harness.finance, key),
    payload: body,
  })

const seedTwoOneTimeWithGrowth = async () => {
  const client = await harness.stack.seedUser()
  const fundId = await harness.seedFund("Cleanup Balanced Fund")
  const first = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-01-10", reasonCode: EARLIER, amountPaise: "1000000" })
  const second = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-02-10", reasonCode: EARLIER, amountPaise: "2000000" })
  expect((await harness.markOneTime(client.id, first)).statusCode).toBe(201)
  expect((await harness.markOneTime(client.id, second)).statusCode).toBe(201)
  const growth = (valuePaise: bigint) =>
    seedGrowthEntry(harness.stack.pool, { userId: client.id, fundId, actorUserId: harness.finance.userId, valuePaise })
  const g1 = await growth(30_001n)
  return { client, fundId, first, second, growth, g1 }
}

describe("admin investment clean-up", () => {
  test("proposes an exact split by value, confirms it idempotently without email, and resolves the client", async () => {
    const { client, fundId, first, g1 } = await seedTwoOneTimeWithGrowth()
    expect(await waitingOf(client.id)).toMatchObject({ waitingRecordings: 0, fundsNeedingSplit: 1 })

    const fund = await investmentsOf(client.id, fundId)
    expect(fund?.status).toBe("preparing")
    expect(fund?.earlierGrowth).toMatchObject({ totalPaise: "30001", cutoffEntryId: g1, needsConfirmation: true, confirmed: null })
    const proposal = fund?.earlierGrowth?.proposal ?? []
    expect(proposal.reduce((sum, part) => sum + BigInt(part.amountPaise), 0n)).toBe(30_001n)
    const firstAllocation = await allocationOf(harness.stack.pool, first)
    expect(proposal.find((part) => part.ref.kind === "one_time" && part.ref.allocationId === firstAllocation)?.amountPaise).toBe("10000")

    const before = await writeCounts()
    const key = `split-${randomUUID()}`
    const body = { cutoffEntryId: g1, parts: proposal }
    const confirmed = await confirm(client.id, fundId, body, key)
    expect(confirmed.statusCode).toBe(201)
    const replay = await confirm(client.id, fundId, body, key)
    expect(replay.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf(replay).data).toEqual(envelopeOf(confirmed).data)
    const reused = await confirm(client.id, fundId, { cutoffEntryId: g1, parts: [...proposal].reverse().map((part, index) => ({ ...part, amountPaise: index === 0 ? String(BigInt(part.amountPaise) + 1n) : String(BigInt(part.amountPaise) - 1n) })) }, key)
    expect(envelopeOf(reused).error.code).toBe("IDEMPOTENCY_KEY_REUSED")

    const [splits, parts, audits, mail] = await writeCounts()
    expect([splits, parts, audits, mail]).toEqual([(before[0] ?? 0) + 1, (before[1] ?? 0) + 2, (before[2] ?? 0) + 1, before[3]])
    expect(await waitingOf(client.id)).toBeUndefined()
    const resolved = await investmentsOf(client.id, fundId)
    expect(resolved?.status).toBe("ready")
    expect(resolved?.earlierGrowth?.needsConfirmation).toBe(false)
    expect(resolved?.earlierGrowth?.confirmed?.parts).toEqual(proposal)
  })

  test("refuses a split whose cutoff went stale or whose parts do not add up, writing nothing", async () => {
    const { client, fundId, first, second, growth, g1 } = await seedTwoOneTimeWithGrowth()
    const opened = await investmentsOf(client.id, fundId)
    const proposal = opened?.earlierGrowth?.proposal ?? []
    const before = await writeCounts()

    const firstRef = { kind: "one_time" as const, allocationId: await allocationOf(harness.stack.pool, first) }
    const secondRef = { kind: "one_time" as const, allocationId: await allocationOf(harness.stack.pool, second) }
    const wrongSum = await confirm(client.id, fundId, { cutoffEntryId: g1, parts: [{ ref: firstRef, amountPaise: "10000" }, { ref: secondRef, amountPaise: "20000" }] })
    expect(wrongSum.statusCode).toBe(400)
    expect(Object.keys(envelopeOf(wrongSum).error.fields ?? {})).toEqual(["parts"])

    await growth(500n)
    const stale = await confirm(client.id, fundId, { cutoffEntryId: g1, parts: proposal })
    expect(stale.statusCode).toBe(409)
    expect(envelopeOf(stale).error.code).toBe("STATE_CONFLICT")

    expect(await writeCounts()).toEqual(before)
    expect(await waitingOf(client.id)).toMatchObject({ fundsNeedingSplit: 1 })
  })

  test("accepts a zero part for an investment the proposal leaves out and stores only the non-zero parts", async () => {
    const { client, fundId, g1 } = await seedTwoOneTimeWithGrowth()
    const later = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-03-10", reasonCode: EARLIER, amountPaise: "500000" })
    expect((await harness.markOneTime(client.id, later)).statusCode).toBe(201)
    const laterRef = { kind: "one_time" as const, allocationId: await allocationOf(harness.stack.pool, later) }
    const opened = await investmentsOf(client.id, fundId)
    expect(opened?.investments.map((row) => row.ref)).toContainEqual(laterRef)
    const proposal = opened?.earlierGrowth?.proposal ?? []
    expect(proposal.map((part) => part.ref)).not.toContainEqual(laterRef)
    expect(proposal).toHaveLength(2)

    const before = await writeCounts()
    const confirmed = await confirm(client.id, fundId, { cutoffEntryId: g1, parts: [...proposal, { ref: laterRef, amountPaise: "0" }] })
    expect(confirmed.statusCode).toBe(201)
    expect(envelopeOf<{ split: { parts: Part[] } }>(confirmed).data.split.parts).toEqual(proposal)
    const [splits, parts] = await writeCounts()
    expect([splits, parts]).toEqual([(before[0] ?? 0) + 1, (before[1] ?? 0) + 2])
    expect((await investmentsOf(client.id, fundId))?.earlierGrowth?.confirmed?.parts).toEqual(proposal)
    expect(await waitingOf(client.id)).toBeUndefined()
  })

  test("the To categorise list and the client's funds agree on which funds need a split", async () => {
    const { client, fundId } = await seedTwoOneTimeWithGrowth()
    const waitingFund = await harness.seedFund("Cleanup Waiting Fund")
    const first = await harness.recordOk(client.id, { fundId: waitingFund, effectiveDate: "2025-01-10", reasonCode: EARLIER, amountPaise: "1000000" })
    const second = await harness.recordOk(client.id, { fundId: waitingFund, effectiveDate: "2025-02-10", reasonCode: EARLIER, amountPaise: "2000000" })
    expect((await harness.markOneTime(client.id, first)).statusCode).toBe(201)
    expect((await harness.markOneTime(client.id, second)).statusCode).toBe(201)
    await seedGrowthEntry(harness.stack.pool, { userId: client.id, fundId: waitingFund, actorUserId: harness.finance.userId, valuePaise: 12_345n })
    await harness.recordOk(client.id, { fundId: waitingFund, effectiveDate: "2025-03-10", reasonCode: CORRECTION })

    const funds = (await adminGet<{ funds: InvestmentsFund[] }>(`/v1/admin/clients/${client.id}/investments`)).funds
    expect(funds.find((fund) => fund.fundId === waitingFund)?.uncategorised).toHaveLength(1)
    expect(funds.filter((fund) => fund.earlierGrowth?.needsConfirmation === true).map((fund) => fund.fundId)).toEqual([fundId])
    expect(await waitingOf(client.id)).toMatchObject({ waitingRecordings: 1, fundsNeedingSplit: 1 })
  })

  test("a correction can be marked one-time or linked to a SIP month, and a linked one cannot be marked one-time", async () => {
    const client = await harness.stack.seedUser()
    const fundId = await harness.seedFund("Correction Fund")
    const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)
    const monthly = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-01-05", reasonCode: MONTHLY })
    const oneTimeCorrection = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-01-20", reasonCode: CORRECTION })
    const sipCorrection = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-02-05", reasonCode: CORRECTION })
    expect((await investmentsOf(client.id, fundId))?.uncategorised.map((row) => [row.entryId, row.reasonLabel])).toEqual([
      [monthly, "Monthly investment"],
      [oneTimeCorrection, "Correction"],
      [sipCorrection, "Correction"],
    ])
    expect(await waitingOf(client.id)).toMatchObject({ waitingRecordings: 3 })
    const mailBefore = await harness.stack.count("email_deliveries", "user_id = $1", [client.id])

    expect((await harness.markOneTime(client.id, oneTimeCorrection)).statusCode).toBe(201)
    const linked = await harness.linkMonths(client.id, schedule.scheduleId, [
      { month: "2025-01", entryId: monthly },
      { month: "2025-02", entryId: sipCorrection },
    ])
    expect(linked.statusCode).toBe(201)
    const refused = await harness.markOneTime(client.id, sipCorrection)
    expect(refused.statusCode).toBe(409)
    expect(envelopeOf(refused).error.code).toBe("STATE_CONFLICT")

    const recordings = await harness.recordings(client.id, fundId)
    expect(recordings.find((row) => row.entryId === oneTimeCorrection)).toMatchObject({ category: "one_time" })
    expect(recordings.find((row) => row.entryId === sipCorrection)).toMatchObject({ category: "sip", sipMonth: "2025-02" })
    expect(await harness.stack.count("email_deliveries", "user_id = $1", [client.id])).toBe(mailBefore)
    expect(await waitingOf(client.id)).toBeUndefined()
    expect((await investmentsOf(client.id, fundId))?.status).toBe("ready")
  })
})
