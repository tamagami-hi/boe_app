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
 * The release-feed filesystem machinery (sidecar parsing, listing cache, newest
 * resolution, download URLs) lives in `release/releaseFeed.ts`, shared with the
 * account-approved email. When `APK_RELEASE_ROOT` is unset (local dev, or a
 * deployment without the mount) the endpoint answers "no update available"
 * rather than failing. An absent update feed must never break app startup.
 */
import { CACHE_KEYS, type Cache } from "../cache/cache.js"
import { join } from "node:path"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminContentRepository } from "../repositories/adminContentRepository.js"
import {
  baseVersion,
  cachedArtifacts,
  clearAppUpdateCache,
  compareVersions,
  downloadUrl,
  latestPublishedBuild,
  newest,
  RELEASE_VARIANTS,
  toArtifact,
  type ReleaseArtifact,
  type ReleaseFeed,
  type ReleaseVariant,
} from "../release/releaseFeed.js"

export type { ReleaseFeed }

export interface PublicAppDeps {
  readonly adminContentRepository: AdminContentRepository
  readonly unitOfWork: UnitOfWork
  readonly appUpdate: ReleaseFeed
  readonly cache: Cache
  readonly config: { readonly appConfigTtlMs: number }
}

const updateQuerySchema = z
  .object({
    platform: z.enum(["android"]).default("android"),
    variant: z.enum(RELEASE_VARIANTS).default("client"),
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

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const artifactBody = (
  artifact: ReleaseArtifact,
  variant: ReleaseVariant,
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
  const row = await deps.cache.readOrLoad(
    CACHE_KEYS.appConfig,
    deps.config.appConfigTtlMs,
    () => deps.unitOfWork.execute((tx) => deps.adminContentRepository.findCurrentAppConfig(tx)),
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

// Re-exported so existing consumers (clientAccountRoutes, tests) keep a single
// import site while the implementation lives in release/releaseFeed.ts.
export { clearAppUpdateCache, latestPublishedBuild }

/** Exposed for tests. */
export const __testing = { compareVersions, toArtifact, baseVersion, newest }
