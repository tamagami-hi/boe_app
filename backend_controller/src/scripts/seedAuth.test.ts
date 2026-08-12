import { describe, expect, test, vi } from "vitest"

import { SEED_PERMISSIONS } from "../db/seedCatalog.js"
import {
  resolveSeedAuthConfig,
  runSeedAuth,
  type SeedAuthClient,
  type SeedAuthConfig,
} from "./seedAuth.js"

describe("onboarding permission catalog", () => {
  test("does not seed permissions for removed review, invitation, or manual KYC workflows", () => {
    const permissionCodes = SEED_PERMISSIONS.map((permission) => permission.code)

    expect(permissionCodes).not.toContain("applications.review")
    expect(permissionCodes).not.toContain("invitations.manage")
    expect(permissionCodes).not.toContain("kyc.read")
    expect(permissionCodes).not.toContain("kyc.review")
  })
})

const baseConfig: SeedAuthConfig = {
  enabled: true,
  allowProduction: false,
  overwrite: false,
  isProduction: false,
  adminEmail: "admin@example.com",
  adminPassword: "correct horse battery staple",
  adminPhone: "+911234567890",
  adminFullName: "BeOnEdge Admin",
  clientEmail: null,
  clientPassword: null,
  clientPhone: "+910000000003",
  clientFullName: "BeOnEdge Client",
}

const withClient = {
  ...baseConfig,
  clientEmail: "client@example.com",
  clientPassword: "a different passphrase entirely",
} satisfies SeedAuthConfig

interface FakeState {
  userExists: boolean
  credentialExists: boolean
}

const createFakePool = (state: FakeState) => {
  const queries: string[] = []
  const calls: { text: string; values: readonly unknown[] }[] = []
  const idFor = (email: string): string => `user-${email}`
  const client: SeedAuthClient = {
    query: vi.fn((text: string, values: readonly unknown[] = []) => {
      queries.push(text)
      calls.push({ text, values })
      if (text.startsWith("SELECT id FROM users")) {
        return Promise.resolve({ rows: state.userExists ? [{ id: idFor(String(values[0])) }] : [] })
      }
      if (text.startsWith("INSERT INTO users")) {
        return Promise.resolve({ rows: [{ id: idFor(String(values[0])) }] })
      }
      if (text.startsWith("SELECT user_id FROM user_credentials")) {
        return Promise.resolve({ rows: state.credentialExists ? [{ user_id: String(values[0]) }] : [] })
      }
      if (text.startsWith("SELECT id FROM roles")) return Promise.resolve({ rows: [{ id: "role-super" }] })
      if (text.startsWith("SELECT id FROM permissions")) return Promise.resolve({ rows: [{ id: "perm-x" }] })
      return Promise.resolve({ rows: [] })
    }),
    release: vi.fn(),
  }
  return { pool: { connect: () => Promise.resolve(client) }, client, queries, calls }
}

const fakeHasher = (): Promise<string> => Promise.resolve("$argon2id$v=19$fake")

describe("resolveSeedAuthConfig", () => {
  test("derives admin fields with fallbacks and lowercased email", () => {
    const config = resolveSeedAuthConfig({
      ADMIN_LOGIN_ID: "Admin@Example.com",
      ADMIN_PASSWORD: "pw",
      NODE_ENV: "production",
      SEED_AUTH_ALLOW_PRODUCTION: "true",
    })
    expect(config).toMatchObject({
      enabled: true,
      allowProduction: true,
      isProduction: true,
      adminEmail: "admin@example.com",
      adminPassword: "pw",
      adminPhone: "+910000000001",
      adminFullName: "BeOnEdge Admin",
    })
  })

  test("SEED_ADMIN_* overrides ADMIN_* and SEED_AUTH_ENABLED=false disables", () => {
    const config = resolveSeedAuthConfig({
      ADMIN_LOGIN_ID: "a@x.com",
      SEED_ADMIN_EMAIL: "b@x.com",
      SEED_ADMIN_PASSWORD: "pw2",
      SEED_AUTH_ENABLED: "false",
      ADMIN_FIRST_NAME: "Ops",
      ADMIN_LAST_NAME: "Lead",
    })
    expect(config.enabled).toBe(false)
    expect(config.adminEmail).toBe("b@x.com")
    expect(config.adminFullName).toBe("Ops Lead")
  })
})

describe("runSeedAuth", () => {
  test("bootstraps a new admin: user, credential, superadmin grants, role assignment", async () => {
    const { pool, queries } = createFakePool({ userExists: false, credentialExists: false })
    const result = await runSeedAuth(pool, baseConfig, fakeHasher)
    expect(result).toMatchObject({ adminSeeded: true, skipped: null })
    expect(queries).toContain("BEGIN")
    expect(queries).toContain("COMMIT")
    expect(queries.some((q) => q.startsWith("INSERT INTO users"))).toBe(true)
    expect(queries.some((q) => q.startsWith("INSERT INTO user_credentials"))).toBe(true)
    expect(queries.some((q) => q.startsWith("INSERT INTO role_permissions"))).toBe(true)
    expect(queries.some((q) => q.startsWith("INSERT INTO user_roles"))).toBe(true)
  })

  test("reuses an existing admin and does not overwrite the credential by default", async () => {
    const { pool, queries } = createFakePool({ userExists: true, credentialExists: true })
    const result = await runSeedAuth(pool, baseConfig, fakeHasher)
    expect(result.adminSeeded).toBe(true)
    expect(queries.some((q) => q.startsWith("INSERT INTO users"))).toBe(false)
    expect(queries.some((q) => q.startsWith("INSERT INTO user_credentials"))).toBe(false)
    expect(queries.some((q) => q.startsWith("UPDATE user_credentials"))).toBe(false)
  })

  test("overwrite=true updates the existing credential", async () => {
    const { pool, queries } = createFakePool({ userExists: true, credentialExists: true })
    await runSeedAuth(pool, { ...baseConfig, overwrite: true }, fakeHasher)
    expect(queries.some((q) => q.startsWith("UPDATE user_credentials"))).toBe(true)
  })

  test("disabled seeds the catalog only", async () => {
    const { pool, queries } = createFakePool({ userExists: false, credentialExists: false })
    const result = await runSeedAuth(pool, { ...baseConfig, enabled: false }, fakeHasher)
    expect(result.skipped).toBe("disabled")
    expect(result.adminSeeded).toBe(false)
    expect(queries.some((q) => q.startsWith("INSERT INTO users"))).toBe(false)
  })

  test("skips admin bootstrap in production unless allowed", async () => {
    const { pool } = createFakePool({ userExists: false, credentialExists: false })
    const result = await runSeedAuth(pool, { ...baseConfig, isProduction: true, allowProduction: false }, fakeHasher)
    expect(result.skipped).toBe("production_not_allowed")
    expect(result.adminSeeded).toBe(false)
  })

  test("requires an admin email and password when enabled", async () => {
    const { pool } = createFakePool({ userExists: false, credentialExists: false })
    await expect(
      runSeedAuth(pool, { ...baseConfig, adminPassword: null }, fakeHasher),
    ).rejects.toThrow(/admin email \+ password/u)
  })
})

describe("runSeedAuth default client", () => {
  test("seeds the client login from the environment, with no role grant", async () => {
    const { pool, calls } = createFakePool({ userExists: false, credentialExists: false })
    const result = await runSeedAuth(pool, withClient, fakeHasher)
    expect(result).toMatchObject({ adminSeeded: true, clientSeeded: true, skipped: null })

    const insertedUsers = calls
      .filter((call) => call.text.startsWith("INSERT INTO users"))
      .map((call) => call.values[0])
    expect(insertedUsers).toStrictEqual(["admin@example.com", "client@example.com"])
    // Two logins, two credential rows.
    expect(calls.filter((c) => c.text.startsWith("INSERT INTO user_credentials"))).toHaveLength(2)
    // Roles are admin-only: exactly one user_roles grant, for the admin.
    const grants = calls.filter((c) => c.text.startsWith("INSERT INTO user_roles"))
    expect(grants).toHaveLength(1)
    expect(grants[0]?.values[0]).toBe("user-admin@example.com")
  })

  test("is skipped, not failed, when no client is configured", async () => {
    const { pool, calls } = createFakePool({ userExists: false, credentialExists: false })
    const result = await runSeedAuth(pool, baseConfig, fakeHasher)
    expect(result.clientSeeded).toBe(false)
    expect(calls.filter((c) => c.text.startsWith("INSERT INTO users"))).toHaveLength(1)
  })

  test("rejects a half-configured client rather than silently skipping it", async () => {
    const { pool } = createFakePool({ userExists: false, credentialExists: false })
    await expect(
      runSeedAuth(pool, { ...withClient, clientPassword: null }, fakeHasher),
    ).rejects.toThrow(/SEED_CLIENT_EMAIL and SEED_CLIENT_PASSWORD together/u)
    await expect(
      runSeedAuth(pool, { ...withClient, clientEmail: null }, fakeHasher),
    ).rejects.toThrow(/SEED_CLIENT_EMAIL and SEED_CLIENT_PASSWORD together/u)
  })

  test("overwrite=true rotates the existing client credential too", async () => {
    const { pool, calls } = createFakePool({ userExists: true, credentialExists: true })
    await runSeedAuth(pool, { ...withClient, overwrite: true }, fakeHasher)
    const updated = calls
      .filter((c) => c.text.startsWith("UPDATE user_credentials"))
      .map((c) => c.values[0])
    expect(updated).toStrictEqual(["user-admin@example.com", "user-client@example.com"])
  })

  test("the production gate covers the client as well as the admin", async () => {
    const { pool, calls } = createFakePool({ userExists: false, credentialExists: false })
    const result = await runSeedAuth(pool, { ...withClient, isProduction: true, allowProduction: false }, fakeHasher)
    expect(result).toMatchObject({ adminSeeded: false, clientSeeded: false, skipped: "production_not_allowed" })
    expect(calls.some((c) => c.text.startsWith("INSERT INTO users"))).toBe(false)
  })

  test("refuses a password the login route would reject as too short", async () => {
    const { pool, calls } = createFakePool({ userExists: false, credentialExists: false })
    // 9 characters: hashes fine, but passwordInputSchema demands 12-128, so every
    // login would fail at request validation before the hash was compared.
    await expect(
      runSeedAuth(pool, { ...withClient, clientPassword: "short1234" }, fakeHasher),
    ).rejects.toThrow(/SEED_CLIENT_PASSWORD the login route would reject/u)
    expect(calls.some((c) => c.text.startsWith("INSERT INTO user_credentials"))).toBe(false)

    await expect(
      runSeedAuth(pool, { ...withClient, adminPassword: "short1234" }, fakeHasher),
    ).rejects.toThrow(/ADMIN_PASSWORD\/SEED_ADMIN_PASSWORD the login route would reject/u)
  })

  test("resolves client fields from the environment with defaults", () => {
    const config = resolveSeedAuthConfig({
      ADMIN_LOGIN_ID: "a@x.com",
      ADMIN_PASSWORD: "pw",
      SEED_CLIENT_EMAIL: "Client@Boe.Local",
      SEED_CLIENT_PASSWORD: "pw3",
    })
    expect(config).toMatchObject({
      clientEmail: "client@boe.local",
      clientPassword: "pw3",
      clientPhone: "+910000000003",
      clientFullName: "BeOnEdge Client",
    })
  })
})
