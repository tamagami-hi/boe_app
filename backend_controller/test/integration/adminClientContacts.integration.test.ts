import { randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest"

import { redeemPasswordToken } from "../../src/domain/auth/passwordCredential.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createEmailVerificationRepository } from "../../src/repositories/emailVerificationRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createIdentityLockRepository } from "../../src/repositories/identityLockRepository.js"
import { createUserContactRepository } from "../../src/repositories/userContactRepository.js"
import { registerAdminClientOnboardingRoutes } from "../../src/routes/adminClientOnboardingRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import {
  adminHeaders,
  adminWebAuth,
  registerAdminLogin,
  signInRoleAdmin,
  type AdminSession,
} from "./adminSessionSupport.js"
import { NEW_PASSWORD, PasswordMailStack, TTL_MS, type Row } from "./passwordMailSupport.js"

interface Client {
  readonly userId: string
  readonly email: string
  readonly phone: string
}

interface Correction {
  readonly email?: string
  readonly phone?: string
  readonly expectedVersion: number
}

let stack: PasswordMailStack
let app: FastifyInstance
let admin: AdminSession
let onboarding: AdminSession

const dataOf = <T>(response: { json: () => unknown }): T => (response.json() as { data: T }).data
const errorOf = (response: { json: () => unknown }) =>
  (response.json() as { error: { code: string; message: string; fields?: Record<string, string[]> } }).error

const TABLES = [
  "users",
  "user_contact_history",
  "password_credential_tokens",
  "email_deliveries",
  "audit_events",
  "idempotency_records",
]

const tableCounts = async (): Promise<number[]> => Promise.all(TABLES.map((table) => stack.count(table)))

const userRow = (userId: string): Promise<Row> => stack.first("select * from users where id = $1", [userId])

const versionOf = async (userId: string): Promise<number> => Number((await userRow(userId)).version)

const createClient = async (): Promise<Client> => {
  const email = `invitee-${randomUUID()}@example.com`
  const phone = stack.nextPhone()
  const response = await app.inject({
    method: "POST",
    url: "/v1/admin/clients",
    headers: adminHeaders(admin, `create-${randomUUID()}`),
    payload: { fullName: "Asha Verma", email, phone },
  })
  expect(response.statusCode).toBe(201)
  return { userId: dataOf<{ userId: string }>(response).userId, email, phone }
}

const correct = (userId: string, body: Correction, key: string, as: AdminSession = admin) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/contact-correction`,
    headers: adminHeaders(as, key),
    payload: body,
  })

const release = (userId: string, body: object, key: string, as: AdminSession = admin) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/users/${userId}/contact-release`,
    headers: adminHeaders(as, key),
    payload: body,
  })

const history = (userId: string) =>
  app.inject({ method: "GET", url: `/v1/admin/users/${userId}/contact-history`, headers: adminHeaders(admin) })

const tokensOf = async (userId: string): Promise<Row[]> =>
  (await stack.pool.query<Row>("select * from password_credential_tokens where user_id = $1 order by created_at", [userId]))
    .rows

const deliveriesOf = async (userId: string): Promise<Row[]> =>
  (await stack.pool.query<Row>("select * from email_deliveries where user_id = $1 order by created_at", [userId])).rows

const redeem = (rawToken: string) =>
  stack.unitOfWork.execute((tx) =>
    redeemPasswordToken(tx, stack.mailDeps(), { rawToken, newPassword: NEW_PASSWORD, requestId: randomUUID() }),
  )

beforeAll(async () => {
  stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  const mail = stack.mailDeps()
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerAdminClientOnboardingRoutes(instance, {
        ...mail,
        webAuth,
        unitOfWork: stack.unitOfWork,
        idempotencyRepository: createIdempotencyRepository(),
        applicationRepository: createApplicationRepository(),
        identityLockRepository: createIdentityLockRepository(),
        emailVerificationRepository: createEmailVerificationRepository(),
        userContactRepository: createUserContactRepository(),
        config: { ...mail.config, idempotencyTtlMs: 86_400_000 },
      })
    },
  })
  admin = await signInRoleAdmin(app, stack, "superadmin")
  onboarding = await signInRoleAdmin(app, stack, "onboarding")
}, 220_000)

afterAll(async () => {
  await app.close()
  await stack.stop()
})

beforeEach(() => {
  stack.clockOffsetMs = 0
})

describe("an admin corrects an invitee's contacts before a password is set", () => {
  test("moves the account to the corrected email, retires the old link and invites only the new address", async () => {
    const client = await createClient()
    const [oldToken] = await tokensOf(client.userId)
    const [oldDelivery] = await deliveriesOf(client.userId)
    const oldLink = await stack.linkOf(String(oldDelivery?.id))
    const corrected = `fixed-${randomUUID()}@example.com`

    const response = await correct(
      client.userId,
      { email: corrected.toUpperCase(), expectedVersion: await versionOf(client.userId) },
      `correct-${randomUUID()}`,
    )

    expect(response.statusCode).toBe(200)
    const body = dataOf<Record<string, unknown> & { passwordLink: Record<string, unknown> }>(response)
    expect(body).toMatchObject({
      userId: client.userId,
      email: corrected,
      phone: client.phone,
      emailChanged: true,
      phoneChanged: false,
      passwordLink: { purpose: "set", deliveryState: "queued" },
    })
    expect(await userRow(client.userId)).toMatchObject({
      email_normalized: corrected,
      email_revision: "2",
      email_verification_state: "pending",
    })
    const tokens = await tokensOf(client.userId)
    expect(tokens).toHaveLength(2)
    expect(tokens[0]).toMatchObject({ id: oldToken?.id, bound_email_revision: "1" })
    expect(tokens[0]?.consumed_at).toBeInstanceOf(Date)
    expect(tokens[1]).toMatchObject({ purpose: "set", consumed_at: null, bound_email_revision: "2" })
    expect((await redeem(oldLink.rawToken)).kind).not.toBe("redeemed")

    const transport = stack.transport()
    await stack.dispatch(transport)
    const recipients = transport.messages.map((message) => message.to)
    expect(recipients.filter((to) => to === client.email || to === corrected)).toEqual([corrected])
    expect(await stack.deliveryRow(String(oldDelivery?.id))).toMatchObject({ state: "cancelled" })

    const history = await stack.pool.query<Row>("select * from user_contact_history where user_id = $1", [client.userId])
    expect(history.rows).toMatchObject([
      {
        change_kind: "admin_correction",
        previous_email_normalized: client.email,
        new_email_normalized: corrected,
        previous_phone_e164: client.phone,
        new_phone_e164: client.phone,
        actor_user_id: admin.userId,
      },
    ])
    const audit = await stack.first(
      "select * from audit_events where entity_id = $1 and command = 'client_contacts.corrected'",
      [client.userId],
    )
    expect(audit).toMatchObject({ actor_type: "admin", actor_user_id: admin.userId })
    expect(JSON.stringify(audit.metadata)).not.toContain(client.email)
  })

  test("replays the same answer for the same key and changes nothing more", async () => {
    const client = await createClient()
    const key = `correct-${randomUUID()}`
    const body = { email: `fixed-${randomUUID()}@example.com`, expectedVersion: await versionOf(client.userId) }
    const first = await correct(client.userId, body, key)
    const before = await tableCounts()

    const replay = await correct(client.userId, body, key)
    const reused = await correct(client.userId, { ...body, email: `other-${randomUUID()}@example.com` }, key)

    expect(first.statusCode).toBe(200)
    expect(replay.statusCode).toBe(200)
    expect(dataOf(replay)).toEqual(dataOf(first))
    expect(replay.json<{ meta: { idempotencyReplay?: boolean } }>().meta.idempotencyReplay).toBe(true)
    expect(errorOf(reused).code).toBe("IDEMPOTENCY_KEY_REUSED")
    expect(await tableCounts()).toEqual(before)
  })

  test("corrects only the phone without retiring the link or sending a new one", async () => {
    const client = await createClient()
    const phone = stack.nextPhone()
    const before = await tokensOf(client.userId)

    const response = await correct(
      client.userId,
      { phone, expectedVersion: await versionOf(client.userId) },
      `correct-${randomUUID()}`,
    )

    expect(response.statusCode).toBe(200)
    expect(dataOf(response)).toMatchObject({ phone, emailChanged: false, phoneChanged: true, passwordLink: null })
    expect(await tokensOf(client.userId)).toEqual(before)
    expect(await userRow(client.userId)).toMatchObject({ phone_e164: phone, email_revision: "1" })
  })

  test("refuses a client who has set a password and changes nothing", async () => {
    const client = await createClient()
    const [delivery] = await deliveriesOf(client.userId)
    expect((await redeem((await stack.linkOf(String(delivery?.id))).rawToken)).kind).toBe("redeemed")
    const before = await tableCounts()

    const response = await correct(
      client.userId,
      { email: `late-${randomUUID()}@example.com`, expectedVersion: await versionOf(client.userId) },
      `correct-${randomUUID()}`,
    )

    expect(response.statusCode).toBe(409)
    expect(errorOf(response)).toMatchObject({ code: "STATE_CONFLICT" })
    expect(errorOf(response).message).toContain("already set a password")
    expect(await tableCounts()).toEqual(before)
    expect((await userRow(client.userId)).email_normalized).toBe(client.email)
  })

  test("reports each contact another account holds under its own field, including a closed account", async () => {
    const client = await createClient()
    const other = await stack.seedUser()
    const closed = await stack.seedUser({ state: "closed" })
    const closedPhone = String((await userRow(closed.id)).phone_e164)
    const before = await tableCounts()

    const response = await correct(
      client.userId,
      { email: other.email, phone: closedPhone, expectedVersion: await versionOf(client.userId) },
      `correct-${randomUUID()}`,
    )

    expect(response.statusCode).toBe(409)
    expect(errorOf(response).fields).toEqual({
      email: ["An account already uses this email address."],
      phone: ["An account already uses this phone number."],
    })
    expect(await tableCounts()).toEqual(before)
  })

  test("refuses a stale version, an admin account and an unchanged request", async () => {
    const client = await createClient()
    const version = await versionOf(client.userId)
    const before = await tableCounts()

    const stale = await correct(client.userId, { email: `x-${randomUUID()}@example.com`, expectedVersion: version + 1 }, `c-${randomUUID()}`)
    const adminTarget = await correct(admin.userId, { phone: stack.nextPhone(), expectedVersion: 1 }, `c-${randomUUID()}`)
    const unchanged = await correct(client.userId, { email: client.email, expectedVersion: version }, `c-${randomUUID()}`)

    expect(errorOf(stale)).toMatchObject({ code: "STATE_CONFLICT" })
    expect(errorOf(stale).message).toContain("changed since you opened it")
    expect(errorOf(adminTarget)).toMatchObject({ code: "STATE_CONFLICT" })
    expect(errorOf(unchanged)).toMatchObject({ code: "VALIDATION_FAILED" })
    expect(await tableCounts()).toEqual(before)
  })
})

describe("an admin releases a closed account's email and phone", () => {
  const closeAccount = async (client: Client): Promise<void> => {
    await stack.setAccountState(client.userId, "closed")
  }

  test("keeps the originals in history and frees both for a new account the old lookups find alone", async () => {
    const client = await createClient()
    await closeAccount(client)

    const response = await release(
      client.userId,
      { expectedVersion: await versionOf(client.userId), reasonCode: "typo_account", reason: "Recreated for the client" },
      `release-${randomUUID()}`,
    )

    expect(response.statusCode).toBe(200)
    const released = await userRow(client.userId)
    expect(released).toMatchObject({
      account_state: "closed",
      email_normalized: `released+${client.userId.replaceAll("-", "")}@released.invalid`,
      full_name: "Asha Verma",
    })
    expect(String(released.phone_e164)).toMatch(/^\+999[0-9]{11}$/u)
    expect(dataOf(response)).toMatchObject({ userId: client.userId, version: Number(released.version) })
    expect((await tokensOf(client.userId)).every((token) => token.consumed_at instanceof Date)).toBe(true)

    const read = await history(client.userId)
    expect(read.statusCode).toBe(200)
    expect(dataOf(read)).toMatchObject({
      userId: client.userId,
      contactsReleasedAt: dataOf<{ releasedAt: string }>(response).releasedAt,
      entries: [
        {
          kind: "closed_release",
          previousEmail: client.email,
          previousPhone: client.phone,
          newPhone: released.phone_e164,
          actorUserId: admin.userId,
          reasonCode: "typo_account",
          reason: "Recreated for the client",
        },
      ],
    })

    const recreated = await app.inject({
      method: "POST",
      url: "/v1/admin/clients",
      headers: adminHeaders(admin, `create-${randomUUID()}`),
      payload: { fullName: "Asha Verma", email: client.email, phone: client.phone },
    })
    expect(recreated.statusCode).toBe(201)
    const recreatedId = dataOf<{ userId: string }>(recreated).userId
    const login = await stack.userRepository.findLoginIdentityByEmail(stack.database, client.email)
    expect(login?.user.id).toBe(recreatedId)
    const owners = await stack.pool.query<Row>("select id from users where email_normalized = $1 or phone_e164 = $2", [
      client.email,
      client.phone,
    ])
    expect(owners.rows).toEqual([{ id: recreatedId }])
  })

  test("refuses an account that is not closed and a second release, and replays the first", async () => {
    const client = await createClient()
    const activeBefore = await tableCounts()
    const notClosed = await release(client.userId, { expectedVersion: await versionOf(client.userId) }, `r-${randomUUID()}`)
    expect(notClosed.statusCode).toBe(409)
    expect(errorOf(notClosed).message).toContain("Only a closed account")
    expect(await tableCounts()).toEqual(activeBefore)

    await closeAccount(client)
    const key = `release-${randomUUID()}`
    const body = { expectedVersion: await versionOf(client.userId) }
    const first = await release(client.userId, body, key)
    const before = await tableCounts()
    const replay = await release(client.userId, body, key)
    const second = await release(client.userId, { expectedVersion: await versionOf(client.userId) }, `r-${randomUUID()}`)

    expect(first.statusCode).toBe(200)
    expect(dataOf(replay)).toEqual(dataOf(first))
    expect(replay.json<{ meta: { idempotencyReplay?: boolean } }>().meta.idempotencyReplay).toBe(true)
    expect(second.statusCode).toBe(409)
    expect(errorOf(second).message).toContain("already released")
    expect(await tableCounts()).toEqual(before)
  })

  test("denies an admin without users.close and writes nothing", async () => {
    const client = await createClient()
    await closeAccount(client)
    const before = await tableCounts()

    const response = await release(client.userId, { expectedVersion: await versionOf(client.userId) }, `r-${randomUUID()}`, onboarding)

    expect(response.statusCode).toBe(403)
    expect((await tableCounts()).slice(0, 4)).toEqual(before.slice(0, 4))
  })

  test("refuses to rewrite the history once written", async () => {
    const client = await createClient()
    await correct(client.userId, { phone: stack.nextPhone(), expectedVersion: await versionOf(client.userId) }, `c-${randomUUID()}`)

    await expect(
      stack.pool.query("update user_contact_history set new_phone_e164 = '+14155550000' where user_id = $1", [client.userId]),
    ).rejects.toThrow(/append-only/u)
    await expect(stack.pool.query("delete from user_contact_history where user_id = $1", [client.userId])).rejects.toThrow(
      /append-only/u,
    )
  })
})

describe("an admin sends a new invite after the old one lapsed", () => {
  test("issues a usable link after the first expired and its mail was cancelled", async () => {
    const client = await createClient()
    const [firstDelivery] = await deliveriesOf(client.userId)
    const firstLink = await stack.linkOf(String(firstDelivery?.id))
    stack.clockOffsetMs = TTL_MS + 1_000
    await stack.dispatch(stack.transport())
    expect(await stack.deliveryRow(String(firstDelivery?.id))).toMatchObject({ state: "cancelled" })

    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/clients/${client.userId}/password-link`,
      headers: adminHeaders(admin, `resend-${randomUUID()}`),
      payload: {},
    })

    expect(response.statusCode).toBe(201)
    const sent = dataOf<{ deliveryId: string; purpose: string }>(response)
    expect(sent.purpose).toBe("set")
    expect((await redeem(firstLink.rawToken)).kind).not.toBe("redeemed")
    expect((await redeem((await stack.linkOf(sent.deliveryId)).rawToken)).kind).toBe("redeemed")
  })
})
