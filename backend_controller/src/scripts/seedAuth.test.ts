import { describe, expect, test, vi } from "vitest"

import {
  resolveSeedAuthConfig,
  runSeedAuth,
  type SeedAuthClient,
  type SeedAuthConfig,
} from "./seedAuth.js"

const baseConfig: SeedAuthConfig = {
  enabled: true,
  allowProduction: false,
  overwrite: false,
  isProduction: false,
  adminEmail: "admin@example.com",
  adminPassword: "correct horse battery staple",
  adminPhone: "+911234567890",
  adminFullName: "BeOnEdge Admin",
}

interface FakeState {
  userExists: boolean
  credentialExists: boolean
}

const createFakePool = (state: FakeState) => {
  const queries: string[] = []
  const client: SeedAuthClient = {
    query: vi.fn((text: string) => {
      queries.push(text)
      if (text.startsWith("SELECT id FROM users")) {
        return Promise.resolve({ rows: state.userExists ? [{ id: "admin-1" }] : [] })
      }
      if (text.startsWith("INSERT INTO users")) return Promise.resolve({ rows: [{ id: "admin-1" }] })
      if (text.startsWith("SELECT user_id FROM user_credentials")) {
        return Promise.resolve({ rows: state.credentialExists ? [{ user_id: "admin-1" }] : [] })
      }
      if (text.startsWith("SELECT id FROM roles")) return Promise.resolve({ rows: [{ id: "role-super" }] })
      if (text.startsWith("SELECT id FROM permissions")) return Promise.resolve({ rows: [{ id: "perm-x" }] })
      return Promise.resolve({ rows: [] })
    }),
    release: vi.fn(),
  }
  return { pool: { connect: () => Promise.resolve(client) }, client, queries }
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
