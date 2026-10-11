import { randomBytes, randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { PostgreSqlContainer } from "@testcontainers/postgresql"
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import type { Kysely } from "kysely"
import type { Pool } from "pg"
import { Wait } from "testcontainers"

import { hashPassword } from "../../src/auth/passwordHasher.js"
import { createCryptoContext, parseCryptoKeys } from "../../src/crypto/context.js"
import type { CryptoContext } from "../../src/crypto/context.js"
import { createDatabase, createUnitOfWork } from "../../src/db/database.js"
import type { UnitOfWork } from "../../src/db/database.js"
import { createPool } from "../../src/db/pool.js"
import type { Database } from "../../src/db/types.js"
import {
  issuePasswordLinkMail,
  type PasswordLinkMailDeps,
  type QueuedPasswordLink,
} from "../../src/domain/auth/passwordLinkMail.js"
import type { PasswordLinkSettings } from "../../src/domain/auth/passwordLinkUrl.js"
import type { PasswordLinkRequester } from "../../src/domain/auth/passwordCredential.js"
import { dispatchDueDeliveries } from "../../src/domain/email/dispatchDueDeliveries.js"
import { CLAIMED_EMAIL_TOPICS } from "../../src/domain/email/emailTopics.js"
import { createPasswordLinkMailGuard } from "../../src/domain/email/passwordLinkMailGuard.js"
import type { EmailMessage, EmailSender } from "../../src/email/emailSender.js"
import { createTransactionalEmailSender } from "../../src/email/transactionalEmailSender.js"
import { createAuditRepository } from "../../src/repositories/auditRepository.js"
import { createAuthSessionRepository } from "../../src/repositories/authSessionRepository.js"
import { createCredentialRepository } from "../../src/repositories/credentialRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createEmailSuppressionRepository } from "../../src/repositories/emailSuppressionRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import { createPasswordTokenRepository } from "../../src/repositories/passwordTokenRepository.js"
import { createUserRepository } from "../../src/repositories/userRepository.js"
import { loadMigrationFiles, runMigrations } from "../../src/scripts/migrate.js"
import { runSeed } from "../../src/scripts/seed.js"

export const PASSWORD = "the password a client already has"
export const NEW_PASSWORD = "another correct horse battery staple"
export const LINK_PAGE = "https://app.beonedge.test/reset-password"
export const COOLDOWN_MS = 60_000
export const TTL_MS = 600_000

export type Row = Record<string, unknown>
export type AccountState = "active" | "suspended" | "closed"

export interface SeededUser {
  readonly id: string
  readonly email: string
}

export interface TransportHandle extends EmailSender {
  readonly messages: EmailMessage[]
}

export type TransportBehaviour = "accept" | "time_out"

const key = (): string => randomBytes(32).toString("base64")

export const CRYPTO_ENV = {
  CRYPTO_TOKEN_HASH_KEY: key(),
  CRYPTO_TOKEN_HASH_KEY_VERSION: "tk1",
  CRYPTO_CONSENT_IP_HMAC_KEY: key(),
  CRYPTO_CONSENT_IP_HMAC_KEY_VERSION: "ck1",
  CRYPTO_RECIPIENT_HMAC_KEY: key(),
  CRYPTO_RECIPIENT_HMAC_KEY_VERSION: "rk1",
  CRYPTO_RECIPIENT_ENC_KEY: key(),
  CRYPTO_RECIPIENT_ENC_KEY_VERSION: "ek1",
}

const SCANNED_TABLES = [
  "outbox_events",
  "email_deliveries",
  "email_send_attempts",
  "audit_events",
  "idempotency_records",
  "password_credential_tokens",
]

export class PasswordMailStack {
  readonly passwordTokenRepository = createPasswordTokenRepository()
  readonly credentialRepository = createCredentialRepository()
  readonly userRepository = createUserRepository()
  readonly authSessionRepository = createAuthSessionRepository()
  readonly auditRepository = createAuditRepository()
  readonly outboxRepository = createOutboxRepository()
  readonly emailDeliveryRepository = createEmailDeliveryRepository()
  readonly emailSuppressionRepository = createEmailSuppressionRepository()
  clockOffsetMs = 0
  passwordHash = ""
  phoneCounter = 0

  private constructor(
    readonly container: StartedPostgreSqlContainer,
    readonly pool: Pool,
    readonly database: Kysely<Database>,
    readonly unitOfWork: UnitOfWork,
    readonly crypto: CryptoContext,
  ) {}

  static async start(options: { readonly seed: boolean }): Promise<PasswordMailStack> {
    const container = await new PostgreSqlContainer("postgres:16-alpine")
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
      .start()
    const pool = createPool({
      connectionString: container.getConnectionUri(),
      poolMax: 10,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 10_000,
    })
    const database = createDatabase(pool)
    const stack = new PasswordMailStack(
      container,
      pool,
      database,
      createUnitOfWork(database),
      createCryptoContext(parseCryptoKeys(CRYPTO_ENV)),
    )
    const directory = fileURLToPath(new URL("../../db/migrations", import.meta.url))
    await runMigrations(pool, await loadMigrationFiles(directory))
    if (options.seed) await runSeed(pool)
    stack.passwordHash = await hashPassword(PASSWORD)
    return stack
  }

  async stop(): Promise<void> {
    await this.pool.end()
    await this.container.stop()
  }

  readonly clock = (): Date => new Date(Date.now() + this.clockOffsetMs)

  mailDeps(passwordLinks: PasswordLinkSettings = { clientUrl: LINK_PAGE, requireHttps: true }): PasswordLinkMailDeps {
    return {
      passwordTokenRepository: this.passwordTokenRepository,
      credentialRepository: this.credentialRepository,
      authSessionRepository: this.authSessionRepository,
      userRepository: this.userRepository,
      auditRepository: this.auditRepository,
      outboxRepository: this.outboxRepository,
      emailDeliveryRepository: this.emailDeliveryRepository,
      crypto: this.crypto,
      clock: this.clock,
      config: {
        tokenTtlMs: TTL_MS,
        maxAttempts: 5,
        requestCooldownMs: COOLDOWN_MS,
        passwordLinks,
        sesConfigurationSet: "boe-transactional",
      },
    }
  }

  nextPhone(): string {
    this.phoneCounter += 1
    return `+1415553${String(this.phoneCounter).padStart(4, "0")}`
  }

  async seedUser(options: { password?: boolean; state?: AccountState } = {}): Promise<SeededUser> {
    const email = `mail-${randomUUID()}@example.com`
    const id = (
      await this.pool.query<{ id: string }>(
        "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at, suspended_at, closed_at) " +
          "values ($1, $2, 'Ada Lovelace', $3::user_account_state, now(), " +
          "case when $3 = 'suspended' then now() end, case when $3 = 'closed' then now() end) returning id",
        [email, this.nextPhone(), options.state ?? "active"],
      )
    ).rows[0]?.id
    if (id === undefined) throw new Error("user not created")
    if (options.password === true) {
      await this.pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [id, this.passwordHash])
    }
    return { id, email }
  }

  async setAccountState(userId: string, state: AccountState): Promise<void> {
    await this.pool.query(
      "update users set account_state = $2::user_account_state, " +
        "suspended_at = case when $2 = 'suspended' then now() else suspended_at end, " +
        "closed_at = case when $2 = 'closed' then now() else closed_at end where id = $1",
      [userId, state],
    )
  }

  queueLink(userId: string, requester: PasswordLinkRequester = { kind: "system" }): Promise<QueuedPasswordLink> {
    return this.unitOfWork.execute((tx) =>
      issuePasswordLinkMail(tx, this.mailDeps(), {
        userId,
        requestId: randomUUID(),
        requester,
        linkBase: LINK_PAGE,
      }),
    )
  }

  async first(text: string, values: readonly unknown[]): Promise<Row> {
    return (await this.pool.query<Row>(text, [...values])).rows[0] ?? {}
  }

  deliveryRow(deliveryId: string): Promise<Row> {
    return this.first("select * from email_deliveries where id = $1", [deliveryId])
  }

  outboxRowOf(deliveryId: string): Promise<Row> {
    return this.first(
      "select o.* from outbox_events o join email_deliveries d on d.outbox_event_id = o.id where d.id = $1",
      [deliveryId],
    )
  }

  payloadRow(deliveryId: string): Promise<Row> {
    return this.first("select * from email_delivery_payloads where email_delivery_id = $1", [deliveryId])
  }

  tokenRow(tokenId: string): Promise<Row> {
    return this.first("select * from password_credential_tokens where id = $1", [tokenId])
  }

  async attemptRows(deliveryId: string): Promise<Row[]> {
    return (
      await this.pool.query<Row>(
        "select a.* from email_send_attempts a join email_deliveries d on d.outbox_event_id = a.outbox_event_id " +
          "where d.id = $1 order by a.generation",
        [deliveryId],
      )
    ).rows
  }

  async linkOf(deliveryId: string): Promise<{ readonly link: string; readonly rawToken: string }> {
    const stored = await this.first("select * from email_delivery_payloads where email_delivery_id = $1", [deliveryId])
    const opened = this.crypto.decryptDeliveryPayload(deliveryId, {
      ciphertext: stored.ciphertext as Buffer,
      nonce: stored.nonce as Buffer,
      keyVersion: String(stored.key_version),
    })
    if (opened.kind !== "opened") throw new Error("the sealed payload could not be opened")
    const link = String(opened.payload.link)
    return { link, rawToken: new URL(link).searchParams.get("token") ?? "" }
  }

  async rowsMentioning(needle: string): Promise<number> {
    let total = 0
    for (const table of SCANNED_TABLES) {
      total +=
        (await this.pool.query<{ c: number }>(`select count(*)::int as c from ${table} t where t::text like $1`, [`%${needle}%`]))
          .rows[0]?.c ?? 0
    }
    return total
  }

  async count(table: string, where = "true", values: readonly unknown[] = []): Promise<number> {
    return (await this.pool.query<{ c: number }>(`select count(*)::int as c from ${table} where ${where}`, [...values])).rows[0]?.c ?? 0
  }

  transport(behaviour: TransportBehaviour = "accept"): TransportHandle {
    const messages: EmailMessage[] = []
    return {
      messages,
      send: (message) => {
        messages.push(message)
        if (behaviour === "time_out") {
          return Promise.reject(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }))
        }
        return Promise.resolve({ messageId: `<password-mail-${randomUUID()}@mailbox>` })
      },
    }
  }

  dispatch(sender: EmailSender, clock: () => Date = this.clock, crypto: CryptoContext = this.crypto) {
    const guard = createPasswordLinkMailGuard({ passwordTokenRepository: this.passwordTokenRepository })
    return dispatchDueDeliveries({
      unitOfWork: this.unitOfWork,
      outboxRepository: this.outboxRepository,
      emailDeliveryRepository: this.emailDeliveryRepository,
      emailSuppressionRepository: this.emailSuppressionRepository,
      sender: createTransactionalEmailSender({ sender, templates: { supportAddress: null } }),
      crypto,
      sendGuards: new Map([
        ["password_set_link", guard],
        ["password_reset_link", guard],
      ]),
      clock,
      config: {
        topics: CLAIMED_EMAIL_TOPICS,
        workerId: "worker-password-mail",
        leaseMs: 30_000,
        claimLimit: 50,
        messageBudgetMs: 25_000,
        passBudgetMs: 35_000,
      },
    })
  }
}
