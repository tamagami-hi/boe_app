import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import type { AccessTokenService } from "../../src/auth/accessToken.js"
import type { EmailSender } from "../../src/email/emailSender.js"
import { clearAppUpdateCache } from "../../src/release/releaseFeed.js"
import { createClientAccountRepository } from "../../src/repositories/clientAccountRepository.js"
import { createClientValueEntryRepository } from "../../src/repositories/clientValueEntryRepository.js"
import { createEmailVerificationRepository } from "../../src/repositories/emailVerificationRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { registerClientAccountRoutes } from "../../src/routes/clientAccountRoutes.js"
import { registerClientEmailVerificationRoutes } from "../../src/routes/clientEmailVerificationRoutes.js"
import { registerClientReviewRoutes } from "../../src/routes/clientReviewRoutes.js"
import { registerClientStatementLinkRoutes } from "../../src/routes/clientStatementLinkRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminWebAuth } from "./adminSessionSupport.js"
import {
  envelopeOf,
  erase,
  recordFor,
  reverseEntry,
  seedClient,
  startErasureHarness,
  type ErasureHarness,
  type SeededClient,
} from "./erasureSupport.js"
import { TTL_MS } from "./passwordMailSupport.js"

type Response = Awaited<ReturnType<FastifyInstance["inject"]>>

interface RacingWrite {
  readonly arrange: (client: SeededClient) => Promise<void>
  readonly send: (bearer: string) => Promise<Response>
  readonly written: (client: SeededClient) => Promise<number>
}

const RECORDED_PAISE = 12_000_000n
const VERIFICATION_CODE = "Rac3Ng"
const LOCK_POLL_MS = 20
const LOCK_WAIT_LIMIT_MS = 10_000
const APPLICATION_ID = "com.beonedge.app.dev"
const PUBLISHED_VERSION = "0.15.2"
const PUBLISHED_VERSION_CODE = 1502
const REPORTED_VERSION_CODE = 1501

let harness: ErasureHarness
let app: FastifyInstance
let tokens: AccessTokenService
let feedRoot: string

const silentSender: EmailSender = { send: () => Promise.resolve({ messageId: null }) }

const post = (url: string, bearer: string, payload: object): Promise<Response> =>
  app.inject({ method: "POST", url, headers: { authorization: `Bearer ${bearer}` }, payload })

const count = (table: string, where: string, values: readonly unknown[]): Promise<number> =>
  harness.stack.count(table, where, values)

const publishNewerBuild = async (): Promise<void> => {
  const directory = join(feedRoot, "client")
  const apk = `boe.dev.client.${PUBLISHED_VERSION}.apk`
  await mkdir(directory)
  await writeFile(join(directory, apk), "apk bytes")
  await writeFile(
    join(directory, `boe.dev.client.${PUBLISHED_VERSION}.json`),
    JSON.stringify({
      apk,
      target: "dev",
      variant: "client",
      version: PUBLISHED_VERSION,
      versionName: PUBLISHED_VERSION,
      versionCode: PUBLISHED_VERSION_CODE,
      applicationId: APPLICATION_ID,
      sha256: "a".repeat(64),
      signing: "release",
    }),
  )
  clearAppUpdateCache()
}

const RACING_WRITES: readonly (readonly [string, RacingWrite])[] = [
  [
    "a support ticket",
    {
      arrange: () => Promise.resolve(),
      send: (bearer) => post("/v1/client/support/tickets", bearer, { subject: "Racing ticket", body: "Raised during erasure." }),
      written: (client) => count("support_requests", "user_id = $1 and subject = 'Racing ticket'", [client.id]),
    },
  ],
  [
    "a review",
    {
      arrange: () => Promise.resolve(),
      send: (bearer) => post("/v1/client/reviews", bearer, { rating: 4, comment: "Shared during erasure." }),
      written: (client) => count("client_reviews", "user_id = $1", [client.id]),
    },
  ],
  [
    "a statement link",
    {
      arrange: async (client) => {
        await harness.stack.pool.query("delete from client_statement_links where user_id = $1", [client.id])
      },
      send: (bearer) => post("/v1/client/statement-links", bearer, { fromPeriod: "2025-01", toPeriod: "2025-01" }),
      written: (client) => count("client_statement_links", "user_id = $1", [client.id]),
    },
  ],
  [
    "an app version report behind the published build",
    {
      arrange: () => Promise.resolve(),
      send: (bearer) =>
        post("/v1/client/app-version", bearer, {
          applicationId: APPLICATION_ID,
          versionName: "0.15.1",
          versionCode: REPORTED_VERSION_CODE,
        }),
      written: (client) => count("notifications", "user_id = $1 and kind = 'app_update_available'", [client.id]),
    },
  ],
  [
    "an email verification code request",
    {
      arrange: () => Promise.resolve(),
      send: (bearer) => post("/v1/client/email-verification/start", bearer, {}),
      written: (client) => count("email_verification_codes", "user_id = $1", [client.id]),
    },
  ],
  [
    "an email verification",
    {
      arrange: async (client) => {
        const code = harness.stack.crypto.hashToken(VERIFICATION_CODE)
        await harness.stack.pool.query(
          "insert into email_verification_codes (user_id, code_hash, code_key_version, expires_at) values ($1, $2, $3, now() + interval '10 minutes')",
          [client.id, code.hash, code.keyVersion],
        )
      },
      send: (bearer) => post("/v1/client/email-verification/verify", bearer, { code: VERIFICATION_CODE }),
      written: (client) =>
        count("users", "id = $1 and (email_verification_state = 'verified' or email_verified_at is not null)", [client.id]),
    },
  ],
]

const seedErasable = async (): Promise<SeededClient> => {
  const client = await seedClient(harness, { verified: false })
  const recorded = await recordFor(harness, client.id, RECORDED_PAISE, "2025-01-15")
  await reverseEntry(harness, client.id, recorded.entryId, RECORDED_PAISE)
  return client
}

const signIn = async (client: SeededClient): Promise<string> => {
  const session = await harness.stack.first(
    "insert into auth_sessions (user_id, channel, refresh_key_version, expires_at) values ($1, 'native', 'rt1', now() + interval '90 days') returning id",
    [client.id],
  )
  return tokens.sign({ sub: client.id, sid: String(session.id) })
}

const waitForLockWaiters = async (waiters: number, isSettled: () => boolean = () => false): Promise<void> => {
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS
  while (Date.now() < deadline) {
    if (isSettled()) return
    const waiting = await harness.stack.first(
      "select count(*)::int as c from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      [],
    )
    if (Number(waiting.c) >= waiters) return
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
  }
  throw new Error(`fewer than ${String(waiters)} requests waited on a lock`)
}

beforeAll(async () => {
  feedRoot = await mkdtemp(join(tmpdir(), "boe-erasure-lock-feed-"))
  await publishNewerBuild()
  harness = await startErasureHarness()
  tokens = (await adminWebAuth(harness.stack)).accessTokenService
  const { stack } = harness
  const auth = { accessTokenService: tokens, database: stack.database, clientWeb: { originAllowlist: [] } }
  const cursorKey = randomBytes(32)
  app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerClientAccountRoutes(instance, {
        ...auth,
        clientAccountRepository: createClientAccountRepository(),
        clientValueEntryRepository: createClientValueEntryRepository(),
        auditRepository: stack.auditRepository,
        notificationRepository: createNotificationRepository(),
        unitOfWork: stack.unitOfWork,
        clock: stack.clock,
        config: { cursorKey },
        appUpdate: { releaseRoot: feedRoot, downloadBaseUrl: null },
      })
      registerClientReviewRoutes(instance, {
        ...auth,
        unitOfWork: stack.unitOfWork,
        auditRepository: stack.auditRepository,
        clock: stack.clock,
        config: { cursorKey },
      })
      registerClientStatementLinkRoutes(instance, {
        ...auth,
        unitOfWork: stack.unitOfWork,
        clientValueEntryRepository: createClientValueEntryRepository(),
        crypto: stack.crypto,
        clock: stack.clock,
        config: { linkTtlMs: TTL_MS },
      })
      registerClientEmailVerificationRoutes(instance, {
        ...auth,
        unitOfWork: stack.unitOfWork,
        clock: stack.clock,
        crypto: stack.crypto,
        emailVerificationRepository: createEmailVerificationRepository(),
        userRepository: stack.userRepository,
        auditRepository: stack.auditRepository,
        emailSender: silentSender,
        config: { codeTtlMs: TTL_MS, maxAttempts: 5, resendCooldownMs: 60_000 },
      })
    },
  })
}, 220_000)

afterAll(async () => {
  await app.close()
  await harness.app.close()
  await harness.stack.stop()
  await rm(feedRoot, { recursive: true, force: true })
})

describe("client writes racing an erasure", () => {
  test.each(RACING_WRITES)("%s sent while erasure holds the client is refused and leaves nothing", async (_label, write) => {
    const client = await seedErasable()
    const bearer = await signIn(client)
    await write.arrange(client)
    const before = await write.written(client)
    const mailHolder = await harness.stack.pool.connect()
    try {
      await mailHolder.query("begin")
      await mailHolder.query("select id from email_deliveries where user_id = $1 for update", [client.id])
      const erasing = erase(harness, client.id, "kept_as_record")
      await waitForLockWaiters(1)
      let settled = false
      const writing = write.send(bearer).finally(() => {
        settled = true
      })
      await waitForLockWaiters(2, () => settled)
      await mailHolder.query("commit")
      const [erased, written] = await Promise.all([erasing, writing])
      expect(erased.statusCode).toBe(200)
      expect(envelopeOf<{ outcome: string; path: string }>(erased).data).toMatchObject({
        outcome: "erased",
        path: "kept_as_record",
      })
      expect(written.statusCode).toBe(403)
      expect(envelopeOf(written).error.code).toBe("ACCOUNT_NOT_ACTIVE")
    } finally {
      mailHolder.release(true)
    }
    expect(before).toBe(0)
    expect(await write.written(client)).toBe(0)
  })
})
