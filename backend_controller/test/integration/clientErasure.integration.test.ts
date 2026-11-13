import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { adminHeaders } from "./adminSessionSupport.js"
import {
  checkErase,
  clientLogin,
  envelopeOf,
  erase,
  needlesOf,
  readableCopies,
  recordFor,
  reverseEntry,
  rowsMentioningId,
  seedClient,
  startErasureHarness,
  tableSnapshot,
  userRow,
  type ErasureHarness,
} from "./erasureSupport.js"

interface Check {
  readonly state: string
  readonly path: string | null
  readonly keptBecause: string | null
  readonly emailVerified: boolean | null
  readonly blockers: readonly { readonly code: string; readonly count: number }[]
}

interface Outcome {
  readonly userId: string
  readonly outcome: string
  readonly path: string
  readonly keptBecause: string | null
  readonly erasedAt: string
}

let harness: ErasureHarness

const moneyOf = async (userId: string): Promise<unknown> =>
  (
    await harness.stack.pool.query(
      "select (select json_agg(e order by e.id) from client_value_entries e where e.user_id = $1) as entries, " +
        "(select json_agg(o order by o.id) from investment_orders o where o.user_id = $1) as orders, " +
        "(select json_agg(p order by p.id) from payments p where p.user_id = $1) as payments",
      [userId],
    )
  ).rows

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
    await stack.pool.query("insert into legal_holds (entity_type, entity_id, reason, placed_by) values ('user', $1, 'open dispute with the client', $2)", [
      client.id,
      admin.userId,
    ])

    const check = envelopeOf<Check>(await checkErase(harness, client.id)).data
    expect(check.state).toBe("blocked")
    expect(check.blockers.map((blocker) => blocker.code).sort()).toEqual(
      ["active_sip_schedules", "holds_money", "legal_hold", "open_maturity_offers", "scheduled_maturities"].sort(),
    )

    const before = await tableSnapshot(stack)
    const refused = await erase(harness, client.id, "kept_as_record")
    expect(refused.statusCode).toBe(409)
    expect(Object.keys(envelopeOf<never>(refused).error.fields ?? {}).sort()).toEqual(
      ["active_sip_schedules", "holds_money", "legal_hold", "open_maturity_offers", "scheduled_maturities"].sort(),
    )
    expect(await tableSnapshot(stack)).toBe(before)
    expect((await userRow(stack, client.id)).pii_tombstoned_at).toBeNull()
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

describe("a verified client is kept as a record without contact details", () => {
  test("overwrites every copy of the email, phone and name, keeps the money history and frees the contacts", async () => {
    const { stack, admin } = harness
    const client = await seedClient(harness, { verified: true })
    const recorded = await recordFor(harness, client.id, 120_000n)
    await reverseEntry(harness, client.id, recorded.entryId, 120_000n)
    const session = await clientLogin(harness, client.email)
    expect(session.statusCode).toBe(200)
    const ledger = await stack.pool.query("select * from client_value_entries where user_id = $1 order by created_at", [client.id])

    const check = envelopeOf<Check>(await checkErase(harness, client.id)).data
    expect(check).toMatchObject({ state: "erasable", path: "kept_as_record", keptBecause: "email_verified", emailVerified: true })

    const response = await erase(harness, client.id, "kept_as_record")
    expect(response.statusCode).toBe(200)
    expect(envelopeOf<Outcome>(response).data).toMatchObject({ outcome: "erased", path: "kept_as_record", keptBecause: "email_verified" })

    expect(await readableCopies(stack, needlesOf(client))).toEqual([])
    const user = await userRow(stack, client.id)
    expect(user).toMatchObject({ account_state: "closed", full_name: "Tombstoned", nominee_name: null })
    expect(user.pii_tombstoned_at).not.toBeNull()
    expect((await stack.pool.query("select * from client_value_entries where user_id = $1 order by created_at", [client.id])).rows).toEqual(
      ledger.rows,
    )
    expect(await stack.count("auth_sessions", "user_id = $1 and state = 'active'", [client.id])).toBe(0)
    expect(await stack.count("email_deliveries", "user_id = $1 and recipient_ciphertext is not null", [client.id])).toBe(0)
    expect(await stack.count("email_deliveries", "user_id = $1 and state = 'queued'", [client.id])).toBe(0)
    expect(
      await stack.count(
        "email_delivery_payloads",
        "ciphertext is not null and email_delivery_id in (select id from email_deliveries where user_id = $1)",
        [client.id],
      ),
    ).toBe(0)
    expect(await stack.count("password_credential_tokens", "user_id = $1 and consumed_at is null", [client.id])).toBe(0)
    expect(await stack.count("audit_events", "entity_id = $1 and command = 'client.erased'", [client.id])).toBe(1)
    expect((await clientLogin(harness, client.email)).statusCode).not.toBe(200)
    const release = await harness.app.inject({
      method: "POST",
      url: `/v1/admin/users/${client.id}/contact-release`,
      headers: adminHeaders(admin, randomUUID()),
      payload: { expectedVersion: Number(user.version) },
    })
    expect(release.statusCode).toBe(409)
    expect(await stack.count("user_contact_history", "user_id = $1 and change_kind = 'closed_release'", [client.id])).toBe(0)

    const reuse = await harness.app.inject({
      method: "POST",
      url: "/v1/admin/clients",
      headers: adminHeaders(admin, randomUUID()),
      payload: { fullName: "New Holder", email: client.email, phone: client.phone },
    })
    expect(reuse.statusCode).toBe(201)
    const formerReuse = await harness.app.inject({
      method: "POST",
      url: "/v1/admin/clients",
      headers: adminHeaders(admin, randomUUID()),
      payload: { fullName: "Former Holder", email: client.oldEmail, phone: client.oldPhone },
    })
    expect(formerReuse.statusCode).toBe(201)
  })
})

describe("a client who never verified their email is deleted completely", () => {
  test("deletes exactly that client's rows, keeps one audit row and leaves another client untouched", async () => {
    const { stack } = harness
    const client = await seedClient(harness, { verified: false })
    const bystander = await seedClient(harness, { verified: false })
    await stack.queueLink(client.id)
    await stack.pool.query(
      "insert into admin_sip_schedules (user_id, fund_id, monthly_amount_paise, start_month, month_count, state, closed_at, created_by_user_id, updated_by_user_id, request_id) " +
        "values ($1, $2, 500000, '2025-01-01', 12, 'closed', now(), $3, $3, $4)",
      [client.id, harness.fundId, harness.admin.userId, randomUUID()],
    )
    expect((await clientLogin(harness, client.email)).statusCode).toBe(200)
    const bystanderBefore = await rowsMentioningId(stack, bystander.id)
    const bystanderCopies = await readableCopies(stack, needlesOf(bystander))

    const check = envelopeOf<Check>(await checkErase(harness, client.id)).data
    expect(check).toMatchObject({ state: "erasable", path: "deleted", keptBecause: null, emailVerified: false })
    const response = await erase(harness, client.id, "deleted")
    expect(response.statusCode).toBe(200)
    expect(envelopeOf<Outcome>(response).data).toMatchObject({ outcome: "erased", path: "deleted" })

    const remaining = await rowsMentioningId(stack, client.id)
    expect(Object.keys(remaining).sort()).toEqual(["audit_events", "idempotency_records"])
    expect(remaining.audit_events).toBe(1)
    const audit = await stack.first("select * from audit_events where entity_id = $1", [client.id])
    expect(audit).toMatchObject({ command: "client.erased", actor_user_id: harness.admin.userId, to_state: "deleted" })
    expect(audit.metadata).toEqual({ path: "deleted", keptBecause: null })
    expect(
      await stack.count("idempotency_records", "response_body::text like $1 and actor_scope <> $2", [`%${client.id}%`, `admin:${harness.admin.userId}`]),
    ).toBe(0)
    expect(await readableCopies(stack, needlesOf(client))).toEqual([])
    expect(await rowsMentioningId(stack, bystander.id)).toEqual(bystanderBefore)
    expect(await readableCopies(stack, needlesOf(bystander))).toEqual(bystanderCopies)

    const again = envelopeOf<Check>(await checkErase(harness, client.id)).data
    expect(again).toMatchObject({ state: "already_erased", path: "deleted" })
  })

  test("falls back to keeping the record when any money row exists, and says so", async () => {
    const { stack } = harness
    const client = await seedClient(harness, { verified: false })
    const recorded = await recordFor(harness, client.id, 80_000n)
    await reverseEntry(harness, client.id, recorded.entryId, 80_000n)
    const moneyBefore = await moneyOf(client.id)

    const check = envelopeOf<Check>(await checkErase(harness, client.id)).data
    expect(check).toMatchObject({ state: "erasable", path: "kept_as_record", keptBecause: "money_records" })
    const wrongPath = await erase(harness, client.id, "deleted")
    expect(wrongPath.statusCode).toBe(409)
    expect(envelopeOf<never>(wrongPath).error.fields).toHaveProperty("expectedPath")
    expect((await userRow(stack, client.id)).pii_tombstoned_at).toBeNull()

    const response = await erase(harness, client.id, "kept_as_record")
    expect(envelopeOf<Outcome>(response).data).toMatchObject({ path: "kept_as_record", keptBecause: "money_records" })
    expect(await userRow(stack, client.id)).toHaveProperty("id", client.id)
    expect(await moneyOf(client.id)).toEqual(moneyBefore)
    expect(await readableCopies(stack, needlesOf(client))).toEqual([])
  })
})
