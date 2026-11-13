import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createUncachedCache } from "../../src/cache/cache.js"
import { clearAppUpdateCache } from "../../src/release/releaseFeed.js"
import { createAdminContentRepository } from "../../src/repositories/adminContentRepository.js"
import { createAppUpdateAnnouncementRepository } from "../../src/repositories/appUpdateAnnouncementRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { registerAdminAppUpdateAnnouncementRoutes } from "../../src/routes/adminAppUpdateAnnouncementRoutes.js"
import { registerAdminContentRoutes } from "../../src/routes/adminContentRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PasswordMailStack } from "./passwordMailSupport.js"

const ROUTE = "/v1/admin/app-config"
const FEED_BASE = "https://dev-app.beonedge.in/downloads"
const LOCK_WAIT_POLL_MS = 25
const LOCK_WAIT_LIMIT_MS = 10_000

interface PublishedConfig {
  readonly version: number | null
  readonly config: Readonly<Record<string, unknown>> | null
}

let stack: PasswordMailStack
let app: FastifyInstance
let feedRoot: string
let editor: AdminSession

const dataOf = <T>(r: { json: () => unknown }): T => (r.json() as { data: T }).data
const errorOf = (r: { json: () => unknown }): string => (r.json() as { error: { code: string } }).error.code

const publish = (payload: object) => app.inject({ method: "PATCH", url: ROUTE, headers: adminHeaders(editor), payload })

const current = async (): Promise<PublishedConfig> =>
  dataOf<PublishedConfig>(await app.inject({ method: "GET", url: ROUTE, headers: adminHeaders(editor) }))

const versionRows = () => stack.count("app_config_versions")
const publishAudits = () => stack.count("audit_events", "command = 'app_config.published'")
const maxVersion = async (): Promise<number> =>
  Number((await stack.first("select coalesce(max(version), 0) as v from app_config_versions", [])).v)

const releaseClientApp = async (version: string, versionCode: number): Promise<void> => {
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

const waitForBlockedPublish = async (): Promise<void> => {
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS
  while (Date.now() < deadline) {
    const waiting = await stack.first(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      [],
    )
    if (Number(waiting.n) > 0) return
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS))
  }
  throw new Error("the publish never waited on the competing writer")
}

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  feedRoot = await mkdtemp(join(tmpdir(), "boe-app-config-feed-"))
  await mkdir(join(feedRoot, "client"))
  await releaseClientApp("0.15.2", 1502)
  const webAuth = await adminWebAuth(stack)
  const contentRepository = createAdminContentRepository()
  const idempotencyRepository = createIdempotencyRepository()
  const cache = createUncachedCache()
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminContentRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
        contentRepository,
        auditRepository: stack.auditRepository,
        idempotencyRepository,
        cache,
      })
      registerAdminAppUpdateAnnouncementRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        idempotencyRepository,
        cache,
        appUpdate: { releaseRoot: feedRoot, downloadBaseUrl: FEED_BASE },
        appUpdateAnnouncementRepository: createAppUpdateAnnouncementRepository(),
        contentRepository,
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
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
  await rm(feedRoot, { recursive: true, force: true })
})

describe("publishing the app configuration from the version it was edited from", () => {
  test("publishes the first configuration and the next one when each screen was opened on the current version", async () => {
    const empty = await current()

    const first = await publish({ config: { featureFlags: { beta: true } }, expectedVersion: empty.version })
    const second = await publish({ config: { featureFlags: { beta: false } }, expectedVersion: dataOf<PublishedConfig>(first).version })

    expect(empty.version).toBeNull()
    expect([first.statusCode, second.statusCode]).toEqual([200, 200])
    expect(dataOf<PublishedConfig>(second).version).toBe(Number(dataOf<PublishedConfig>(first).version) + 1)
    expect((await current()).config).toMatchObject({ featureFlags: { beta: false } })
  })

  test("refuses a screen opened on an older version and writes nothing", async () => {
    const opened = await current()
    const accepted = await publish({ config: { featureFlags: { first: true } }, expectedVersion: opened.version })
    const [rows, audits, live] = [await versionRows(), await publishAudits(), await current()]

    const stale = await publish({ config: { featureFlags: { second: true } }, expectedVersion: opened.version })

    expect(accepted.statusCode).toBe(200)
    expect([stale.statusCode, errorOf(stale)]).toEqual([409, "STATE_CONFLICT"])
    expect([await versionRows(), await publishAudits()]).toEqual([rows, audits])
    expect(await current()).toEqual(live)
  })

  test("still publishes a request without the edited-from version, as released admin apps send it", async () => {
    const before = await maxVersion()

    const response = await publish({ config: { featureFlags: { legacy: true } } })

    expect(response.statusCode).toBe(200)
    expect(dataOf<PublishedConfig>(response).version).toBe(before + 1)
    expect((await current()).config).toMatchObject({ featureFlags: { legacy: true } })
  })

  test("a screen opened before a required update cannot lower the minimum version that update raised", async () => {
    const base = await current()
    await publish({ config: { minimumSupportedVersion: { android: "0.15.1" } }, expectedVersion: base.version })
    const opened = await current()
    const announced = await app.inject({
      method: "POST",
      url: "/v1/admin/app-update-announcements",
      headers: adminHeaders(editor, `ann-${randomBytes(8).toString("hex")}`),
      payload: { versionCode: 1502, mandatory: true },
    })

    const stale = await publish({
      config: { ...(opened.config ?? {}), featureFlags: { afterUpdate: true } },
      expectedVersion: opened.version,
    })

    expect(announced.statusCode).toBe(202)
    expect([stale.statusCode, errorOf(stale)]).toEqual([409, "STATE_CONFLICT"])
    expect((await current()).config).toMatchObject({ minimumSupportedVersion: { android: "0.15.2" } })
  })
})

describe("simultaneous publishes", () => {
  test("released admin apps publishing at the same moment each get their own version instead of a server error", async () => {
    const before = await maxVersion()

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) => publish({ config: { presentation: { attempt: index } } })),
    )

    expect(responses.map((response) => response.statusCode)).toEqual(Array(6).fill(200))
    const versions = responses.map((response) => Number(dataOf<PublishedConfig>(response).version)).sort((a, b) => a - b)
    expect(versions).toEqual([1, 2, 3, 4, 5, 6].map((offset) => before + offset))
  })

  test("of several screens opened on the same version exactly one publishes", async () => {
    const opened = await current()
    const rows = await versionRows()

    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, index) => publish({ config: { presentation: { screen: index } }, expectedVersion: opened.version })),
    )

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409, 409, 409])
    expect(await versionRows()).toBe(rows + 1)
  })

  test("a version taken by another writer mid-publish is reported as a conflict, not a server error", async () => {
    const opened = await current()
    const taken = (await maxVersion()) + 1
    const audits = await publishAudits()
    const writer = await stack.pool.connect()
    try {
      await writer.query("begin")
      await writer.query("update app_config_versions set retired_at = now() where retired_at is null")
      await writer.query(
        "insert into app_config_versions (version, payload, content_sha256, published_by_user_id, published_at) values ($1, '{}'::jsonb, $2, $3, now())",
        [taken, Buffer.alloc(32), editor.userId],
      )
      const pending = publish({ config: { featureFlags: { racing: true } }, expectedVersion: opened.version })
      await waitForBlockedPublish()
      await writer.query("commit")

      const response = await pending

      expect([response.statusCode, errorOf(response)]).toEqual([409, "STATE_CONFLICT"])
      expect(await publishAudits()).toBe(audits)
      expect((await current()).version).toBe(taken)
    } finally {
      await writer.query("rollback")
      writer.release()
    }
  })
})
