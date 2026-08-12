/**
 * Deploy auth seed (`npm run seed:auth`). Runs the idempotent bootstrap catalog
 * (roles/permissions/consent) and then, when enabled, bootstraps a single admin
 * login from the environment: an active `users` row, an Argon2id
 * `user_credentials` row, the `superadmin` role's permission grants, and a
 * `superadmin` `user_roles` assignment. All writes are idempotent, so repeated
 * runs are safe. This is the security bootstrap the canonical catalog seed
 * deferred (spec 02 §3.5; roles/permissions grants need a granting user).
 */
import { pathToFileURL } from "node:url"

import { hashPassword, passwordInputSchema } from "../auth/passwordHasher.js"
import { parseDatabaseConfig } from "../db/config.js"
import { createPool, schemaToolPoolSettings } from "../db/pool.js"
import { buildSeedStatements, SEED_ROLE_PERMISSIONS } from "../db/seedCatalog.js"

export interface SeedAuthClient {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: readonly unknown[] }>
  release: () => void
}

export interface SeedAuthPool {
  connect: () => Promise<SeedAuthClient>
}

export interface SeedAuthConfig {
  readonly enabled: boolean
  readonly allowProduction: boolean
  readonly overwrite: boolean
  readonly isProduction: boolean
  readonly adminEmail: string | null
  readonly adminPassword: string | null
  readonly adminPhone: string
  readonly adminFullName: string
  /**
   * The default client (QA) login. Both email and password must be supplied
   * together or neither; see resolveSeedAuthConfig. This account is the one the
   * mobile app signs in with, and the `.env` is its only source of truth.
   */
  readonly clientEmail: string | null
  readonly clientPassword: string | null
  readonly clientPhone: string
  readonly clientFullName: string
}

export type SeedAuthResult = Readonly<{
  catalogStatements: number
  adminSeeded: boolean
  clientSeeded: boolean
  skipped: "disabled" | "production_not_allowed" | null
}>

const SUPERADMIN_ROLE = "superadmin"
const DEFAULT_ADMIN_PHONE = "+910000000001"
const DEFAULT_CLIENT_PHONE = "+910000000003"

const trimmedOrNull = (value: string | undefined): string | null => {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Resolve the seed-auth configuration from an environment source (pure). */
export const resolveSeedAuthConfig = (source: Readonly<Record<string, string | undefined>>): SeedAuthConfig => {
  const firstName = trimmedOrNull(source.ADMIN_FIRST_NAME) ?? "BeOnEdge"
  const lastName = trimmedOrNull(source.ADMIN_LAST_NAME) ?? "Admin"
  const clientFirstName = trimmedOrNull(source.SEED_CLIENT_FIRST_NAME) ?? "BeOnEdge"
  const clientLastName = trimmedOrNull(source.SEED_CLIENT_LAST_NAME) ?? "Client"
  return {
    enabled: source.SEED_AUTH_ENABLED !== "false",
    allowProduction: source.SEED_AUTH_ALLOW_PRODUCTION === "true",
    overwrite: source.SEED_AUTH_OVERWRITE === "true",
    isProduction: source.NODE_ENV === "production",
    adminEmail: (trimmedOrNull(source.SEED_ADMIN_EMAIL) ?? trimmedOrNull(source.ADMIN_LOGIN_ID))?.toLowerCase() ?? null,
    adminPassword: trimmedOrNull(source.SEED_ADMIN_PASSWORD) ?? trimmedOrNull(source.ADMIN_PASSWORD),
    adminPhone: trimmedOrNull(source.ADMIN_PHONE) ?? DEFAULT_ADMIN_PHONE,
    adminFullName: `${firstName} ${lastName}`,
    clientEmail: trimmedOrNull(source.SEED_CLIENT_EMAIL)?.toLowerCase() ?? null,
    clientPassword: trimmedOrNull(source.SEED_CLIENT_PASSWORD),
    clientPhone: trimmedOrNull(source.SEED_CLIENT_PHONE) ?? DEFAULT_CLIENT_PHONE,
    clientFullName: `${clientFirstName} ${clientLastName}`,
  }
}

const firstRow = <T>(result: { rows: readonly unknown[] }): T | undefined => result.rows[0] as T | undefined

/**
 * Idempotently ensure a login exists: an active `users` row and an Argon2id
 * `user_credentials` row. Returns the user id. When the user already exists its
 * demographics are left untouched — `phone_e164` is UNIQUE, so rewriting it from
 * the environment could collide with an unrelated account — and the credential is
 * replaced only when `overwrite` is set.
 */
const upsertLogin = async (
  client: SeedAuthClient,
  login: Readonly<{
    email: string
    passwordHash: string
    phone: string
    fullName: string
    overwrite: boolean
  }>,
): Promise<string> => {
  const existing = firstRow<{ id: string }>(
    await client.query("SELECT id FROM users WHERE email_normalized = $1", [login.email]),
  )
  const userId =
    existing?.id ??
    firstRow<{ id: string }>(
      await client.query(
        "INSERT INTO users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
          "VALUES ($1, $2, $3, 'active', now()) RETURNING id",
        [login.email, login.phone, login.fullName],
      ),
    )?.id

  if (userId === undefined) throw new Error(`seed:auth could not resolve the user id for ${login.email}`)

  const credential = firstRow<{ user_id: string }>(
    await client.query("SELECT user_id FROM user_credentials WHERE user_id = $1", [userId]),
  )
  if (credential === undefined) {
    await client.query("INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)", [
      userId,
      login.passwordHash,
    ])
  } else if (login.overwrite) {
    await client.query(
      "UPDATE user_credentials SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE user_id = $1",
      [userId, login.passwordHash],
    )
  }
  return userId
}

/**
 * Apply the catalog seed and, when enabled, the idempotent admin bootstrap in a
 * single transaction. `hasher` is injectable so tests avoid a real Argon2id run.
 */
export const runSeedAuth = async (
  pool: SeedAuthPool,
  config: SeedAuthConfig,
  hasher: (plain: string) => Promise<string> = hashPassword,
): Promise<SeedAuthResult> => {
  const statements = buildSeedStatements()

  if (config.enabled && (config.adminEmail === null || config.adminPassword === null)) {
    throw new Error(
      "seed:auth requires an admin email + password (ADMIN_LOGIN_ID/SEED_ADMIN_EMAIL and ADMIN_PASSWORD/SEED_ADMIN_PASSWORD)",
    )
  }
  /*
   * Half-configured is a mistake worth failing on rather than silently skipping:
   * an operator who set only SEED_CLIENT_EMAIL believes a client login exists,
   * and one who set only SEED_CLIENT_PASSWORD believes they rotated it.
   */
  if (config.enabled && (config.clientEmail === null) !== (config.clientPassword === null)) {
    throw new Error("seed:auth requires SEED_CLIENT_EMAIL and SEED_CLIENT_PASSWORD together, or neither")
  }
  /*
   * A seeded password must satisfy the same rule the login route applies to a
   * submitted one (`passwordInputSchema`: 12-128 code points, no control
   * characters). Nothing used to check this, so a short value hashed and stored
   * happily and then failed every login at request validation, before the hash was
   * ever compared — indistinguishable from a wrong password, with the seed
   * reporting success. Fail here instead, naming the variable at fault.
   */
  for (const [name, password] of [
    ["ADMIN_PASSWORD/SEED_ADMIN_PASSWORD", config.adminPassword],
    ["SEED_CLIENT_PASSWORD", config.clientPassword],
  ] as const) {
    if (password === null) continue
    const check = passwordInputSchema.safeParse(password)
    if (!check.success) {
      throw new Error(
        `seed:auth refuses to store a ${name} the login route would reject: ` +
          `${check.error.issues.map((issue) => issue.message).join("; ")}`,
      )
    }
  }
  const seedAdmin = config.enabled && !(config.isProduction && !config.allowProduction)
  const seedClient = seedAdmin && config.clientEmail !== null && config.clientPassword !== null
  // Hash outside the transaction to keep it short.
  const passwordHash = seedAdmin && config.adminPassword !== null ? await hasher(config.adminPassword) : null
  const clientPasswordHash = seedClient && config.clientPassword !== null ? await hasher(config.clientPassword) : null

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const statement of statements) {
      await client.query(statement.text, statement.values)
    }

    if (!config.enabled) {
      await client.query("COMMIT")
      return { catalogStatements: statements.length, adminSeeded: false, clientSeeded: false, skipped: "disabled" }
    }
    if (!seedAdmin) {
      await client.query("COMMIT")
      return {
        catalogStatements: statements.length,
        adminSeeded: false,
        clientSeeded: false,
        skipped: "production_not_allowed",
      }
    }

    if (config.adminEmail === null || passwordHash === null) {
      throw new Error("seed:auth could not resolve the admin credential")
    }
    const adminId = await upsertLogin(client, {
      email: config.adminEmail,
      passwordHash,
      phone: config.adminPhone,
      fullName: config.adminFullName,
      overwrite: config.overwrite,
    })

    const role = firstRow<{ id: string }>(
      await client.query("SELECT id FROM roles WHERE code = $1", [SUPERADMIN_ROLE]),
    )
    if (role === undefined) throw new Error("seed:auth could not resolve the superadmin role")

    for (const permissionCode of SEED_ROLE_PERMISSIONS[SUPERADMIN_ROLE] ?? []) {
      const permission = firstRow<{ id: string }>(
        await client.query("SELECT id FROM permissions WHERE code = $1", [permissionCode]),
      )
      if (permission === undefined) continue
      await client.query(
        "INSERT INTO role_permissions (role_id, permission_id, granted_by_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [role.id, permission.id, adminId],
      )
    }

    await client.query(
      "INSERT INTO user_roles (user_id, role_id, granted_by_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [adminId, role.id, adminId],
    )

    // A finance policy version must exist before any redemption can reference it
    // (`redemption_requests.finance_policy_version` is a foreign key). Version 1
    // carries the schema's default dual-approval threshold; changing thresholds is
    // an administrative act that publishes a new version.
    const policy = firstRow<{ version: number }>(
      await client.query("SELECT version FROM finance_policy_versions WHERE retired_at IS NULL"),
    )
    if (policy === undefined) {
      await client.query(
        "INSERT INTO finance_policy_versions (version, effective_from, published_by_user_id) " +
          "VALUES (1, now(), $1) ON CONFLICT (version) DO NOTHING",
        [adminId],
      )
    }

    /*
     * The default client (QA) login. It deliberately gets no role grant: roles
     * carry admin permissions, and an investor is authorised by owning its own
     * records, not by a role. `application_id` stays NULL — this account did not
     * come through signup, and the column is nullable and UNIQUE, so leaving it
     * unset is both legal and honest about the account's provenance.
     */
    if (seedClient && config.clientEmail !== null && clientPasswordHash !== null) {
      await upsertLogin(client, {
        email: config.clientEmail,
        passwordHash: clientPasswordHash,
        phone: config.clientPhone,
        fullName: config.clientFullName,
        overwrite: config.overwrite,
      })
    }

    await client.query("COMMIT")
    return { catalogStatements: statements.length, adminSeeded: true, clientSeeded: seedClient, skipped: null }
  } catch (error: unknown) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const config = resolveSeedAuthConfig(process.env)
  const pool = createPool(schemaToolPoolSettings(parseDatabaseConfig(process.env)))
  try {
    const result = await runSeedAuth(pool, config)
    if (result.skipped === "disabled") {
      process.stdout.write("seed:auth disabled (SEED_AUTH_ENABLED=false); catalog seeded only\n")
    } else if (result.skipped === "production_not_allowed") {
      process.stdout.write(
        "seed:auth skipped admin bootstrap in production (set SEED_AUTH_ALLOW_PRODUCTION=true); catalog seeded\n",
      )
    } else {
      process.stdout.write(
        `seed:auth applied; admin ${result.adminSeeded ? "bootstrapped" : "unchanged"}, ` +
          `client ${result.clientSeeded ? "bootstrapped" : "not configured (SEED_CLIENT_EMAIL/PASSWORD unset)"}\n`,
      )
    }
  } finally {
    await pool.end()
  }
}
