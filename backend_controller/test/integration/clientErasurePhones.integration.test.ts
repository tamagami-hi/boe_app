import { randomBytes, randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { runErasedPhoneRescrub, type RescrubbedRow } from "../../src/domain/admin/erasedPhoneRescrub.js"
import { erasedEmailFor } from "../../src/domain/admin/erasureContacts.js"
import { createClientErasureInspectRepository } from "../../src/repositories/clientErasureInspectRepository.js"
import { createClientErasureWriteRepository } from "../../src/repositories/clientErasureWriteRepository.js"
import { createErasedClientRepository } from "../../src/repositories/erasedClientRepository.js"
import {
  erase,
  readableCopies,
  seedClient,
  startErasureHarness,
  tableSnapshot,
  type ErasureHarness,
  type SeededClient,
} from "./erasureSupport.js"

interface Planted {
  readonly receiptId: string
  readonly auditId: string
  readonly supportId: string
}

let harness: ErasureHarness
let erased: SeededClient
let planted: Planted

const national = (phone: string): string => phone.slice(3)
const spaced = (phone: string): string => `${national(phone).slice(0, 5)} ${national(phone).slice(5)}`

const rescrubDeps = {
  erasedClientRepository: createErasedClientRepository(),
  erasureInspectRepository: createClientErasureInspectRepository(),
  erasureWriteRepository: createClientErasureWriteRepository(),
}

const insertReceipt = async (body: unknown): Promise<string> =>
  String(
    (
      await harness.stack.first(
        "insert into idempotency_records (actor_scope, http_method, route_template, key, actor_user_id, request_hash, " +
          "response_status, response_body, expires_at) values ($1, 'POST', '/v1/admin/nominee-requests/:requestId/decision', " +
          "$2, $3, $4, 200, $5, '9999-12-31') returning id",
        [`admin:${harness.admin.userId}`, randomUUID(), harness.admin.userId, randomBytes(32), JSON.stringify(body)],
      )
    ).id,
  )

const insertAudit = async (userId: string, metadata: unknown): Promise<string> =>
  String(
    (
      await harness.stack.first(
        "insert into audit_events (actor_type, actor_user_id, command, entity_type, entity_id, request_id, entity_version, metadata) " +
          "values ('admin', $1, 'legacy.note', 'user', $2, $3, 1, $4) returning id",
        [harness.admin.userId, userId, randomUUID(), JSON.stringify(metadata)],
      )
    ).id,
  )

const insertSupport = async (userId: string, body: string): Promise<string> =>
  String(
    (
      await harness.stack.first(
        "insert into support_requests (user_id, reference, category, subject, body) values ($1, $2, 'account', 'Help', $3) returning id",
        [userId, `REQ-${randomUUID().slice(0, 6)}`, body],
      )
    ).id,
  )

const insertReview = async (applicationId: string, detail: string): Promise<string> =>
  String(
    (
      await harness.stack.first(
        "insert into application_reviews (application_id, reviewer_user_id, decision, reason_code, reason_detail, request_id, idempotency_key) " +
          "values ($1, $2, 'rejected', 'other', $3, $4, $5) returning id",
        [applicationId, harness.admin.userId, detail, randomUUID(), randomUUID()],
      )
    ).id,
  )

const insertErasedHistory = async (userId: string, detail: string): Promise<string> =>
  String(
    (
      await harness.stack.first(
        "insert into user_contact_history (user_id, change_kind, previous_email_normalized, previous_phone_e164, new_email_normalized, " +
          "new_phone_e164, actor_user_id, request_id, reason_code, reason_detail) " +
          "values ($1, 'admin_correction', $2, 'tombstone-previous', $2, 'tombstone-new', $3, $4, 'typo', $5) returning id",
        [userId, erasedEmailFor(userId), harness.admin.userId, randomUUID(), detail],
      )
    ).id,
  )

const columnOf = async (table: string, column: string, id: string): Promise<unknown> =>
  (await harness.stack.first(`select "${column}" as value from "${table}" where id = $1`, [id])).value

const sorted = (rows: readonly RescrubbedRow[]): readonly string[] => rows.map((row) => `${row.table}:${row.id}`).sort()

beforeAll(async () => {
  harness = await startErasureHarness()
  erased = await seedClient(harness, { verified: true })
  planted = {
    receiptId: await insertReceipt({
      userId: erased.id,
      request: { state: "declined", declineReason: `Called ${spaced(erased.phone)} and +91 ${spaced(erased.oldPhone)}` },
      amountPaise: national(erased.phone),
      referenceId: `91${national(erased.phone)}`,
      units: Number(national(erased.phone)),
    }),
    auditId: await insertAudit(erased.id, { userId: erased.id, note: `Rang 0${national(erased.oldPhone)}` }),
    supportId: await insertSupport(erased.id, `Ring me on 0 ${spaced(erased.phone)}`),
  }
  expect((await erase(harness, erased.id, "kept_as_record")).statusCode).toBe(200)
}, 220_000)

afterAll(async () => {
  await harness.app.close()
  await harness.stack.stop()
})

describe("erasure replaces the client's national-form phones in free text", () => {
  test("a decline reason, audit note and support text naming a national-form phone no longer show it", async () => {
    expect(await readableCopies(harness.stack, [spaced(erased.phone), spaced(erased.oldPhone)])).toEqual([])
    const body = (await columnOf("idempotency_records", "response_body", planted.receiptId)) as {
      readonly request: { readonly declineReason: string }
    }
    expect(body.request.declineReason).toBe("Called tombstone and tombstone")
    expect(await columnOf("audit_events", "metadata", planted.auditId)).toEqual({ userId: erased.id, note: "Rang tombstone" })
    expect(await columnOf("support_requests", "body", planted.supportId)).toBe("Ring me on tombstone")
  })

  test("digit-only values holding the same digits are left as they were", async () => {
    expect(await columnOf("idempotency_records", "response_body", planted.receiptId)).toMatchObject({
      userId: erased.id,
      amountPaise: national(erased.phone),
      referenceId: `91${national(erased.phone)}`,
      units: Number(national(erased.phone)),
    })
  })
})

describe("the one-off re-scrub of already erased clients", () => {
  test("a dry run changes nothing, and a second apply finds nothing more", async () => {
    const kept = await seedClient(harness, { verified: true })
    const gone = await seedClient(harness, { verified: false })
    const bystander = await seedClient(harness, { verified: true })
    expect((await erase(harness, kept.id, "kept_as_record")).statusCode).toBe(200)
    expect((await erase(harness, gone.id, "deleted")).statusCode).toBe(200)

    const keptReceipt = await insertReceipt({
      userId: kept.id,
      request: { declineReason: `Called ${spaced(kept.phone)} on Monday` },
      amountPaise: national(kept.phone),
    })
    const keptAudit = await insertAudit(kept.id, { userId: kept.id, note: `Rang 0${national(kept.phone)}` })
    const keptSupport = await insertSupport(kept.id, `Call me on +91 ${spaced(kept.oldPhone)}`)
    const keptHistory = await insertErasedHistory(kept.id, `Confirmed on ${spaced(kept.oldPhone)}`)
    const keptPlainHistory = await insertErasedHistory(kept.id, "Typo in the address")
    const goneReceipt = await insertReceipt({ userId: gone.id, note: `Asked to be called on ${spaced(gone.phone)}` })
    const goneReview = await insertReview(gone.rejectedApplicationId, `Phoned ${national(gone.phone).slice(0, 5)}-${national(gone.phone).slice(5)} back`)
    const bystanderBody = { userId: bystander.id, note: `Called ${spaced(bystander.phone)}` }
    const bystanderReceipt = await insertReceipt(bystanderBody)
    const expected = sorted([
      { table: "idempotency_records", id: keptReceipt },
      { table: "idempotency_records", id: goneReceipt },
      { table: "audit_events", id: keptAudit },
      { table: "support_requests", id: keptSupport },
      { table: "application_reviews", id: goneReview },
      { table: "user_contact_history", id: keptHistory },
    ])

    const before = await tableSnapshot(harness.stack)
    const dryRun = await runErasedPhoneRescrub(harness.stack.database, rescrubDeps, { apply: false })
    expect(await tableSnapshot(harness.stack)).toBe(before)
    expect(dryRun).toMatchObject({ mode: "dry_run", erasedClients: 3 })
    expect(sorted(dryRun.rows)).toEqual(expected)
    expect(dryRun.tables).toMatchObject({ idempotency_records: 2, audit_events: 1, support_requests: 1, application_reviews: 1, user_contact_history: 1, notifications: 0 })

    const applied = await runErasedPhoneRescrub(harness.stack.database, rescrubDeps, { apply: true })
    expect(applied.mode).toBe("applied")
    expect(sorted(applied.rows)).toEqual(expected)
    const afterApply = await tableSnapshot(harness.stack)
    expect(afterApply).not.toBe(before)

    const again = await runErasedPhoneRescrub(harness.stack.database, rescrubDeps, { apply: true })
    expect(again.rows).toEqual([])
    expect(Object.values(again.tables).every((count) => count === 0)).toBe(true)
    expect(await tableSnapshot(harness.stack)).toBe(afterApply)

    expect(await columnOf("idempotency_records", "response_body", keptReceipt)).toEqual({
      userId: kept.id,
      request: { declineReason: "Called tombstone on Monday" },
      amountPaise: national(kept.phone),
    })
    expect(await columnOf("audit_events", "metadata", keptAudit)).toEqual({ userId: kept.id, note: "Rang tombstone" })
    expect(await columnOf("support_requests", "body", keptSupport)).toBe("Call me on tombstone")
    expect(await columnOf("idempotency_records", "response_body", goneReceipt)).toEqual({
      userId: gone.id,
      note: "Asked to be called on tombstone",
    })
    expect(await columnOf("application_reviews", "reason_detail", goneReview)).toBe("Phoned tombstone back")
    expect(await columnOf("user_contact_history", "reason_detail", keptHistory)).toBeNull()
    expect(await columnOf("user_contact_history", "reason_detail", keptPlainHistory)).toBe("Typo in the address")
    expect(await columnOf("idempotency_records", "response_body", bystanderReceipt)).toEqual(bystanderBody)
  })
})
