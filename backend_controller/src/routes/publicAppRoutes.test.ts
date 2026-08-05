import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import type { UnitOfWork } from "../db/database.js"
import type { AdminContentRepository } from "../repositories/adminContentRepository.js"
import { createApplication } from "../runtime/application.js"

import { clearAppUpdateCache, registerPublicAppRoutes } from "./publicAppRoutes.js"

/**
 * The update endpoint's whole job is to turn a directory of published artifacts
 * into a yes/no answer, so these tests drive it through real files on disk. The
 * database side (app config) is stubbed: `minimumSupportedVersion` is the only
 * value read from it, and Postgres would add nothing but startup time.
 */

interface UpdateEnvelope {
  ok: boolean
  data: {
    updateAvailable: boolean
    mandatory: boolean
    minimumSupportedVersion: string | null
    current: { version: string | null; versionCode: number | null; applicationId: string | null }
    latest: {
      version: string
      versionCode: number
      applicationId: string
      sha256: string
      sizeBytes: number
      url: string | null
    } | null
  }
}

let releaseRoot: string
let app: FastifyInstance

/** Sidecar exactly as `emu/boe_update.sh` writes it. */
const sidecar = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  apk: "boe.dev.client.0.7.3.apk",
  target: "dev",
  variant: "client",
  version: "0.7.3",
  buildLabel: "0.7.3",
  applicationId: "com.beonedge.app.dev",
  versionName: "0.7.3",
  versionCode: 703,
  builtAt: "2026-08-05T10:47:24Z",
  signing: "release",
  sha256: "4f5e53142cffdc4794f68c9d429487c067e0cb92cd43f47e4e02d0ade9dcd348",
  sizeBytes: 2555925,
  ...overrides,
})

/** Write a sidecar plus a stand-in APK, the pair the endpoint requires. */
const publish = async (
  variant: string,
  name: string,
  overrides: Record<string, unknown> = {},
  writeApk = true,
): Promise<void> => {
  const directory = join(releaseRoot, variant)
  await mkdir(directory, { recursive: true })
  const meta = sidecar({ apk: `${name}.apk`, ...overrides })
  await writeFile(join(directory, `${name}.json`), JSON.stringify(meta), "utf8")
  if (writeApk) await writeFile(join(directory, `${name}.apk`), "not-a-real-apk", "utf8")
}

const buildApp = (
  options: { releaseRoot: string | null; downloadBaseUrl: string | null; minimumAndroid?: string },
): FastifyInstance => {
  const payload =
    options.minimumAndroid === undefined
      ? {}
      : { minimumSupportedVersion: { android: options.minimumAndroid } }

  const adminContentRepository = {
    findCurrentAppConfig: () =>
      Promise.resolve({
        id: "config-1",
        version: 1,
        payload,
        content_sha256: Buffer.alloc(32),
        published_by_user_id: "admin-1",
        published_at: new Date("2026-08-05T00:00:00Z"),
        retired_at: null,
        created_at: new Date("2026-08-05T00:00:00Z"),
      }),
  } as unknown as AdminContentRepository

  // The route only ever reads, so a pass-through unit of work is enough.
  const unitOfWork = {
    execute: <T,>(work: (tx: never) => Promise<T>): Promise<T> => work(undefined as never),
  } as unknown as UnitOfWork

  return createApplication({
    logger: false,
    registerRoutes: (instance) =>
      registerPublicAppRoutes(instance, {
        adminContentRepository,
        unitOfWork,
        appUpdate: { releaseRoot: options.releaseRoot, downloadBaseUrl: options.downloadBaseUrl },
      }),
  })
}

const ask = async (query: string): Promise<UpdateEnvelope> => {
  const response = await app.inject({ method: "GET", url: `/v1/app/update?${query}` })
  expect(response.statusCode).toBe(200)
  return response.json<UpdateEnvelope>()
}

beforeEach(async () => {
  releaseRoot = await mkdtemp(join(tmpdir(), "boe-apk-"))
  clearAppUpdateCache()
})

afterEach(async () => {
  if (app !== undefined) await app.close()
  await rm(releaseRoot, { recursive: true, force: true })
  clearAppUpdateCache()
})

describe("GET /v1/app/update", () => {
  test("offers the highest published versionCode with a download URL", async () => {
    await publish("client", "boe.dev.client.0.7.2", { version: "0.7.2", versionName: "0.7.2", versionCode: 702 })
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({ releaseRoot, downloadBaseUrl: "https://dev-app.beonedge.in/downloads" })

    const body = await ask("applicationId=com.beonedge.app.dev&versionCode=702&version=0.7.2")

    expect(body.ok).toBe(true)
    expect(body.data.updateAvailable).toBe(true)
    expect(body.data.latest?.versionCode).toBe(703)
    expect(body.data.latest?.url).toBe(
      "https://dev-app.beonedge.in/downloads/client/boe.dev.client.0.7.3.apk",
    )
    // The digest must be passed through untouched: the app verifies against it.
    expect(body.data.latest?.sha256).toBe(sidecar().sha256)
  })

  test("reports no update when the caller already runs the newest build", async () => {
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({ releaseRoot, downloadBaseUrl: "https://dev-app.beonedge.in/downloads" })

    const body = await ask("applicationId=com.beonedge.app.dev&versionCode=703&version=0.7.3")

    expect(body.data.updateAvailable).toBe(false)
    expect(body.data.latest?.versionCode).toBe(703)
  })

  test("never offers an APK built for a different applicationId", async () => {
    // A dev build must not be handed to a production install: the signing
    // certificates differ, so Android would refuse the install anyway.
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({ releaseRoot, downloadBaseUrl: "https://dev-app.beonedge.in/downloads" })

    const body = await ask("applicationId=com.beonedge.app&versionCode=1&version=0.1.0")

    expect(body.data.updateAvailable).toBe(false)
    expect(body.data.latest).toBeNull()
  })

  test("ignores debug-signed builds", async () => {
    await publish("client", "boe.dev.client.0.7.9", {
      version: "0.7.9",
      versionName: "0.7.9",
      versionCode: 709,
      signing: "debug",
    })
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({ releaseRoot, downloadBaseUrl: "https://dev-app.beonedge.in/downloads" })

    const body = await ask("applicationId=com.beonedge.app.dev&versionCode=700&version=0.7.0")

    expect(body.data.latest?.versionCode).toBe(703)
  })

  test("ignores a sidecar whose APK is not on disk yet", async () => {
    // Publishing moves the APK and the sidecar as two separate renames, so this
    // window really happens; advertising in it would hand out a dead link.
    await publish("client", "boe.dev.client.0.8.0", {
      version: "0.8.0",
      versionName: "0.8.0",
      versionCode: 800,
    }, false)
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({ releaseRoot, downloadBaseUrl: "https://dev-app.beonedge.in/downloads" })

    const body = await ask("applicationId=com.beonedge.app.dev&versionCode=700&version=0.7.0")

    expect(body.data.latest?.versionCode).toBe(703)
  })

  test("answers 'no update' rather than failing when no release directory is mounted", async () => {
    app = buildApp({ releaseRoot: null, downloadBaseUrl: null })

    const body = await ask("applicationId=com.beonedge.app.dev&versionCode=703&version=0.7.3")

    expect(body.ok).toBe(true)
    expect(body.data.updateAvailable).toBe(false)
    expect(body.data.latest).toBeNull()
  })

  test("omits the download URL when no public base URL is configured", async () => {
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({ releaseRoot, downloadBaseUrl: null })

    const body = await ask("applicationId=com.beonedge.app.dev&versionCode=702&version=0.7.2")

    expect(body.data.latest?.url).toBeNull()
  })

  test("marks the running build mandatory when it is below the published floor", async () => {
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({
      releaseRoot,
      downloadBaseUrl: "https://dev-app.beonedge.in/downloads",
      minimumAndroid: "0.7.2",
    })

    const stale = await ask("applicationId=com.beonedge.app.dev&versionCode=701&version=0.7.1")
    expect(stale.data.mandatory).toBe(true)
    expect(stale.data.minimumSupportedVersion).toBe("0.7.2")

    const supported = await ask("applicationId=com.beonedge.app.dev&versionCode=702&version=0.7.2")
    expect(supported.data.mandatory).toBe(false)
  })

  test("is never mandatory when no floor is published", async () => {
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({ releaseRoot, downloadBaseUrl: "https://dev-app.beonedge.in/downloads" })

    const body = await ask("applicationId=com.beonedge.app.dev&versionCode=1&version=0.0.1")

    expect(body.data.updateAvailable).toBe(true)
    expect(body.data.mandatory).toBe(false)
  })

  test("compares versions numerically, not lexicographically", async () => {
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({
      releaseRoot,
      downloadBaseUrl: "https://dev-app.beonedge.in/downloads",
      minimumAndroid: "0.9.0",
    })

    // "0.10.0" > "0.9.0" numerically, even though it sorts earlier as a string.
    const body = await ask("applicationId=com.beonedge.app.dev&versionCode=1000&version=0.10.0")
    expect(body.data.mandatory).toBe(false)
  })

  test("tolerates a build label with a git suffix", async () => {
    await publish("client", "boe.dev.client.0.7.3")
    app = buildApp({
      releaseRoot,
      downloadBaseUrl: "https://dev-app.beonedge.in/downloads",
      minimumAndroid: "0.7.2",
    })

    const body = await ask(
      "applicationId=com.beonedge.app.dev&versionCode=701&version=0.7.1-dev.0.g08406b0.dirty",
    )
    expect(body.data.mandatory).toBe(true)
  })

  test("rejects an unknown query parameter instead of ignoring it", async () => {
    app = buildApp({ releaseRoot, downloadBaseUrl: null })

    const response = await app.inject({ method: "GET", url: "/v1/app/update?variant=client&surprise=1" })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } })
  })

  test("rejects a variant outside the known set, so it can never become a path segment", async () => {
    app = buildApp({ releaseRoot, downloadBaseUrl: null })

    const response = await app.inject({ method: "GET", url: "/v1/app/update?variant=../../etc" })

    expect(response.statusCode).toBe(400)
  })
})

describe("GET /v1/app-config", () => {
  test("serves the published config without a session", async () => {
    app = buildApp({ releaseRoot: null, downloadBaseUrl: null, minimumAndroid: "0.7.2" })

    const response = await app.inject({ method: "GET", url: "/v1/app-config" })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      data: { version: 1, config: { minimumSupportedVersion: { android: "0.7.2" } } },
    })
  })
})
