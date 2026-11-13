import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import {
  checkErase,
  envelopeOf,
  erase,
  recordFor,
  seedClient,
  startErasureHarness,
  tableSnapshot,
  userRow,
  type ErasureHarness,
} from "./erasureSupport.js"

interface Check {
  readonly state: string
  readonly blockers: readonly { readonly code: string; readonly count: number }[]
}

let harness: ErasureHarness

const blockerCodes = async (userId: string): Promise<readonly string[]> =>
  envelopeOf<Check>(await checkErase(harness, userId)).data.blockers.map((blocker) => blocker.code).sort()

const refusedWithoutChange = async (userId: string, expectedPath: string, codes: readonly string[]): Promise<void> => {
  const before = await tableSnapshot(harness.stack)
  const refused = await erase(harness, userId, expectedPath)
  expect(refused.statusCode).toBe(409)
  expect(Object.keys(envelopeOf<never>(refused).error.fields ?? {}).sort()).toEqual([...codes].sort())
  expect(await tableSnapshot(harness.stack)).toBe(before)
  expect((await userRow(harness.stack, userId)).pii_tombstoned_at).toBeNull()
}

const hold = async (entityType: string, entityId: string): Promise<string> =>
  String(
    (
      await harness.stack.first(
        "insert into legal_holds (entity_type, entity_id, reason, placed_by) values ($1, $2, 'open dispute with the client', $3) returning id",
        [entityType, entityId, harness.admin.userId],
      )
    ).id,
  )

const release = (holdId: string) =>
  harness.stack.pool.query("update legal_holds set released_at = now(), released_by = $2 where id = $1", [holdId, harness.admin.userId])

beforeAll(async () => {
  harness = await startErasureHarness()
}, 220_000)

afterAll(async () => {
  await harness.app.close()
  await harness.stack.stop()
})

describe("the erasure guard", () => {
  test("refuses while money is held or anything is open, names every reason and changes nothing", async () => {
    const { stack, admin, fundId } = harness
    const client = await seedClient(harness, { verified: true })
    await recordFor(harness, client.id, 250_000n)
    await stack.pool.query(
      "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, created_by_user_id, updated_by_user_id, request_id) " +
        "values ($1, $2, 500000, '2025-01-01', 12, $3, $3, $4)",
      [client.id, fundId, admin.userId, randomUUID()],
    )
    const maturity = await stack.first(
      "insert into client_maturity_schedules (user_id, fund_id, maturity_date, created_by_user_id, updated_by_user_id, request_id) " +
        "values ($1, $2, '2030-01-01', $3, $3, $4) returning id",
      [client.id, fundId, admin.userId, randomUUID()],
    )
    await stack.pool.query(
      "insert into client_maturity_offers (maturity_schedule_id, user_id, fund_id, sip_monthly_amount_paise, sip_start_month, " +
        "sip_month_count, created_by_user_id, request_id) values ($1, $2, $3, 500000, '2030-02-01', 12, $4, $5)",
      [maturity.id, client.id, fundId, admin.userId, randomUUID()],
    )
    await hold("user", client.id)
    const codes = ["active_sip_schedules", "holds_money", "legal_hold", "open_maturity_offers", "scheduled_maturities"]
    expect(await blockerCodes(client.id)).toEqual([...codes].sort())
    await refusedWithoutChange(client.id, "kept_as_record", codes)
  })

  test("refuses while a failed withdrawal payout leaves the client owed money, even at zero balance", async () => {
    const { stack, admin, fundId } = harness
    const client = await seedClient(harness, { verified: true })
    await recordFor(harness, client.id, 100_000n)
    const withdrawal = await stack.first(
      "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
        "reason_code, actor_type, created_by_user_id, request_id) " +
        "values ($1, $2, 'withdrawal', -100000, -100000, '2025-03-01', 'maturity_withdrawal', 'admin', $3, $4) returning id",
      [client.id, fundId, admin.userId, randomUUID()],
    )
    const maturity = await stack.first(
      "insert into client_position_maturities (user_id, fund_id, state, matured_on, principal_at_maturity_paise, value_at_maturity_paise, " +
        "settlement, settled_at, settlement_entry_id, reason_code, marked_by_user_id, request_id) " +
        "values ($1, $2, 'settled', '2025-03-01', 100000, 100000, 'withdrawal', now(), $3, 'matured', $4, $5) returning id",
      [client.id, fundId, withdrawal.id, admin.userId, randomUUID()],
    )
    await stack.pool.query(
      "insert into withdrawal_operations (user_id, fund_id, maturity_id, ledger_entry_id, state, amount_paise, growth_portion_paise, " +
        "principal_portion_paise, effective_date, failed_at, failure_code, reason_code, created_by_user_id, request_id) " +
        "values ($1, $2, $3, $4, 'failed', 100000, 0, 100000, '2025-03-01', now(), 'bank_rejected', 'maturity_withdrawal', $5, $6)",
      [client.id, fundId, maturity.id, withdrawal.id, admin.userId, randomUUID()],
    )
    expect(await blockerCodes(client.id)).toEqual(["failed_withdrawals"])
    await refusedWithoutChange(client.id, "kept_as_record", ["failed_withdrawals"])
  })

  test("refuses while a legal hold sits on the client's application or one of their emails", async () => {
    const client = await seedClient(harness, { verified: false })
    const onApplication = await hold("application", client.rejectedApplicationId)
    expect(await blockerCodes(client.id)).toEqual(["legal_hold"])
    await refusedWithoutChange(client.id, "deleted", ["legal_hold"])
    await release(onApplication)

    const delivery = await harness.stack.first(
      "select id from email_deliveries where user_id = $1 order by created_at limit 1",
      [client.id],
    )
    const onDelivery = await hold("email_delivery", String(delivery.id))
    await refusedWithoutChange(client.id, "deleted", ["legal_hold"])
    await release(onDelivery)
    expect(await blockerCodes(client.id)).toEqual([])
  })

  test("refuses staff accounts and admins without users.close", async () => {
    const staff = await erase(harness, harness.finance.userId, "kept_as_record")
    expect(staff.statusCode).toBe(409)
    expect(envelopeOf<never>(staff).error.fields).toHaveProperty("staff_account")
    expect((await userRow(harness.stack, harness.finance.userId)).pii_tombstoned_at).toBeNull()

    const client = await seedClient(harness, { verified: false })
    expect((await checkErase(harness, client.id, harness.finance)).statusCode).toBe(403)
    expect((await erase(harness, client.id, "deleted", randomUUID(), harness.finance)).statusCode).toBe(403)
    expect(await userRow(harness.stack, client.id)).toHaveProperty("id", client.id)
  })
})
