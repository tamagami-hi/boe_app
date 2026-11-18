import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createInvestmentRecordedGuard } from "../../src/domain/email/investmentRecordedGuard.js"
import { createClientReceiptRepository } from "../../src/repositories/clientReceiptRepository.js"
import { composeEmailDispatchWorker } from "../../src/runtime/workerComposition.js"
import { EARLIER, CORRECTION, MONTHLY, RecordingCategoryHarness, envelopeOf } from "./recordingCategorySupport.js"

const SIP_KEY = "sip_payment_recorded"
const ONE_TIME_KEY = "one_time_investment_recorded"
const LEGACY_KEY = "investment_recorded"
const FUND_NAME = "Category Mail Fund"
const WRITE_TABLES = [
  "client_value_entries",
  "client_value_entry_categories",
  "admin_sip_schedule_months",
  "email_deliveries",
  "outbox_events",
] as const

let harness: RecordingCategoryHarness
let fundId: string

const writeCounts = async (): Promise<number[]> => Promise.all(WRITE_TABLES.map((table) => harness.stack.count(table)))

const entryTx = async (entryId: string): Promise<string> =>
  String((await harness.stack.first("select xmin::text as tx from client_value_entries where id = $1", [entryId])).tx)

const revisionOf = async (userId: string): Promise<string> =>
  String((await harness.stack.first("select email_revision::text as revision from users where id = $1", [userId])).revision)

const sipBody = (scheduleId: string, month: string, effectiveDate: string) => ({
  fundId,
  effectiveDate,
  reasonCode: MONTHLY,
  category: "sip",
  sipScheduleLink: { scheduleId, month },
})

const oneTimeBody = (effectiveDate = "2025-06-02") => ({ fundId, effectiveDate, reasonCode: EARLIER, category: "one_time" })

const dispatchRecordingMail = async () => {
  const transport = harness.stack.transport()
  const guard = createInvestmentRecordedGuard({
    clientReceiptRepository: createClientReceiptRepository(),
    userRepository: harness.stack.userRepository,
  })
  await harness.stack.dispatch(transport, harness.stack.clock, harness.stack.crypto, [
    [SIP_KEY, guard],
    [ONE_TIME_KEY, guard],
  ])
  return transport
}

beforeAll(async () => {
  harness = await RecordingCategoryHarness.start()
  fundId = await harness.seedFund(FUND_NAME)
}, 220_000)

afterAll(async () => {
  await harness.stop()
})

describe("emails for new recordings by category", () => {
  test("a SIP payment queues one SIP email in its own transaction with month N of M and the next month due, and a replay none", async () => {
    const client = await harness.stack.seedUser()
    const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)
    const key = `sip-${randomUUID()}`

    const first = await harness.record(client.id, sipBody(schedule.scheduleId, "2025-03", "2025-03-04"), key)
    const replay = await harness.record(client.id, sipBody(schedule.scheduleId, "2025-03", "2025-03-04"), key)

    expect(first.statusCode).toBe(201)
    expect(envelopeOf(replay).meta.idempotencyReplay).toBe(true)
    const entryId = envelopeOf<{ entryId: string }>(first).data.entryId
    const mails = await harness.mailOf(client.id, SIP_KEY)
    expect(mails).toHaveLength(1)
    expect(mails[0]?.payload).toEqual({
      template: SIP_KEY,
      entryId,
      scheduleId: schedule.scheduleId,
      effectiveDate: "2025-03-04",
      sipMonth: "2025-03",
      monthNumber: 3,
      monthCount: 12,
      nextMonth: "2025-01",
      boundEmailRevision: await revisionOf(client.id),
    })
    expect(mails[0]?.tx).toBe(await entryTx(entryId))
    expect(await harness.sealedOf(String(mails[0]?.id))).toEqual({
      fullName: "Ada Lovelace",
      fundName: FUND_NAME,
      amountPaise: "500000",
    })
    expect(await harness.mailOf(client.id, LEGACY_KEY)).toHaveLength(0)

    const transport = await dispatchRecordingMail()
    const sent = transport.messages.filter((message) => message.to === client.email)
    expect(sent.map((message) => message.subject)).toEqual(["SIP payment recorded"])
    expect(sent[0]?.text).toContain(
      `Your SIP payment of ₹5,000.00 in ${FUND_NAME}, dated 4 March 2025, has been added to your BeOnEdge app.`,
    )
    expect(sent[0]?.text).toContain("It is recorded for March 2025, month 3 of 12 of this SIP.")
    expect(sent[0]?.text).toContain("The next month due is January 2025.")
    expect(sent[0]?.text).toContain("Investments are subject to market risk.")
  })

  test("the last open month says every month is recorded instead of a next month", async () => {
    const client = await harness.stack.seedUser()
    const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 2)
    await harness.recordOk(client.id, sipBody(schedule.scheduleId, "2025-02", "2025-02-03"))
    await harness.recordOk(client.id, sipBody(schedule.scheduleId, "2025-01", "2025-02-04"))

    const mails = await harness.mailOf(client.id, SIP_KEY)

    expect(mails.map((row) => (row.payload as Record<string, unknown>).nextMonth)).toEqual(["2025-01", null])
    const transport = await dispatchRecordingMail()
    const last = transport.messages.find((message) => message.to === client.email && message.text.includes("month 1 of 2"))
    expect(last?.text).toContain("Every month of this SIP is now recorded.")
  })

  test("a one-time investment queues one one-time email and stores its category in the same transaction", async () => {
    const client = await harness.stack.seedUser()
    const key = `one-time-${randomUUID()}`

    const first = await harness.record(client.id, oneTimeBody(), key)
    await harness.record(client.id, oneTimeBody(), key)

    expect(first.statusCode).toBe(201)
    const entryId = envelopeOf<{ entryId: string }>(first).data.entryId
    const mails = await harness.mailOf(client.id, ONE_TIME_KEY)
    expect(mails).toHaveLength(1)
    expect(mails[0]?.payload).toEqual({
      template: ONE_TIME_KEY,
      entryId,
      effectiveDate: "2025-06-02",
      boundEmailRevision: await revisionOf(client.id),
    })
    const category = await harness.stack.first(
      "select category, xmin::text as tx from client_value_entry_categories where entry_id = $1",
      [entryId],
    )
    expect(category).toEqual({ category: "one_time", tx: await entryTx(entryId) })
    expect(mails[0]?.tx).toBe(await entryTx(entryId))
    expect(await harness.mailOf(client.id, LEGACY_KEY)).toHaveLength(0)

    const transport = await dispatchRecordingMail()
    const sent = transport.messages.filter((message) => message.to === client.email)
    expect(sent.map((message) => message.subject)).toEqual(["One-time investment recorded"])
    expect(sent[0]?.text).toContain(
      `Your one-time investment of ₹5,000.00 in ${FUND_NAME}, dated 2 June 2025, has been added to your BeOnEdge app.`,
    )
  })

  test.each(["SIP payment", "one-time investment"] as const)(
    "a %s write that rolls back after the email was queued leaves no entry, category or email",
    async (kind) => {
      const client = await harness.stack.seedUser()
      const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)
      const body = kind === "SIP payment" ? sipBody(schedule.scheduleId, "2025-04", "2025-04-02") : oneTimeBody()
      const before = await writeCounts()
      harness.failures.receiptWrite = true
      try {
        expect((await harness.record(client.id, body)).statusCode).toBe(500)
      } finally {
        harness.failures.receiptWrite = false
      }

      expect(await writeCounts()).toEqual(before)
      expect(await harness.stack.count("email_deliveries", "user_id = $1", [client.id])).toBe(0)
    },
  )

  test("refuses a category that does not fit the recording before anything is written", async () => {
    const client = await harness.stack.seedUser()
    const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)
    const before = await writeCounts()

    const refusals = await Promise.all([
      harness.record(client.id, { fundId, effectiveDate: "2025-02-02", reasonCode: MONTHLY, category: "sip" }),
      harness.record(client.id, { ...oneTimeBody(), sipScheduleLink: { scheduleId: schedule.scheduleId, month: "2025-02" } }),
      harness.record(client.id, { fundId, effectiveDate: "2025-02-02", reasonCode: CORRECTION, category: "one_time" }),
      harness.record(client.id, { ...sipBody(schedule.scheduleId, "2025-02", "2025-02-02"), reasonCode: EARLIER }),
    ])

    expect(refusals.map((response) => [response.statusCode, Object.keys(envelopeOf(response).error.fields ?? {})])).toEqual([
      [400, ["sipScheduleLink"]],
      [400, ["sipScheduleLink"]],
      [400, ["category"]],
      [400, ["sipScheduleLink"]],
    ])
    expect(await writeCounts()).toEqual(before)
  })

  test("categorising or linking history queues no email, while an uncategorised recording keeps the shared email", async () => {
    const client = await harness.stack.seedUser()
    const earlier = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-01-03", reasonCode: EARLIER })
    const monthly = await harness.recordOk(client.id, { fundId, effectiveDate: "2025-02-03", reasonCode: MONTHLY })
    expect((await harness.mailOf(client.id, LEGACY_KEY)).map((row) => (row.payload as Record<string, unknown>).entryId)).toEqual([
      earlier,
      monthly,
    ])
    const schedule = await harness.scheduleFor(client.id, fundId, "2025-01", 12)
    const mailBefore = await harness.stack.count("outbox_events", "aggregate_id in ($1, $2)", [earlier, monthly])

    expect((await harness.markOneTime(client.id, earlier)).statusCode).toBe(201)
    expect((await harness.linkMonths(client.id, schedule.scheduleId, [{ month: "2025-02", entryId: monthly }])).statusCode).toBe(201)

    expect(await harness.stack.count("email_deliveries", "user_id = $1", [client.id])).toBe(2)
    expect(await harness.stack.count("outbox_events", "aggregate_id in ($1, $2)", [earlier, monthly])).toBe(mailBefore)
  })

  test("the deployed worker guards and renders queued shared, SIP and one-time emails rather than failing them as unknown", async () => {
    const queueEach = async (closeAfter: boolean) => {
      const clients = await Promise.all([harness.stack.seedUser(), harness.stack.seedUser(), harness.stack.seedUser()])
      const [legacy, sip, oneTime] = clients
      if (legacy === undefined || sip === undefined || oneTime === undefined) throw new Error("expected three clients")
      const schedule = await harness.scheduleFor(sip.id, fundId, "2025-01", 12)
      await harness.recordOk(legacy.id, { fundId, effectiveDate: "2025-05-05", reasonCode: MONTHLY })
      await harness.recordOk(sip.id, sipBody(schedule.scheduleId, "2025-05", "2025-05-05"))
      await harness.recordOk(oneTime.id, oneTimeBody("2025-05-05"))
      if (closeAfter) for (const client of clients) await harness.stack.setAccountState(client.id, "closed")
      return [
        [legacy.id, LEGACY_KEY],
        [sip.id, SIP_KEY],
        [oneTime.id, ONE_TIME_KEY],
      ] as const
    }
    const kept = await queueEach(false)
    const closed = await queueEach(true)
    const worker = composeEmailDispatchWorker(harness.workerEnv())

    try {
      await worker.runOnce()
    } finally {
      await worker.dispose()
    }

    const outcomesOf = (pairs: readonly (readonly [string, string])[]) =>
      Promise.all(
        pairs.map(async ([userId, templateKey]) =>
          (await harness.mailOf(userId, templateKey)).map((row) => [templateKey, row.state, row.last_error_code]),
        ),
      )
    expect(await outcomesOf(kept)).toEqual([
      [[LEGACY_KEY, "retryable_failed", "EMAIL_TRANSPORT_NOT_CONFIGURED"]],
      [[SIP_KEY, "retryable_failed", "EMAIL_TRANSPORT_NOT_CONFIGURED"]],
      [[ONE_TIME_KEY, "retryable_failed", "EMAIL_TRANSPORT_NOT_CONFIGURED"]],
    ])
    expect((await outcomesOf(closed)).map((rows) => rows.map(([templateKey, state]) => [templateKey, state]))).toEqual([
      [[LEGACY_KEY, "cancelled"]],
      [[SIP_KEY, "cancelled"]],
      [[ONE_TIME_KEY, "cancelled"]],
    ])
  })
})
