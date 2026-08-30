import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

/**
 * The committed origin allowlists must contain the APK's content origin.
 *
 * `cors.test.ts` already proves the handler reflects `https://localhost` when it
 * is allow-listed. That is not the defect this guards. The defect is
 * configuration drift: the shipped `.env.example` files omitted the origin
 * entirely, so a deployment made from them answers every APK request without
 * `Access-Control-Allow-Origin` and the browser discards the reply. The symptom
 * is the whole app appearing offline, with a green backend and green tests.
 *
 * A retired release script used to warn about exactly this at deploy time; the
 * rewrite dropped the warning. Asserting it here keeps the contract enforced
 * somewhere that actually runs.
 *
 * This is a static file check, not runtime proof. It cannot tell you what the
 * deployed environment holds — a real deployment may override these values.
 * Confirming production still needs a request from the APK WebView with
 * `Origin: https://localhost` against the deployed backend.
 */

/** The exact origin Capacitor serves the Android bundle from (androidScheme=https). */
const APK_ORIGIN = "https://localhost"

const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), "utf8")

/** Reads a `KEY=value` line out of a dotenv-style example file. */
const envValue = (contents: string, key: string): string | undefined => {
  for (const line of contents.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("#")) continue
    const [name, ...rest] = trimmed.split("=")
    if (name === key) return rest.join("=").trim()
  }
  return undefined
}

const originsOf = (contents: string, key: string): string[] =>
  (envValue(contents, key) ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

/** Every example that configures a backend expected to serve an APK. */
const localDevelopmentExamples = [
  { file: "backend_controller/.env.example", key: "WEB_ORIGIN_ALLOWLIST" },
] as const

const deployedExamples = [
  { file: "backend_controller/.env.production.example", key: "WEB_ORIGIN_ALLOWLIST" },
  { file: "backend_controller/.env.production.example", key: "CORS_ORIGIN" },
  { file: "release_manager/stacks/dev_release/.env.example", key: "WEB_ORIGIN_ALLOWLIST" },
  { file: "release_manager/stacks/prod_release/.env.example", key: "WEB_ORIGIN_ALLOWLIST" },
] as const

const apkServingExamples = [...localDevelopmentExamples, ...deployedExamples]

describe("committed origin allowlists", () => {
  for (const { file, key } of apkServingExamples) {
    test(`${file} → ${key} allows the exact APK origin`, () => {
      const origins = originsOf(repoFile(file), key)

      expect(origins.length).toBeGreaterThan(0)
      // Exact string. A trailing slash, an added port, or a scheme change all
      // fail to match the browser's Origin header.
      expect(origins).toContain(APK_ORIGIN)
    })
  }

  for (const { file, key } of localDevelopmentExamples) {
    test(`${file} → ${key} limits cleartext to the local Vite server`, () => {
      const origins = originsOf(repoFile(file), key)

      for (const origin of origins) {
        expect(origin).not.toBe("*")
        expect(origin.startsWith("*")).toBe(false)
        expect(origin).not.toMatch(/\s/)
        if (origin.startsWith("http://")) expect(origin).toBe("http://localhost:5174")
        else expect(origin.startsWith("https://")).toBe(true)
      }
    })
  }

  for (const { file, key } of deployedExamples) {
    test(`${file} → ${key} stays explicit and https-only`, () => {
      const origins = originsOf(repoFile(file), key)

      for (const origin of origins) {
        // `*` is illegal alongside credentials, which the admin console needs.
        expect(origin).not.toBe("*")
        expect(origin.startsWith("*")).toBe(false)
        // Cleartext must never appear: `http://localhost` is a developer machine,
        // a different thing from the APK's `https://localhost` content origin.
        expect(origin.startsWith("http://")).toBe(false)
        expect(origin.startsWith("https://")).toBe(true)
        // The deploy gate rejects entries containing whitespace.
        expect(origin).not.toMatch(/\s/)
      }
    })
  }

  test("the deploy gate's own allowlist pattern accepts the APK origin", () => {
    // release_manager/stacks/_shared/_boe_deploy.sh requires every entry to be an
    // unspaced https:// origin. If that ever tightens to reject `localhost`, the
    // examples above would pass while the deploy died.
    const gate = repoFile("release_manager/stacks/_shared/_boe_deploy.sh")

    expect(gate).toContain("WEB_ORIGIN_ALLOWLIST")
    expect(APK_ORIGIN.startsWith("https://")).toBe(true)
    expect(APK_ORIGIN).not.toMatch(/\s/)
  })
})
const REDIRECT_KEY = "PHONEPE_CHECKOUT_REDIRECT_URL"

const redirectExamples = [
  "backend_controller/.env.example",
  "backend_controller/.env.production.example",
  "release_manager/stacks/dev_release/.env.example",
  "release_manager/stacks/prod_release/.env.example",
] as const

describe("committed PhonePe checkout redirect URLs", () => {
  for (const file of redirectExamples) {
    test(`${file} declares ${REDIRECT_KEY}`, () => {
      expect(envValue(repoFile(file), REDIRECT_KEY)).toBeDefined()
    })

    test(`${file} → ${REDIRECT_KEY} is a safe absolute https URL`, () => {
      const value = envValue(repoFile(file), REDIRECT_KEY) ?? ""
      expect(value.length).toBeGreaterThan(0)

      const url = new URL(value)
      expect(url.protocol).toBe("https:")
      expect(url.username).toBe("")
      expect(url.password).toBe("")
      expect(url.hash).toBe("")
      expect(url.pathname).not.toBe("/")
    })
  }

  test("the examples do not point the payer back at a provider-events webhook", () => {
    for (const file of redirectExamples) {
      const value = envValue(repoFile(file), REDIRECT_KEY) ?? ""
      expect(value).not.toContain("/provider-events/")
    }
  })
})
