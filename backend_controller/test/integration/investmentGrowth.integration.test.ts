import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { EARLIER, InvestmentGrowthHarness, MONTHLY, envelopeOf } from "./investmentGrowthSupport.js"

type Ref = Readonly<{ kind: "sip"; scheduleId: string } | { kind: "one_time"; allocationId: string }>
type Part = Readonly<{ ref: Ref; label: string; investedPaise: string; deltaPaise: string; afterPaise: string }>
type Entry = Readonly<{ userId: string; beforePaise: string; deltaPaise: string; afterPaise: string; parts: readonly Part[] }>
type Plan = Readonly<{ basisHash: string; entries: readonly Entry[]; skipped: readonly { userId: string; ref: Ref | null; reason: string }[] }>

const PREVIEW = "/v1/admin/investment-growth/preview"
const COMMIT = "/v1/admin/investment-growth/commit"
const INDIVIDUAL = "/v1/admin/investment-growth/individual"
const WRITE = { effectiveDate: "2026-10-31", reasonCode: "monthly_update" }
const SEVERAL = "Update the admin app to record growth for clients with more than one investment in a fund."

let harness: InvestmentGrowthHarness

beforeAll(async () => {
  harness = await InvestmentGrowthHarness.start()
}, 220_000)

afterAll(async () => {
  await harness.stop()
})

const seedFundClients = async () => {
  const fundId = await harness.seedFund(`Growth Parts Fund ${randomUUID().slice(0, 4)}`)
  const mixed = await harness.stack.seedUser()
  const scheduleId = await harness.sipSchedule(mixed.id, fundId)
  const sipEntries = [
    await harness.recordOk(mixed.id, { fundId, effectiveDate: "2026-01-05", reasonCode: MONTHLY }),
    await harness.recordOk(mixed.id, { fundId, effectiveDate: "2026-02-05", reasonCode: MONTHLY }),
  ]
  await harness.linkMonths(mixed.id, scheduleId, sipEntries)
  const oneTimeEntry = await harness.recordOk(mixed.id, { fundId, effectiveDate: "2026-06-02", reasonCode: EARLIER, amountPaise: "2500000" })
  await harness.markOneTime(mixed.id, oneTimeEntry)
  const single = await harness.stack.seedUser()
  const singleEntry = await harness.recordOk(single.id, { fundId, effectiveDate: "2026-03-10", reasonCode: EARLIER, amountPaise: "1000000" })
  const waiting = await harness.stack.seedUser()
  await harness.recordOk(waiting.id, { fundId, effectiveDate: "2026-03-10", reasonCode: EARLIER })
  await harness.recordOk(waiting.id, { fundId, effectiveDate: "2026-04-10", reasonCode: EARLIER })
  return {
    fundId,
    mixed,
    single,
    waiting,
    sip: { kind: "sip", scheduleId } as const,
    oneTime: { kind: "one_time", allocationId: await harness.allocationOf(oneTimeEntry) } as const,
    singleRef: { kind: "one_time", allocationId: await harness.allocationOf(singleEntry) } as const,
  }
}

const planOf = async (body: Readonly<Record<string, unknown>>): Promise<Plan> => {
  const response = await harness.post(PREVIEW, body, null)
  expect(response.statusCode).toBe(200)
  return envelopeOf<Plan>(response).data
}

const unbalancedEntries = async (): Promise<number> =>
  (
    await harness.stack.pool.query(
      "select e.id from client_value_entries e join client_growth_parts p on p.entry_id = e.id " +
        "group by e.id, e.value_delta_paise having sum(p.amount_paise) <> e.value_delta_paise",
    )
  ).rowCount ?? 0

const growthMail = async (userId: string) =>
  (
    await harness.stack.pool.query<{ id: string; template_version: string }>(
      "select id, template_version from email_deliveries where user_id = $1 and template_key = 'investment_growth' order by created_at",
      [userId],
    )
  ).rows

const sealedOf = async (deliveryId: string): Promise<Record<string, unknown>> => {
  const stored = await harness.stack.payloadRow(deliveryId)
  const opened = harness.stack.crypto.decryptDeliveryPayload(deliveryId, {
    ciphertext: stored.ciphertext as Buffer,
    nonce: stored.nonce as Buffer,
    keyVersion: String(stored.key_version),
  })
  if (opened.kind !== "opened") throw new Error("sealed payload not readable")
  return { ...opened.payload }
}

describe("per-investment growth", () => {
  test("a fund rate writes one entry per client whose parts sum to it, skips a client to categorise, mails v2 once each, and replays", async () => {
    const seeded = await seedFundClients()
    const preview = await planOf({ fundId: seeded.fundId, growthBasisPoints: 150 })

    expect(preview.skipped).toEqual([{ userId: seeded.waiting.id, ref: null, reason: "categorise_first" }])
    const mixedEntry = preview.entries.find((entry) => entry.userId === seeded.mixed.id)
    expect(mixedEntry?.deltaPaise).toBe("52500")
    expect(mixedEntry?.parts.map((part) => [part.ref, part.deltaPaise])).toEqual([
      [seeded.oneTime, "37500"],
      [seeded.sip, "15000"],
    ])
    expect(mixedEntry?.parts[0]?.label).toBe("One-time investment of ₹25,000.00 from 2 June 2026")
    expect(preview.entries.find((entry) => entry.userId === seeded.single.id)?.parts).toMatchObject([{ ref: seeded.singleRef, deltaPaise: "15000" }])

    const before = await harness.growthCounts()
    const key = `commit-${randomUUID()}`
    const body = { fundId: seeded.fundId, growthBasisPoints: 150, basisHash: preview.basisHash, ...WRITE }
    const committed = await harness.post(COMMIT, body, key)
    expect(committed.statusCode).toBe(201)
    const after = await harness.growthCounts()
    expect(after.map((count, index) => count - (before[index] ?? 0))).toEqual([1, 2, 3, 2, 2])
    expect(await unbalancedEntries()).toBe(0)

    const [mail] = await growthMail(seeded.mixed.id)
    expect(mail?.template_version).toBe("v2")
    expect(await sealedOf(mail?.id ?? "")).toMatchObject({
      deltaPaise: "52500",
      valueAfterPaise: "3552500",
      parts: [
        { kind: "one_time", investedPaise: "2500000", effectiveDate: "2026-06-02", deltaPaise: "37500" },
        { kind: "sip", deltaPaise: "15000" },
      ],
    })
    expect(await growthMail(seeded.waiting.id)).toEqual([])

    const replay = await harness.post(COMMIT, body, key)
    expect(replay.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf(replay).data).toEqual(envelopeOf(committed).data)
    const stale = await harness.post(COMMIT, body)
    expect(stale.statusCode).toBe(409)
    expect(await harness.growthCounts()).toEqual(after)
  })

  test("a closed SIP that still holds money keeps taking a fund rate, typed gains and growth for one investor", async () => {
    const seeded = await seedFundClients()
    await harness.closeSchedule(seeded.mixed.id, seeded.sip.scheduleId)

    const rate = await planOf({ fundId: seeded.fundId, growthBasisPoints: 150 })
    expect(rate.entries.find((entry) => entry.userId === seeded.mixed.id)?.parts.map((part) => [part.ref, part.deltaPaise])).toEqual([
      [seeded.oneTime, "37500"],
      [seeded.sip, "15000"],
    ])
    const typed = await planOf({ fundId: seeded.fundId, items: [{ userId: seeded.mixed.id, ref: seeded.sip, gainSinceInvestedPaise: "2000" }] })
    expect(typed.entries[0]?.parts).toMatchObject([{ ref: seeded.sip, deltaPaise: "2000" }])
    const one = await harness.post(INDIVIDUAL, { userId: seeded.mixed.id, fundId: seeded.fundId, ref: seeded.sip, growthPaise: "700", ...WRITE })
    expect(one.statusCode).toBe(201)
    expect(envelopeOf<{ part: Part }>(one).data.part).toMatchObject({ ref: seeded.sip, deltaPaise: "700" })
  })

  test("typed gains refuse a client to categorise at commit and another client's investment, writing nothing", async () => {
    const seeded = await seedFundClients()
    const items = [
      { userId: seeded.mixed.id, ref: seeded.sip, gainSinceInvestedPaise: "20000" },
      { userId: seeded.waiting.id, ref: seeded.singleRef, gainSinceInvestedPaise: "100" },
    ]
    const preview = await planOf({ fundId: seeded.fundId, items })
    expect(preview.entries.map((entry) => [entry.userId, entry.deltaPaise])).toEqual([[seeded.mixed.id, "20000"]])
    expect(preview.skipped).toEqual([{ userId: seeded.waiting.id, ref: null, reason: "categorise_first" }])

    const before = await harness.growthCounts()
    const blocked = await harness.post(COMMIT, { fundId: seeded.fundId, items, basisHash: preview.basisHash, ...WRITE })
    expect(blocked.statusCode).toBe(409)
    const foreign = await harness.post(PREVIEW, { fundId: seeded.fundId, items: [{ userId: seeded.mixed.id, ref: seeded.singleRef, gainSinceInvestedPaise: "1" }] }, null)
    expect(foreign.statusCode).toBe(400)
    expect(await harness.growthCounts()).toEqual(before)
  })

  test("one investor: a rate on one investment writes one entry with one part, and another client's investment is refused", async () => {
    const seeded = await seedFundClients()
    const before = await harness.growthCounts()
    const foreign = await harness.post(INDIVIDUAL, { userId: seeded.mixed.id, fundId: seeded.fundId, ref: seeded.singleRef, growthBasisPoints: 100, ...WRITE })
    expect(foreign.statusCode).toBe(400)
    expect(await harness.growthCounts()).toEqual(before)

    const written = await harness.post(INDIVIDUAL, { userId: seeded.mixed.id, fundId: seeded.fundId, ref: seeded.oneTime, growthBasisPoints: 100, ...WRITE })
    expect(written.statusCode).toBe(201)
    expect(envelopeOf<{ deltaPaise: string; part: Part }>(written).data).toMatchObject({
      deltaPaise: "25000",
      afterPaise: "3525000",
      part: { ref: seeded.oneTime, deltaPaise: "25000", investedPaise: "2500000" },
    })
    const after = await harness.growthCounts()
    expect(after.map((count, index) => count - (before[index] ?? 0))).toEqual([1, 1, 1, 1, 1])
    expect(await unbalancedEntries()).toBe(0)
  })

  test("released growth endpoints refuse a fund where the client has more than one investment and allow a single one", async () => {
    const seeded = await seedFundClients()
    const before = await harness.growthCounts()
    const legacy = { growthPaise: "1000", ...WRITE }

    for (const response of [
      await harness.post("/v1/admin/client-growth/individual", { userId: seeded.mixed.id, fundId: seeded.fundId, ...legacy }),
      await harness.post("/v1/admin/client-growth/individual", { userId: seeded.waiting.id, fundId: seeded.fundId, ...legacy }),
      await harness.post("/v1/admin/client-growth/collective/preview", { fundId: seeded.fundId, growthBasisPoints: 100 }, null),
    ]) {
      expect(response.statusCode).toBe(403)
      expect(envelopeOf(response).error).toMatchObject({ code: "AUTHORIZATION_DENIED", message: SEVERAL })
    }
    expect(await harness.growthCounts()).toEqual(before)

    const single = await harness.post("/v1/admin/client-growth/individual", { userId: seeded.single.id, fundId: seeded.fundId, ...legacy })
    expect(single.statusCode).toBe(201)
    expect((await growthMail(seeded.single.id)).map((mail) => mail.template_version)).toEqual(["v1"])
    const collective = await harness.post("/v1/admin/client-growth/collective/preview", {
      fundId: seeded.fundId,
      items: [{ userId: seeded.single.id, growthPaise: "500" }],
    }, null)
    expect(collective.statusCode).toBe(200)
  })
})
