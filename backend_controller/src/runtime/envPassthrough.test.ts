import { readFileSync } from "node:fs"
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
