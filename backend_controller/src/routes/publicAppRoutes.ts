/**
 * Public app-surface routes: the two things a freshly launched mobile app needs
 * before it has a session.
 *
 *   GET /v1/app-config    the published app configuration (feature flags,
 *                         minimum supported versions, maintenance notice)
 *   GET /v1/app/update     whether a newer APK has been published, and where to
 *                          download it
 *
 * Both are unauthenticated on purpose: the app calls them on the splash screen,
 * before login, and a client that is too old to authenticate must still be able
 * to learn that it has to update.
 *
 * ── WHERE THE UPDATE ANSWER COMES FROM ──────────────────────────────────────
 * The release pipeline (`release_manager/lib/apk_ship.sh`) publishes each APK
 * into a per-variant holder directory on the VPS together with an immutable
 * sidecar JSON written by `emu/boe_update.sh`:
 *
 *   dev_apk/boe.dev.client.0.7.5.apk
 *   dev_apk/boe.dev.client.0.7.5.json   { versionName, versionCode, sha256, … }
 *
 * Those directories are mounted read-only into this container under
 * `APK_RELEASE_ROOT/<variant>/`, so the filesystem the release tooling already
 * treats as authoritative *is* the update feed. Shipping an APK is therefore the
 * only action needed to offer an update — there is no second place to remember
 * to bump, and nothing can advertise a version that was never published.
 *
 * The APK bytes themselves are served by nginx (`/downloads/<variant>/`), not by
 * this process: streaming multi-megabyte files through Fastify would tie up the
 * API for the duration of every download.
 *
 * When `APK_RELEASE_ROOT` is unset (local dev, or a deployment without the
 * mount) the endpoint answers "no update available" rather than failing. An
 * absent update feed must never break app startup.
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminContentRepository } from "../repositories/adminContentRepository.js"

export interface PublicAppDeps {
  readonly adminContentRepository: AdminContentRepository
  readonly unitOfWork: UnitOfWork
  readonly appUpdate: {
    /** Directory holding one subdirectory per variant, or null when unmounted. */
    readonly releaseRoot: string | null
    /** Public base URL nginx serves the holder directories at, no trailing slash. */
    readonly downloadBaseUrl: string | null
  }
}

/**
 * Variants are a closed set and become path segments, so they are validated
 * against a literal union rather than sanitised — there is no way to smuggle
 * `../` through an enum.
 */
const VARIANTS = ["client", "admin"] as const
type Variant = (typeof VARIANTS)[number]

const updateQuerySchema = z
  .object({
    platform: z.enum(["android"]).default("android"),
    variant: z.enum(VARIANTS).default("client"),
    /**
     * The caller's own identity. `applicationId` matters: dev and prod APKs are
     * signed with different certificates and carry different ids, and Android
     * refuses to install an update whose signature does not match. Offering a
     * `com.beonedge.app.dev` APK to a production install would produce a
     * download that can only ever fail, so a mismatch is filtered out here.
     */
    applicationId: z.string().trim().max(200).optional(),
    versionCode: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
    /**
     * The running build's dotted version ("0.7.4"). Sent alongside versionCode
     * because the two answer different questions: versionCode decides *newer*
     * (it is the only ordering Android itself enforces), while this decides
     * *too old*, since the admin schema states the floor as a dotted version
     * string in `minimumSupportedVersion.android`.
     */
    version: z.string().trim().max(64).optional(),
  })
  .strict()

/** One published APK, as described by its sidecar. */
interface ReleaseArtifact {
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
const toArtifact = (raw: unknown): ReleaseArtifact | null => {
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
 * hits this endpoint, while publishes happen a few times a day, so re-reading
 * the directory per request is pure overhead. The TTL is short enough that a
 * fresh release is offered within seconds of shipping.
 */
const LISTING_TTL_MS = 30_000
interface CacheEntry {
  readonly expiresAt: number
  readonly artifacts: readonly ReleaseArtifact[]
}
const listingCache = new Map<string, CacheEntry>()

const cachedArtifacts = async (
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
const compareVersions = (left: string, right: string): number => {
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
const baseVersion = (value: string): string => {
  const match = /^[0-9]+(?:\.[0-9]+)*/u.exec(value)
  const leading = match?.[0]
  return leading === undefined || leading.length === 0 ? value : leading
}

const newest = (
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

const downloadUrl = (
  base: string | null,
  variant: Variant,
  artifact: ReleaseArtifact,
): string | null => (base === null ? null : `${base}/${variant}/${artifact.apk}`)

const artifactBody = (
  artifact: ReleaseArtifact,
  variant: Variant,
  base: string | null,
): Record<string, unknown> => ({
  version: artifact.version,
  versionName: artifact.versionName,
  versionCode: artifact.versionCode,
  applicationId: artifact.applicationId,
  sizeBytes: artifact.sizeBytes,
  // Hex sha256 of the APK. The app verifies the download against this before it
  // hands the file to the package installer.
  sha256: artifact.sha256,
  url: downloadUrl(base, variant, artifact),
  publishedAt: artifact.builtAt,
})

/**
 * Read the published app config payload, or `{}` when nothing is published yet.
 */
const publishedConfig = async (
  deps: PublicAppDeps,
): Promise<{ version: number | null; config: Record<string, unknown> | null; publishedAt: string | null }> => {
  const row = await deps.unitOfWork.execute((tx) =>
    deps.adminContentRepository.findCurrentAppConfig(tx),
  )
  if (row === null) return { version: null, config: null, publishedAt: null }
  return {
    version: row.version,
    config: { ...asRecord(row.payload) },
    publishedAt: new Date(row.published_at).toISOString(),
  }
}

export const registerPublicAppRoutes = (
  application: FastifyInstance,
  deps: PublicAppDeps,
): void => {
  /**
   * The app's own configuration. The client already calls this on startup and
   * merges the answer over its bundled defaults, so an unpublished config is a
   * `null` config rather than a 404 — a fresh deployment must not make every
   * app launch look like a failure.
   */
  application.get("/v1/app-config", async (_request, reply): Promise<FastifyReply> => {
    return reply.sendData(await publishedConfig(deps))
  })

  /**
   * Update check. Always 200 with a decision the app can act on; a caller that
   * cannot be served (no mount, no published APK for its applicationId) is told
   * there is no update rather than given an error to handle on the splash
   * screen.
   */
  application.get(
    "/v1/app/update",
    async (request: FastifyRequest, reply): Promise<FastifyReply> => {
      const query = parseOrThrow(updateQuerySchema, request.query)
      const root = deps.appUpdate.releaseRoot

      const artifacts =
        root === null ? [] : await cachedArtifacts(join(root, query.variant), Date.now())
      const latest = newest(artifacts, query.applicationId)

      const config = await publishedConfig(deps)
      const minimumRaw = asRecord(asRecord(config.config).minimumSupportedVersion).android
      const minimumSupportedVersion = asString(minimumRaw)

      // "Newer" is decided on versionCode, the only value Android itself treats
      // as an ordering. versionName carries a git label in dev builds and is
      // not reliably comparable.
      const updateAvailable =
        latest !== null &&
        query.versionCode !== undefined &&
        latest.versionCode > query.versionCode

      /**
       * Mandatory when the *running* build is older than the published floor —
       * independent of whether a newer APK happens to be on disk, because
       * "you are too old to use this" is a statement about the caller. An
       * absent or unparseable floor is never mandatory: a config typo must not
       * lock every user out of the app.
       */
      const mandatory =
        minimumSupportedVersion !== null &&
        query.version !== undefined &&
        compareVersions(baseVersion(query.version), baseVersion(minimumSupportedVersion)) < 0

      return reply.sendData({
        platform: query.platform,
        variant: query.variant,
        updateAvailable,
        mandatory,
        current: {
          version: query.version ?? null,
          versionCode: query.versionCode ?? null,
          applicationId: query.applicationId ?? null,
        },
        latest: latest === null ? null : artifactBody(latest, query.variant, deps.appUpdate.downloadBaseUrl),
        minimumSupportedVersion,
        maintenance: asRecord(asRecord(config.config).maintenance),
      })
    },
  )
}

/** Exposed for tests. */
export const __testing = { compareVersions, toArtifact, baseVersion, newest }
