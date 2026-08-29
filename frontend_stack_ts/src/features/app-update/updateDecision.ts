import type { getAppUpdate } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { SHA256_HEX } from "~/platform/appUpdate"

export type AppUpdateFeed = DataOf<typeof getAppUpdate>

export type UpdateRelease = Readonly<{
  version: string
  versionName: string
  versionCode: number
  sizeBytes: number
  sha256: string
  url: string
}>

export type AppUpdateDecision =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "optional"; release: UpdateRelease }>
  | Readonly<{
      kind: "mandatory"
      release: UpdateRelease | null
      minimumSupportedVersion: string | null
    }>

export const installableRelease = (feed: AppUpdateFeed): UpdateRelease | null => {
  if (!feed.updateAvailable) return null
  const latest = feed.latest
  if (latest === null) return null
  if (latest.url === null) return null
  if (!latest.url.startsWith("https://")) return null
  if (!SHA256_HEX.test(latest.sha256)) return null
  return {
    version: latest.version,
    versionName: latest.versionName,
    versionCode: latest.versionCode,
    sizeBytes: latest.sizeBytes,
    sha256: latest.sha256,
    url: latest.url,
  }
}

export const decideAppUpdate = (feed: AppUpdateFeed | null): AppUpdateDecision => {
  if (feed === null) return { kind: "none" }

  const release = installableRelease(feed)

  if (feed.mandatory) {
    return { kind: "mandatory", release, minimumSupportedVersion: feed.minimumSupportedVersion }
  }

  return release === null ? { kind: "none" } : { kind: "optional", release }
}

export const isBlocking = (decision: AppUpdateDecision): boolean => decision.kind === "mandatory"
