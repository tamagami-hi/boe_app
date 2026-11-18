import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { allocationOf, insertSplit, seedGrowthEntry } from "./investmentBreakdownSupport.js"
import { EARLIER, RecordingCategoryHarness } from "./recordingCategorySupport.js"

let harness: RecordingCategoryHarness

beforeAll(async () => {
  harness = await RecordingCategoryHarness.start()
}, 220_000)

afterAll(async () => {
  await harness.stop()
})

const seedClient = async () => {
  const client = await harness.stack.seedUser()
  const fundId = await harness.seedFund("Schema Balanced Fund")
  const entryId = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-01-10", reasonCode: EARLIER })
  const allocationId = await allocationOf(harness.stack.pool, entryId)
  return { userId: client.id, fundId, entryId, allocationId, actorUserId: harness.finance.userId }
}

const refused = async (work: Promise<unknown>, message: RegExp): Promise<void> => {
  await expect(work).rejects.toThrow(message)
}

describe("migration 078 investment breakdown tables", () => {
  test("a growth part must sit on a growth entry of the same client and fund and sum to it", async () => {
    const owner = await seedClient()
    const other = await seedClient()
    const pool = harness.stack.pool

    await refused(
      pool.query(
        "insert into client_growth_parts (entry_id, user_id, fund_id, target_kind, target_allocation_id, amount_paise) values ($1, $2, $3, 'one_time', $4, 100)",
        [owner.entryId, owner.userId, owner.fundId, owner.allocationId],
      ),
      /growth adjustment entries only/u,
    )
    await refused(
      seedGrowthEntry(pool, { ...owner, valuePaise: 500n, parts: [{ target: { kind: "one_time", allocationId: other.allocationId }, amountPaise: 500n }] }),
      /client_growth_parts_allocation_fk/u,
    )
    await refused(
      seedGrowthEntry(pool, { ...owner, valuePaise: 500n, parts: [{ target: { kind: "one_time", allocationId: owner.allocationId }, amountPaise: 400n }] }),
      /sum to 400, not its 500 paise/u,
    )
    const growthCount = await harness.stack.count("client_value_entries", "user_id = $1 and entry_type = 'growth_adjustment'", [owner.userId])
    expect(growthCount).toBe(0)

    const entryId = await seedGrowthEntry(pool, {
      ...owner,
      valuePaise: 500n,
      parts: [{ target: { kind: "one_time", allocationId: owner.allocationId }, amountPaise: 500n }],
    })
    await refused(pool.query("update client_growth_parts set amount_paise = 1 where entry_id = $1", [entryId]), /append-only/u)
    await refused(pool.query("delete from client_growth_parts where entry_id = $1", [entryId]), /append-only/u)
    await refused(
      pool.query(
        "insert into client_growth_parts (entry_id, user_id, fund_id, target_kind, target_allocation_id, amount_paise) values ($1, $2, $3, 'one_time', $4, 7)",
        [entryId, owner.userId, owner.fundId, owner.allocationId],
      ),
      /client_growth_parts_one_time_uk/u,
    )
  })

  test("an earlier-growth split must balance, cover its cutoff, cover only untargeted growth, and stay append-only", async () => {
    const client = await seedClient()
    const pool = harness.stack.pool
    const target = { kind: "one_time" as const, allocationId: client.allocationId }
    const untargeted = await seedGrowthEntry(pool, { ...client, valuePaise: 900n })
    const targeted = await seedGrowthEntry(pool, { ...client, valuePaise: 100n, parts: [{ target, amountPaise: 100n }] })
    const base = { ...client, cutoffEntryId: untargeted, totalPaise: 900n, entryIds: [untargeted] }

    await refused(insertSplit(pool, { ...base, parts: [{ target, amountPaise: 800n }] }), /does not balance/u)
    await refused(insertSplit(pool, { ...base, totalPaise: 1_000n, entryIds: [untargeted, targeted], parts: [{ target, amountPaise: 1_000n }] }), /untargeted growth/u)
    await refused(insertSplit(pool, { ...base, cutoffEntryId: targeted, parts: [{ target, amountPaise: 900n }] }), /does not cover its cutoff/u)
    expect(await harness.stack.count("client_earlier_growth_splits", "user_id = $1", [client.userId])).toBe(0)

    const splitId = await insertSplit(pool, { ...base, parts: [{ target, amountPaise: 900n }] })
    for (const table of ["client_earlier_growth_splits", "client_earlier_growth_split_parts", "client_earlier_growth_split_entries"]) {
      const column = table === "client_earlier_growth_splits" ? "id" : "split_id"
      await refused(pool.query(`update ${table} set user_id = user_id where ${column} = $1`, [splitId]), /append-only/u)
      await refused(pool.query(`delete from ${table} where ${column} = $1`, [splitId]), /append-only/u)
    }
    await refused(
      pool.query(
        "insert into client_earlier_growth_split_parts (split_id, user_id, fund_id, target_kind, target_sip_schedule_id, target_allocation_id, amount_paise) " +
          "values ($1, $2, $3, 'sip', null, null, 5)",
        [splitId, client.userId, client.fundId],
      ),
      /client_earlier_growth_split_parts_target/u,
    )
  })
})
