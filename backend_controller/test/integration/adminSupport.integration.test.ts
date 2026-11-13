import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import type { AccessTokenService } from "../../src/auth/accessToken.js"
import { createClientAccountRepository } from "../../src/repositories/clientAccountRepository.js"
import { createClientValueEntryRepository } from "../../src/repositories/clientValueEntryRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerAdminSupportRoutes } from "../../src/routes/adminSupportRoutes.js"
import { registerClientAccountRoutes } from "../../src/routes/clientAccountRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

interface Client {
  readonly userId: string
  readonly token: string
}

interface Ticket {
  readonly id: string
  readonly userId: string
  readonly clientName: string
  readonly reference: string
  readonly status: string
  readonly version: number
  readonly resolutionNote?: string | null
  readonly resolvedAt?: string | null
  readonly history?: readonly Readonly<Record<string, unknown>>[]
}

interface Page<T> {
  readonly items: readonly T[]
}

const CLIENT_TICKET_KEYS = [
  "body",
  "category",
  "createdAt",
  "id",
  "reference",
  "resolutionNote",
  "resolvedAt",
  "status",
  "subject",
  "updatedAt",
]

let stack: PasswordMailStack
let app: FastifyInstance
let tokens: AccessTokenService
let support: AdminSession
let reader: AdminSession
let finance: AdminSession

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const metaOf = (response: { json: () => unknown }) =>
  (response.json() as { meta: { idempotencyReplay?: boolean; page?: { nextCursor: string | null } } }).meta
const codeOf = (response: { json: () => unknown }): string => (response.json() as { error: { code: string } }).error.code

const seedClient = async (): Promise<Client> => {
  const user = await stack.seedUser({ password: true })
  const session = await stack.pool.query<{ id: string }>(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) " +
      "values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [user.id],
  )
  return { userId: user.id, token: await tokens.sign({ sub: user.id, sid: session.rows[0]?.id ?? "" }) }
}

const raiseTicket = async (client: Client, subject: string): Promise<string> => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/client/support/tickets",
    headers: { authorization: `Bearer ${client.token}` },
    payload: { subject, body: `${subject}: the transfer on 3 November is not in my portfolio.`, category: "payments" },
  })
  expect(response.statusCode).toBe(201)
  return dataOf<{ id: string }>(response).id
}

const clientGet = (client: Client, url: string) =>
  app.inject({ method: "GET", url, headers: { authorization: `Bearer ${client.token}` } })

const adminGet = (session: AdminSession, url: string) =>
  app.inject({ method: "GET", url, headers: adminHeaders(session) })

const respond = (session: AdminSession, ticketId: string, payload: object, key: string) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/support/tickets/${ticketId}/responses`,
    headers: adminHeaders(session, key),
    payload,
  })

const ticketRow = (ticketId: string) =>
  stack.first("select state, resolution_note, resolved_at, version::int as version from support_requests where id = $1", [
    ticketId,
  ])

const responseAudits = (ticketId: string): Promise<number> =>
  stack.count("audit_events", "entity_id = $1 and command = 'support.request_responded'", [ticketId])

const updateNotices = (ticketId: string): Promise<number> =>
  stack.count("notifications", "kind = 'support_request_updated' and payload ->> 'ticketId' = $1", [ticketId])

const writeFootprint = async (ticketId: string) => ({
  ticket: await ticketRow(ticketId),
  audits: await responseAudits(ticketId),
  notices: await updateNotices(ticketId),
  receipts: await stack.count("idempotency_records"),
})

const signInWithPermissions = async (role: string, permissions: readonly string[]): Promise<AdminSession> => {
  await stack.pool.query("insert into roles (code, name) values ($1, $1) on conflict do nothing", [role])
  const session = await signInRoleAdmin(app, stack, role)
  for (const permission of permissions) {
    await stack.pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
        "select r.id, p.id, $1 from roles r, permissions p where r.code = $2 and p.code = $3 on conflict do nothing",
      [session.userId, role, permission],
    )
  }
  return session
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  tokens = webAuth.accessTokenService
  const cursorKey = randomBytes(32)
  const notificationRepository = createNotificationRepository()
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminSupportRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        clock: stack.clock,
        config: { cursorKey, idempotencyTtlMs: 86_400_000 },
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository,
      })
      registerClientAccountRoutes(instance, {
        accessTokenService: tokens,
        database: stack.database,
        clientWeb: { originAllowlist: [] },
        clientAccountRepository: createClientAccountRepository(),
        clientValueEntryRepository: createClientValueEntryRepository(),
        auditRepository: stack.auditRepository,
        notificationRepository,
        unitOfWork: stack.unitOfWork,
        clock: stack.clock,
        config: { cursorKey },
      })
    },
  })
  support = await signInRoleAdmin(app, stack, "support")
  finance = await signInRoleAdmin(app, stack, "finance")
  reader = await signInWithPermissions("support_reader", ["support.read"])
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("the admin support inbox", () => {
  test("lists requests oldest first across pages and the client reads the response through the existing endpoint", async () => {
    const client = await seedClient()
    const first = await raiseTicket(client, "Missing transfer")
    const second = await raiseTicket(client, "Second question")

    const seen: string[] = []
    let after: string | null = null
    do {
      const query: string = after === null ? "" : `&after=${encodeURIComponent(after)}`
      const page = await adminGet(support, `/v1/admin/support/tickets?status=open&limit=1${query}`)
      expect(page.statusCode).toBe(200)
      seen.push(...dataOf<Page<Ticket>>(page).items.map((item) => item.id))
      after = metaOf(page).page?.nextCursor ?? null
    } while (after !== null)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.indexOf(first)).toBeGreaterThanOrEqual(0)
    expect(seen.indexOf(first)).toBeLessThan(seen.indexOf(second))

    const perClient = await adminGet(support, `/v1/admin/users/${client.userId}/support-tickets`)
    expect(perClient.statusCode).toBe(200)
    expect(dataOf<Page<Ticket>>(perClient).items.map((item) => item.id)).toEqual([second, first])
    expect((await adminGet(support, `/v1/admin/users/${randomUUID()}/support-tickets`)).statusCode).toBe(404)

    const detail = dataOf<Ticket>(await adminGet(support, `/v1/admin/support/tickets/${first}`))
    expect(detail).toMatchObject({ clientName: "Ada Lovelace", status: "open", version: 1 })
    expect(detail.history?.map((event) => event.command)).toEqual(["support.request_created"])

    const note = "We are checking the transfer with the bank and will update this request."
    const answered = await respond(support, first, { status: "in_progress", resolutionNote: note, expectedVersion: 1 }, `support-${randomUUID()}`)
    expect(answered.statusCode).toBe(200)
    const after1 = dataOf<Ticket>(answered)
    expect(after1).toMatchObject({ status: "in_progress", resolutionNote: note, version: 2, resolvedAt: null })
    expect(after1.history?.[1]).toMatchObject({
      command: "support.request_responded",
      actorName: "Admin User",
      fromState: "open",
      toState: "in_progress",
      noteChanged: true,
    })

    const resolved = await respond(support, first, { status: "resolved", resolutionNote: note, expectedVersion: 2 }, `support-${randomUUID()}`)
    expect(resolved.statusCode).toBe(200)

    const mine = dataOf<Page<Readonly<Record<string, unknown>>>>(await clientGet(client, "/v1/client/support/tickets"))
    const seenByClient = mine.items.find((item) => item.id === first)
    expect(seenByClient).toMatchObject({ status: "resolved", resolutionNote: note })
    expect(typeof seenByClient?.resolvedAt).toBe("string")
    for (const item of mine.items) expect(Object.keys(item).sort()).toEqual(CLIENT_TICKET_KEYS)

    const inbox = dataOf<Page<Readonly<{ kind: string; payload: Record<string, unknown> }>>>(
      await clientGet(client, "/v1/client/notifications"),
    )
    const notices = inbox.items.filter((item) => item.kind === "support_request_updated")
    expect(notices).toHaveLength(2)
    expect(notices[0]?.payload).toEqual({
      ticketId: first,
      reference: detail.reference,
      status: "resolved",
      deepLink: "/profile/support",
    })
  })

  test("a repeated response key replays without writing or notifying twice", async () => {
    const client = await seedClient()
    const ticketId = await raiseTicket(client, "Statement question")
    const key = `support-${randomUUID()}`
    const body = { status: "resolved", resolutionNote: "Your March statement now shows the correction.", expectedVersion: 1 }

    const [left, right] = await Promise.all([respond(support, ticketId, body, key), respond(support, ticketId, body, key)])
    const outcomes = [left.statusCode, right.statusCode].sort()
    expect(outcomes[0]).toBe(200)
    expect([200, 409]).toContain(outcomes[1])

    const retried = await respond(support, ticketId, body, key)
    expect(retried.statusCode).toBe(200)
    expect(metaOf(retried).idempotencyReplay).toBe(true)
    expect(dataOf<Ticket>(retried).version).toBe(2)

    const changed = await respond(support, ticketId, { ...body, resolutionNote: "A different note." }, key)
    expect(changed.statusCode).toBe(409)
    expect(codeOf(changed)).toBe("IDEMPOTENCY_KEY_REUSED")

    expect(await writeFootprint(ticketId)).toMatchObject({
      ticket: { state: "resolved", resolution_note: body.resolutionNote, version: 2 },
      audits: 1,
      notices: 1,
    })
  })

  test("a stale expected version is refused and nothing changes", async () => {
    const client = await seedClient()
    const ticketId = await raiseTicket(client, "Account question")
    const first = await respond(
      support,
      ticketId,
      { status: "in_progress", resolutionNote: "Looking into it.", expectedVersion: 1 },
      `support-${randomUUID()}`,
    )
    expect(first.statusCode).toBe(200)
    const before = await writeFootprint(ticketId)

    const stale = await respond(
      support,
      ticketId,
      { status: "closed", resolutionNote: "Closing from an old screen.", expectedVersion: 1 },
      `support-${randomUUID()}`,
    )
    expect(stale.statusCode).toBe(409)
    expect(codeOf(stale)).toBe("STATE_CONFLICT")

    const repeated = await respond(
      support,
      ticketId,
      { status: "in_progress", resolutionNote: "Looking into it.", expectedVersion: 2 },
      `support-${randomUUID()}`,
    )
    expect(repeated.statusCode).toBe(400)

    expect(await writeFootprint(ticketId)).toEqual(before)
    expect(before).toMatchObject({ ticket: { state: "in_progress", version: 2 }, audits: 1, notices: 1 })

    const missing = await respond(
      support,
      randomUUID(),
      { status: "closed", resolutionNote: "No such request.", expectedVersion: 1 },
      `support-${randomUUID()}`,
    )
    expect(missing.statusCode).toBe(404)
  })

  test("reads need support.read and responses need support.write", async () => {
    const client = await seedClient()
    const ticketId = await raiseTicket(client, "Permission check")
    const before = await writeFootprint(ticketId)
    const reads = [
      "/v1/admin/support/tickets",
      `/v1/admin/support/tickets/${ticketId}`,
      `/v1/admin/users/${client.userId}/support-tickets`,
    ]
    const body = { status: "closed", resolutionNote: "Not allowed.", expectedVersion: 1 }

    for (const url of reads) {
      const denied = await adminGet(finance, url)
      expect(denied.statusCode, url).toBe(403)
      expect(codeOf(denied)).toBe("AUTHORIZATION_DENIED")
      expect((await adminGet(reader, url)).statusCode, url).toBe(200)
      expect([401, 403], url).toContain((await app.inject({ method: "GET", url })).statusCode)
    }

    for (const session of [finance, reader]) {
      const refused = await respond(session, ticketId, body, `support-${randomUUID()}`)
      expect(refused.statusCode).toBe(403)
      expect(codeOf(refused)).toBe("AUTHORIZATION_DENIED")
    }
    const clientAttempt = await app.inject({
      method: "POST",
      url: `/v1/admin/support/tickets/${ticketId}/responses`,
      headers: { authorization: `Bearer ${client.token}`, "idempotency-key": `support-${randomUUID()}` },
      payload: body,
    })
    expect(clientAttempt.statusCode).toBe(401)

    expect(await writeFootprint(ticketId)).toEqual(before)
  })
})
