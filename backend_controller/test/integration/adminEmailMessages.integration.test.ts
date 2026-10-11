import { randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAdminMessageGuard } from "../../src/domain/email/adminMessageGuard.js"
import type { SendGuard } from "../../src/domain/email/dispatchDueDeliveries.js"
import { createAdminEmailMessageRepository } from "../../src/repositories/adminEmailMessageRepository.js"
import { createEmailTemplateRepository } from "../../src/repositories/emailTemplateRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { registerAdminEmailMessageRoutes } from "../../src/routes/adminEmailMessageRoutes.js"
import { registerAdminEmailTemplateRoutes } from "../../src/routes/adminEmailTemplateRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { ADMIN_ORIGIN, adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { COOLDOWN_MS, PasswordMailStack, type SeededUser } from "./passwordMailSupport.js"

const MESSAGES = "/v1/admin/email-messages"
const TEMPLATES = "/v1/admin/email-templates"

interface Preview {
  readonly revision: number
  readonly subject: string
  readonly text: string
  readonly html: string
  readonly sample: boolean
  readonly recipient: { readonly maskedEmail: string; readonly emailRevision: string; readonly block: string | null } | null
}

interface Queued {
  readonly messageId: string
  readonly deliveryId: string
  readonly recipient: string
  readonly test: boolean
}

let stack: PasswordMailStack
let app: FastifyInstance
let editor: AdminSession
let tester: AdminSession
let support: AdminSession
let onboarding: AdminSession
let guards: readonly (readonly [string, SendGuard])[]

const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code

const queuedMail = () => stack.count("email_deliveries", "template_key = 'admin_message'")

const createTemplate = async (subject: string, body: string): Promise<{ templateId: string; version: number }> => {
  const response = await app.inject({
    method: "POST",
    url: TEMPLATES,
    headers: adminHeaders(editor, `tpl-${randomUUID()}`),
    payload: { name: `Message ${randomUUID().slice(0, 8)}`, subject, body },
  })
  return dataOf(response)
}

const preview = (as: AdminSession, templateId: string, userId?: string) =>
  app.inject({
    method: "GET",
    url: `${MESSAGES}/preview?templateId=${templateId}${userId === undefined ? "" : `&userId=${userId}`}`,
    headers: adminHeaders(as),
  })

const sendTo = (as: AdminSession, payload: object, key = `send-${randomUUID()}`) =>
  app.inject({ method: "POST", url: MESSAGES, headers: adminHeaders(as, key), payload })

const sendTest = (as: AdminSession, payload: object, key = `test-${randomUUID()}`) =>
  app.inject({ method: "POST", url: `${MESSAGES}/test`, headers: adminHeaders(as, key), payload })

const seedClient = async (fullName = "Meera Kapoor"): Promise<SeededUser> => {
  const user = await stack.seedUser()
  await stack.pool.query("update users set full_name = $2 where id = $1", [user.id, fullName])
  return user
}

const approved = async (templateId: string, client: SeededUser) => {
  const seen = dataOf<Preview>(await preview(editor, templateId, client.id))
  return { templateId, revision: seen.revision, userId: client.id, expectedEmailRevision: seen.recipient?.emailRevision ?? "" }
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  const emailTemplateRepository = createEmailTemplateRepository()
  const adminEmailMessageRepository = createAdminEmailMessageRepository()
  guards = [
    ["admin_message", createAdminMessageGuard({ adminEmailMessageRepository, emailTemplateRepository, userRepository: stack.userRepository })],
  ]
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      const shared = {
        webAuth,
        unitOfWork: stack.unitOfWork,
        idempotencyRepository: createIdempotencyRepository(),
        emailTemplateRepository,
        auditRepository: stack.auditRepository,
        clock: stack.clock,
      }
      registerAdminEmailTemplateRoutes(instance, { ...shared, config: { idempotencyTtlMs: 86_400_000 } })
      registerAdminEmailMessageRoutes(instance, {
        ...shared,
        adminEmailMessageRepository,
        userRepository: stack.userRepository,
        emailSuppressionRepository: stack.emailSuppressionRepository,
        outboxRepository: stack.outboxRepository,
        emailDeliveryRepository: stack.emailDeliveryRepository,
        crypto: stack.crypto,
        config: { sesConfigurationSet: "boe-test", sendCooldownMs: COOLDOWN_MS, supportAddress: null, idempotencyTtlMs: 86_400_000 },
      })
    },
  })
  editor = await signInRoleAdmin(app, stack, "superadmin")
  tester = await signInRoleAdmin(app, stack, "superadmin")
  support = await signInRoleAdmin(app, stack, "support")
  onboarding = await signInRoleAdmin(app, stack, "onboarding")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("previewing", () => {
  test("shows a marked sample, or the chosen client's name and masked address, and queues nothing", async () => {
    const { templateId } = await createTemplate("Hello {{first_name}}", "Hello {{full_name}},\n\nA note from the team.")
    const client = await seedClient()
    const before = await queuedMail()

    const sample = dataOf<Preview>(await preview(editor, templateId))
    const chosen = dataOf<Preview>(await preview(editor, templateId, client.id))

    expect(sample).toMatchObject({ sample: true, recipient: null, subject: "Hello Asha" })
    expect(chosen).toMatchObject({ sample: false, subject: "Hello Meera" })
    expect(chosen.text).toContain("Hello Meera Kapoor,")
    expect(chosen.recipient?.maskedEmail).not.toBe(client.email)
    expect(chosen.recipient?.block).toBeNull()
    expect(await queuedMail()).toBe(before)
  })

  test("escapes markup in a template so the preview runs no script", async () => {
    const { templateId } = await createTemplate("Notice", "Hello {{first_name}},\n\n<script>alert(1)</script><img src=x onerror=alert(2)>")

    const html = dataOf<Preview>(await preview(editor, templateId)).html

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toMatch(/<script|<img/iu)
  })
})

describe("sending to a client", () => {
  test("queues one sealed message bound to the template version and the client's address, audited as the admin", async () => {
    const { templateId } = await createTemplate("Hello {{first_name}}", "Hello {{first_name}},\n\nYour statement is ready.")
    const client = await seedClient()

    const response = await sendTo(editor, await approved(templateId, client))

    expect(response.statusCode).toBe(202)
    const queued = dataOf<Queued>(response)
    expect(queued.test).toBe(false)
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({ template_key: "admin_message", user_id: client.id, state: "queued" })
    expect((await stack.outboxRowOf(queued.deliveryId)).payload).toEqual({ template: "admin_message", adminMessageId: queued.messageId, test: false })
    expect(await stack.rowsMentioning("Meera")).toBe(0)
    expect(await stack.first("select template_revision, recipient_user_id, actor_user_id, is_test from admin_email_messages where id = $1", [queued.messageId])).toEqual({
      template_revision: 1,
      recipient_user_id: client.id,
      actor_user_id: editor.userId,
      is_test: false,
    })
    expect(await stack.count("audit_events", "command = 'email_message.sent' and actor_user_id = $1 and entity_id = $2", [editor.userId, client.id])).toBe(1)
  })

  test("delivers the approved words with the client's name and no test marking", async () => {
    const { templateId } = await createTemplate("For {{first_name}}", "Hello {{first_name}},\n\nLine one\nLine two")
    const client = await seedClient("Ravi Menon")
    const queued = dataOf<Queued>(await sendTo(editor, await approved(templateId, client)))
    const transport = stack.transport()

    await stack.dispatch(transport, stack.clock, stack.crypto, guards)

    const sent = transport.messages.find((message) => message.to === client.email)
    expect(sent?.subject).toBe("For Ravi")
    expect(sent?.text).toContain("Hello Ravi,")
    expect(sent?.html).toContain("Line one<br>Line two")
    expect(sent?.text).not.toContain("test")
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({ state: "sent" })
  })

  test("replays the same key without a second message, and refuses it once its window has ended", async () => {
    const { templateId } = await createTemplate("Replay", "Hello {{first_name}},\n\nOnce only.")
    const client = await seedClient()
    const payload = await approved(templateId, client)
    const key = `send-${randomUUID()}`

    const first = dataOf<Queued>(await sendTo(editor, payload, key))
    const again = dataOf<Queued>(await sendTo(editor, payload, key))
    await stack.pool.query(
      "update idempotency_records set created_at = now() - interval '2 days', completed_at = now() - interval '2 days', " +
        "expires_at = now() - interval '1 day' where key = $1",
      [key],
    )
    const expired = await sendTo(editor, payload, key)

    expect(again.messageId).toBe(first.messageId)
    expect([expired.statusCode, errorOf(expired)]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"])
    expect(await stack.count("admin_email_messages", "recipient_user_id = $1", [client.id])).toBe(1)
  })

  test("refuses a recipient address in the request and a stale address revision, sending nothing", async () => {
    const { templateId } = await createTemplate("Tamper", "Hello {{first_name}},\n\nNothing to see.")
    const client = await seedClient()
    const payload = await approved(templateId, client)
    const before = await queuedMail()

    const tampered = await sendTo(editor, { ...payload, recipient: "attacker@example.com" })
    await stack.pool.query("update users set email_revision = email_revision + 1 where id = $1", [client.id])
    const stale = await sendTo(editor, payload)

    expect([tampered.statusCode, errorOf(tampered)]).toEqual([400, "VALIDATION_FAILED"])
    expect([stale.statusCode, errorOf(stale)]).toEqual([409, "STATE_CONFLICT"])
    expect(await queuedMail()).toBe(before)
  })

  test("refuses a template changed or archived after the preview", async () => {
    const created = await createTemplate("Version one", "Hello {{first_name}},\n\nFirst words.")
    const client = await seedClient()
    const payload = await approved(created.templateId, client)
    const before = await queuedMail()

    await app.inject({
      method: "POST",
      url: `${TEMPLATES}/${created.templateId}/revisions`,
      headers: adminHeaders(editor, `rev-${randomUUID()}`),
      payload: { expectedVersion: created.version, name: `Changed ${randomUUID().slice(0, 8)}`, description: "", subject: "Version two", body: "Second words." },
    })
    const changed = await sendTo(editor, payload)
    await app.inject({
      method: "POST",
      url: `${TEMPLATES}/${created.templateId}/archive`,
      headers: adminHeaders(editor, `arc-${randomUUID()}`),
      payload: { expectedVersion: created.version + 1 },
    })
    const archived = await sendTo(editor, { ...payload, revision: 2 })

    expect([changed.statusCode, errorOf(changed)]).toEqual([409, "STATE_CONFLICT"])
    expect([archived.statusCode, errorOf(archived)]).toEqual([409, "STATE_CONFLICT"])
    expect(await queuedMail()).toBe(before)
  })

  test("refuses an admin account, a suspended client, and a suppressed address", async () => {
    const { templateId } = await createTemplate("Blocked", "Hello {{first_name}},\n\nBlocked.")
    const suspended = await seedClient()
    const suppressed = await seedClient()
    const forAdmin = { templateId, revision: 1, userId: support.userId, expectedEmailRevision: "1" }
    const forSuspended = await approved(templateId, suspended)
    const forSuppressed = await approved(templateId, suppressed)
    await stack.setAccountState(suspended.id, "suspended")
    const source = await stack.first(
      "insert into email_provider_events (sns_message_id, sns_topic_arn, sns_type, payload_sha256, expires_at) " +
        "values ($1, 'arn:aws:sns:ap-south-1:1:t', 'Notification', $2, now() + interval '7 days') returning id",
      [randomUUID(), Buffer.alloc(32)],
    )
    await stack.pool.query(
      "insert into email_suppressions (recipient_hmac, suppression_hmac_key_version, reason, source_event_id) values ($1, $2, 'complaint', $3)",
      [stack.crypto.hmacRecipient(suppressed.email).hash, stack.crypto.suppressionHmacKeyVersion, source.id],
    )
    const before = await queuedMail()

    const results = [await sendTo(editor, forAdmin), await sendTo(editor, forSuspended), await sendTo(editor, forSuppressed)]

    expect(results.map((r) => [r.statusCode, errorOf(r)])).toEqual([
      [409, "STATE_CONFLICT"],
      [409, "STATE_CONFLICT"],
      [409, "STATE_CONFLICT"],
    ])
    expect(await queuedMail()).toBe(before)
  })

  test("refuses a second message to the same client inside the cooldown", async () => {
    const { templateId } = await createTemplate("Cooldown", "Hello {{first_name}},\n\nOne at a time.")
    const client = await seedClient()
    const payload = await approved(templateId, client)

    const first = await sendTo(editor, payload)
    const second = await sendTo(editor, payload)

    expect(first.statusCode).toBe(202)
    expect([second.statusCode, errorOf(second)]).toEqual([429, "RATE_LIMITED"])
    expect(await stack.count("admin_email_messages", "recipient_user_id = $1", [client.id])).toBe(1)
  })
})

describe("sending a test", () => {
  test("goes only to the admin's own address with a sample name and a visible test marking", async () => {
    const { templateId } = await createTemplate("Hi {{first_name}}", "Hello {{full_name}},\n\nA test of the words.")

    const response = await sendTest(tester, { templateId, revision: 1 })
    const transport = stack.transport()
    await stack.dispatch(transport, stack.clock, stack.crypto, guards)

    expect(response.statusCode).toBe(202)
    const queued = dataOf<Queued>(response)
    expect(queued.test).toBe(true)
    expect(await stack.deliveryRow(queued.deliveryId)).toMatchObject({ user_id: tester.userId, state: "sent" })
    const sent = transport.messages.find((message) => message.to === tester.email)
    expect(sent?.subject).toBe("[Test] Hi Asha")
    expect(sent?.text).toContain("It was not sent to a client")
    expect(sent?.text).toContain("Hello Asha Verma,")
  })
})

describe("the worker's guard", () => {
  test("cancels a queued message when the client's address or the template changes before sending", async () => {
    const first = await createTemplate("Guard one", "Hello {{first_name}},\n\nGuarded.")
    const second = await createTemplate("Guard two", "Hello {{first_name}},\n\nGuarded too.")
    const movedClient = await seedClient()
    const otherClient = await seedClient()
    const moved = dataOf<Queued>(await sendTo(editor, await approved(first.templateId, movedClient)))
    const revised = dataOf<Queued>(await sendTo(editor, await approved(second.templateId, otherClient)))
    await stack.pool.query("update users set email_revision = email_revision + 1 where id = $1", [movedClient.id])
    await app.inject({
      method: "POST",
      url: `${TEMPLATES}/${second.templateId}/revisions`,
      headers: adminHeaders(editor, `rev-${randomUUID()}`),
      payload: { expectedVersion: second.version, name: `Guarded ${randomUUID().slice(0, 8)}`, description: "", subject: "New", body: "New words." },
    })
    const transport = stack.transport()

    await stack.dispatch(transport, stack.clock, stack.crypto, guards)

    expect(await stack.deliveryRow(moved.deliveryId)).toMatchObject({ state: "cancelled" })
    expect(await stack.deliveryRow(revised.deliveryId)).toMatchObject({ state: "cancelled" })
    expect(transport.messages.filter((message) => [movedClient.email, otherClient.email].includes(message.to))).toEqual([])
  })
})

describe("who may send", () => {
  test("support and onboarding admins can neither preview nor send, and a send without CSRF is refused", async () => {
    const { templateId } = await createTemplate("Denied", "Hello {{first_name}},\n\nDenied.")
    const client = await seedClient()
    const payload = await approved(templateId, client)
    const before = await queuedMail()

    const denied = [
      await preview(support, templateId, client.id),
      await sendTo(support, payload),
      await sendTo(onboarding, payload),
      await sendTest(onboarding, { templateId, revision: 1 }),
    ]
    const noCsrf = await app.inject({
      method: "POST",
      url: MESSAGES,
      headers: { origin: ADMIN_ORIGIN, cookie: editor.cookie, "idempotency-key": `send-${randomUUID()}` },
      payload,
    })

    expect(denied.map((r) => [r.statusCode, errorOf(r)])).toEqual(Array(4).fill([403, "AUTHORIZATION_DENIED"]))
    expect(noCsrf.statusCode).toBe(403)
    expect(await queuedMail()).toBe(before)
  })
})
