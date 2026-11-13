import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { adminHeaders } from "./adminSessionSupport.js"
import {
  checkErase,
  clientLogin,
  envelopeOf,
  erase,
  growIndividually,
  needlesOf,
  othersSnapshot,
  ownIdsOf,
  readableCopies,
  recordFor,
  reverseEntry,
  rowsMentioningId,
  seedClient,
  startErasureHarness,
  userRow,
  type ErasureHarness,
  type SeededClient,
} from "./erasureSupport.js"

interface Check {
  readonly state: string
  readonly path: string | null
  readonly keptBecause: string | null
  readonly emailVerified: boolean | null
}

interface Outcome {
  readonly userId: string
  readonly outcome: string
  readonly path: string
  readonly keptBecause: string | null
}

let harness: ErasureHarness

const moneyOf = async (userId: string): Promise<unknown> =>
  (
    await harness.stack.pool.query(
      "select (select json_agg(e order by e.id) from client_value_entries e where e.user_id = $1) as entries, " +
        "(select json_agg(o order by o.id) from investment_orders o where o.user_id = $1) as orders, " +
        "(select json_agg(p order by p.id) from payments p where p.user_id = $1) as payments, " +
        "(select json_agg(a order by a.id) from payment_attempts a where a.user_id = $1) as attempts",
      [userId],
    )
  ).rows

const expectBystanderIntact = async (bystander: SeededClient): Promise<void> => {
  const { stack } = harness
  expect(await userRow(stack, bystander.id)).toMatchObject({
    email_normalized: bystander.email,
    phone_e164: bystander.phone,
    full_name: bystander.name,
    nominee_name: bystander.nominee,
    pii_tombstoned_at: null,
  })
  expect(await stack.first("select * from user_contact_history where user_id = $1", [bystander.id])).toMatchObject({
    previous_email_normalized: bystander.oldEmail,
    previous_phone_e164: bystander.oldPhone,
    new_email_normalized: bystander.email,
  })
  expect(await stack.first("select * from applications where id = $1", [bystander.rejectedApplicationId])).toMatchObject({
    email_normalized: bystander.oldEmail,
    full_name: bystander.name,
    pii_tombstoned_at: null,
  })
}

const createClientWith = (email: string, phone: string) =>
  harness.app.inject({
    method: "POST",
    url: "/v1/admin/clients",
    headers: adminHeaders(harness.admin, randomUUID()),
    payload: { fullName: "New Holder", email, phone },
  })

beforeAll(async () => {
  harness = await startErasureHarness()
}, 220_000)

afterAll(async () => {
  await harness.app.close()
  await harness.stack.stop()
})

describe("a verified client is kept as a record without contact details", () => {
  test("overwrites every copy, keeps the money history, frees the contacts and touches no one else", async () => {
    const { stack } = harness
    const client = await seedClient(harness, { verified: true })
    const bystander = await seedClient(harness, { verified: true })
    const recorded = await recordFor(harness, client.id, 120_000n)
    await reverseEntry(harness, client.id, recorded.entryId, 120_000n)
    expect((await clientLogin(harness, client.email)).statusCode).toBe(200)
    const ledger = await stack.pool.query("select * from client_value_entries where user_id = $1 order by created_at", [client.id])
    const own = await ownIdsOf(stack, client)
    const others = await othersSnapshot(stack, own)

    expect(envelopeOf<Check>(await checkErase(harness, client.id)).data).toMatchObject({
      state: "erasable",
      path: "kept_as_record",
      keptBecause: "email_verified",
      emailVerified: true,
    })
    const response = await erase(harness, client.id, "kept_as_record")
    expect(response.statusCode).toBe(200)
    expect(envelopeOf<Outcome>(response).data).toMatchObject({ outcome: "erased", path: "kept_as_record", keptBecause: "email_verified" })

    expect(await readableCopies(stack, needlesOf(client))).toEqual([])
    expect(await othersSnapshot(stack, own)).toBe(others)
    await expectBystanderIntact(bystander)
    const user = await userRow(stack, client.id)
    expect(user).toMatchObject({ account_state: "closed", full_name: "Tombstoned", nominee_name: null })
    expect(user.pii_tombstoned_at).not.toBeNull()
    expect((await stack.pool.query("select * from client_value_entries where user_id = $1 order by created_at", [client.id])).rows).toEqual(
      ledger.rows,
    )
    expect(await stack.first("select password_hash from user_credentials where user_id = $1", [client.id])).toEqual({ password_hash: null })
    expect(await stack.count("auth_sessions", "user_id = $1 and state = 'active'", [client.id])).toBe(0)
    expect(
      await stack.count("email_deliveries", "(user_id = $1 or application_id = $2) and recipient_ciphertext is not null", [
        client.id,
        client.rejectedApplicationId,
      ]),
    ).toBe(0)
    expect(await stack.count("email_deliveries", "application_id = $1 and erased_at is not null", [client.rejectedApplicationId])).toBe(1)
    expect(await stack.count("email_deliveries", "user_id = $1 and state = 'queued'", [client.id])).toBe(0)
    expect(await stack.count("audit_events", "entity_id = $1 and command = 'client.erased'", [client.id])).toBe(1)
    expect((await clientLogin(harness, client.email)).statusCode).not.toBe(200)
    const release = await harness.app.inject({
      method: "POST",
      url: `/v1/admin/users/${client.id}/contact-release`,
      headers: adminHeaders(harness.admin, randomUUID()),
      payload: { expectedVersion: Number(user.version) },
    })
    expect(release.statusCode).toBe(409)
    expect((await growIndividually(harness, client.id)).statusCode).toBe(409)
    await expect(recordFor(harness, client.id, 10_000n)).rejects.toThrow(/erased/u)
    expect((await stack.pool.query("select * from client_value_entries where user_id = $1 order by created_at", [client.id])).rows).toEqual(
      ledger.rows,
    )

    expect((await createClientWith(client.email, client.phone)).statusCode).toBe(201)
    expect((await createClientWith(client.oldEmail, client.oldPhone)).statusCode).toBe(201)
  })

  test("gives every erased client unique placeholders", async () => {
    const { stack } = harness
    const first = await seedClient(harness, { verified: true })
    const second = await seedClient(harness, { verified: true })
    expect((await erase(harness, first.id, "kept_as_record")).statusCode).toBe(200)
    expect((await erase(harness, second.id, "kept_as_record")).statusCode).toBe(200)
    const [a, b] = [await userRow(stack, first.id), await userRow(stack, second.id)]
    expect(a.email_normalized).toBe(`released+${first.id.replaceAll("-", "")}@released.invalid`)
    expect(b.email_normalized).toBe(`released+${second.id.replaceAll("-", "")}@released.invalid`)
    expect(String(a.phone_e164)).toMatch(/^\+999\d{11}$/u)
    expect(String(b.phone_e164)).toMatch(/^\+999\d{11}$/u)
    expect(a.phone_e164).not.toBe(b.phone_e164)
  })
})

describe("a client who never verified their email is deleted completely", () => {
  test("deletes exactly that client's rows, keeps one audit row and leaves everyone else byte-identical", async () => {
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
    const own = await ownIdsOf(stack, client)
    const others = await othersSnapshot(stack, own)

    expect(envelopeOf<Check>(await checkErase(harness, client.id)).data).toMatchObject({
      state: "erasable",
      path: "deleted",
      keptBecause: null,
      emailVerified: false,
    })
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
    expect(await stack.count("email_deliveries", "application_id = $1", [client.rejectedApplicationId])).toBe(0)
    expect(await stack.first("select pii_tombstoned_at is not null as tombstoned from applications where id = $1", [client.rejectedApplicationId])).toEqual({
      tombstoned: true,
    })
    expect(await readableCopies(stack, needlesOf(client))).toEqual([])
    expect(await othersSnapshot(stack, own)).toBe(others)
    await expectBystanderIntact(bystander)
    expect(envelopeOf<Check>(await checkErase(harness, client.id)).data).toMatchObject({ state: "already_erased", path: "deleted" })
  })

  test("falls back to keeping the record when a ledger row exists, and says so", async () => {
    const { stack } = harness
    const client = await seedClient(harness, { verified: false })
    const recorded = await recordFor(harness, client.id, 80_000n)
    await reverseEntry(harness, client.id, recorded.entryId, 80_000n)
    const moneyBefore = await moneyOf(client.id)

    expect(envelopeOf<Check>(await checkErase(harness, client.id)).data).toMatchObject({
      state: "erasable",
      path: "kept_as_record",
      keptBecause: "money_records",
    })
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

  test("falls back to keeping the record when only failed payment rows exist", async () => {
    const { stack } = harness
    const client = await seedClient(harness, { verified: false })
    const version = await stack.first("select current_published_version_id as id from funds where id = $1", [harness.fundId])
    const order = await stack.first(
      "insert into investment_orders (user_id, fund_id, fund_version_id, type, state, amount_paise, cancelled_at, failure_code) " +
        "values ($1, $2, $3, 'lump_sum', 'payment_failed', 50000, now(), 'payment_failed') returning id",
      [client.id, harness.fundId, version.id],
    )
    const payment = await stack.first(
      "insert into payments (order_id, user_id, amount_paise, state, failed_at) values ($1, $2, 50000, 'failed', now()) returning id",
      [order.id, client.id],
    )
    await stack.pool.query(
      "insert into payment_attempts (payment_id, user_id, attempt_number, provider, merchant_order_id, state, failure_code) " +
        "values ($1, $2, 1, 'phonepe', $3, 'failed', 'declined')",
      [payment.id, client.id, `erase-${randomUUID()}`],
    )
    const moneyBefore = await moneyOf(client.id)
    expect(await stack.count("client_value_entries", "user_id = $1", [client.id])).toBe(0)

    expect(envelopeOf<Check>(await checkErase(harness, client.id)).data).toMatchObject({
      state: "erasable",
      path: "kept_as_record",
      keptBecause: "money_records",
    })
    expect((await erase(harness, client.id, "kept_as_record")).statusCode).toBe(200)
    expect(await moneyOf(client.id)).toEqual(moneyBefore)
    expect(await readableCopies(stack, needlesOf(client))).toEqual([])
  })
})
