/**
 * The published-APK release feed, shared by everything that needs to know what
 * the newest build is.
 *
 * ── WHERE THE ANSWER COMES FROM ─────────────────────────────────────────────
 * The release pipeline (`release_manager/lib/apk_ship.sh`) publishes each APK
 * into a per-variant holder directory on the VPS together with an immutable
 * sidecar JSON written by `emu/boe_update.sh`:
 *
 *   dev_apk/boe.dev.client.0.7.5.apk
 *   dev_apk/boe.dev.client.0.7.5.json   { versionName, versionCode, sha256, … }
 *
 * Those directories are mounted read-only into this container under
 * `APK_RELEASE_ROOT/<variant>/`, so the filesystem the release tooling already
 * treats as authoritative *is* the update feed. Shipping an APK is the only
 * action needed to publish — there is no second place to remember to bump, and
 * nothing can advertise a version that was never published.
 *
 * The APK bytes themselves are served by nginx (`/downloads/<variant>/`), not by
 * this process. `APK_DOWNLOAD_BASE_URL` is the public prefix nginx serves those
 * same holder directories at, so a download URL is base + variant + filename.
 *
 * Consumers:
 *  - `GET /v1/app/update` (routes/publicAppRoutes.ts) — the app's update check;
 *  - the account-approved email (routes/adminIdentityRoutes.ts) — the official
 *    client APK link sent to a newly approved investor.
 *
 * When `APK_RELEASE_ROOT` is unset (local dev, or a deployment without the
 * mount) every answer degrades to "nothing published" rather than failing.
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"

/**
 * Variants are a closed set and become path segments, so they are validated
 * against a literal union rather than sanitised — there is no way to smuggle
 * `../` through an enum.
 */
export const RELEASE_VARIANTS = ["client", "admin"] as const
export type ReleaseVariant = (typeof RELEASE_VARIANTS)[number]

export interface ReleaseFeed {
  /** Directory holding one subdirectory per variant, or null when unmounted. */
  readonly releaseRoot: string | null
  /** Public base URL nginx serves the holder directories at, no trailing slash. */
  readonly downloadBaseUrl: string | null
}

/** One published APK, as described by its sidecar. */
export interface ReleaseArtifact {
  readonly apk: string
  readonly variant: string
  readonly target: string
  readonly version: string
  readonly versionName: string
  readonly versionCode: number
  readonly applicationId: string
  readonly sha256: string
  readonly sizeBytes: number
  readonly signing: string
  readonly builtAt: string | null
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

/**
 * Turn a sidecar into an artifact, or null when it is not a usable release.
 *
 * Rejecting here rather than at the call site keeps every "would this install?"
 * rule in one place: unsigned/debug builds are never offered as updates, and a
 * sidecar without a version code cannot be compared against a running app.
 */
export const toArtifact = (raw: unknown): ReleaseArtifact | null => {
  const record = asRecord(raw)
  const apk = asString(record.apk)
  const versionCode = asNumber(record.versionCode)
  const applicationId = asString(record.applicationId)
  const sha256 = asString(record.sha256)
  const signing = asString(record.signing)
  if (apk === null || versionCode === null || applicationId === null || sha256 === null) return null
  // A debug-signed APK cannot upgrade a release-signed install; never offer one.
  if (signing !== "release") return null
  if (!apk.endsWith(".apk")) return null
  // Defence in depth: the filename becomes part of a URL and a filesystem path.
  if (apk.includes("/") || apk.includes("\\") || apk.includes("..")) return null
  return {
    apk,
    variant: asString(record.variant) ?? "",
    target: asString(record.target) ?? "",
    version: asString(record.version) ?? "",
    versionName: asString(record.versionName) ?? asString(record.version) ?? "",
    versionCode,
    applicationId,
    sha256,
    sizeBytes: asNumber(record.sizeBytes) ?? 0,
    signing,
    builtAt: asString(record.builtAt),
  }
}

/**
 * Read every sidecar in a variant's holder directory and return the artifacts
 * whose APK is actually present on disk.
 *
 * The presence check is not paranoia: `apk_publish_remote_atomic` moves the APK
 * and its sidecar into place as two separate renames, so there is a window in
 * which the sidecar for a new version exists but its APK does not. Advertising
 * during that window would hand out a 404 download link.
 */
const readVariantArtifacts = async (directory: string): Promise<readonly ReleaseArtifact[]> => {
  let entries: readonly string[]
  try {
    entries = await readdir(directory)
  } catch {
    // Missing or unreadable holder directory: no updates, not an error.
    return []
  }

  const artifacts: ReleaseArtifact[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(join(directory, entry), "utf8"))
    } catch {
      continue
    }
    const artifact = toArtifact(parsed)
    if (artifact === null) continue
    try {
      const apkStat = await stat(join(directory, artifact.apk))
      if (!apkStat.isFile()) continue
      // Trust the bytes on disk over the sidecar for the size the UI shows as a
      // download total; they only differ if a publish was interrupted.
      artifacts.push({ ...artifact, sizeBytes: apkStat.size })
    } catch {
      continue
    }
  }
  return artifacts
}

/**
 * Directory listings are cached briefly. The splash screen of every app launch
 * hits the update endpoint, while publishes happen a few times a day, so
 * re-reading the directory per request is pure overhead. The TTL is short
 * enough that a fresh release is offered within seconds of shipping.
 */
const LISTING_TTL_MS = 30_000
interface CacheEntry {
  readonly expiresAt: number
  readonly artifacts: readonly ReleaseArtifact[]
}
const listingCache = new Map<string, CacheEntry>()

export const cachedArtifacts = async (
  directory: string,
  now: number,
): Promise<readonly ReleaseArtifact[]> => {
  const hit = listingCache.get(directory)
  if (hit !== undefined && hit.expiresAt > now) return hit.artifacts
  const artifacts = await readVariantArtifacts(directory)
  listingCache.set(directory, { expiresAt: now + LISTING_TTL_MS, artifacts })
  return artifacts
}

/** Exposed for tests: drop memoised directory listings. */
export const clearAppUpdateCache = (): void => {
  listingCache.clear()
}

/**
 * Compare dotted numeric versions ("0.7.4" vs "0.10.0") segment by segment.
 * Returns a negative number when `left` is older. Non-numeric segments compare
 * as 0, which is the safe direction: a version we cannot parse is never treated
 * as newer than one we can.
 */
export const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split(".")
  const rightParts = right.split(".")
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const a = Number.parseInt(leftParts[index] ?? "0", 10)
    const b = Number.parseInt(rightParts[index] ?? "0", 10)
    const left0 = Number.isNaN(a) ? 0 : a
    const right0 = Number.isNaN(b) ? 0 : b
    if (left0 !== right0) return left0 - right0
  }
  return 0
}

/** The release version ("0.7.4") out of a build label ("0.7.4-dev.0.gabc123"). */
export const baseVersion = (value: string): string => {
  const match = /^[0-9]+(?:\.[0-9]+)*/u.exec(value)
  const leading = match?.[0]
  return leading === undefined || leading.length === 0 ? value : leading
}

export const newest = (
  artifacts: readonly ReleaseArtifact[],
  applicationId: string | undefined,
): ReleaseArtifact | null => {
  const eligible =
    applicationId === undefined
      ? artifacts
      : artifacts.filter((artifact) => artifact.applicationId === applicationId)
  return eligible.reduce<ReleaseArtifact | null>(
    (best, artifact) =>
      best === null || artifact.versionCode > best.versionCode ? artifact : best,
    null,
  )
}

export const downloadUrl = (
  base: string | null,
  variant: ReleaseVariant,
  artifact: ReleaseArtifact,
): string | null => (base === null ? null : `${base}/${variant}/${artifact.apk}`)

/**
 * Newest published build for an applicationId, or null.
 *
 * Exported so the authenticated app-version report resolves "latest" through
 * exactly the same filesystem read as the public update feed. Two independent
 * notions of "newest" would eventually disagree, and the inbox would then argue
 * with the launch dialog.
 */
export const latestPublishedBuild = async (
  feed: ReleaseFeed,
  input: Readonly<{ variant: string; applicationId: string }>,
): Promise<Readonly<{ versionCode: number; version: string }> | null> => {
  const root = feed.releaseRoot
  if (root === null) return null
  const artifacts = await cachedArtifacts(join(root, input.variant), Date.now())
  const found = newest(artifacts, input.applicationId)
  return found === null ? null : { versionCode: found.versionCode, version: found.version }
}

/**
 * Public download URL of the newest published APK for a variant, or null when
 * the feed is unmounted, nothing is published, or no download base is
 * configured.
 *
 * Used by the account-approved email, which needs the official client APK link
 * without knowing the install's applicationId: the newest release-signed
 * artifact in the variant directory is the one nginx serves and the one the
 * update endpoint would offer a fresh install.
 */
export const latestPublishedApkUrl = async (
  feed: ReleaseFeed,
  variant: ReleaseVariant,
): Promise<string | null> => {
  if (feed.releaseRoot === null || feed.downloadBaseUrl === null) return null
  const identity = (() => {
    if (feed.downloadBaseUrl === "https://dev-app.beonedge.in/downloads") {
      return { target: "dev", applicationIdBase: "com.beonedge.app.dev" }
    }
    if (feed.downloadBaseUrl === "https://app.beonedge.in/downloads") {
      return { target: "prod", applicationIdBase: "com.beonedge.app" }
    }
    return null
  })()
  if (identity === null) return null
  const expectedApplicationId =
    variant === "admin" ? `${identity.applicationIdBase}.admin` : identity.applicationIdBase
  const artifacts = await cachedArtifacts(join(feed.releaseRoot, variant), Date.now())
  const found = newest(
    artifacts.filter((artifact) => {
      const name = /^boe\.(dev|prod)\.(client|admin)\..+\.apk$/u.exec(artifact.apk)
      return name !== null
        && name[1] === identity.target
        && artifact.target === identity.target
        && name[2] === variant
        && artifact.variant === variant
        && artifact.applicationId === expectedApplicationId
    }),
    undefined,
  )
  return found === null ? null : downloadUrl(feed.downloadBaseUrl, variant, found)
}
