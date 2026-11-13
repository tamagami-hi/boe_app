import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"

import { recordContribution, type RecordedContribution } from "../../src/domain/admin/recordContribution.js"
import { enqueueEmail } from "../../src/domain/email/enqueueEmail.js"
import { createAdminSipScheduleRepository } from "../../src/repositories/adminSipScheduleRepository.js"
import { createClientErasureDeleteRepository } from "../../src/repositories/clientErasureDeleteRepository.js"
import { createClientErasureInspectRepository } from "../../src/repositories/clientErasureInspectRepository.js"
import { createClientErasureWriteRepository } from "../../src/repositories/clientErasureWriteRepository.js"
import { createClientGrowthRepository } from "../../src/repositories/clientGrowthRepository.js"
import { createClientPositionRepository } from "../../src/repositories/clientPositionRepository.js"
import { createApplicationRepository } from "../../src/repositories/applicationRepository.js"
import { createEmailChangeRepository } from "../../src/repositories/emailChangeRepository.js"
import { createEmailVerificationRepository } from "../../src/repositories/emailVerificationRepository.js"
import { createIdempotencyRepository } from "../../src/repositories/idempotencyRepository.js"
import { createIdentityLockRepository } from "../../src/repositories/identityLockRepository.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { createMandatesRepository } from "../../src/repositories/mandatesRepository.js"
import { createNotificationRepository } from "../../src/repositories/notificationRepository.js"
import { createUserContactRepository } from "../../src/repositories/userContactRepository.js"
import { registerAdminClientErasureRoutes } from "../../src/routes/adminClientErasureRoutes.js"
import { registerAdminClientGrowthRoutes } from "../../src/routes/adminClientGrowthRoutes.js"
import { registerAdminClientOnboardingRoutes } from "../../src/routes/adminClientOnboardingRoutes.js"
import { registerClientWebAuthRoutes } from "../../src/routes/clientWebAuthRoutes.js"
import { createApplication } from "../../src/runtime/application.js"
import { adminHeaders, adminWebAuth, registerAdminLogin, signInRoleAdmin, type AdminSession } from "./adminSessionSupport.js"
import { PASSWORD, PasswordMailStack, type Row } from "./passwordMailSupport.js"

export const CLIENT_ORIGIN = "https://admin.beonedge.test"

export interface ErasureHarness {
  readonly stack: PasswordMailStack
  readonly app: FastifyInstance
  readonly admin: AdminSession
  readonly finance: AdminSession
  readonly fundId: string
}

export interface SeededClient {
  readonly id: string
  readonly email: string
  readonly phone: string
  readonly name: string
  readonly oldEmail: string
  readonly oldPhone: string
  readonly changeTarget: string
  readonly nominee: string
  readonly applicationId: string
  readonly rejectedApplicationId: string
}

export type Envelope<T> = Readonly<{
  data: T
  meta: Readonly<{ idempotencyReplay?: boolean }>
  error: Readonly<{ code: string; message: string; fields?: Record<string, readonly string[]> }>
}>

export const envelopeOf = <T>(response: { json: () => unknown }): Envelope<T> => response.json() as Envelope<T>

export const startErasureHarness = async (): Promise<ErasureHarness> => {
  const stack = await PasswordMailStack.start({ seed: true })
  const webAuth = await adminWebAuth(stack)
  const mail = stack.mailDeps()
  const app = createApplication({
    logger: false,
    registerRoutes: (instance) => {
      registerAdminLogin(instance, stack, webAuth)
      registerClientWebAuthRoutes(instance, { ...webAuth, unitOfWork: stack.unitOfWork, loginEventRepository: createLoginEventRepository() })
      registerAdminClientOnboardingRoutes(instance, {
        ...mail,
        webAuth,
        unitOfWork: stack.unitOfWork,
        idempotencyRepository: createIdempotencyRepository(),
        applicationRepository: createApplicationRepository(),
        identityLockRepository: createIdentityLockRepository(),
        emailVerificationRepository: createEmailVerificationRepository(),
        userContactRepository: createUserContactRepository(),
        emailChangeRepository: createEmailChangeRepository(),
        config: { ...mail.config, idempotencyTtlMs: 86_400_000 },
      })
      registerAdminClientGrowthRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        database: stack.database,
        clock: stack.clock,
        config: { idempotencyTtlMs: 86_400_000 },
        clientGrowthRepository: createClientGrowthRepository(),
        auditRepository: stack.auditRepository,
        idempotencyRepository: createIdempotencyRepository(),
        notificationRepository: createNotificationRepository(),
      })
      registerAdminClientErasureRoutes(instance, {
        webAuth,
        unitOfWork: stack.unitOfWork,
        idempotencyRepository: createIdempotencyRepository(),
        clock: stack.clock,
        crypto: stack.crypto,
        identityLockRepository: createIdentityLockRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        authSessionRepository: stack.authSessionRepository,
        auditRepository: stack.auditRepository,
        erasureInspectRepository: createClientErasureInspectRepository(),
        erasureWriteRepository: createClientErasureWriteRepository(),
        erasureDeleteRepository: createClientErasureDeleteRepository(),
        userContactRepository: createUserContactRepository(),
        passwordTokenRepository: stack.passwordTokenRepository,
        emailVerificationRepository: createEmailVerificationRepository(),
        emailChangeRepository: createEmailChangeRepository(),
        mandateLookup: createMandatesRepository(),
        config: { idempotencyTtlMs: 86_400_000 },
      })
    },
  })
  const admin = await signInRoleAdmin(app, stack, "superadmin")
  const finance = await signInRoleAdmin(app, stack, "finance")
  const fundId = await seedFund(stack, admin.userId)
  return { stack, app, admin, finance, fundId }
}

const seedFund = async (stack: PasswordMailStack, actor: string): Promise<string> => {
  const fund = await stack.first(
    "insert into funds (slug, state, published_at, created_by_user_id) values ($1, 'published', now(), $2) returning id",
    [`erase-${randomUUID().slice(0, 8)}`, actor],
  )
  const disclosure = await stack.first(
    "insert into fund_disclosure_versions (fund_id, version, title, body, content_sha256, effective_from, published_by_user_id) " +
      "values ($1, 1, 'Disclosure', 'Body.', $2, now(), $3) returning id",
    [fund.id, randomBytes(32), actor],
  )
  const version = await stack.first(
    "insert into fund_versions (fund_id, version, name, category, objective, risk_level, return_tier, minimum_sip_paise, " +
      "minimum_purchase_paise, disclosure_version_id, terms_sha256, created_by_user_id, created_at) " +
      "values ($1, 1, 'Erase Fund', 'hybrid', 'Growth.', 'moderate', 'moderate', 50000, 500000, $2, $3, $4, '2024-01-01') returning id",
    [fund.id, disclosure.id, randomBytes(32), actor],
  )
  await stack.pool.query("update funds set current_published_version_id = $1 where id = $2", [version.id, fund.id])
  return String(fund.id)
}

const uniqueEmail = (label: string): string => `${label}-${randomUUID().slice(0, 8)}@erase-${randomUUID().slice(0, 6)}.test`

export const seedClient = async (
  harness: ErasureHarness,
  options: Readonly<{ verified: boolean }>,
): Promise<SeededClient> => {
  const { stack } = harness
  const email = uniqueEmail("current")
  const oldEmail = uniqueEmail("former")
  const changeTarget = uniqueEmail("target")
  const phone = `+9198${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`
  const oldPhone = `+9197${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`
  const name = `Erase Subject ${randomUUID().slice(0, 6)}`
  const nominee = `Nominee Person ${randomUUID().slice(0, 6)}`
  const application = await stack.first(
    "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
      "values ($1, $2, $3, 'approved', now(), now()) returning id",
    [email, phone, name],
  )
  const user = await stack.first(
    "insert into users (application_id, email_normalized, phone_e164, full_name, account_state, activated_at, " +
      "email_verification_state, email_verified_at, nominee_name, nominee_relation) " +
      "values ($1, $2, $3, $4, 'active', now(), $5, $6, $7, 'Sister') returning id",
    [application.id, email, phone, name, options.verified ? "verified" : "pending", options.verified ? new Date() : null, nominee],
  )
  const id = String(user.id)
  await stack.pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [id, stack.passwordHash])
  const rejected = await stack.first(
    "insert into applications (email_normalized, phone_e164, full_name, state, submitted_at, decided_at) " +
      "values ($1, $2, $3, 'rejected', now(), now()) returning id",
    [oldEmail, oldPhone, name],
  )
  const client = {
    id, email, phone, name, oldEmail, oldPhone, changeTarget, nominee,
    applicationId: String(application.id),
    rejectedApplicationId: String(rejected.id),
  }
  await populateCopies(harness, client)
  return client
}

const populateCopies = async (harness: ErasureHarness, client: SeededClient): Promise<void> => {
  const { stack, admin } = harness
  const q = (text: string, values: readonly unknown[]) => stack.pool.query(text, [...values])
  const national = client.phone.slice(3)
  for (const applicationId of [client.applicationId, client.rejectedApplicationId]) {
    await q(
      "insert into application_consents (application_id, consent_document_id, accepted_at, ip_hmac, ip_hmac_key_version, user_agent) " +
        "select $1, id, now(), $2, 'ck1', $3 from consent_documents order by id limit 1",
      [applicationId, randomBytes(32), `Erase-Agent/${client.id}`],
    )
  }
  await q(
    "insert into user_contact_history (user_id, change_kind, previous_email_normalized, previous_phone_e164, " +
      "new_email_normalized, new_phone_e164, actor_user_id, request_id, reason_code, reason_detail) " +
      "values ($1, 'admin_correction', $2, $3, $4, $5, $6, $7, 'typo', $8)",
    [client.id, client.oldEmail, client.oldPhone, client.email, client.phone, admin.userId, randomUUID(), `called ${client.oldPhone}`],
  )
  await stack.unitOfWork.execute((tx) =>
    enqueueEmail(tx, stack.mailDeps(), {
      recipient: client.oldEmail,
      template: { templateKey: "application_rejected", applicationId: client.rejectedApplicationId },
      templateVersion: "v1",
      sesConfigurationSet: "boe-transactional",
      eventType: "application.rejected",
      eventVersion: 1,
      aggregateType: "application",
      aggregateId: client.rejectedApplicationId,
      requestId: randomUUID(),
      deduplicationKey: `erase-test:${randomUUID()}`,
      payload: { template: "application_rejected", note: `for ${client.oldEmail}` },
    }),
  )
  await q(
    "insert into auth_login_events (user_id, email_normalized, channel, outcome, request_id) values ($1, $2, 'client_web', 'invalid_credentials', $3)",
    [client.id, client.email, randomUUID()],
  )
  await q(
    "insert into auth_login_events (user_id, email_normalized, channel, outcome, request_id) values (null, $1, 'client_web', 'unknown_identity', $2)",
    [client.oldEmail, randomUUID()],
  )
  await q("insert into notifications (user_id, kind, title, body, payload) values ($1, 'admin_note', 'Hello', $2, $3)", [
    client.id,
    `We will call ${client.phone}`,
    JSON.stringify({ contact: client.email }),
  ])
  await q(
    "insert into support_requests (user_id, reference, category, subject, body) values ($1, $2, 'account', 'Help', $3)",
    [client.id, `REQ-${randomUUID().slice(0, 6)}`, `Call me on ${national} or write to ${client.email.toUpperCase()}. ${client.name.toLowerCase()}`],
  )
  await q(
    "insert into audit_events (actor_type, actor_user_id, command, entity_type, entity_id, request_id, entity_version, reason_detail, metadata) " +
      "values ('admin', $1, 'legacy.note', 'user', $2, $3, 1, $4, $5)",
    [admin.userId, client.id, randomUUID(), `phone ${client.phone}`, JSON.stringify({ userId: client.id, email: client.oldEmail, masked: maskOf(client.email) })],
  )
  await q(
    "insert into idempotency_records (actor_scope, http_method, route_template, key, actor_user_id, request_hash, response_status, response_body, expires_at) " +
      "values ($1, 'POST', '/v1/admin/users/:userId/nominee', $2, $3, $4, 200, $5, '9999-12-31')",
    [`admin:${admin.userId}`, randomUUID(), admin.userId, randomBytes(32), JSON.stringify({ userId: client.id, email: client.email, phone: client.phone, nominee: { name: client.nominee, relation: "Sister" } })],
  )
  await q(
    "insert into idempotency_records (actor_scope, http_method, route_template, key, actor_user_id, request_hash, response_status, response_body, expires_at) " +
      "values ($1, 'POST', '/v1/client/profile/email', $2, $3, $4, 200, $5, '9999-12-31')",
    [`user:${client.id}`, randomUUID(), client.id, randomBytes(32), JSON.stringify({ requested: client.changeTarget })],
  )
  const target = stack.crypto.encryptRecipient(client.changeTarget)
  await q(
    "insert into email_change_requests (user_id, target_ciphertext, target_nonce, target_key_version, code_hash, code_key_version, " +
      "bound_email_revision, bound_credential_version, expires_at) values ($1, $2, $3, $4, $5, 'tk1', 1, 1, now() + interval '10 minutes')",
    [client.id, target.ciphertext, target.nonce, target.keyVersion, randomBytes(32)],
  )
  await stack.unitOfWork.execute((tx) =>
    enqueueEmail(tx, stack.mailDeps(), {
      recipient: client.oldEmail,
      template: { templateKey: "contact_email_changed", userId: client.id },
      templateVersion: "v1",
      sesConfigurationSet: "boe-transactional",
      eventType: "user.email_changed",
      eventVersion: 1,
      aggregateType: "user",
      aggregateId: client.id,
      requestId: randomUUID(),
      deduplicationKey: `erase-test:${randomUUID()}`,
      payload: { template: "contact_email_changed" },
      sealedPayload: { name: client.name, email: client.email },
    }),
  )
  await stack.unitOfWork.execute((tx) =>
    enqueueEmail(tx, stack.mailDeps(), {
      recipient: client.email,
      template: { templateKey: "maturity_options", userId: client.id },
      templateVersion: "v1",
      sesConfigurationSet: "boe-transactional",
      eventType: "client_maturity_offer.sent",
      eventVersion: 1,
      aggregateType: "user",
      aggregateId: client.id,
      requestId: randomUUID(),
      deduplicationKey: `erase-test:${randomUUID()}`,
      payload: { template: "maturity_options" },
      sealedPayload: { name: client.name },
    }),
  )
}

export const maskOf = (email: string): string => `${email[0] ?? ""}***@${email.slice(email.lastIndexOf("@") + 1)}`

export const needlesOf = (client: SeededClient): readonly string[] => [
  client.email,
  client.oldEmail,
  client.changeTarget,
  maskOf(client.email),
  maskOf(client.oldEmail),
  client.phone,
  client.oldPhone,
  client.phone.slice(3),
  client.name,
  client.nominee,
]

export const readableCopies = async (stack: PasswordMailStack, needles: readonly string[]): Promise<readonly string[]> => {
  const columns = (
    await stack.pool.query<{ table_name: string; column_name: string }>(
      "select c.table_name, c.column_name from information_schema.columns c " +
        "join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema " +
        "where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type in ('text', 'character varying', 'jsonb', 'json', 'character')",
    )
  ).rows
  const found: string[] = []
  for (const { table_name: table, column_name: column } of columns) {
    for (const needle of needles) {
      const hit = await stack.pool.query<{ c: number }>(
        `select count(*)::int as c from "${table}" where "${column}"::text ilike $1`,
        [`%${needle}%`],
      )
      if ((hit.rows[0]?.c ?? 0) > 0) found.push(`${table}.${column}: ${needle}`)
    }
  }
  return found
}

export const tableSnapshot = async (stack: PasswordMailStack, exclude: readonly string[] = []): Promise<string> => {
  const tables = (
    await stack.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
    )
  ).rows
    .map((row) => row.table_name)
    .filter((table) => !exclude.includes(table))
  const parts: string[] = []
  for (const table of tables) {
    const rows = (await stack.pool.query<{ r: string }>(`select to_jsonb(t)::text as r from "${table}" t order by 1`)).rows
    parts.push(`${table}:${rows.map((row) => row.r).join("|")}`)
  }
  return parts.join("\n")
}

export const rowsMentioningId = async (stack: PasswordMailStack, id: string): Promise<Readonly<Record<string, number>>> => {
  const tables = (
    await stack.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    )
  ).rows.map((row) => row.table_name)
  const counts: Record<string, number> = {}
  for (const table of tables) {
    const c = (await stack.pool.query<{ c: number }>(`select count(*)::int as c from "${table}" t where to_jsonb(t)::text like $1`, [`%${id}%`]))
      .rows[0]?.c ?? 0
    if (c > 0) counts[table] = c
  }
  return counts
}

export const checkErase = (harness: ErasureHarness, userId: string, as: AdminSession = harness.admin) =>
  harness.app.inject({ method: "GET", url: `/v1/admin/clients/${userId}/erase-check`, headers: adminHeaders(as) })

export const erase = (
  harness: ErasureHarness,
  userId: string,
  expectedPath: string,
  key: string = randomUUID(),
  as: AdminSession = harness.admin,
) =>
  harness.app.inject({
    method: "POST",
    url: `/v1/admin/clients/${userId}/erase`,
    headers: adminHeaders(as, key),
    payload: { confirm: "ERASE", expectedPath },
  })

export const recordFor = (harness: ErasureHarness, userId: string, amountPaise: bigint): Promise<RecordedContribution> => {
  const { stack } = harness
  return stack.unitOfWork.execute((tx) =>
    recordContribution(
      tx,
      {
        ...stack.mailDeps(),
        clientPositionRepository: createClientPositionRepository(),
        clientGrowthRepository: createClientGrowthRepository(),
        userRepository: stack.userRepository,
        auditRepository: stack.auditRepository,
        notificationRepository: createNotificationRepository(),
        sipScheduleRepository: createAdminSipScheduleRepository(),
        config: { sesConfigurationSet: "boe-transactional" },
      },
      {
        userId,
        fundId: harness.fundId,
        amountPaise,
        effectiveDate: "2025-01-15",
        reasonCode: "recorded_offline_investment",
        note: null,
        actorUserId: harness.admin.userId,
        requestId: randomUUID(),
      },
    ),
  )
}

export const reverseEntry = async (harness: ErasureHarness, userId: string, entryId: string, amountPaise: bigint): Promise<void> => {
  await harness.stack.pool.query(
    "insert into client_value_entries (user_id, fund_id, entry_type, principal_delta_paise, value_delta_paise, effective_date, " +
      "reason_code, reverses_entry_id, actor_type, created_by_user_id, request_id) " +
      "values ($1, $2, 'reversal', $3, $3, '2025-02-01', 'correction', $4, 'admin', $5, $6)",
    [userId, harness.fundId, -amountPaise, entryId, harness.admin.userId, randomUUID()],
  )
}

export const clientLogin = (harness: ErasureHarness, email: string) =>
  harness.app.inject({
    method: "POST",
    url: "/v1/auth/client/web/login",
    headers: { origin: CLIENT_ORIGIN },
    payload: { email, password: PASSWORD },
  })

export const growIndividually = (harness: ErasureHarness, userId: string) =>
  harness.app.inject({
    method: "POST",
    url: "/v1/admin/client-growth/individual",
    headers: adminHeaders(harness.admin, randomUUID()),
    payload: { userId, fundId: harness.fundId, growthPaise: "1000", effectiveDate: "2025-03-01", reasonCode: "monthly" },
  })

export const ownIdsOf = async (stack: PasswordMailStack, client: SeededClient): Promise<readonly string[]> => {
  const apps = [client.applicationId, client.rejectedApplicationId]
  const rows = await stack.pool.query<{ id: string }>(
    "select id from email_deliveries where user_id = $1 or application_id = any($2::uuid[]) " +
      "union all select outbox_event_id from email_deliveries where (user_id = $1 or application_id = any($2::uuid[])) and outbox_event_id is not null " +
      "union all select id from auth_login_events where user_id is null and email_normalized = any($3::text[])",
    [client.id, apps, [client.email, client.oldEmail, client.changeTarget]],
  )
  return [client.id, ...apps, ...rows.rows.map((row) => row.id)]
}

export const othersSnapshot = async (stack: PasswordMailStack, ownIds: readonly string[]): Promise<string> => {
  const tables = (
    await stack.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
    )
  ).rows.map((row) => row.table_name)
  const parts: string[] = []
  for (const table of tables) {
    const rows = (
      await stack.pool.query<{ r: string }>(
        `select to_jsonb(t)::text as r from "${table}" t where not (to_jsonb(t)::text like any($1::text[])) order by 1`,
        [ownIds.map((id) => `%${id}%`)],
      )
    ).rows
    parts.push(`${table}:${rows.map((row) => row.r).join("|")}`)
  }
  return parts.join("\n")
}

export const consentsOf = async (stack: PasswordMailStack, client: SeededClient): Promise<readonly Row[]> =>
  (
    await stack.pool.query<Row>(
      "select application_id, user_agent, ip_hmac from application_consents where application_id = any($1::uuid[]) order by application_id",
      [[client.applicationId, client.rejectedApplicationId]],
    )
  ).rows

export const userRow = (stack: PasswordMailStack, id: string): Promise<Row> => stack.first("select * from users where id = $1", [id])
