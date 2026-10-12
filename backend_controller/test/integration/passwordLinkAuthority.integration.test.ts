import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { FastifyInstance } from "fastify"
import type { Pool } from "pg"
import { Wait } from "testcontainers"
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { hashPassword, verifyPassword } from "../../src/auth/passwordHasher.js"
import { createPasswordRecheckLimiter } from "../../src/auth/passwordRecheckLimiter.js"
import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import type { CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import {
  changePassword,
  issuePasswordToken,
  redeemPasswordToken,
  type PasswordCredentialDeps,
  type PasswordLinkRequester,
} from "../../src/domain/auth/passwordCredential.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPasswordTokenRepository } from "../../src/repositories/passwordTokenRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { registerPasswordRoutes, type PasswordRoutesDeps } from "../../src/routes/passwordRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"

const PASSWORD = "the password a client already has"
const NEW_PASSWORD = "another correct horse battery staple"
const COOLDOWN_MS = 60_000
const TTL_MS = 600_000

type Row = Record<string, unknown>
type AccountState = "active" | "suspended" | "closed" | "invited"

interface SeededUser {
  readonly id: string
  readonly email: string
}

interface Gate {
  readonly reached: Promise<void>
  readonly release: () => void
  readonly wrap: <A extends unknown[], R>(work: (...args: A) => Promise<R>) => (...args: A) => Promise<R>
}

let container: StartedPostgreSqlContainer
let pool: Pool
let unitOfWork: UnitOfWork
let crypto: CryptoContext
let passwordHash: string
let phoneCounter = 0
let clockOffsetMs = 0

const passwordTokenRepository = createPasswordTokenRepository()
const credentialRepository = createCredentialRepository()
const userRepository = createUserRepository()
const key = (): string => randomBytes(32).toString("base64")
const clock = (): Date => new Date(Date.now() + clockOffsetMs)

const baseDeps = (): PasswordCredentialDeps => ({
  passwordTokenRepository,
  credentialRepository,
  authSessionRepository: createAuthSessionRepository(),
  userRepository,
  auditRepository: createAuditRepository(),
  crypto,
  clock,
  config: { tokenTtlMs: TTL_MS, maxAttempts: 5, requestCooldownMs: COOLDOWN_MS },
})

const createGate = (): Gate => {
  let signalReached: () => void = () => undefined
  let release: () => void = () => undefined
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    reached,
    release,
    wrap:
      (work) =>
      async (...args) => {
        signalReached()
        await released
        return work(...args)
      },
  }
}

const nextPhone = (): string => {
  phoneCounter += 1
  return `+1415557${String(phoneCounter).padStart(4, "0")}`
}

const seedUser = async (options: { password?: boolean } = {}): Promise<SeededUser> => {
  const email = `link-${randomUUID()}@example.com`
  const id = (
    await pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, 'Ada Lovelace', 'active', now()) returning id",
      [email, nextPhone()],
    )
  ).rows[0]?.id
  if (id === undefined) throw new Error("user not created")
  if (options.password === true) {
    await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [id, passwordHash])
  }
  return { id, email }
}

const setAccountState = async (userId: string, state: AccountState): Promise<void> => {
  await pool.query(
    "update users set account_state = $2::user_account_state, " +
      "suspended_at = case when $2 = 'suspended' then now() else suspended_at end, " +
      "closed_at = case when $2 = 'closed' then now() else closed_at end where id = $1",
    [userId, state],
  )
}

const issue = (userId: string, requester: PasswordLinkRequester = { kind: "system" }) =>
  unitOfWork.execute((tx) => issuePasswordToken(tx, baseDeps(), { userId, requestId: randomUUID(), requester }))

const redeem = (rawToken: string, deps: PasswordCredentialDeps = baseDeps()) =>
  unitOfWork.execute((tx) =>
    redeemPasswordToken(tx, deps, { rawToken, newPassword: NEW_PASSWORD, requestId: randomUUID() }),
  )

const tokenRows = async (userId: string): Promise<Row[]> =>
  (await pool.query<Row>("select * from password_credential_tokens where user_id = $1 order by created_at, id", [userId]))
    .rows

const activeTokens = async (userId: string): Promise<Row[]> =>
  (await pool.query<Row>("select * from password_credential_tokens where user_id = $1 and consumed_at is null", [userId]))
    .rows

const tokenByRaw = async (rawToken: string): Promise<Row> =>
  (
    await pool.query<Row>("select * from password_credential_tokens where token_hash = $1", [
      crypto.hashToken(rawToken).hash,
    ])
  ).rows[0] ?? {}

const credentialOf = async (userId: string): Promise<Row | null> =>
  (await pool.query<Row>("select password_hash, version from user_credentials where user_id = $1", [userId])).rows[0] ??
  null

const insertToken = async (
  userId: string,
  options: { purpose: "set" | "reset"; binding: readonly [string, string] | null },
): Promise<string> => {
  const rawToken = `forged-${randomUUID()}-${randomUUID()}`
  await pool.query(
    "insert into password_credential_tokens (user_id, purpose, token_hash, token_key_version, expires_at, " +
      "bound_email_revision, bound_credential_version) " +
      "values ($1, $2::password_token_purpose, $3, 'tk1', now() + interval '10 minutes', $4, $5)",
    [userId, options.purpose, crypto.hashToken(rawToken).hash, options.binding?.[0] ?? null, options.binding?.[1] ?? null],
  )
  return rawToken
}

const waitForBlockedBackend = (): Promise<void> =>
  vi.waitFor(
    async () => {
      const blocked = await pool.query<{ c: number }>(
        "select count(*)::int as c from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      )
      expect(blocked.rows[0]?.c).toBeGreaterThan(0)
    },
    { timeout: 5_000, interval: 25 },
  )

const releaseOnceBlocked = async (gate: Gate, started: readonly Promise<unknown>[]): Promise<void> => {
  try {
    await waitForBlockedBackend()
  } finally {
    gate.release()
    await Promise.allSettled(started)
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start()
  pool = createPool({
    connectionString: container.getConnectionUri(),
    poolMax: 10,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
  })
  unitOfWork = createUnitOfWork(createDatabase(pool))
  crypto = createCryptoContext(
    parseCryptoKeys({
      CRYPTO_TOKEN_HASH_KEY: key(),
      CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
      CRYPTO_CONSENT_IP_HMAC_KEY: key(),
      CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
      CRYPTO_RECIPIENT_HMAC_KEY: key(),
      CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
      CRYPTO_RECIPIENT_ENC_KEY: key(),
      CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
    }),
  )
  const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
  await runMigrations(pool, await loadMigrationFiles(directory))
  passwordHash = await hashPassword(PASSWORD)
}, 220_000)

afterAll(async () => {
  await pool.end()
  await container.stop()
})

beforeEach(() => {
  clockOffsetMs = 0
})

describe("password link issuance on PostgreSQL", () => {
  test("derives set or reset from the stored password and binds the email revision and credential version", async () => {
    const fresh = await seedUser()
    const holder = await seedUser({ password: true })

    const set = await issue(fresh.id)
    const reset = await issue(holder.id)

    expect([set.purpose, reset.purpose]).toEqual(["set", "reset"])
    expect(await activeTokens(fresh.id)).toMatchObject([
      { purpose: "set", bound_email_revision: "1", bound_credential_version: "0" },
    ])
    expect(await activeTokens(holder.id)).toMatchObject([
      { purpose: "reset", bound_email_revision: "1", bound_credential_version: "1" },
    ])
  })

  test("issues nothing for a suspended, closed or invited account and writes no audit row", async () => {
    for (const state of ["suspended", "closed", "invited"] as const) {
      const user = await seedUser({ password: true })
      await setAccountState(user.id, state)

      await expect(issue(user.id)).rejects.toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" })

      expect(await tokenRows(user.id)).toHaveLength(0)
      const audited = await pool.query("select 1 from audit_events where entity_id = $1", [user.id])
      expect(audited.rowCount).toBe(0)
    }
  })

  test("applies one cooldown per user whoever asks, and a newer link retires the older one", async () => {
    const user = await seedUser({ password: true })
    const admin = await seedUser()

    const first = await issue(user.id, { kind: "admin", userId: admin.id })
    await expect(issue(user.id, { kind: "user", userId: user.id })).rejects.toMatchObject({ code: "RATE_LIMITED" })
    await expect(issue(user.id)).rejects.toMatchObject({ code: "RATE_LIMITED" })
    expect(await tokenRows(user.id)).toHaveLength(1)

    clockOffsetMs = COOLDOWN_MS + 1_000
    const second = await issue(user.id)

    const rows = await tokenRows(user.id)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.consumed_at).toBeInstanceOf(Date)
    expect(rows[1]?.consumed_at).toBeNull()
    expect((await redeem(first.rawToken)).kind).toBe("unknown_token")
    expect((await redeem(second.rawToken)).kind).toBe("redeemed")
    const audit = await pool.query<Row>(
      "select actor_type, actor_user_id, command from audit_events where entity_id = $1 and command like 'password.%_requested' order by occurred_at",
      [user.id],
    )
    expect(audit.rows[0]).toEqual({ actor_type: "admin", actor_user_id: admin.id, command: "password.reset_requested" })
  })
})

describe("password link redemption on PostgreSQL", () => {
  test("a set link creates the first password once and a reset link replaces it, each retiring the link", async () => {
    const fresh = await seedUser()
    const setLink = await issue(fresh.id)

    expect(await redeem(setLink.rawToken)).toMatchObject({ kind: "redeemed", purpose: "set", userId: fresh.id })
    expect(await verifyPassword(String((await credentialOf(fresh.id))?.password_hash), NEW_PASSWORD)).toBe(true)
    expect((await credentialOf(fresh.id))?.version).toBe("1")
    expect(await activeTokens(fresh.id)).toHaveLength(0)
    expect((await redeem(setLink.rawToken)).kind).toBe("unknown_token")

    clockOffsetMs = COOLDOWN_MS + 1_000
    const resetLink = await issue(fresh.id)
    expect(resetLink.purpose).toBe("reset")
    expect(await redeem(resetLink.rawToken)).toMatchObject({ kind: "redeemed", purpose: "reset" })
    expect((await credentialOf(fresh.id))?.version).toBe("2")
    expect(await activeTokens(fresh.id)).toHaveLength(0)
  })

  interface Scenario {
    readonly name: string
    readonly expected: string
    readonly arrange: () => Promise<{ userId: string; rawToken: string; redeemAtOffsetMs?: number }>
  }

  const SCENARIOS: readonly Scenario[] = [
    {
      name: "a link that carries no binding",
      expected: "unbound",
      arrange: async () => {
        const user = await seedUser({ password: true })
        return { userId: user.id, rawToken: await insertToken(user.id, { purpose: "reset", binding: null }) }
      },
    },
    {
      name: "an account suspended after the link was issued",
      expected: "inactive_account",
      arrange: async () => {
        const user = await seedUser({ password: true })
        const link = await issue(user.id)
        await setAccountState(user.id, "suspended")
        return { userId: user.id, rawToken: link.rawToken }
      },
    },
    {
      name: "an email revision that moved after the link was issued",
      expected: "stale_email",
      arrange: async () => {
        const user = await seedUser({ password: true })
        const link = await issue(user.id)
        await pool.query("update users set email_revision = email_revision + 1 where id = $1", [user.id])
        return { userId: user.id, rawToken: link.rawToken }
      },
    },
    {
      name: "a credential replaced after the link was issued by a path that retires no links",
      expected: "stale_credential",
      arrange: async () => {
        const user = await seedUser({ password: true })
        const link = await issue(user.id)
        await pool.query("update user_credentials set password_hash = $2, version = version + 1 where user_id = $1", [
          user.id,
          await hashPassword("a password set somewhere else"),
        ])
        return { userId: user.id, rawToken: link.rawToken }
      },
    },
    {
      name: "a set link issued before a password appeared",
      expected: "stale_credential",
      arrange: async () => {
        const user = await seedUser()
        const link = await issue(user.id)
        await pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [user.id, passwordHash])
        return { userId: user.id, rawToken: link.rawToken }
      },
    },
    {
      name: "a set link whose binding matches an account that already has a password",
      expected: "credential_present",
      arrange: async () => {
        const user = await seedUser({ password: true })
        return { userId: user.id, rawToken: await insertToken(user.id, { purpose: "set", binding: ["1", "1"] }) }
      },
    },
    {
      name: "a link past its expiry",
      expected: "expired",
      arrange: async () => {
        const user = await seedUser({ password: true })
        const link = await issue(user.id)
        return { userId: user.id, rawToken: link.rawToken, redeemAtOffsetMs: TTL_MS + 1_000 }
      },
    },
  ]

  test.each(SCENARIOS)("refuses $name and changes neither the credential nor the link", async (scenario) => {
    const { userId, rawToken, redeemAtOffsetMs } = await scenario.arrange()
    const before = await credentialOf(userId)
    clockOffsetMs = redeemAtOffsetMs ?? 0

    const outcome = await redeem(rawToken)

    expect(outcome.kind).toBe(scenario.expected)
    expect(await credentialOf(userId)).toEqual(before)
    expect((await tokenByRaw(rawToken)).consumed_at).toBeNull()
  })

  test("changing the password retires the outstanding link, and the next link binds the new credential version", async () => {
    const user = await seedUser({ password: true })
    const outstanding = await issue(user.id)

    const changed = await unitOfWork.execute((tx) =>
      changePassword(tx, baseDeps(), {
        userId: user.id,
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        requestId: randomUUID(),
      }),
    )

    expect(changed.kind).toBe("changed")
    expect((await tokenByRaw(outstanding.rawToken)).consumed_at).toBeInstanceOf(Date)
    expect(await activeTokens(user.id)).toHaveLength(0)
    expect((await redeem(outstanding.rawToken)).kind).toBe("unknown_token")

    clockOffsetMs = COOLDOWN_MS + 1_000
    await issue(user.id)
    expect(await activeTokens(user.id)).toMatchObject([{ purpose: "reset", bound_credential_version: "2" }])
  })
})

describe("concurrent resend and redemption on two connections", () => {
  test("a resend that arrives while a redemption holds the locks waits, then binds the new password", async () => {
    const user = await seedUser({ password: true })
    const link = await issue(user.id)
    clockOffsetMs = COOLDOWN_MS + 1_000
    const gate = createGate()
    const slowRedemption = redeem(link.rawToken, {
      ...baseDeps(),
      credentialRepository: { ...credentialRepository, replace: gate.wrap(credentialRepository.replace) },
    })
    await gate.reached

    const resend = issue(user.id)
    await releaseOnceBlocked(gate, [slowRedemption, resend])
    const [redeemed, reissued] = await Promise.all([slowRedemption, resend])

    expect(redeemed.kind).toBe("redeemed")
    expect(reissued.purpose).toBe("reset")
    expect(await activeTokens(user.id)).toMatchObject([{ bound_credential_version: "2" }])
    expect(await verifyPassword(String((await credentialOf(user.id))?.password_hash), NEW_PASSWORD)).toBe(true)
  })

  test("a redemption that arrives while a resend holds the locks waits without deadlock and finds its link retired", async () => {
    const user = await seedUser({ password: true })
    const link = await issue(user.id)
    clockOffsetMs = COOLDOWN_MS + 1_000
    const before = await credentialOf(user.id)
    const gate = createGate()
    const slowResend = unitOfWork.execute((tx) =>
      issuePasswordToken(
        tx,
        {
          ...baseDeps(),
          passwordTokenRepository: {
            ...passwordTokenRepository,
            latestCreatedAt: gate.wrap(passwordTokenRepository.latestCreatedAt),
          },
        },
        { userId: user.id, requestId: randomUUID(), requester: { kind: "system" } },
      ),
    )
    await gate.reached

    const redemption = redeem(link.rawToken)
    await releaseOnceBlocked(gate, [slowResend, redemption])
    const [reissued, outcome] = await Promise.all([slowResend, redemption])

    expect(outcome.kind).toBe("unknown_token")
    expect(await credentialOf(user.id)).toEqual(before)
    const active = await activeTokens(user.id)
    expect(active).toHaveLength(1)
    expect(active[0]?.token_hash).toEqual(crypto.hashToken(reissued.rawToken).hash)
  })

  test("two resends at once issue one link and answer the other with the cooldown", async () => {
    const user = await seedUser({ password: true })
    const gate = createGate()
    const first = unitOfWork.execute((tx) =>
      issuePasswordToken(
        tx,
        {
          ...baseDeps(),
          passwordTokenRepository: {
            ...passwordTokenRepository,
            latestCreatedAt: gate.wrap(passwordTokenRepository.latestCreatedAt),
          },
        },
        { userId: user.id, requestId: randomUUID(), requester: { kind: "system" } },
      ),
    )
    await gate.reached

    const second = issue(user.id)
    await releaseOnceBlocked(gate, [first, second])
    const settled = await Promise.allSettled([first, second])

    expect(settled[0].status).toBe("fulfilled")
    expect(settled[1]).toMatchObject({ status: "rejected", reason: { code: "RATE_LIMITED" } })
    expect(await activeTokens(user.id)).toHaveLength(1)
  })
})

describe("password routes on PostgreSQL", () => {
  let app: FastifyInstance

  beforeAll(() => {
    app = createApplication({
      logger: false,
      registerRoutes: (instance) =>
        registerPasswordRoutes(instance, {
          ...baseDeps(),
          passwordRecheckLimiter: createPasswordRecheckLimiter(() => new Date()),
          unitOfWork,
          outboxRepository: createOutboxRepository(),
          emailDeliveryRepository: createEmailDeliveryRepository(),
          appUpdate: { releaseRoot: "/nonexistent", downloadBaseUrl: "https://app.test/downloads" },
          config: {
            tokenTtlMs: TTL_MS,
            maxAttempts: 5,
            requestCooldownMs: COOLDOWN_MS,
            passwordLinks: { clientUrl: "https://app.test/reset-password", requireHttps: true },
            sesConfigurationSet: "boe-transactional",
          },
        } as unknown as PasswordRoutesDeps),
    })
  })

  afterAll(async () => {
    await app.close()
  })

  const forgot = (email: string) =>
    app.inject({ method: "POST", url: "/v1/auth/password/forgot", payload: { email } })

  const queuedLinks = async (userIds: readonly string[]): Promise<Row[]> =>
    (
      await pool.query<Row>(
        "select d.id, d.template_key, d.state, d.user_id, p.ciphertext, p.nonce, p.key_version " +
          "from email_deliveries d join email_delivery_payloads p on p.email_delivery_id = d.id " +
          "where d.user_id = any($1::uuid[]) order by d.created_at",
        [userIds],
      )
    ).rows

  test("answers a forgot request the same for an unknown address, an inactive account, a throttled one and a mailed one", async () => {
    const active = await seedUser({ password: true })
    const suspended = await seedUser({ password: true })
    await setAccountState(suspended.id, "suspended")

    const unknown = await forgot(`nobody-${randomUUID()}@example.com`)
    const inactive = await forgot(suspended.email)
    const mailed = await forgot(active.email)
    const throttled = await forgot(active.email)

    for (const response of [unknown, inactive, mailed, throttled]) {
      expect(response.statusCode).toBe(202)
      expect(response.json<{ data: unknown }>().data).toEqual({ status: "accepted" })
    }
    expect(await tokenRows(suspended.id)).toHaveLength(0)
    expect(await tokenRows(active.id)).toHaveLength(1)
    const queued = await queuedLinks([active.id, suspended.id])
    expect(queued).toMatchObject([{ template_key: "password_reset_link", state: "queued", user_id: active.id }])
    const opened = crypto.decryptDeliveryPayload(String(queued[0]?.id), {
      ciphertext: queued[0]?.ciphertext as Buffer,
      nonce: queued[0]?.nonce as Buffer,
      keyVersion: String(queued[0]?.key_version),
    })
    if (opened.kind !== "opened") throw new Error("the sealed link could not be opened")
    const rawToken = new URL(String(opened.payload.link)).searchParams.get("token") ?? ""
    expect((await tokenByRaw(rawToken)).id).toBe((await tokenRows(active.id))[0]?.id)
  })

  test("answers a link that cannot be redeemed with the same 401 as an unknown link", async () => {
    const user = await seedUser({ password: true })
    const link = await issue(user.id)
    await setAccountState(user.id, "suspended")

    const stale = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { token: link.rawToken, newPassword: NEW_PASSWORD },
    })
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset",
      payload: { token: `unknown-${randomUUID()}-${randomUUID()}`, newPassword: NEW_PASSWORD },
    })

    expect([stale.statusCode, unknown.statusCode]).toEqual([401, 401])
    expect(stale.json<{ error: unknown }>().error).toEqual(unknown.json<{ error: unknown }>().error)
    expect(stale.json<{ error: { code: string } }>().error.code).toBe("INVALID_CREDENTIALS")
  })
})
