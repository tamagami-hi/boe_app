import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8")

const backendSchemaKeys = (): ReadonlySet<string> => {
  const source = repoFile("backend_controller/src/runtime/environment.ts")
  const schema = source.slice(source.indexOf("z.object({"))
  return new Set(
    [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]{2,}):/gmu)]
      .map((match) => match[1])
      .filter((key): key is string => key !== undefined),
  )
}

const declaredKeys = (contents: string): readonly string[] =>
  [...contents.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)]
    .map((match) => match[1])
    .filter((key): key is string => key !== undefined)

const composeSubstitutions = (contents: string): ReadonlySet<string> =>
  new Set(
    [...contents.matchAll(/\$\{([A-Z0-9_]+)/gu)]
      .map((match) => match[1])
      .filter((key): key is string => key !== undefined),
  )

const STACKS = [
  {
    stack: "dev_release",
    example: "release_manager/stacks/dev_release/.env.example",
    compose: "release_manager/stacks/dev_release/docker-compose.dev_app.yml",
  },
  {
    stack: "prod_release",
    example: "release_manager/stacks/prod_release/.env.example",
    compose: "release_manager/stacks/prod_release/docker-compose.prod_app.yml",
  },
] as const

const BACKEND_CONFIG_SOURCES = [
  "backend_controller/src/runtime/environment.ts",
  "backend_controller/src/db/config.ts",
  "backend_controller/src/crypto/context.ts",
] as const

const BACKEND_SOURCE_DIRECTORIES = [
  "backend_controller/src",
  "backend_controller/scripts",
] as const

const INFRASTRUCTURE_KEYS: ReadonlySet<string> = new Set([
  "BOE_VERSION",
  "BACKEND_PORT",
  "APP_FRONTEND_PORT",
  "ADMIN_FRONTEND_PORT",
  "PUBLIC_API_BASE_URL",
  "APK_CLIENT_DIR",
  "APK_ADMIN_DIR",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_HOST_BIND",
  "REDIS_MAXMEMORY",
  "EMAIL_WORKER_INTERVAL_SECONDS",
  "SIP_WORKER_INTERVAL_SECONDS",
  "COLLECTION_WORKER_INTERVAL_SECONDS",
])

const readableKeys = (): ReadonlySet<string> => {
  const keys = new Set<string>()
  for (const relative of BACKEND_CONFIG_SOURCES) {
    const source = repoFile(relative)
    const schema = source.slice(source.indexOf("z.object({"))
    for (const match of schema.matchAll(/^ {2}([A-Z][A-Z0-9_]{2,}):/gmu)) {
      if (match[1] !== undefined) keys.add(match[1])
    }
  }
  for (const directory of BACKEND_SOURCE_DIRECTORIES) {
    const root = fileURLToPath(new URL(`../../../${directory}/`, import.meta.url))
    for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!file.endsWith(".ts")) continue
      const contents = readFileSync(`${root}${file}`, "utf8")
      for (const match of contents.matchAll(/(?:process\.env|source|env)\.([A-Z][A-Z0-9_]{2,})/gu)) {
        if (match[1] !== undefined) keys.add(match[1])
      }
    }
  }
  return keys
}

describe("no environment example offers a setting nothing consumes", () => {
  const consumed = readableKeys()

  test("the readable-key scan found the whole surface", () => {
    expect(consumed.size).toBeGreaterThan(80)
    expect(consumed.has("TRUST_PROXY")).toBe(true)
    expect(consumed.has("DB_STATEMENT_TIMEOUT_MS")).toBe(true)
    expect(consumed.has("PASSWORD_BREACH_CHECK_MODE")).toBe(true)
  })

  for (const example of [
    "backend_controller/.env.example",
    "backend_controller/.env.production.example",
    ...STACKS.map(({ example: file }) => file),
  ]) {
    test(`${example} declares nothing dead`, () => {
      const dead = declaredKeys(repoFile(example))
        .filter((key) => !consumed.has(key))
        .filter((key) => !INFRASTRUCTURE_KEYS.has(key))

      expect(dead).toStrictEqual([])
    })
  }
})

describe("stack env reaches the backend container", () => {
  const schemaKeys = backendSchemaKeys()

  test("the backend schema was actually parsed", () => {
    expect(schemaKeys.size).toBeGreaterThan(40)
    expect(schemaKeys.has("PHONEPE_CALLBACK_URL")).toBe(true)
    expect(schemaKeys.has("REDIS_URL")).toBe(true)
    expect(schemaKeys.has("ACCESS_TOKEN_ISSUER")).toBe(true)
  })

  for (const { stack, example, compose } of STACKS) {
    test(`${stack} passes every backend-read key through compose`, () => {
      const passed = composeSubstitutions(repoFile(compose))
      const missing = declaredKeys(repoFile(example))
        .filter((key) => schemaKeys.has(key))
        .filter((key) => !passed.has(key))

      expect(missing).toStrictEqual([])
    })

    test(`${stack} passes the checkout redirect through compose`, () => {
      expect(composeSubstitutions(repoFile(compose)).has("PHONEPE_CHECKOUT_REDIRECT_URL")).toBe(true)
    })
  }
})
