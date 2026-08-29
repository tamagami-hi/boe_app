import { describe, expect, it } from "vitest"

import {
  decideAppUpdate,
  installableRelease,
} from "~/features/app-update/updateDecision"
import type { AppUpdateFeed } from "~/features/app-update/updateDecision"

const DIGEST = "a".repeat(64)

const artifact = (over: Partial<NonNullable<AppUpdateFeed["latest"]>> = {}): NonNullable<
  AppUpdateFeed["latest"]
> => ({
  version: "0.2.0",
  versionName: "0.2.0",
  versionCode: 20,
  applicationId: "com.beonedge.app",
  sizeBytes: 8_666_647,
  sha256: DIGEST,
  url: "https://releases.example.test/client/beonedge-0.2.0.apk",
  publishedAt: "2026-08-29T00:00:00.000Z",
  ...over,
})

const feed = (over: Partial<AppUpdateFeed> = {}): AppUpdateFeed => ({
  platform: "android",
  variant: "client",
  updateAvailable: true,
  mandatory: false,
  current: { version: "0.1.0", versionCode: 10, applicationId: "com.beonedge.app" },
  latest: artifact(),
  minimumSupportedVersion: null,
  maintenance: {},
  ...over,
})

describe("app update decision", () => {
  it("does nothing without a feed", () => {
    expect(decideAppUpdate(null)).toEqual({ kind: "none" })
  })

  it("does nothing when the feed reports no newer build", () => {
    expect(decideAppUpdate(feed({ updateAvailable: false }))).toEqual({ kind: "none" })
  })

  it("offers a dismissible update when a newer build exists and the floor is met", () => {
    const decision = decideAppUpdate(feed())
    expect(decision.kind).toBe("optional")
    expect(decision.kind === "optional" ? decision.release.versionCode : null).toBe(20)
  })

  it("blocks when the running build is below the minimum supported version", () => {
    const decision = decideAppUpdate(feed({ mandatory: true, minimumSupportedVersion: "0.2.0" }))
    expect(decision.kind).toBe("mandatory")
    expect(decision.kind === "mandatory" ? decision.minimumSupportedVersion : null).toBe("0.2.0")
    expect(decision.kind === "mandatory" ? decision.release?.sha256 : null).toBe(DIGEST)
  })

  it("blocks with nothing to download when the floor is unreachable", () => {
    const decision = decideAppUpdate(
      feed({ mandatory: true, updateAvailable: false, minimumSupportedVersion: "9.9.9" }),
    )
    expect(decision).toEqual({
      kind: "mandatory",
      release: null,
      minimumSupportedVersion: "9.9.9",
    })
  })

  it("blocks rather than nags: mandatory wins over dismissible", () => {
    expect(decideAppUpdate(feed({ mandatory: true })).kind).toBe("mandatory")
  })

  it("refuses a release with no download url", () => {
    expect(installableRelease(feed({ latest: artifact({ url: null }) }))).toBeNull()
    expect(decideAppUpdate(feed({ latest: artifact({ url: null }) }))).toEqual({ kind: "none" })
  })

  it("refuses a release served over plain http", () => {
    const insecure = artifact({ url: "http://releases.example.test/client/app.apk" })
    expect(installableRelease(feed({ latest: insecure }))).toBeNull()
  })

  it("refuses a release whose digest is not a sha-256", () => {
    expect(installableRelease(feed({ latest: artifact({ sha256: "" }) }))).toBeNull()
    expect(installableRelease(feed({ latest: artifact({ sha256: "abc" }) }))).toBeNull()
    expect(
      installableRelease(feed({ latest: artifact({ sha256: DIGEST.toUpperCase() }) })),
    ).toBeNull()
  })

  it("carries the digest through to whatever performs the download", () => {
    const release = installableRelease(feed())
    expect(release?.sha256).toBe(DIGEST)
    expect(release?.sizeBytes).toBe(8_666_647)
    expect(release?.url.startsWith("https://")).toBe(true)
  })

  it("never offers a download when the feed has no artifact at all", () => {
    expect(installableRelease(feed({ latest: null }))).toBeNull()
    expect(decideAppUpdate(feed({ latest: null }))).toEqual({ kind: "none" })
  })
})
