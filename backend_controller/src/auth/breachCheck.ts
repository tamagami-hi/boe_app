/**
 * Breached-password check (spec 04 §4.1). Activation and password-change commands
 * verify the candidate against Have I Been Pwned's k-anonymity range API before
 * opening the credential transaction: only the uppercase first five SHA-1 hex
 * characters leave the process, padded responses are requested, and the suffix is
 * compared locally in constant time. The password, full SHA-1, suffix, and the
 * matching line are never sent, persisted, or logged.
 *
 * Fail-closed: any timeout / non-2xx / malformed response throws
 * DEPENDENCY_UNAVAILABLE so no credential is committed. `bypass` mode is accepted
 * only under NODE_ENV test/development.
 */
import { createHash, timingSafeEqual } from "node:crypto"

import { AppError } from "../http/errorCatalog.js"

const RANGE_ENDPOINT = "https://api.pwnedpasswords.com/range/"
const REQUEST_TIMEOUT_MS = 2_000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 1_024
const SUFFIX_LENGTH = 35

export interface BreachChecker {
  /** Resolves if the password is not breached; throws otherwise. */
  check: (password: string) => Promise<void>
}

export type BreachCheckMode = "enforce" | "bypass"

/** Resolve the mode, rejecting `bypass` outside test/development at startup. */
export const resolveBreachCheckMode = (
  env: Readonly<Record<string, string | undefined>>,
): BreachCheckMode => {
  const mode = env.PASSWORD_BREACH_CHECK_MODE ?? "enforce"
  if (mode === "enforce") return "enforce"
  if (mode === "bypass") {
    const nodeEnv = env.NODE_ENV
    if (nodeEnv !== "test" && nodeEnv !== "development") {
      throw new Error("PASSWORD_BREACH_CHECK_MODE=bypass is not allowed outside test/development")
    }
    return "bypass"
  }
  throw new Error(`invalid PASSWORD_BREACH_CHECK_MODE: ${mode}`)
}

const sha1Hex = (password: string): string =>
  createHash("sha1").update(password, "utf8").digest("hex").toUpperCase()

const suffixMatches = (candidate: string, returned: string): boolean => {
  if (returned.length !== SUFFIX_LENGTH) return false
  return timingSafeEqual(Buffer.from(candidate, "utf8"), Buffer.from(returned, "utf8"))
}

/** True if the padded range body reports any positive occurrence for the suffix. */
const bodyReportsBreach = (body: string, suffix: string): boolean => {
  let breached = false
  for (const line of body.split(/\r?\n/u)) {
    const separator = line.indexOf(":")
    if (separator === -1) continue
    const returnedSuffix = line.slice(0, separator)
    const count = Number.parseInt(line.slice(separator + 1), 10)
    if (suffixMatches(suffix, returnedSuffix) && Number.isFinite(count) && count > 0) {
      breached = true
    }
  }
  return breached
}

interface CacheEntry {
  readonly body: string
  readonly expiresAt: number
}

export interface HibpBreachCheckerOptions {
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
}

const breachedError = (): AppError =>
  new AppError("VALIDATION_FAILED", {
    fields: { password: ["this password appeared in a data breach; choose another"] },
  })

/** Create the HIBP-backed breach checker. `fetchImpl` is injectable for tests. */
export const createHibpBreachChecker = (options: HibpBreachCheckerOptions = {}): BreachChecker => {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const cache = new Map<string, CacheEntry>()

  const fetchRange = async (prefix: string): Promise<string> => {
    const cached = cache.get(prefix)
    if (cached !== undefined && cached.expiresAt > now()) return cached.body

    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    let body: string
    try {
      const response = await fetchImpl(`${RANGE_ENDPOINT}${prefix}`, {
        headers: { "Add-Padding": "true" },
        signal: controller.signal,
      })
      if (!response.ok) throw new AppError("DEPENDENCY_UNAVAILABLE")
      body = await response.text()
    } catch (error: unknown) {
      if (error instanceof AppError) throw error
      throw new AppError("DEPENDENCY_UNAVAILABLE", { cause: error })
    } finally {
      clearTimeout(timer)
    }

    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(prefix, { body, expiresAt: now() + CACHE_TTL_MS })
    return body
  }

  return {
    check: async (password) => {
      const digest = sha1Hex(password)
      const prefix = digest.slice(0, 5)
      const suffix = digest.slice(5)
      const body = await fetchRange(prefix)
      if (bodyReportsBreach(body, suffix)) throw breachedError()
    },
  }
}

/** A no-op checker for local/test use only (never selected in production). */
export const createBypassBreachChecker = (): BreachChecker => ({
  check: () => Promise.resolve(),
})

/** Select the checker from configuration. */
export const createBreachChecker = (
  mode: BreachCheckMode,
  options: HibpBreachCheckerOptions = {},
): BreachChecker => (mode === "bypass" ? createBypassBreachChecker() : createHibpBreachChecker(options))
