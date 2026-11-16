import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { createPasswordRecheckLimiter } from "../../src/auth/passwordRecheckLimiter.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createAdminOversightRepository } from "../../src/repositories/adminOversightRepository.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createEmailChangeRepository } from "../../src/repositories/emailChangeRepository.js"
import { createEmailVerificationRepository } from "../../src/repositories/emailVerificationRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createIdentityLockRepository } from "../../src/repositories/identityLockRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { registerAdminOversightRoutes } from "../../src/routes/adminOversightRoutes.js"
import { registerClientProfileRoutes } from "../../src/routes/clientProfileRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import {
  adminHeaders,
  adminWebAuth,
  registerAdminLogin,
  signInRoleAdmin,
  type AdminSession,
} from "./adminSessionSupport.js"
import { bearer, registerNomineeTestSurface, seedNomineeClient, type NomineeClient } from "./nomineeSupport.js"
import { PASSWORD, PasswordMailStack, type Row } from "./passwordMailSupport.js"

const PROFILE_KEYS = ["email", "emailVerification", "fullName", "pendingEmailChange", "phone", "phoneVerified", "userId", "version"]
const ADMIN_DETAIL_KEYS = ["emailVerification", "orders", "roles", "user"]
const NOMINEE = { name: "Meera Krishnan Rao", relation: "Spouse" }
const WRONG_PASSWORD = "not the client's real password"

type Client = NomineeClient

interface NomineeResponse {
  readonly userId: string
  readonly nominee: { readonly name: string; readonly relation: string } | null
  readonly version: number
  readonly status?: string
}

let stack: PasswordMailStack
let app: FastifyInstance
let webAuth: WebAuthDeps
let admin: AdminSession
let onboarding: AdminSession
let support: AdminSession
let finance: AdminSession

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }) =>
  (response.json() as { error: { code: string; fields?: Record<string, string[]> } }).error

const seedClient = (state: "active" | "suspended" | "closed" = "active"): Promise<Client> => seedNomineeClient(stack, webAuth, state)

const clientGet = (client: Client) => app.inject({ method: "GET", url: "/v1/client/profile/nominee", headers: bearer(client) })

const clientPost = (client: Client, payload: object, currentPassword: string = PASSWORD) =>
  app.inject({
    method: "POST",
    url: "/v1/client/profile/nominee",
    headers: bearer(client),
    payload: { ...payload, currentPassword },
  })

const clientRequest = (client: Client, payload: object) =>
  app.inject({
    method: "POST",
    url: "/v1/client/nominee-requests",
    headers: bearer(client, randomUUID()),
    payload: { ...payload, currentPassword: PASSWORD },
  })

const adminGet = (userId: string, as: AdminSession = admin) =>
  app.inject({ method: "GET", url: `/v1/admin/users/${userId}/nominee`, headers: adminHeaders(as) })

const adminPost = (userId: string, payload: object, key: string | undefined, as: AdminSession = admin) =>
  app.inject({ method: "POST", url: `/v1/admin/users/${userId}/nominee`, headers: adminHeaders(as, key), payload })

const nomineeRow = (userId: string): Promise<Row> =>
  stack.first("select nominee_name, nominee_relation, nominee_version, version from users where id = $1", [userId])

const auditRows = async (userId: string): Promise<Row[]> =>
  (
    await stack.pool.query<Row>(
      "select actor_type, actor_user_id, command, entity_version, metadata from audit_events where entity_id = $1 and command = 'user.nominee_changed' order by occurred_at, id",
      [userId],
    )
  ).rows

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  webAuth = await adminWebAuth(stack)
  const mail = stack.mailDeps()
  const idempotencyRepository = createIdempotencyRepository()
  const clientAuth = { accessTokenService: webAuth.accessTokenService, database: stack.database, clientWeb: { originAllowlist: [] } }
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerNomineeTestSurface(instance, stack, webAuth)
      registerClientProfileRoutes(instance, {
        ...mail,
        ...clientAuth,
        unitOfWork: stack.unitOfWork,
        emailVerificationRepository: createEmailVerificationRepository(),
        emailChangeRepository: createEmailChangeRepository(),
        applicationRepository: createApplicationRepository(),
        identityLockRepository: createIdentityLockRepository(),
        passwordRecheckLimiter: createPasswordRecheckLimiter(stack.clock),
        config: { sesConfigurationSet: "boe-transactional", codeTtlMs: 600_000, maxAttempts: 5, resendCooldownMs: 60_000 },
      })
      registerAdminOversightRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        config: { cursorKey: randomBytes(32), idempotencyTtlMs: 86_400_000 },
        oversightRepository: createAdminOversightRepository(),
        loginEventRepository: createLoginEventRepository(),
        auditRepository: stack.auditRepository,
        idempotencyRepository,
        authSessionRepository: stack.authSessionRepository,
      })
    },
  })
  admin = await signInRoleAdmin(app, stack, "superadmin")
  onboarding = await signInRoleAdmin(app, stack, "onboarding")
  support = await signInRoleAdmin(app, stack, "support")
  finance = await signInRoleAdmin(app, stack, "finance")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

describe("a client's own nominee", () => {
  test("reads only the signed-in client's nominee and refuses every direct change without touching it", async () => {
    const asha = await seedClient()
    const ravi = await seedClient()
    expect((await adminPost(asha.id, { ...NOMINEE, expectedVersion: 0 }, randomUUID())).statusCode).toBe(200)
    const ashaBefore = await nomineeRow(asha.id)
    const raviBefore = await nomineeRow(ravi.id)

    expect(dataOf<NomineeResponse>(await clientGet(asha))).toEqual({ userId: asha.id, nominee: NOMINEE, version: 1 })
    expect(dataOf<NomineeResponse>(await clientGet(ravi))).toEqual({ userId: ravi.id, nominee: null, version: 0 })

    const attempts: readonly (readonly [Client, object, string])[] = [
      [asha, { name: "Kiran Rao", relation: "Son" }, PASSWORD],
      [asha, { name: null, relation: null }, PASSWORD],
      [asha, { name: "Kiran Rao", relation: "Son" }, WRONG_PASSWORD],
      [ravi, NOMINEE, PASSWORD],
      [ravi, { ...NOMINEE, userId: asha.id }, PASSWORD],
      [ravi, {}, PASSWORD],
    ]
    for (const [client, payload, password] of attempts) {
      const refused = await clientPost(client, payload, password)
      expect(refused.statusCode, JSON.stringify(payload)).toBe(403)
      expect(errorOf(refused).code).toBe("AUTHORIZATION_DENIED")
    }

    expect(await nomineeRow(asha.id)).toEqual(ashaBefore)
    expect(await nomineeRow(ravi.id)).toEqual(raviBefore)
    expect(await stack.count("audit_events", "actor_user_id = any($1::uuid[])", [[asha.id, ravi.id]])).toBe(0)
    expect((await clientRequest(asha, { name: "Kiran Rao", relation: "Son" })).statusCode).toBe(201)
  })

  test("needs a signed-in active client", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/client/profile/nominee" })).statusCode).toBe(401)
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/client/profile/nominee",
          payload: { ...NOMINEE, currentPassword: PASSWORD },
        })
      ).statusCode,
    ).toBe(401)
  })

  test("leaves users.version and the existing profile and admin user responses unchanged", async () => {
    const client = await seedClient()
    await adminPost(client.id, { ...NOMINEE, expectedVersion: 0 }, randomUUID())
    await adminPost(client.id, { name: "Kiran Rao", relation: "Son", expectedVersion: 1 }, randomUUID())
    expect(await nomineeRow(client.id)).toMatchObject({ nominee_name: "Kiran Rao", nominee_version: 2, version: "1" })

    const profile = await app.inject({ method: "GET", url: "/v1/client/profile", headers: bearer(client) })
    expect(Object.keys(dataOf<Row>(profile)).sort()).toEqual(PROFILE_KEYS)
    expect(dataOf<Row>(profile).version).toBe(1)
    const detail = await app.inject({ method: "GET", url: `/v1/admin/users/${client.id}/detail`, headers: adminHeaders(admin) })
    expect(detail.statusCode).toBe(200)
    expect(Object.keys(dataOf<Row>(detail)).sort()).toEqual(ADMIN_DETAIL_KEYS)
    expect(JSON.stringify(dataOf<Row>(detail))).not.toContain("Kiran")
  })
})

describe("the admin nominee endpoints", () => {
  test("allow users.read to read and clients.create to edit client accounts only", async () => {
    const client = await seedClient()
    const nominee = { name: "ഗോപാല്\u200D കൃഷ്ണൻ", relation: "മകൻ" }

    for (const outsider of [support, finance]) {
      expect((await adminGet(client.id, outsider)).statusCode).toBe(403)
      expect((await adminPost(client.id, { ...nominee, expectedVersion: 0 }, randomUUID(), outsider)).statusCode).toBe(403)
    }
    expect(await nomineeRow(client.id)).toMatchObject({ nominee_name: null, nominee_version: 0 })

    const set = await adminPost(client.id, { ...nominee, expectedVersion: 0 }, randomUUID(), onboarding)
    expect(set.statusCode).toBe(200)
    expect(dataOf<NomineeResponse>(await adminGet(client.id, onboarding))).toEqual({ userId: client.id, nominee, version: 1 })
    expect(await auditRows(client.id)).toMatchObject([
      { actor_type: "admin", actor_user_id: onboarding.userId, metadata: { change: "added", currentName: "ഗ***" } },
    ])
    expect(errorOf(await adminGet(onboarding.userId)).code).toBe("RESOURCE_NOT_FOUND")
    expect(errorOf(await adminGet(randomUUID())).code).toBe("RESOURCE_NOT_FOUND")
  })

  test("hold one change per idempotency key, refuse a stale version and refuse non-client or closed accounts", async () => {
    const client = await seedClient("suspended")
    const key = randomUUID()
    const body = { name: "Kiran Rao", relation: "Son", expectedVersion: 0 }

    expect(errorOf(await adminPost(client.id, body, undefined)).code).toBe("VALIDATION_FAILED")
    const first = await adminPost(client.id, body, key)
    const replay = await adminPost(client.id, body, key)
    expect(first.statusCode).toBe(200)
    expect(dataOf<NomineeResponse>(replay)).toEqual(dataOf<NomineeResponse>(first))
    expect(replay.json()).toMatchObject({ meta: { idempotencyReplay: true } })
    expect(await auditRows(client.id)).toHaveLength(1)
    expect(errorOf(await adminPost(client.id, { ...body, relation: "Daughter" }, key)).code).toBe("IDEMPOTENCY_KEY_REUSED")

    expect(errorOf(await adminPost(client.id, { ...body, relation: "Daughter" }, randomUUID())).code).toBe("STATE_CONFLICT")
    expect(await nomineeRow(client.id)).toEqual({ nominee_name: "Kiran Rao", nominee_relation: "Son", nominee_version: 1, version: "1" })

    expect(errorOf(await adminPost(onboarding.userId, body, randomUUID())).code).toBe("STATE_CONFLICT")
    const closed = await seedClient("closed")
    expect(errorOf(await adminPost(closed.id, body, randomUUID())).code).toBe("STATE_CONFLICT")
    expect(await nomineeRow(closed.id)).toMatchObject({ nominee_name: null, nominee_version: 0 })
  })
})

describe("nominee validation", () => {
  const refusals: readonly (readonly [object, string])[] = [
    [{ name: "Meera Rao", relation: null }, "relation"],
    [{ name: null, relation: "Spouse" }, "name"],
    [{ name: "M", relation: "Spouse" }, "name"],
    [{ name: "x".repeat(121), relation: "Spouse" }, "name"],
    [{ name: "Meera\u0007Rao", relation: "Spouse" }, "name"],
    [{ name: "Meera Rao", relation: "S" }, "relation"],
    [{ name: "Meera Rao", relation: "x".repeat(121) }, "relation"],
    [{ name: "Meera Rao", relation: "Sp\u0085ouse" }, "relation"],
    [{ name: "Meera\u200bRao", relation: "Spouse" }, "name"],
    [{ name: "Meera\ufeffRao", relation: "Spouse" }, "name"],
    [{ name: "Meera Rao", relation: "Spo\u202euse" }, "relation"],
    [{ name: "Meera Rao", relation: "Spo\u2028use" }, "relation"],
    [{ name: "-- .", relation: "Spouse" }, "name"],
    [{ name: "\u200DMeera Rao", relation: "Spouse" }, "name"],
    [{ name: "Meera Rao", relation: "Spouse\u200C" }, "relation"],
  ]

  test("refuses a half nominee, bad lengths, control or invisible characters, edge joiners and text without a letter", async () => {
    const client = await seedClient()
    for (const [payload, field] of refusals) {
      const fromClient = await clientRequest(client, payload)
      expect(fromClient.statusCode, JSON.stringify(payload)).toBe(400)
      expect(Object.keys(errorOf(fromClient).fields ?? {}), JSON.stringify(payload)).toEqual([field])
      const fromAdmin = await adminPost(client.id, { ...payload, expectedVersion: 0 }, randomUUID())
      expect(fromAdmin.statusCode, JSON.stringify(payload)).toBe(400)
      expect(Object.keys(errorOf(fromAdmin).fields ?? {}), JSON.stringify(payload)).toEqual([field])
    }
    expect(await nomineeRow(client.id)).toEqual({ nominee_name: null, nominee_relation: null, nominee_version: 0, version: "1" })
    expect(await auditRows(client.id)).toEqual([])
    expect(await stack.count("client_nominee_requests", "user_id = $1", [client.id])).toBe(0)
  })
})

describe("tombstoning", () => {
  test("clears the nominee, which then reads as none and cannot be set again", async () => {
    const client = await seedClient()
    await adminPost(client.id, { ...NOMINEE, expectedVersion: 0 }, randomUUID())
    await stack.setAccountState(client.id, "closed")

    await stack.pool.query("update users set pii_tombstoned_at = now() where id = $1", [client.id])

    expect(await nomineeRow(client.id)).toMatchObject({ nominee_name: null, nominee_relation: null })
    const read = dataOf<NomineeResponse>(await adminGet(client.id))
    expect(read.nominee).toBeNull()
    expect(errorOf(await adminPost(client.id, { ...NOMINEE, expectedVersion: read.version }, randomUUID())).code).toBe(
      "STATE_CONFLICT",
    )
    expect(await nomineeRow(client.id)).toMatchObject({ nominee_name: null, nominee_relation: null })
    expect(await auditRows(client.id)).toHaveLength(1)
  })
})
