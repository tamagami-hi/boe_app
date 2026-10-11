import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"
import { sql } from "kysely"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createAccessTokenService } from "../../src/auth/accessToken.js"
import { hashPassword } from "../../src/auth/passwordHasher.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { PasswordLinkSettings } from "../../src/domain/auth/passwordLinkUrl.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createApplicationReviewRepository } from "../../src/repositories/applicationReviewRepository.js"
import type { EmailDeliveryWriteRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailVerificationRepository } from "../../src/repositories/emailVerificationRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import type { OutboxWriteRepository } from "../../src/repositories/outboxRepository.js"
import { registerAdminClientOnboardingRoutes } from "../../src/routes/adminClientOnboardingRoutes.js"
import { registerAdminIdentityRoutes, type AdminIdentityDeps } from "../../src/routes/adminIdentityRoutes.js"
import { registerPasswordRoutes, type PasswordRoutesDeps } from "../../src/routes/passwordRoutes.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { LINK_PAGE, NEW_PASSWORD, PASSWORD, PasswordMailStack, TTL_MS, type Row } from "./passwordMailSupport.js"

const ORIGIN = "https://admin.beonedge.test"
const FEED_BASE = "https://dev-app.beonedge.in/downloads"
const APK_FILENAME = "boe.dev.client.1.0.0.apk"
const APK_URL = `${FEED_BASE}/client/${APK_FILENAME}?v=100`

interface Session {
  readonly cookie: string
  readonly csrf: string
}

interface AppOptions {
  readonly passwordLinks?: PasswordLinkSettings
  readonly outboxRepository?: OutboxWriteRepository
  readonly emailDeliveryRepository?: EmailDeliveryWriteRepository
  readonly releaseRoot?: string
}

let stack: PasswordMailStack
let app: FastifyInstance
let session: Session
let adminId: string
let publishedRoot: string
let emptyRoot: string
let webAuth: WebAuthDeps
let adminDeps: AdminIdentityDeps

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }): { code: string; message: string } =>
  (response.json() as { error: { code: string; message: string } }).error

const cookieJar = (setCookie: string | string[] | undefined): Record<string, string> => {
  const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  const jar: Record<string, string> = {}
  for (const cookie of list) {
    const pair = cookie.split(";")[0] ?? ""
    const index = pair.indexOf("=")
    if (index !== -1) jar[pair.slice(0, index)] = pair.slice(index + 1)
  }
  return jar
}

const buildApp = (options: AppOptions = {}): FastifyInstance => {
  const mail = {
    ...stack.mailDeps(options.passwordLinks),
    outboxRepository: options.outboxRepository ?? stack.outboxRepository,
    emailDeliveryRepository: options.emailDeliveryRepository ?? stack.emailDeliveryRepository,
  }
  return createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerWebAuthRoutes(instance, {
        ...webAuth,
        unitOfWork: stack.unitOfWork,
        loginEventRepository: createLoginEventRepository(),
      })
      registerAdminClientOnboardingRoutes(instance, {
        ...mail,
        webAuth,
        unitOfWork: stack.unitOfWork,
        idempotencyRepository: createIdempotencyRepository(),
        applicationRepository: createApplicationRepository(),
        emailVerificationRepository: createEmailVerificationRepository(),
        config: { ...mail.config, idempotencyTtlMs: 86_400_000 },
      })
      registerPasswordRoutes(instance, {
        ...mail,
        unitOfWork: stack.unitOfWork,
        appUpdate: { releaseRoot: options.releaseRoot ?? publishedRoot, downloadBaseUrl: FEED_BASE },
      } as unknown as PasswordRoutesDeps)
      registerAdminIdentityRoutes(instance, adminDeps)
    },
  })
}

const createRoleAdmin = async (role: string): Promise<{ readonly id: string; readonly session: Session }> => {
  const email = `admin-${randomUUID()}@example.com`
  const id = (
    await stack.pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, 'Admin User', 'active', now()) returning id",
      [email, stack.nextPhone()],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("admin not created")
  await stack.pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [
    id,
    await hashPassword(PASSWORD),
  ])
  for (const permission of SEED_ROLE_PERMISSIONS[role] ?? []) {
    await stack.pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
        "select r.id, p.id, $1 from roles r, permissions p where r.code = $3 and p.code = $2 on conflict do nothing",
      [id, permission, role],
    )
  }
  await stack.pool.query(
    "insert into user_roles (user_id, role_id, granted_by_user_id) select $1, id, $1 from roles where code = $2",
    [id, role],
  )
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/web/login",
    headers: { origin: ORIGIN },
    payload: { email, password: PASSWORD },
  })
  expect(login.statusCode).toBe(200)
  return {
    id,
    session: {
      cookie: Object.entries(cookieJar(login.headers["set-cookie"]))
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
      csrf: dataOf<{ csrfToken: string }>(login).csrfToken,
    },
  }
}

const createAdmin = async (): Promise<string> => {
  const created = await createRoleAdmin("onboarding")
  session = created.session
  return created.id
}

interface NewClient {
  readonly fullName: string
  readonly email: string
  readonly phone: string
}

const newClient = (): NewClient => ({
  fullName: "Asha Verma",
  email: `asha-${randomUUID()}@example.com`,
  phone: stack.nextPhone(),
})

const createClient = (target: FastifyInstance, key: string, client: NewClient) =>
  target.inject({
    method: "POST",
    url: "/v1/admin/clients",
    headers: {
      origin: ORIGIN,
      cookie: session.cookie,
      "x-csrf-token": session.csrf,
      "idempotency-key": key,
    },
    payload: client,
  })

const postJson = (target: FastifyInstance, url: string, payload: object) =>
  target.inject({ method: "POST", url, payload })

const userRows = async (userId: string) => ({
  tokens: (await stack.pool.query<Row>("select * from password_credential_tokens where user_id = $1", [userId])).rows,
  deliveries: (await stack.pool.query<Row>("select * from email_deliveries where user_id = $1 order by created_at", [userId])).rows,
})

const TABLES = ["users", "password_credential_tokens", "outbox_events", "email_deliveries", "email_delivery_payloads", "idempotency_records", "audit_events"]

const tableCounts = async (): Promise<number[]> => Promise.all(TABLES.map((table) => stack.count(table)))

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  publishedRoot = await mkdtemp(join(tmpdir(), "boe-password-mail-feed-"))
  emptyRoot = await mkdtemp(join(tmpdir(), "boe-password-mail-empty-"))
  const clientDir = join(publishedRoot, "client")
  await mkdir(clientDir, { recursive: true })
  await writeFile(join(clientDir, APK_FILENAME), "fake-apk-bytes")
  await writeFile(
    join(clientDir, "boe.dev.client.1.0.0.json"),
    JSON.stringify({
      apk: APK_FILENAME,
      target: "dev",
      variant: "client",
      version: "1.0.0",
      versionName: "1.0.0",
      versionCode: 100,
      applicationId: "com.beonedge.app.dev",
      sha256: "deadbeef",
      signing: "release",
    }),
  )

  const keyPair = await generateKeyPair("ES256", { extractable: true })
  webAuth = {
    userRepository: stack.userRepository,
    authSessionRepository: stack.authSessionRepository,
    auditRepository: stack.auditRepository,
    accessTokenService: createAccessTokenService({
      issuer: "https://api.beonedge.test",
      audience: "boe-web",
      currentKid: "k1",
      signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
      verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
    }),
    database: stack.database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    csrfKeyVersion: "cs1",
    clock: () => new Date(),
    config: { cookieSecure: false, originAllowlist: [ORIGIN] },
  }
  adminDeps = {
    webAuth,
    unitOfWork: stack.unitOfWork,
    database: stack.database,
    clock: () => new Date(),
    crypto: stack.crypto,
    config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" },
    appUpdate: { releaseRoot: publishedRoot, downloadBaseUrl: FEED_BASE },
    applicationRepository: createApplicationRepository(),
    applicationReviewRepository: createApplicationReviewRepository(),
    userRepository: stack.userRepository,
    credentialRepository: stack.credentialRepository,
    outboxRepository: stack.outboxRepository,
    emailDeliveryRepository: stack.emailDeliveryRepository,
    auditRepository: stack.auditRepository,
    idempotencyRepository: createIdempotencyRepository(),
  }
  app = buildApp()
  adminId = await createAdmin()
}, 220_000)

afterAll(async () => {
  await app.close()
  await rm(publishedRoot, { recursive: true, force: true })
  await rm(emptyRoot, { recursive: true, force: true })
  await stack.stop()
})

describe("admin client creation queues the invite", () => {
  test("in the creation transaction, with the link only in the sealed payload and the body released clients parse", async () => {
    const client = newClient()

    const response = await createClient(app, "create-client-0001", client)

    expect(response.statusCode).toBe(201)
    const created = dataOf<{ userId: string; passwordLink: Record<string, unknown> }>(response)
    expect(Object.keys(created).sort()).toEqual(["accountState", "emailVerification", "passwordLink", "userId"])
    expect(created).toMatchObject({ accountState: "active", emailVerification: "pending" })
    const { tokens, deliveries } = await userRows(created.userId)
    expect(created.passwordLink).toEqual({
      purpose: "set",
      expiresAt: new Date(tokens[0]?.expires_at as Date).toISOString(),
      deliveryId: deliveries[0]?.id,
      deliveryState: "queued",
    })
    expect(tokens).toMatchObject([
      { purpose: "set", consumed_at: null, bound_email_revision: "1", bound_credential_version: "0" },
    ])
    expect(deliveries).toMatchObject([
      { template_key: "password_set_link", template_version: "v1", state: "queued", application_id: null, attempt_count: 0 },
    ])
    const deliveryId = String(deliveries[0]?.id)
    const outbox = await stack.outboxRowOf(deliveryId)
    expect(outbox).toMatchObject({
      topic: "email.sealed",
      state: "pending",
      event_type: "user.password_set_link",
      aggregate_id: created.userId,
      deduplication_key: `password_link:${String(tokens[0]?.id)}`,
    })
    expect(outbox.payload).toEqual({
      template: "password_set_link",
      passwordTokenId: tokens[0]?.id,
      validForMs: TTL_MS,
    })
    const { link, rawToken } = await stack.linkOf(deliveryId)
    expect(link.startsWith(`${LINK_PAGE}?token=`)).toBe(true)
    expect(stack.crypto.hashToken(rawToken).hash).toEqual(tokens[0]?.token_hash)
    expect(await stack.payloadRow(deliveryId)).toMatchObject({ scrubbed_at: null, key_version: "ek1" })
    expect(await stack.rowsMentioning(rawToken)).toBe(0)
    expect(await stack.rowsMentioning(link)).toBe(0)
    expect(await stack.count("user_credentials", "user_id = $1", [created.userId])).toBe(0)
    const audited = await stack.pool.query<Row>(
      "select actor_type, actor_user_id, command from audit_events where entity_id = $1 and command like 'password.%_requested'",
      [created.userId],
    )
    expect(audited.rows).toEqual([{ actor_type: "admin", actor_user_id: adminId, command: "password.set_requested" }])
  })

  test("replays the same answer for the same key and queues no second invite", async () => {
    const client = newClient()
    const first = await createClient(app, "create-client-0002", client)
    const created = dataOf<{ userId: string }>(first)
    const before = await tableCounts()

    const replay = await createClient(app, "create-client-0002", client)

    expect(replay.statusCode).toBe(201)
    expect(dataOf(replay)).toEqual(created)
    expect(replay.json<{ meta: { idempotencyReplay?: boolean } }>().meta.idempotencyReplay).toBe(true)
    expect(await tableCounts()).toEqual(before)
    const { tokens, deliveries } = await userRows(created.userId)
    expect([tokens.length, deliveries.length]).toEqual([1, 1])
  })

  test("rolls the account, token, receipt and audit back together when the mail cannot be queued, and the key stays usable", async () => {
    const client = newClient()
    const broken = buildApp({
      outboxRepository: { ...stack.outboxRepository, enqueue: () => Promise.reject(new Error("outbox unavailable")) },
    })
    const before = await tableCounts()

    const failed = await createClient(broken, "create-client-0003", client)
    await broken.close()

    expect(failed.statusCode).toBe(500)
    expect(await tableCounts()).toEqual(before)
    expect(await stack.count("users", "email_normalized = $1", [client.email.toLowerCase()])).toBe(0)

    const retried = await createClient(app, "create-client-0003", client)
    expect(retried.statusCode).toBe(201)
  })

  test.each<[string, PasswordLinkSettings]>([
    ["no address configured", { clientUrl: null, requireHttps: true }],
    ["cleartext http where https is required", { clientUrl: "http://app.beonedge.test/reset-password", requireHttps: true }],
    ["credentials in the address", { clientUrl: "https://admin:secret@app.beonedge.test/reset-password", requireHttps: true }],
    ["a query string on the address", { clientUrl: `${LINK_PAGE}?campaign=1`, requireHttps: true }],
  ])("answers an explicit unavailable error and saves nothing for %s", async (_name, passwordLinks) => {
    const client = newClient()
    const key = `create-client-${randomUUID()}`
    const misconfigured = buildApp({ passwordLinks })
    const before = await tableCounts()

    const failed = await createClient(misconfigured, key, client)
    await misconfigured.close()

    expect(failed.statusCode).toBe(503)
    expect(errorOf(failed).code).toBe("DEPENDENCY_UNAVAILABLE")
    expect(errorOf(failed).message).toContain("CLIENT_PASSWORD_LINK_URL")
    expect(await tableCounts()).toEqual(before)
    expect(await stack.count("users", "email_normalized = $1", [client.email.toLowerCase()])).toBe(0)

    const repaired = await createClient(app, key, client)
    expect(repaired.statusCode).toBe(201)
  })

  test("still answers STATE_CONFLICT for an address that already has an account, and queues nothing for it", async () => {
    const client = newClient()
    const created = dataOf<{ userId: string }>(await createClient(app, "create-client-0005", client))
    const before = await tableCounts()

    const duplicate = await createClient(app, "create-client-0006", { ...client, phone: stack.nextPhone() })

    expect(duplicate.statusCode).toBe(409)
    expect(errorOf(duplicate).code).toBe("STATE_CONFLICT")
    expect(await tableCounts()).toEqual(before)
    expect((await userRows(created.userId)).deliveries).toHaveLength(1)
  })

  test("shows the queued mail in the admin delivery list under its own template key, with no secret", async () => {
    const client = newClient()
    const created = dataOf<{ userId: string }>(await createClient(app, "create-client-0007", client))
    const { deliveries } = await userRows(created.userId)
    const { link, rawToken } = await stack.linkOf(String(deliveries[0]?.id))
    const stored = await stack.payloadRow(String(deliveries[0]?.id))

    const listed = await app.inject({
      method: "GET",
      url: `/v1/admin/email-deliveries?limit=50&userId=${created.userId}`,
      headers: { origin: ORIGIN, cookie: session.cookie },
    })

    expect(listed.statusCode).toBe(200)
    expect(dataOf<{ items: Row[] }>(listed).items).toMatchObject([
      {
        emailDeliveryId: deliveries[0]?.id,
        templateKey: "password_set_link",
        templateVersion: "v1",
        state: "queued",
        attemptCount: 0,
        lastErrorCode: null,
        userId: created.userId,
        applicationId: null,
        sesMessageId: null,
      },
    ])
    for (const secret of [rawToken, link, (stored.ciphertext as Buffer).toString("hex"), (stored.ciphertext as Buffer).toString("base64")]) {
      expect(listed.body).not.toContain(secret)
    }
  })
})

describe("forgot password queues the reset link", () => {
  test("answers an unknown address, an inactive account, a throttled one and a queued one identically", async () => {
    const active = await stack.seedUser({ password: true })
    const suspended = await stack.seedUser({ password: true, state: "suspended" })

    const unknown = await postJson(app, "/v1/auth/password/forgot", { email: `nobody-${randomUUID()}@example.com` })
    const inactive = await postJson(app, "/v1/auth/password/forgot", { email: suspended.email })
    const queued = await postJson(app, "/v1/auth/password/forgot", { email: active.email })
    const throttled = await postJson(app, "/v1/auth/password/forgot", { email: active.email })

    for (const response of [unknown, inactive, queued, throttled]) {
      expect(response.statusCode).toBe(202)
      expect(dataOf(response)).toEqual({ status: "accepted" })
      expect(Object.keys(response.json<object>())).toEqual(Object.keys(unknown.json<object>()))
    }
    expect((await userRows(suspended.id)).tokens).toEqual([])
    expect((await userRows(suspended.id)).deliveries).toEqual([])
    const { tokens, deliveries } = await userRows(active.id)
    expect(tokens).toHaveLength(1)
    expect(deliveries).toMatchObject([{ template_key: "password_reset_link", state: "queued", application_id: null }])
    const { link, rawToken } = await stack.linkOf(String(deliveries[0]?.id))
    expect(link.startsWith(`${LINK_PAGE}?token=`)).toBe(true)
    expect(stack.crypto.hashToken(rawToken).hash).toEqual(tokens[0]?.token_hash)
    expect(await stack.rowsMentioning(rawToken)).toBe(0)
    expect(await stack.rowsMentioning(link)).toBe(0)
  })

  test("keeps the same answer and issues and queues nothing when the link address is unusable", async () => {
    const user = await stack.seedUser({ password: true })
    const misconfigured = buildApp({ passwordLinks: { clientUrl: null, requireHttps: true } })
    const before = await tableCounts()

    const response = await postJson(misconfigured, "/v1/auth/password/forgot", { email: user.email })
    await misconfigured.close()

    expect(response.statusCode).toBe(202)
    expect(dataOf(response)).toEqual({ status: "accepted" })
    expect(await tableCounts()).toEqual(before)
  })
})

describe("redeeming a link queues the app download mail", () => {
  const redeem = (target: FastifyInstance, rawToken: string) =>
    postJson(target, "/v1/auth/password/reset", { token: rawToken, newPassword: NEW_PASSWORD })

  test("in the redemption's own transaction, and never reports it as sent", async () => {
    const user = await stack.seedUser({ password: true })
    const queued = await stack.queueLink(user.id)
    const { rawToken } = await stack.linkOf(queued.deliveryId)

    const response = await redeem(app, rawToken)

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toEqual({ status: "password_set", downloadEmailStatus: "queued", downloadUrl: APK_URL })
    expect((await stack.tokenRow(queued.tokenId)).consumed_at).toBeInstanceOf(Date)
    expect((await stack.first("select version from user_credentials where user_id = $1", [user.id])).version).toBe("2")
    const download = (await userRows(user.id)).deliveries.filter((delivery) => delivery.template_key === "password_app_download")
    expect(download).toMatchObject([{ state: "queued", user_id: user.id, application_id: null }])
    expect(await stack.outboxRowOf(String(download[0]?.id))).toMatchObject({
      topic: "email",
      state: "pending",
      deduplication_key: `password_app_download:${queued.tokenId}`,
      payload: { template: "password_app_download", downloadUrl: APK_URL },
    })
    expect(await stack.payloadRow(String(download[0]?.id))).toEqual({})
  })

  test("stays successful and queues nothing when the queueing fails inside the database", async () => {
    const user = await stack.seedUser({ password: true })
    const queued = await stack.queueLink(user.id)
    const { rawToken } = await stack.linkOf(queued.deliveryId)
    const failing: EmailDeliveryWriteRepository = {
      ...stack.emailDeliveryRepository,
      createPasswordMailDelivery: async (tx, input) => {
        await sql`select 1 / 0`.execute(tx)
        return stack.emailDeliveryRepository.createPasswordMailDelivery(tx, input)
      },
    }
    const broken = buildApp({ emailDeliveryRepository: failing })
    const outboxBefore = await stack.count("outbox_events")

    const response = await redeem(broken, rawToken)
    await broken.close()

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toEqual({ status: "password_set", downloadEmailStatus: "unconfirmed", downloadUrl: APK_URL })
    expect((await stack.tokenRow(queued.tokenId)).consumed_at).toBeInstanceOf(Date)
    expect((await stack.first("select version from user_credentials where user_id = $1", [user.id])).version).toBe("2")
    expect((await userRows(user.id)).deliveries.map((delivery) => delivery.template_key)).toEqual(["password_reset_link"])
    expect(await stack.count("outbox_events")).toBe(outboxBefore)
  })

  test("answers unavailable and queues nothing when no client APK is published", async () => {
    const user = await stack.seedUser({ password: true })
    const queued = await stack.queueLink(user.id)
    const { rawToken } = await stack.linkOf(queued.deliveryId)
    const unpublished = buildApp({ releaseRoot: emptyRoot })

    const response = await redeem(unpublished, rawToken)
    await unpublished.close()

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toEqual({ status: "password_set", downloadEmailStatus: "unavailable", downloadUrl: null })
    expect((await userRows(user.id)).deliveries.map((delivery) => delivery.template_key)).toEqual(["password_reset_link"])
  })

  test("queues nothing for a link that cannot be redeemed", async () => {
    const user = await stack.seedUser({ password: true })
    const queued = await stack.queueLink(user.id)
    const { rawToken } = await stack.linkOf(queued.deliveryId)
    await stack.setAccountState(user.id, "suspended")
    const before = await tableCounts()

    const stale = await redeem(app, rawToken)
    const unknown = await redeem(app, `unknown-${randomUUID()}-${randomUUID()}`)

    expect([stale.statusCode, unknown.statusCode]).toEqual([401, 401])
    expect(errorOf(stale)).toEqual(errorOf(unknown))
    expect((await tableCounts()).slice(2)).toEqual(before.slice(2))
    expect((await stack.tokenRow(queued.tokenId)).consumed_at).toBeNull()
  })
})

describe("an admin resends a client's password link", () => {
  const linkUrl = (userId: string): string => `/v1/admin/clients/${userId}/password-link`

  const resend = (target: FastifyInstance, userId: string, key: string, as: Session = session) =>
    target.inject({
      method: "POST",
      url: linkUrl(userId),
      headers: { origin: ORIGIN, cookie: as.cookie, "x-csrf-token": as.csrf, "idempotency-key": key },
      payload: {},
    })

  const status = (userId: string, as: Session = session) =>
    app.inject({ method: "GET", url: linkUrl(userId), headers: { origin: ORIGIN, cookie: as.cookie } })

  const pastCooldown = async (userId: string): Promise<void> => {
    await stack.pool.query(
      "update password_credential_tokens set created_at = created_at - interval '2 minutes' where user_id = $1",
      [userId],
    )
  }

  test("queues a fresh link, retires the one it replaces, and shows it in the status", async () => {
    const created = dataOf<{ userId: string }>(await createClient(app, `create-${randomUUID()}`, newClient()))
    const [firstToken] = (await userRows(created.userId)).tokens
    await pastCooldown(created.userId)

    const response = await resend(app, created.userId, `resend-${randomUUID()}`)

    expect(response.statusCode).toBe(201)
    const sent = dataOf<{ userId: string; purpose: string; deliveryId: string; deliveryState: string; expiresAt: string }>(response)
    expect(sent).toMatchObject({ userId: created.userId, purpose: "set", deliveryState: "queued" })
    const { tokens, deliveries } = await userRows(created.userId)
    expect(tokens).toHaveLength(2)
    expect((await stack.tokenRow(String(firstToken?.id))).consumed_at).toBeInstanceOf(Date)
    expect(deliveries.map((delivery) => delivery.id)).toContain(sent.deliveryId)
    const audited = await stack.pool.query<Row>(
      "select actor_type, actor_user_id from audit_events where entity_id = $1 and command = 'password.set_requested' order by occurred_at",
      [created.userId],
    )
    expect(audited.rows).toEqual([
      { actor_type: "admin", actor_user_id: adminId },
      { actor_type: "admin", actor_user_id: adminId },
    ])

    const shown = await status(created.userId)
    expect(shown.statusCode).toBe(200)
    expect(dataOf(shown)).toMatchObject({
      userId: created.userId,
      hasPassword: false,
      latestLink: {
        purpose: "set",
        state: "active",
        expiresAt: sent.expiresAt,
        delivery: { deliveryId: sent.deliveryId, state: "queued", lastErrorCode: null, sentAt: null },
      },
    })
    expect(dataOf<{ nextLinkAllowedAt: string | null }>(shown).nextLinkAllowedAt).not.toBeNull()
    expect(JSON.stringify(dataOf(shown))).not.toMatch(/token/iu)
  })

  test("replays the same answer for the same key and issues no second link", async () => {
    const user = await stack.seedUser({ password: true })
    const key = `resend-${randomUUID()}`
    const first = await resend(app, user.id, key)
    const before = await tableCounts()

    const replay = await resend(app, user.id, key)

    expect(first.statusCode).toBe(201)
    expect(dataOf(first)).toMatchObject({ purpose: "reset" })
    expect(replay.statusCode).toBe(201)
    expect(dataOf(replay)).toEqual(dataOf(first))
    expect(replay.json<{ meta: { idempotencyReplay?: boolean } }>().meta.idempotencyReplay).toBe(true)
    expect(await tableCounts()).toEqual(before)
  })

  test("answers RATE_LIMITED inside the cooldown with a new key and changes nothing", async () => {
    const user = await stack.seedUser({ password: true })
    expect((await resend(app, user.id, `resend-${randomUUID()}`)).statusCode).toBe(201)
    const before = await tableCounts()

    const again = await resend(app, user.id, `resend-${randomUUID()}`)

    expect(again.statusCode).toBe(429)
    expect(errorOf(again).code).toBe("RATE_LIMITED")
    expect(await tableCounts()).toEqual(before)
  })

  test.each([
    ["an admin account", async () => adminId],
    ["a suspended client", async () => (await stack.seedUser({ password: true, state: "suspended" })).id],
    ["a closed client", async () => (await stack.seedUser({ password: true, state: "closed" })).id],
  ])("refuses %s with STATE_CONFLICT and writes nothing", async (_name, target) => {
    const userId = await target()
    const before = await tableCounts()

    const response = await resend(app, userId, `resend-${randomUUID()}`)

    expect(response.statusCode).toBe(409)
    expect(errorOf(response).code).toBe("STATE_CONFLICT")
    expect(await tableCounts()).toEqual(before)
  })

  test("answers RESOURCE_NOT_FOUND for an unknown user, on both routes", async () => {
    const unknown = randomUUID()

    expect(errorOf(await resend(app, unknown, `resend-${randomUUID()}`)).code).toBe("RESOURCE_NOT_FOUND")
    expect(errorOf(await status(unknown)).code).toBe("RESOURCE_NOT_FOUND")
  })

  test("answers 503 naming the setting and writes nothing when the link address is unusable", async () => {
    const user = await stack.seedUser({ password: true })
    const broken = buildApp({ passwordLinks: { clientUrl: null, requireHttps: true } })
    const before = await tableCounts()

    const response = await resend(broken, user.id, `resend-${randomUUID()}`)
    await broken.close()

    expect(response.statusCode).toBe(503)
    expect(errorOf(response)).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" })
    expect(errorOf(response).message).toContain("CLIENT_PASSWORD_LINK_URL")
    expect(await tableCounts()).toEqual(before)
  })

  test("denies a support admin on both routes and writes nothing", async () => {
    const support = await createRoleAdmin("support")
    const user = await stack.seedUser({ password: true })
    const before = await tableCounts()

    const sent = await resend(app, user.id, `resend-${randomUUID()}`, support.session)
    const read = await status(user.id, support.session)

    expect(sent.statusCode).toBe(403)
    expect(errorOf(sent).code).toBe("AUTHORIZATION_DENIED")
    expect(read.statusCode).toBe(403)
    expect(errorOf(read).code).toBe("AUTHORIZATION_DENIED")
    expect((await tableCounts()).slice(0, 6)).toEqual(before.slice(0, 6))
  })

  test("reports a client with a password and no link yet", async () => {
    const user = await stack.seedUser({ password: true })

    const shown = await status(user.id)

    expect(dataOf(shown)).toEqual({ userId: user.id, hasPassword: true, nextLinkAllowedAt: null, latestLink: null })
  })
})
