import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { adminHeaders } from "./adminSessionSupport.js"
import type { Row } from "./passwordMailSupport.js"
import {
  CORRECTION,
  EARLIER,
  MONTHLY,
  RecordingCategoryHarness,
  envelopeOf,
  type Recording,
  type Schedule,
} from "./recordingCategorySupport.js"

const HISTORY_TABLES = ["admin_sip_schedule_months", "client_value_entry_categories", "audit_events", "idempotency_records"] as const

let harness: RecordingCategoryHarness

const historyCounts = async (): Promise<number[]> => Promise.all(HISTORY_TABLES.map((table) => harness.stack.count(table)))

const ledgerRowsOf = async (userId: string): Promise<Row[]> =>
  (
    await harness.stack.pool.query<Row>(
      "select to_jsonb(v) as row from client_value_entries v where v.user_id = $1 order by v.id",
      [userId],
    )
  ).rows

const deliveriesOf = (userId: string): Promise<number> => harness.stack.count("email_deliveries", "user_id = $1", [userId])

const recordOn = (userId: string, fundId: string, effectiveDate: string, reasonCode = MONTHLY): Promise<string> =>
  harness.recordOk(userId, { fundId, effectiveDate, reasonCode })

const reverse = async (userId: string, entryId: string): Promise<void> => {
  const response = await harness.app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/ledger-entries/${entryId}/reversal`,
    headers: adminHeaders(harness.finance, `reverse-${randomUUID()}`),
    payload: { reasonCode: "recorded_in_error" },
  })
  expect(response.statusCode).toBe(201)
}

const seedHistory = async () => {
  const client = await harness.stack.seedUser()
  const fundId = await harness.seedFund("History Balanced Fund")
  const ids = {
    december: await recordOn(client.id, fundId, "2024-12-20"),
    january: await recordOn(client.id, fundId, "2025-01-05"),
    februaryEarly: await recordOn(client.id, fundId, "2025-02-03"),
    februaryLate: await recordOn(client.id, fundId, "2025-02-25"),
    marchEarlier: await recordOn(client.id, fundId, "2025-03-01", EARLIER),
    marchCorrection: await recordOn(client.id, fundId, "2025-03-10", CORRECTION),
    may: await recordOn(client.id, fundId, "2025-05-02"),
  }
  const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 6)
  return { client, fundId, ids, schedule }
}

const expectFields = (response: { statusCode: number; json: () => unknown }, fields: readonly string[]) => {
  expect(response.statusCode).toBe(400)
  const envelope = envelopeOf(response)
  expect(envelope.error.code).toBe("VALIDATION_FAILED")
  expect(Object.keys(envelope.error.fields ?? {}).sort()).toEqual([...fields].sort())
}

const expectConflict = (response: { statusCode: number; json: () => unknown }) => {
  expect(response.statusCode).toBe(409)
  expect(envelopeOf(response).error.code).toBe("STATE_CONFLICT")
}

beforeAll(async () => {
  harness = await RecordingCategoryHarness.start()
}, 220_000)

afterAll(async () => {
  await harness.stop()
})

describe("linking earlier monthly recordings to a past-dated SIP schedule", () => {
  test("proposes each monthly recording for its own month first, then the oldest left over in month order, skipping one-time ones", async () => {
    const { client, ids, schedule } = await seedHistory()
    expect(schedule).toMatchObject({ monthsPaid: 0, nextUnpaidMonth: "2025-01" })

    const proposal = await harness.proposal(client.id, schedule.scheduleId)

    expect(proposal.months.map((row) => [row.month, row.monthNumber, row.paid, row.proposedEntryId])).toEqual([
      ["2025-01", 1, false, ids.january],
      ["2025-02", 2, false, ids.februaryEarly],
      ["2025-03", 3, false, ids.februaryLate],
      ["2025-04", 4, false, null],
      ["2025-05", 5, false, ids.may],
      ["2025-06", 6, false, null],
    ])
    expect(proposal.candidates.map((row) => row.entryId).sort()).toEqual(
      [ids.december, ids.january, ids.februaryEarly, ids.februaryLate, ids.marchEarlier, ids.may].sort(),
    )

    expect((await harness.markOneTime(client.id, ids.may)).statusCode).toBe(201)
    const afterOneTime = await harness.proposal(client.id, schedule.scheduleId)
    expect(afterOneTime.months.map((row) => row.proposedEntryId)).toEqual([
      ids.january,
      ids.februaryEarly,
      ids.februaryLate,
      null,
      null,
      null,
    ])
  })

  test("links the confirmed rows in one write without email, audits each, and the client sees the months paid", async () => {
    const { client, ids, schedule } = await seedHistory()
    const ledgerBefore = await ledgerRowsOf(client.id)
    const mailBefore = await deliveriesOf(client.id)
    const links = [
      { month: "2025-01", entryId: ids.january },
      { month: "2025-02", entryId: ids.februaryEarly },
      { month: "2025-03", entryId: ids.marchEarlier },
      { month: "2025-05", entryId: ids.may },
    ]

    const response = await harness.linkMonths(client.id, schedule.scheduleId, links)

    expect(response.statusCode).toBe(201)
    expect(envelopeOf<{ linked: number; schedule: Schedule }>(response).data).toMatchObject({
      linked: 4,
      schedule: { monthsPaid: 4, paidMonths: ["2025-01", "2025-02", "2025-03", "2025-05"], nextUnpaidMonth: "2025-04" },
    })
    const clientSchedules = await harness.clientGet<{ items: { scheduleId: string; monthsPaid: number; totalMonths: number }[] }>(
      client.id,
      "/v1/client/sip-schedules",
    )
    expect(clientSchedules.items).toEqual([
      expect.objectContaining({ scheduleId: schedule.scheduleId, monthsPaid: 4, totalMonths: 6 }),
    ])
    const audits = (
      await harness.stack.pool.query<Row>(
        "select actor_user_id, metadata from audit_events where command = 'admin_sip_schedule.month_linked' and entity_id = $1",
        [schedule.scheduleId],
      )
    ).rows
    expect(
      audits.map((row) => {
        const metadata = row.metadata as Record<string, unknown>
        return [row.actor_user_id, metadata.sipMonth, metadata.entryId, metadata.source, metadata.previousCategory]
      }),
    ).toEqual(
      expect.arrayContaining(
        links.map((link) => [harness.finance.userId, link.month, link.entryId, "earlier_recording", null]),
      ),
    )
    expect(audits).toHaveLength(4)
    expect(await ledgerRowsOf(client.id)).toEqual(ledgerBefore)
    expect(await deliveriesOf(client.id)).toBe(mailBefore)

    const receipt = await harness.clientGet<{ receipt: { category: string; categoryLabel: string; sipMonth: string | null } }>(
      client.id,
      `/v1/client/receipts/${ids.marchEarlier}`,
    )
    expect(receipt.receipt).toEqual(expect.objectContaining({ category: "earlier_investment", categoryLabel: "SIP payment", sipMonth: "2025-03" }))
    const recordings = new Map((await harness.recordings(client.id)).map((row) => [row.entryId, row]))
    expect(recordings.get(ids.marchEarlier)).toMatchObject({ category: "sip", sipMonth: "2025-03", sipLinkAllowed: false })
    expect(recordings.get(ids.februaryLate)).toMatchObject({ category: null, categoryLabel: "Monthly investment", sipLinkAllowed: true })
  })

  test("refuses every conflicting row at once and writes nothing", async () => {
    const client = await harness.stack.seedUser()
    const stranger = await harness.stack.seedUser()
    const fundId = await harness.seedFund("Conflict Fund")
    const otherFundId = await harness.seedFund("Other Conflict Fund")
    const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)
    const linked = await recordOn(client.id, fundId, "2025-01-05")
    expect((await harness.linkMonths(client.id, schedule.scheduleId, [{ month: "2025-01", entryId: linked }])).statusCode).toBe(201)
    const valid = await recordOn(client.id, fundId, "2025-02-05")
    const spare = await recordOn(client.id, fundId, "2025-04-05")
    const reversed = await recordOn(client.id, fundId, "2025-03-05")
    await reverse(client.id, reversed)
    const correction = await recordOn(client.id, fundId, "2025-03-06", CORRECTION)
    const otherFund = await recordOn(client.id, otherFundId, "2025-03-07")
    const otherClient = await recordOn(stranger.id, fundId, "2025-03-08")
    const repeated = await recordOn(client.id, fundId, "2025-05-05")
    const before = await historyCounts()

    const response = await harness.linkMonths(client.id, schedule.scheduleId, [
      { month: "2025-02", entryId: valid },
      { month: "2025-01", entryId: spare },
      { month: "2025-05", entryId: linked },
      { month: "2025-06", entryId: reversed },
      { month: "2025-07", entryId: correction },
      { month: "2025-08", entryId: otherFund },
      { month: "2025-09", entryId: otherClient },
      { month: "2025-02", entryId: repeated },
      { month: "2025-10", entryId: valid },
      { month: "2026-01", entryId: repeated },
    ])

    expectFields(response, [
      "links.1.month",
      "links.2.entryId",
      "links.3.entryId",
      "links.4.entryId",
      "links.5.entryId",
      "links.6.entryId",
      "links.7.month",
      "links.8.entryId",
      "links.9.month",
      "links.9.entryId",
    ])
    expect(envelopeOf(response).error.fields?.["links.1.month"]).toEqual(["is already paid by another recording"])
    expect(await historyCounts()).toEqual(before)

    const otherSchedule = await harness.scheduleFor(client.id, otherFundId, "2025-01", 12)
    const closed = await harness.app.inject({
      method: "POST",
      url: `/v1/admin/clients/${client.id}/sip-schedules/${otherSchedule.scheduleId}/close`,
      headers: adminHeaders(harness.finance, `close-${randomUUID()}`),
      payload: { expectedVersion: otherSchedule.version },
    })
    expect(closed.statusCode).toBe(200)
    const afterClose = await historyCounts()
    expectConflict(await harness.linkMonths(client.id, otherSchedule.scheduleId, [{ month: "2025-03", entryId: otherFund }]))
    const foreign = await harness.linkMonths(stranger.id, schedule.scheduleId, [{ month: "2025-03", entryId: otherClient }])
    expect(foreign.statusCode).toBe(404)
    expect(await historyCounts()).toEqual(afterClose)
  })

  test("a replay with the same key links once, a reused key is refused, and racing writes link a recording once", async () => {
    const client = await harness.stack.seedUser()
    const fundId = await harness.seedFund("Replay Fund")
    const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)
    const first = await recordOn(client.id, fundId, "2025-01-05")
    const second = await recordOn(client.id, fundId, "2025-02-05")
    const key = `links-${randomUUID()}`
    const links = [{ month: "2025-01", entryId: first }]

    const original = await harness.linkMonths(client.id, schedule.scheduleId, links, key)
    const replay = await harness.linkMonths(client.id, schedule.scheduleId, links, key)

    expect(original.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    expect(envelopeOf(replay).data).toEqual(envelopeOf(original).data)
    const linkCount = () => harness.stack.count("admin_sip_schedule_months", "schedule_id = $1", [schedule.scheduleId])
    const auditCount = () =>
      harness.stack.count("audit_events", "command = 'admin_sip_schedule.month_linked' and entity_id = $1", [schedule.scheduleId])
    expect([await linkCount(), await auditCount()]).toEqual([1, 1])

    const reused = await harness.linkMonths(client.id, schedule.scheduleId, [{ month: "2025-02", entryId: second }], key)
    expect(reused.statusCode).toBe(409)
    expect(envelopeOf(reused).error.code).toBe("IDEMPOTENCY_KEY_REUSED")

    const racing = await Promise.all([
      harness.linkMonths(client.id, schedule.scheduleId, [{ month: "2025-02", entryId: second }]),
      harness.linkMonths(client.id, schedule.scheduleId, [{ month: "2025-03", entryId: second }]),
    ])
    expect(racing.map((response) => response.statusCode).sort()).toEqual([201, 400])
    expect([await linkCount(), await auditCount()]).toEqual([2, 2])
  })
})

describe("marking an earlier recording as one-time", () => {
  test("stores the category beside the entry, leaves the entry and totals unchanged, sends no email and audits it", async () => {
    const client = await harness.stack.seedUser()
    const fundId = await harness.seedFund("One-time Fund")
    const entryId = await recordOn(client.id, fundId, "2025-02-02", EARLIER)
    const ledgerBefore = await ledgerRowsOf(client.id)
    const mailBefore = await deliveriesOf(client.id)

    const response = await harness.markOneTime(client.id, entryId)

    expect(response.statusCode).toBe(201)
    expect(envelopeOf<{ recording: Recording }>(response).data.recording).toMatchObject({
      entryId,
      category: "one_time",
      categoryLabel: "One-time investment",
      oneTimeAllowed: false,
      sipLinkAllowed: true,
      amountPaise: "500000",
    })
    expect(await ledgerRowsOf(client.id)).toEqual(ledgerBefore)
    expect(await deliveriesOf(client.id)).toBe(mailBefore)
    expect(
      await harness.stack.first(
        "select user_id, fund_id, category, set_by_user_id from client_value_entry_categories where entry_id = $1",
        [entryId],
      ),
    ).toEqual({ user_id: client.id, fund_id: fundId, category: "one_time", set_by_user_id: harness.finance.userId })
    expect(
      await harness.stack.first(
        "select actor_user_id, to_state from audit_events where command = 'client_value_entry.category_set' and entity_id = $1",
        [entryId],
      ),
    ).toEqual({ actor_user_id: harness.finance.userId, to_state: "one_time" })
    const receipt = await harness.clientGet<{ receipt: { categoryLabel: string } }>(client.id, `/v1/client/receipts/${entryId}`)
    expect(receipt.receipt.categoryLabel).toBe("One-time investment")

    expectConflict(await harness.markOneTime(client.id, entryId))
    await expect(
      harness.stack.pool.query("update client_value_entry_categories set category = 'one_time' where entry_id = $1", [entryId]),
    ).rejects.toThrow(/append-only/u)
    await expect(harness.stack.pool.query("delete from client_value_entry_categories where entry_id = $1", [entryId])).rejects.toThrow(
      /append-only/u,
    )
  })

  test("can be changed to a SIP month later, and refuses corrections, reversed or linked recordings and other clients", async () => {
    const client = await harness.stack.seedUser()
    const stranger = await harness.stack.seedUser()
    const fundId = await harness.seedFund("Recategorised Fund")
    const entryId = await recordOn(client.id, fundId, "2025-02-02", EARLIER)
    expect((await harness.markOneTime(client.id, entryId)).statusCode).toBe(201)
    const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)

    expect((await harness.linkMonths(client.id, schedule.scheduleId, [{ month: "2025-02", entryId }])).statusCode).toBe(201)

    const changed = (await harness.recordings(client.id, fundId)).find((row) => row.entryId === entryId)
    expect(changed).toMatchObject({ category: "sip", categoryLabel: "SIP payment", sipMonth: "2025-02", oneTimeAllowed: false })
    const audit = await harness.stack.first(
      "select metadata from audit_events where command = 'admin_sip_schedule.month_linked' and metadata->>'entryId' = $1",
      [entryId],
    )
    expect((audit.metadata as Record<string, unknown>).previousCategory).toBe("one_time")

    const correction = await recordOn(client.id, fundId, "2025-03-03", CORRECTION)
    const reversed = await recordOn(client.id, fundId, "2025-03-04", EARLIER)
    await reverse(client.id, reversed)
    const before = await historyCounts()
    expectConflict(await harness.markOneTime(client.id, correction))
    expectConflict(await harness.markOneTime(client.id, reversed))
    expectConflict(await harness.markOneTime(client.id, entryId))
    expect((await harness.markOneTime(stranger.id, entryId)).statusCode).toBe(404)
    expect(await historyCounts()).toEqual(before)
  })
})
