import { randomBytes, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { adminHeaders } from "./adminSessionSupport.js"
import { consentsOf, erase, seedClient, startErasureHarness, userRow, type ErasureHarness } from "./erasureSupport.js"

let harness: ErasureHarness

const receiptsOf = async (userId: string): Promise<string> =>
  JSON.stringify(
    (
      await harness.stack.pool.query(
        "select * from idempotency_records where response_body::text like $1 or actor_scope = $2 order by id",
        [`%${userId}%`, `user:${userId}`],
      )
    ).rows,
  )

beforeAll(async () => {
  harness = await startErasureHarness()
}, 220_000)

afterAll(async () => {
  await harness.app.close()
  await harness.stack.stop()
})

describe("erasure reaches only the client's own contacts", () => {
  test("leaves another person's application that shares only the phone untouched", async () => {
    const { stack } = harness
    const client = await seedClient(harness, { verified: true })
    const relative = await stack.first(
      "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
        "values ($1, $2, 'Family Member', 'rejected', now(), now()) returning *",
      [`relative-${randomUUID()}@example.com`, client.phone],
    )
    const consents = await consentsOf(stack, client)
    expect(consents.map((row) => row.user_agent)).toEqual([`Erase-Agent/${client.id}`, `Erase-Agent/${client.id}`])
    expect((await erase(harness, client.id, "kept_as_record")).statusCode).toBe(200)
    expect(await consentsOf(stack, client)).toEqual(consents.map((row) => ({ ...row, user_agent: null })))
    expect(await stack.first("select * from applications where id = $1", [relative.id])).toEqual(relative)
    expect(await stack.first("select pii_tombstoned_at is not null as tombstoned from applications where id = $1", [client.rejectedApplicationId])).toEqual({
      tombstoned: true,
    })
  })

  test("leaves another user's receipts byte-identical when that user now holds a former contact", async () => {
    const { stack, admin } = harness
    const client = await seedClient(harness, { verified: true })
    const holder = await harness.app.inject({
      method: "POST",
      url: "/v1/admin/clients",
      headers: adminHeaders(admin, randomUUID()),
      payload: { fullName: "Second Holder", email: client.oldEmail, phone: client.oldPhone },
    })
    expect(holder.statusCode).toBe(201)
    const holderId = holder.json<{ data: { userId: string } }>().data.userId
    await stack.pool.query(
      "insert into idempotency_records (actor_scope, http_method, route_template, key, actor_user_id, request_hash, response_status, response_body, expires_at) " +
        "values ($1, 'POST', '/v1/admin/clients/:userId/contact-correction', $2, $3, $4, 200, $5, '9999-12-31')",
      [`admin:${admin.userId}`, randomUUID(), admin.userId, randomBytes(32), JSON.stringify({ userId: holderId, email: client.oldEmail, phone: client.oldPhone })],
    )
    const holderBefore = { user: await userRow(stack, holderId), receipts: await receiptsOf(holderId) }

    expect((await erase(harness, client.id, "kept_as_record")).statusCode).toBe(200)
    expect({ user: await userRow(stack, holderId), receipts: await receiptsOf(holderId) }).toEqual(holderBefore)
    expect(await stack.count("auth_login_events", "email_normalized = $1", [client.oldEmail])).toBe(1)
  })
})
