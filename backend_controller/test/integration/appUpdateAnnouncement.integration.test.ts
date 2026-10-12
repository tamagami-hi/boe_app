import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createUncachedCache } from "../../src/cache/cache.js"
import { createAppUpdateNoticeGuard } from "../../src/domain/email/appUpdateNoticeGuard.js"
import type { SendGuard } from "../../src/domain/email/dispatchDueDeliveries.js"
import { clearAppUpdateCache } from "../../src/release/releaseFeed.js"
import { createAdminContentRepository } from "../../src/repositories/adminContentRepository.js"
import { createAppUpdateAnnouncementRepository } from "../../src/repositories/appUpdateAnnouncementRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { registerAdminAppUpdateAnnouncementRoutes } from "../../src/routes/adminAppUpdateAnnouncementRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

const ROUTE = "/v1/admin/app-update-announcements"
const FEED_BASE = "https://dev-app.beonedge.in/downloads"

interface Preview {
  readonly release: { readonly version: string; readonly versionCode: number; readonly url: string } | null
  readonly subject: string | null
  readonly recipientCount: number
  readonly alreadySent: boolean
  readonly currentMinimum: string | null
}

interface Sent {
  readonly announcementId: string
  readonly recipientCount: number
  readonly appConfigVersion: number | null
}

let stack: PasswordMailStack
let app: FastifyInstance
let feedRoot: string
let editor: AdminSession
let tester: AdminSession
let support: AdminSession
let messenger: AdminSession
let guards: readonly (readonly [string, SendGuard])[]

const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code
const notices = () => stack.count("email_deliveries", "template_key = 'app_update_notice'")

const publish = async (version: string, versionCode: number): Promise<void> => {
  const apk = `boe.dev.client.${version}.apk`
  const dir = join(feedRoot, "client")
  await writeFile(join(dir, apk), "apk bytes")
  await writeFile(
    join(dir, `boe.dev.client.${version}.json`),
    JSON.stringify({
      apk,
      target: "dev",
      variant: "client",
      version,
      versionName: version,
      versionCode,
      applicationId: "com.beonedge.app.dev",
      sha256: "a".repeat(64),
      signing: "release",
    }),
  )
  clearAppUpdateCache()
}

const preview = (as: AdminSession, mandatory = false) =>
  app.inject({ method: "GET", url: `${ROUTE}/preview?mandatory=${String(mandatory)}`, headers: adminHeaders(as) })

const send = (as: AdminSession, payload: object, key = `ann-${randomUUID()}`) =>
  app.inject({ method: "POST", url: ROUTE, headers: adminHeaders(as, key), payload })

const sendTest = (as: AdminSession, payload: object) =>
  app.inject({ method: "POST", url: `${ROUTE}/test`, headers: adminHeaders(as, `test-${randomUUID()}`), payload })

const currentConfig = async () =>
  stack.first("select version, payload from app_config_versions where retired_at is null order by version desc limit 1", [])

const publishConfig = async (payload: object): Promise<void> => {
  const version = Number((await stack.first("select coalesce(max(version), 0) + 1 as v from app_config_versions", [])).v)
  await stack.pool.query("update app_config_versions set retired_at = now() where retired_at is null")
  await stack.pool.query(
    "insert into app_config_versions (version, payload, content_sha256, published_by_user_id, published_at) values ($1, $2::jsonb, $3, $4, now())",
    [version, JSON.stringify(payload), Buffer.alloc(32), editor.userId],
  )
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  feedRoot = await mkdtemp(join(tmpdir(), "boe-app-update-feed-"))
  await mkdir(join(feedRoot, "client"))
  await publish("0.15.2", 1502)
  const webAuth = await adminWebAuth(stack)
  const appUpdateAnnouncementRepository = createAppUpdateAnnouncementRepository()
  guards = [["app_update_notice", createAppUpdateNoticeGuard({ appUpdateAnnouncementRepository, userRepository: stack.userRepository })]]
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminAppUpdateAnnouncementRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        idempotencyRepository: createIdempotencyRepository(),
        cache: createUncachedCache(),
        appUpdate: { releaseRoot: feedRoot, downloadBaseUrl: FEED_BASE },
        appUpdateAnnouncementRepository,
        contentRepository: createAdminContentRepository(),
        userRepository: stack.userRepository,
        outboxRepository: stack.outboxRepository,
        emailDeliveryRepository: stack.emailDeliveryRepository,
        auditRepository: stack.auditRepository,
        crypto: stack.crypto,
        clock: stack.clock,
        config: { sesConfigurationSet: "boe-test", supportAddress: null, idempotencyTtlMs: 86_400_000 },
      })
    },
  })
  editor = await signInRoleAdmin(app, stack, "superadmin")
  tester = await signInRoleAdmin(app, stack, "superadmin")
  support = await signInRoleAdmin(app, stack, "support")
  await stack.pool.query("insert into roles (code, name) values ('messenger', 'Messenger')")
  await stack.pool.query(
    "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
      "select r.id, p.id, $1 from roles r, permissions p where r.code = 'messenger' and p.code = 'email_messages.send'",
    [editor.userId],
  )
  messenger = await signInRoleAdmin(app, stack, "messenger")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
  await rm(feedRoot, { recursive: true, force: true })
})

describe("announcing an app update to every client", () => {
  test("previews the published version and counts only active clients, sending nothing", async () => {
    const before = dataOf<Preview>(await preview(editor)).recipientCount
    await stack.seedUser()
    await stack.seedUser({ state: "suspended" })
    const queued = await notices()

    const seen = dataOf<Preview>(await preview(editor))

    expect(seen.release).toEqual({ version: "0.15.2", versionCode: 1502, url: `${FEED_BASE}/client/boe.dev.client.0.15.2.apk?v=1502` })
    expect(seen.subject).toBe("BeOnEdge app version 0.15.2 is available")
    expect(seen.recipientCount).toBe(before + 1)
    expect(await notices()).toBe(queued)
  })

  test("queues one notice per active client with the official link, and never to admins or inactive accounts", async () => {
    const active = await stack.seedUser()
    const suspended = await stack.seedUser({ state: "suspended" })
    const configBefore = await currentConfig()

    const response = await send(editor, { versionCode: 1502, mandatory: false, message: "This release adds contact details." })

    expect(response.statusCode).toBe(202)
    const sent = dataOf<Sent>(response)
    expect(sent.appConfigVersion).toBeNull()
    const rows = (
      await stack.pool.query<{ user_id: string; payload: Record<string, unknown> }>(
        "select d.user_id, o.payload from email_deliveries d join outbox_events o on o.id = d.outbox_event_id " +
          "where d.template_key = 'app_update_notice' and o.payload ->> 'announcementId' = $1",
        [sent.announcementId],
      )
    ).rows
    expect(rows).toHaveLength(sent.recipientCount)
    const recipients = rows.map((row) => row.user_id)
    expect(recipients).toContain(active.id)
    expect(recipients).not.toContain(suspended.id)
    expect(recipients).not.toContain(editor.userId)
    expect(rows[0]?.payload).toMatchObject({ downloadUrl: `${FEED_BASE}/client/boe.dev.client.0.15.2.apk?v=1502`, mandatory: false })
    expect(await currentConfig()).toEqual(configBefore)
    expect(await stack.count("audit_events", "command = 'app_update.announced' and entity_id = $1", [sent.announcementId])).toBe(1)
  })

  test("replays the same request without a second send and refuses the same announcement again", async () => {
    await publish("0.15.3", 1503)
    const key = `ann-${randomUUID()}`
    const first = dataOf<Sent>(await send(editor, { versionCode: 1503, mandatory: false }, key))
    const queued = await notices()

    const replay = dataOf<Sent>(await send(editor, { versionCode: 1503, mandatory: false }, key))
    const again = await send(editor, { versionCode: 1503, mandatory: false })

    expect(replay.announcementId).toBe(first.announcementId)
    expect([again.statusCode, errorOf(again)]).toEqual([409, "STATE_CONFLICT"])
    expect(await notices()).toBe(queued)
    expect(dataOf<Preview>(await preview(editor)).alreadySent).toBe(true)
  })

  test("refuses a version other than the one now published, sending nothing", async () => {
    const queued = await notices()

    const stale = await send(editor, { versionCode: 1502, mandatory: true })

    expect([stale.statusCode, errorOf(stale)]).toEqual([409, "STATE_CONFLICT"])
    expect(await notices()).toBe(queued)
  })
})

describe("a required update", () => {
  test("raises the app's minimum version in the same step and keeps the rest of the configuration", async () => {
    await publishConfig({ featureFlags: { beta: true }, minimumSupportedVersion: { message: "Keep this note." }, maintenance: { enabled: false } })

    const response = await send(editor, { versionCode: 1503, mandatory: true })

    expect(response.statusCode).toBe(202)
    const sent = dataOf<Sent>(response)
    const config = await currentConfig()
    expect(Number(config.version)).toBe(sent.appConfigVersion)
    expect(config.payload).toMatchObject({
      featureFlags: { beta: true },
      minimumSupportedVersion: { android: "0.15.3", message: "Keep this note." },
    })
  })

  test("never lowers a minimum that is already higher", async () => {
    await publish("0.15.4", 1504)
    await publishConfig({ minimumSupportedVersion: { android: "0.16.0" } })
    const before = await currentConfig()

    const sent = dataOf<Sent>(await send(editor, { versionCode: 1504, mandatory: true }))

    expect(await currentConfig()).toEqual(before)
    expect(sent.appConfigVersion).toBe(Number(before.version))
  })

  test("needs the configuration permission as well as the send permission", async () => {
    await publish("0.15.5", 1505)
    const before = await currentConfig()

    const required = await send(messenger, { versionCode: 1505, mandatory: true })
    const optional = await send(messenger, { versionCode: 1505, mandatory: false })

    expect([required.statusCode, errorOf(required)]).toEqual([403, "AUTHORIZATION_DENIED"])
    expect(optional.statusCode).toBe(202)
    expect(await currentConfig()).toEqual(before)
  })
})

describe("delivery", () => {
  test("sends the required wording and link, a marked test only to the admin, and cancels mail to an account suspended meanwhile", async () => {
    await publish("0.15.6", 1506)
    const client = await stack.seedUser()
    const leaving = await stack.seedUser()
    await send(editor, { versionCode: 1506, mandatory: true, message: "Statements now load faster." })
    const test = await sendTest(tester, { versionCode: 1506, mandatory: false })
    await stack.setAccountState(leaving.id, "suspended")
    const transport = stack.transport()

    await stack.dispatch(transport, stack.clock, stack.crypto, guards)

    expect(test.statusCode).toBe(202)
    const toClient = transport.messages.find((message) => message.to === client.email && message.subject.includes("0.15.6"))
    expect(toClient?.subject).toBe("Update required: BeOnEdge app version 0.15.6")
    expect(toClient?.text).toContain(`${FEED_BASE}/client/boe.dev.client.0.15.6.apk?v=1506`)
    expect(toClient?.text).toContain("Statements now load faster.")
    const toAdmin = transport.messages.filter((message) => message.to === tester.email)
    expect(toAdmin.map((message) => message.subject)).toEqual(["[Test] BeOnEdge app version 0.15.6 is available"])
    expect(transport.messages.some((message) => message.to === leaving.email && message.subject.includes("0.15.6"))).toBe(false)
  })
})

describe("who may announce", () => {
  test("a support admin can neither preview nor send", async () => {
    const queued = await notices()

    const denied = [await preview(support), await send(support, { versionCode: 1506, mandatory: false }), await sendTest(support, { versionCode: 1506, mandatory: false })]

    expect(denied.map((r) => [r.statusCode, errorOf(r)])).toEqual(Array(3).fill([403, "AUTHORIZATION_DENIED"]))
    expect(await notices()).toBe(queued)
  })
})
