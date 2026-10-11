import { randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createEmailTemplateRepository } from "../../src/repositories/emailTemplateRepository.js"
import { registerAdminEmailTemplateRoutes } from "../../src/routes/adminEmailTemplateRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { ADMIN_ORIGIN, adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

const ROUTE = "/v1/admin/email-templates"

interface Template {
  readonly templateId: string
  readonly slug: string
  readonly name: string
  readonly preloaded: boolean
  readonly archivedAt: string | null
  readonly version: number
  readonly currentRevision: number
  readonly subject: string
  readonly body: string
}

let stack: PasswordMailStack
let app: FastifyInstance
let editor: AdminSession
let support: AdminSession

const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code

const list = (as: AdminSession, includeArchived = false) =>
  app.inject({ method: "GET", url: `${ROUTE}?includeArchived=${String(includeArchived)}`, headers: adminHeaders(as) })

const post = (as: AdminSession, url: string, payload: object) =>
  app.inject({ method: "POST", url, headers: adminHeaders(as, `tpl-${randomUUID()}`), payload })

const create = (as: AdminSession, payload: object) => post(as, ROUTE, payload)

const counts = async () => ({
  templates: Number((await stack.pool.query<{ n: string }>("select count(*) as n from email_templates")).rows[0]?.n),
  revisions: Number((await stack.pool.query<{ n: string }>("select count(*) as n from email_template_revisions")).rows[0]?.n),
})

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminEmailTemplateRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        idempotencyRepository: createIdempotencyRepository(),
        emailTemplateRepository: createEmailTemplateRepository(),
        auditRepository: stack.auditRepository,
        clock: () => new Date(),
        config: { idempotencyTtlMs: 86_400_000 },
      })
    },
  })
  editor = await signInRoleAdmin(app, stack, "superadmin")
  support = await signInRoleAdmin(app, stack, "support")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("the template catalogue", () => {
  test("starts with the five preloaded templates, each with an editable first revision and only allowed placeholders", async () => {
    const response = await list(editor)

    expect(response.statusCode).toBe(200)
    const items = dataOf<{ items: Template[]; placeholders: string[] }>(response)
    expect(items.placeholders).toEqual(["first_name", "full_name"])
    const preloaded = items.items.filter((item) => item.preloaded)
    expect(preloaded.map((item) => item.slug).sort()).toEqual([
      "account-update",
      "education-reminder",
      "support-follow-up",
      "team-message",
      "welcome-note",
    ])
    for (const item of preloaded) {
      expect(item.currentRevision).toBe(1)
      expect(item.body).not.toMatch(/\{\{(?!first_name\}\}|full_name\}\})/u)
    }
  })

  test("creates a custom template with a slug from its name, audited as the admin", async () => {
    const response = await create(editor, { name: "Diwali greetings 2026", subject: "Happy Diwali, {{first_name}}", body: "Hello {{full_name}},\n\nBest wishes." })

    expect(response.statusCode).toBe(201)
    const template = dataOf<Template>(response)
    expect(template).toMatchObject({ slug: "diwali-greetings-2026", preloaded: false, currentRevision: 1, archivedAt: null })
    const audit = await stack.pool.query("select actor_user_id from audit_events where entity_id = $1 and command = 'email_template.created'", [template.templateId])
    expect(audit.rows).toEqual([{ actor_user_id: editor.userId }])
  })

  test.each([
    ["a header-injecting subject", { name: "Bad one", subject: "Hi\r\nBcc: x@example.com", body: "Body" }],
    ["an unknown placeholder", { name: "Bad two", subject: "Hi", body: "Your code is {{otp_code}}" }],
    ["a password link placeholder", { name: "Bad three", subject: "Hi", body: "Reset at {{reset_link}}" }],
    ["an empty body", { name: "Bad four", subject: "Hi", body: "   " }],
  ])("refuses %s and saves nothing", async (_name, payload) => {
    const before = await counts()

    const response = await create(editor, payload)

    expect([response.statusCode, errorOf(response)]).toEqual([400, "VALIDATION_FAILED"])
    expect(await counts()).toEqual(before)
  })

  test("refuses a second template with the same name", async () => {
    await create(editor, { name: "Monthly note", subject: "Hello", body: "Body" })

    const again = await create(editor, { name: "Monthly note", subject: "Hello again", body: "Body" })

    expect(again.statusCode).toBe(409)
  })
})

describe("editing a template", () => {
  test("adds a new revision and leaves the earlier one exactly as it was", async () => {
    const created = dataOf<Template>(await create(editor, { name: `Edit me ${randomUUID().slice(0, 8)}`, subject: "First", body: "First body" }))

    const revised = await post(editor, `${ROUTE}/${created.templateId}/revisions`, {
      expectedVersion: created.version,
      name: created.name,
      description: "",
      subject: "Second",
      body: "Second body",
    })

    expect(revised.statusCode).toBe(200)
    expect(dataOf<Template>(revised)).toMatchObject({ currentRevision: 2, subject: "Second" })
    const first = await stack.pool.query(
      "select subject, body from email_template_revisions where template_id = $1 and revision = 1",
      [created.templateId],
    )
    expect(first.rows).toEqual([{ subject: "First", body: "First body" }])
  })

  test("refuses an edit made against a stale version", async () => {
    const created = dataOf<Template>(await create(editor, { name: `Stale ${randomUUID().slice(0, 8)}`, subject: "One", body: "One" }))
    const payload = { expectedVersion: created.version, name: created.name, description: "", subject: "Two", body: "Two" }
    expect((await post(editor, `${ROUTE}/${created.templateId}/revisions`, payload)).statusCode).toBe(200)

    const stale = await post(editor, `${ROUTE}/${created.templateId}/revisions`, { ...payload, subject: "Three" })

    expect(stale.statusCode).toBe(409)
  })

  test("archives a template out of the list, refuses edits while archived, and restores it", async () => {
    const created = dataOf<Template>(await create(editor, { name: `Archive ${randomUUID().slice(0, 8)}`, subject: "A", body: "A" }))

    const archived = dataOf<Template>(await post(editor, `${ROUTE}/${created.templateId}/archive`, { expectedVersion: created.version }))
    const visible = dataOf<{ items: Template[] }>(await list(editor)).items.map((item) => item.templateId)
    const withArchived = dataOf<{ items: Template[] }>(await list(editor, true)).items.map((item) => item.templateId)
    const edit = await post(editor, `${ROUTE}/${created.templateId}/revisions`, {
      expectedVersion: archived.version,
      name: created.name,
      description: "",
      subject: "B",
      body: "B",
    })
    const restored = await post(editor, `${ROUTE}/${created.templateId}/restore`, { expectedVersion: archived.version })

    expect(archived.archivedAt).not.toBeNull()
    expect(visible).not.toContain(created.templateId)
    expect(withArchived).toContain(created.templateId)
    expect(edit.statusCode).toBe(409)
    expect(dataOf<Template>(restored).archivedAt).toBeNull()
  })
})

describe("who may manage templates", () => {
  test("a support admin can neither read nor write, and nothing is saved", async () => {
    const before = await counts()

    const read = await list(support)
    const write = await create(support, { name: "Support made", subject: "Hi", body: "Body" })

    expect([read.statusCode, errorOf(read)]).toEqual([403, "AUTHORIZATION_DENIED"])
    expect([write.statusCode, errorOf(write)]).toEqual([403, "AUTHORIZATION_DENIED"])
    expect(await counts()).toEqual(before)
  })

  test("a request with no session is refused", async () => {
    const response = await app.inject({ method: "GET", url: ROUTE, headers: { origin: ADMIN_ORIGIN } })
    expect(response.statusCode).toBe(401)
  })
})
