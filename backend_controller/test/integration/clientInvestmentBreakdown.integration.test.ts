import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { foldInvestmentBreakdown } from "../../src/domain/client/investmentBreakdown.js"
import { indiaCalendarDate } from "../../src/domain/shared/calendarDate.js"
import { loadBreakdownInput } from "../../src/repositories/investmentBreakdownRepository.js"
import { allocationOf, seedGrowthEntry } from "./investmentBreakdownSupport.js"
import { EARLIER, MONTHLY, RecordingCategoryHarness } from "./recordingCategorySupport.js"

interface BreakdownFund {
  readonly fundId: string
  readonly fundName: string
  readonly status: string
  readonly sips: readonly Record<string, unknown>[]
  readonly oneTime: readonly Record<string, unknown>[]
  readonly lines: readonly Record<string, unknown>[]
}

interface BreakdownData {
  readonly asOfDate: string
  readonly funds: readonly BreakdownFund[]
}

const ROUTE = "/v1/client/investment-breakdown"

let harness: RecordingCategoryHarness

beforeAll(async () => {
  harness = await RecordingCategoryHarness.start()
}, 220_000)

afterAll(async () => {
  await harness.stop()
})

const seedSipAndTwoOneTime = async () => {
  const client = await harness.stack.seedUser()
  const fundId = await harness.seedFund("Breakdown Balanced Fund")
  const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)
  const january = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-01-05", reasonCode: MONTHLY })
  const february = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-02-05", reasonCode: MONTHLY })
  expect(
    (
      await harness.linkMonths(client.id, schedule.scheduleId, [
        { month: "2025-01", entryId: january },
        { month: "2025-02", entryId: february },
      ])
    ).statusCode,
  ).toBe(201)
  const first = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-01-20", reasonCode: EARLIER, amountPaise: "2000000" })
  const second = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-03-01", reasonCode: EARLIER, amountPaise: "3000000" })
  expect((await harness.markOneTime(client.id, first)).statusCode).toBe(201)
  expect((await harness.markOneTime(client.id, second)).statusCode).toBe(201)
  const firstAllocation = await allocationOf(harness.stack.pool, first)
  await seedGrowthEntry(harness.stack.pool, {
    userId: client.id,
    fundId,
    actorUserId: harness.finance.userId,
    valuePaise: 45_000n,
    parts: [
      { target: { kind: "sip", scheduleId: schedule.scheduleId }, amountPaise: 5_000n },
      { target: { kind: "one_time", allocationId: firstAllocation }, amountPaise: 40_000n },
    ],
  })
  return { client, fundId, schedule, first, second, firstAllocation }
}

describe("GET /v1/client/investment-breakdown", () => {
  test("returns a ready fund whose SIP and one-time blocks equal the fold and add up to the position", async () => {
    const { client, fundId, schedule, first, second } = await seedSipAndTwoOneTime()

    const data = await harness.clientGet<BreakdownData>(client.id, ROUTE)

    expect(data.asOfDate).toBe(indiaCalendarDate(new Date()))
    expect(data.funds).toHaveLength(1)
    const [fund] = data.funds
    expect(fund).toMatchObject({ fundId, fundName: "Breakdown Balanced Fund", status: "ready", lines: [] })
    expect(fund?.sips).toEqual([
      expect.objectContaining({
        scheduleId: schedule.scheduleId,
        state: "active",
        investedPaise: "1000000",
        valuePaise: "1005000",
        growthPaise: "5000",
        simpleReturnBasisPoints: "50",
        monthsPaid: 2,
        monthsTotal: 12,
      }),
    ])
    expect(fund?.oneTime.map((block) => [block.entryId, block.effectiveDate, block.investedPaise, block.valuePaise, block.reversed])).toEqual([
      [second, "2025-03-01", "3000000", "3000000", false],
      [first, "2025-01-20", "2000000", "2040000", false],
    ])

    const folded = foldInvestmentBreakdown(await loadBreakdownInput(harness.stack.database, client.id), data.asOfDate)[0]
    expect(fund?.sips[0]?.xirrBasisPoints).toBe(folded?.sips[0]?.xirrBasisPoints?.toString() ?? null)
    const total = [...(fund?.sips ?? []), ...(fund?.oneTime ?? [])].reduce((sum, block) => sum + BigInt(String(block.valuePaise)), 0n)
    expect(total).toBe(folded?.positionValuePaise)
    expect(total).toBe(6_045_000n)
  })

  test("never shows another client's funds or investments", async () => {
    const owner = await seedSipAndTwoOneTime()
    const stranger = await harness.stack.seedUser()
    const strangerFund = await harness.seedFund("Stranger Fund")
    await harness.recordOk(stranger.id, { fundId: strangerFund, effectiveDate: "2025-04-01", reasonCode: EARLIER })

    const own = await harness.clientGet<BreakdownData>(stranger.id, ROUTE)

    expect(own.funds.map((fund) => fund.fundId)).toEqual([strangerFund])
    expect(JSON.stringify(own)).not.toContain(owner.fundId)
    expect(JSON.stringify(own)).not.toContain(owner.firstAllocation)
  })

  test("an uncategorised client gets a preparing fund with empty blocks", async () => {
    const client = await harness.stack.seedUser()
    const fundId = await harness.seedFund("Preparing Fund")
    await harness.recordOk(client.id, { fundId, effectiveDate: "2025-04-01", reasonCode: EARLIER })

    const data = await harness.clientGet<BreakdownData>(client.id, ROUTE)

    expect(data.funds).toEqual([{ fundId, fundName: "Preparing Fund", status: "preparing", sips: [], oneTime: [], lines: [] }])
  })
})
