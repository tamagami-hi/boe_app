import { z } from "zod"

import type { AccessTokenConfig } from "../auth/accessToken.js"
import {
  MAX_PAYMENT_ATTEMPT_TTL_MS,
  MIN_PAYMENT_ATTEMPT_TTL_MS,
} from "../domain/payments/checkoutExpiry.js"

const DEFAULT_PORT = 47502
const DAY_MS = 24 * 60 * 60 * 1000

const RuntimeEnvironmentSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
  // Which immediate peers may speak for the client address.
  //
  // Every deployment sits behind nginx, which proxies from the private network
  // and sets X-Real-IP / X-Forwarded-For. Without this, `request.ip` is the proxy
  // itself, so every recorded sign-in address is a loopback or bridge address —
  // which makes `auth_login_events.ip_address` and `auth_sessions.ip_address`
  // worthless for the question they exist to answer.
  //
  // A CIDR list rather than `true`: trusting the header unconditionally lets any
  // direct caller claim any address. The default covers loopback and the private
  // ranges a container bridge uses, so a request arriving from a public address
  // can never forge its own provenance. Set to `false` to disable entirely.
  TRUST_PROXY: z
    .string()
    .trim()
    .default("127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"),
})

export type RuntimeEnvironment = Readonly<{
  host: string
  logLevel: z.infer<typeof RuntimeEnvironmentSchema>["LOG_LEVEL"]
  nodeEnvironment: z.infer<typeof RuntimeEnvironmentSchema>["NODE_ENV"]
  port: number
  /** Fastify `trustProxy`: a CIDR/address allowlist, or false when disabled. */
  trustProxy: string | false
}>

export const parseRuntimeEnvironment = (
  source: Readonly<Record<string, string | undefined>>,
): RuntimeEnvironment => {
  const parsed = RuntimeEnvironmentSchema.parse(source)
  const trustProxy = parsed.TRUST_PROXY.toLowerCase()

  return Object.freeze({
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    nodeEnvironment: parsed.NODE_ENV,
    port: parsed.PORT,
    trustProxy: trustProxy === "" || trustProxy === "false" ? false : parsed.TRUST_PROXY,
  })
}


/**
 * Full application composition configuration (spec 04 §4.1/§4.3/§6.3). Secret
 * material (JWT PEMs, HMAC keys) is supplied via the environment; this parser
 * fails fast at startup if a required value is missing or malformed, so a
 * misconfigured deployment never boots into a half-wired state.
 */
const ServerConfigSchema = z.object({
  ACCESS_TOKEN_ISSUER: z.string().trim().min(1),
  ACCESS_TOKEN_AUDIENCE: z.string().trim().min(1),
  ACCESS_TOKEN_CURRENT_KID: z.string().trim().min(1),
  ACCESS_TOKEN_SIGNING_KEY: z.string().min(1),
  ACCESS_TOKEN_VERIFICATION_KEYS: z.string().min(1),
  REFRESH_HMAC_KEY: z.string().min(1),
  REFRESH_KEY_VERSION: z.string().trim().min(1),
  CSRF_KEY_VERSION: z.string().trim().min(1),
  CURSOR_HMAC_KEY: z.string().min(1),
  WEB_COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  // Deploy compat: WEB_ORIGIN_ALLOWLIST is authoritative, but a deployment that
  // only sets the legacy CORS_ORIGIN is accepted as the allowlist source.
  WEB_ORIGIN_ALLOWLIST: z.string().trim().optional(),
  CORS_ORIGIN: z.string().trim().optional(),
  // Email transport (SES) + provider inbox (SNS) are optional: a deployment
  // without AWS boots with email in a disabled/degraded state.
  AWS_REGION: z.string().trim().optional(),
  SNS_TOPIC_ARN: z.string().trim().optional(),
  SES_CONFIGURATION_SET: z.string().trim().optional(),
  PROVIDER_EVENT_TTL_MS: z.coerce.number().int().min(1).default(7 * DAY_MS),
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().min(1).default(DAY_MS),
  // Client growth business cap: the largest positive rate an admin may post
  // (spec §8.1; default +1000.00%). The -100.00% floor is not configurable.
  CLIENT_GROWTH_MAX_BASIS_POINTS: z.coerce.number().int().min(1).max(10_000_000).default(100_000),
  FUND_AUM_MAX_GROWTH_BASIS_POINTS: z.coerce.number().int().min(1).max(10_000_000).default(100_000),
  FUND_AUM_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  FUND_AUM_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(30),
  // PhonePe payment gateway. The provider callback (the payment confirmation
  // channel) is basic-auth protected by credentials issued in the PhonePe
  // dashboard; the API client credentials drive status checks and refunds.
  // The config is complete only when every credential is present; in production
  // an incomplete set refuses to boot.
  PAYMENT_PROVIDER: z.literal("phonepe").default("phonepe"),
  PHONEPE_CLIENT_ID: z.string().trim().optional(),
  PHONEPE_CLIENT_SECRET: z.string().optional(),
  PHONEPE_CLIENT_VERSION: z.string().trim().optional(),
  PHONEPE_ENV: z.enum(["sandbox", "production"]).optional(),
  PHONEPE_CALLBACK_USERNAME: z.string().trim().optional(),
  PHONEPE_CALLBACK_PASSWORD: z.string().optional(),
  PHONEPE_MERCHANT_ID: z.string().trim().optional(),
  PHONEPE_MOBILE_SDK_ORDER_ENABLED: z.enum(["true", "false"]).default("false"),
  PHONEPE_AUTOPAY_ENABLED: z.enum(["true", "false"]).default("false"),
  PHONEPE_AUTOPAY_COLLECTION_ENABLED: z.enum(["true", "false"]).default("false"),
  PHONEPE_API_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
  CRYPTO_PAYMENT_TOKEN_ENC_KEY: z.string().optional(),
  CRYPTO_PAYMENT_TOKEN_ENC_KEY_VERSION: z.string().trim().optional(),
  // Where the app returns after checkout and where the provider posts the
  // callback; both are deployment wiring, optional at boot.
  PHONEPE_REDIRECT_URL: z.string().trim().optional(),
  PHONEPE_CALLBACK_URL: z.string().trim().optional(),
  PHONEPE_SUBSCRIPTION_CALLBACK_URL: z.string().trim().optional(),
  PHONEPE_SUBSCRIPTION_EVENT_ALLOWLIST: z.string().trim().optional(),
  PHONEPE_CHECKOUT_ALLOWED_ORIGINS: z.string().trim().optional(),
  PAYMENT_ATTEMPT_TTL_MS: z.coerce
    .number()
    .int()
    .min(MIN_PAYMENT_ATTEMPT_TTL_MS)
    .max(MAX_PAYMENT_ATTEMPT_TTL_MS)
    .default(15 * 60 * 1000),
  // POST /newuser is the only unauthenticated-by-default write in the surface:
  // the standalone marketing site (beonedge.in, on AWS) posts signups to it
  // server-to-server. This shared secret is how that one caller is recognised —
  // it must be presented in the `x-signup-key` header. An Origin/Referer check
  // could not do this job: those headers are only sent by browsers and are
  // trivially forged by any HTTP client, whereas this call has no browser in it.
  //
  // Optional here on purpose. A missing signup secret must degrade /newuser
  // alone, not refuse to boot and take client logins down with it; the route
  // fails closed on its own. The deploy scripts assert the key is present, so
  // the failure still surfaces before containers are replaced.
  NEWUSER_SHARED_SECRET: z.string().trim().min(32).optional(),
  // Transactional email (KYC codes). The company mailbox is both the SMTP login
  // and the `From`. An incomplete SMTP configuration fails delivery closed.
  KYC_EMAIL_FROM: z.string().trim().optional(),
  EMAIL_SMTP_HOST: z.string().trim().optional(),
  EMAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  EMAIL_SMTP_USER: z.string().trim().optional(),
  EMAIL_SMTP_PASSWORD: z.string().optional(),
  EMAIL_SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  // Where onboarding emails point.
  SUPPORT_EMAIL: z.string().trim().optional(),
  // Outbox email delivery worker knobs (mirrors the payment worker).
  EMAIL_WORKER_CLAIM_LIMIT: z.coerce.number().int().min(1).max(200).default(25),
  EMAIL_WORKER_LEASE_MS: z.coerce.number().int().min(1000).default(60_000),
  // KYC email-OTP policy.
  KYC_CODE_TTL_MS: z.coerce.number().int().min(1).default(10 * 60 * 1000),
  KYC_CODE_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  KYC_RESEND_COOLDOWN_MS: z.coerce.number().int().min(1).default(60 * 1000),
  KYC_VALIDITY_MS: z.coerce.number().int().min(1).default(365 * DAY_MS),
  // Concurrent-device policy for native (client app) sessions. Signing in on a
  // new device beyond the cap revokes the oldest device's session rather than
  // refusing the login. SEED_CLIENT_EMAIL is exempt: the dev/QA account is
  // signed in on many emulators at once and must not evict itself.
  MAX_NATIVE_DEVICES_PER_USER: z.coerce.number().int().min(1).max(50).default(3),
  SEED_CLIENT_EMAIL: z.string().trim().optional(),
  // Bounded Argon2id concurrency; see auth/passwordGate.ts. The default tracks
  // UV_THREADPOOL_SIZE (which is what actually runs the hashing, 8 in the
  // container image) and falls back to libuv's own default of 4.
  PASSWORD_HASH_MAX_CONCURRENT: z.coerce.number().int().min(1).max(64).optional(),
  PASSWORD_HASH_MAX_QUEUED: z.coerce.number().int().min(0).max(4096).default(64),
  // In-app APK update feed. APK_RELEASE_ROOT holds one subdirectory per variant
  // (client/, admin/) of published APKs + their sidecar JSONs, mounted read-only
  // from the release holder directories; APK_DOWNLOAD_BASE_URL is the public
  // prefix nginx serves those same directories at. Both optional: without them
  // GET /v1/app/update answers "no update" instead of failing, so a deployment
  // that has not been given the mount still boots and still serves apps.
  REDIS_URL: z.string().trim().optional(),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).default(2_000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1).default(1_000),
  REDIS_MAX_RETRIES_PER_REQUEST: z.coerce.number().int().min(0).max(10).default(1),
  REDIS_KEY_NAMESPACE: z.string().trim().min(1).default("boe"),
  CACHE_APP_CONFIG_TTL_MS: z.coerce.number().int().min(0).default(30_000),
  CACHE_CATALOG_TTL_MS: z.coerce.number().int().min(0).default(30_000),
  CACHE_PUBLIC_CONTENT_TTL_MS: z.coerce.number().int().min(0).default(60_000),
  APK_RELEASE_ROOT: z.string().trim().optional(),
  APK_DOWNLOAD_BASE_URL: z
    .enum([
      "https://dev-app.beonedge.in/downloads",
      "https://app.beonedge.in/downloads",
    ])
    .optional(),
})

export interface ServerConfig {
  readonly access: AccessTokenConfig
  readonly refreshKey: Buffer
  readonly refreshKeyVersion: string
  readonly csrfKeyVersion: string
  readonly cursorKey: Buffer
  readonly web: { readonly cookieSecure: boolean; readonly originAllowlist: readonly string[] }
  readonly providerEvents: { readonly awsRegion: string | null; readonly topicArn: string | null; readonly ttlMs: number }
  readonly sesConfigurationSet: string
  readonly emailConfigured: boolean
  /**
   * The gate on POST /newuser. `sharedSecret` is null when the deployment has
   * not been given one, in which case the route rejects every caller rather
   * than accepting an unauthenticated signup.
   */
  readonly signup: {
    readonly sharedSecret: string | null
  }
  readonly payments: {
    readonly provider: "phonepe"
    /**
     * The PhonePe integration, or null when unconfigured. Present iff every
     * client credential and both callback credentials are set; in production an
     * incomplete set fails the boot rather than half-wiring money movement.
     */
    readonly phonepe: {
      readonly clientId: string
      readonly clientSecret: string
      readonly clientVersion: string
      readonly env: "sandbox" | "production"
      readonly callbackUsername: string
      readonly callbackPassword: string
      readonly redirectUrl: string
      readonly callbackUrl: string
      readonly subscriptionCallbackUrl: string | null
      readonly checkoutAllowedOrigins: readonly string[]
    } | null
    readonly attemptTtlMs: number
    readonly mobileSdk: {
      readonly enabled: boolean
      readonly merchantId: string | null
      readonly tokenEncryptionKey: Buffer | null
      readonly tokenKeyVersion: string | null
      readonly requestTimeoutMs: number
    }
    readonly autoPay: {
      readonly enabled: boolean
      readonly collectionEnabled: boolean
      readonly subscriptionEventAllowlist: readonly string[]
    }
  }
  readonly email: {
    readonly fromAddress: string | null
    readonly smtp: {
      readonly host: string
      readonly port: number
      readonly user: string
      readonly password: string
      readonly secure: boolean
    } | null
    /** Addresses baked into onboarding email bodies. */
    readonly links: {
      readonly supportAddress: string | null
    }
    readonly worker: { readonly claimLimit: number; readonly leaseMs: number }
  }
  readonly kyc: {
    readonly codeTtlMs: number
    readonly maxAttempts: number
    readonly resendCooldownMs: number
    readonly validityMs: number
  }
  readonly ttls: {
    readonly idempotencyTtlMs: number
  }
  readonly clientGrowth: {
    /**
     * Positive business maximum for a signed client growth rate in basis
     * points (spec §8.1; the lower bound is fixed at -10,000 = -100.00%).
     */
    readonly maxBasisPoints: number
  }
  readonly fundAum: {
    readonly maxGrowthBasisPoints: number
    readonly rateLimitWindowMs: number
    readonly rateLimitMaxRequests: number
  }
  readonly cache: {
    readonly redisUrl: string | null
    readonly configured: boolean
    readonly namespace: string
    readonly connectTimeoutMs: number
    readonly commandTimeoutMs: number
    readonly maxRetriesPerRequest: number
    readonly appConfigTtlMs: number
    readonly catalogTtlMs: number
    readonly publicContentTtlMs: number
  }
  /** Source of truth for the in-app update check; see publicAppRoutes.ts. */
  readonly appUpdate: {
    readonly releaseRoot: string | null
    readonly downloadBaseUrl: string | null
  }
  /** Concurrent native-session policy; see nativeAuth.enforceDeviceLimit. */
  readonly deviceLimit: {
    readonly maxDevices: number
    readonly exemptEmails: readonly string[]
  }
  /** Bounded Argon2id concurrency; see auth/passwordGate.ts. */
  readonly passwordHashing: {
    readonly maxConcurrent: number
    readonly maxQueued: number
  }
}

/**
 * libuv's threadpool size, which is what runs Argon2id. Not validated by the
 * schema because it is libuv's variable rather than ours — we only read it to
 * size the gate, and anything unparseable falls back to libuv's own default.
 */
const LIBUV_DEFAULT_THREADPOOL_SIZE = 4

const threadpoolSize = (raw: string | undefined): number => {
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1024
    ? parsed
    : LIBUV_DEFAULT_THREADPOOL_SIZE
}

const decode32ByteKey = (name: string, value: string): Buffer => {
  const key = Buffer.from(value, "base64")
  if (key.length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key`)
  return key
}

const parseVerificationKeys = (raw: string): Record<string, string> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("ACCESS_TOKEN_VERIFICATION_KEYS must be a JSON object of kid -> SPKI PEM")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("ACCESS_TOKEN_VERIFICATION_KEYS must be a JSON object")
  }
  const keys: Record<string, string> = {}
  for (const [kid, pem] of Object.entries(parsed)) {
    if (typeof pem !== "string" || pem.length === 0) throw new Error(`verification key for kid ${kid} must be a PEM string`)
    keys[kid] = pem
  }
  if (Object.keys(keys).length === 0) throw new Error("ACCESS_TOKEN_VERIFICATION_KEYS must contain at least one key")
  return keys
}

/**
 * The PhonePe integration is configured iff every client credential and both
 * callback credentials are present. A partial set is a misconfiguration: in
 * production it refuses the boot, elsewhere it degrades to "unconfigured" so a
 * dev stack can run without real money movement. Redirect/callback URLs are
 * deployment wiring and stay optional either way.
 */
const parsePhonePeConfig = (
  parsed: z.infer<typeof ServerConfigSchema>,
  source: Readonly<Record<string, string | undefined>>,
): ServerConfig["payments"]["phonepe"] => {
  const present = (value: string | undefined): value is string =>
    value !== undefined && value.trim().length > 0
  const credentials = [
    parsed.PHONEPE_CLIENT_ID,
    parsed.PHONEPE_CLIENT_SECRET,
    parsed.PHONEPE_CLIENT_VERSION,
    parsed.PHONEPE_ENV,
    parsed.PHONEPE_CALLBACK_USERNAME,
    parsed.PHONEPE_CALLBACK_PASSWORD,
  ]
  const configuredCount = credentials.filter(present).length
  if (configuredCount === 0) return null
  if (configuredCount < credentials.length) {
    if (source.NODE_ENV === "production") {
      throw new Error(
        "PHONEPE_* configuration is incomplete: set PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, " +
          "PHONEPE_CLIENT_VERSION, PHONEPE_ENV, PHONEPE_CALLBACK_USERNAME and PHONEPE_CALLBACK_PASSWORD together",
      )
    }
    return null
  }
  if (!present(parsed.PHONEPE_REDIRECT_URL) || !present(parsed.PHONEPE_CALLBACK_URL)) {
    throw new Error("PHONEPE_REDIRECT_URL and PHONEPE_CALLBACK_URL are required when PhonePe is configured")
  }
  if (!present(parsed.PHONEPE_CHECKOUT_ALLOWED_ORIGINS)) {
    throw new Error("PHONEPE_CHECKOUT_ALLOWED_ORIGINS is required when PhonePe is configured")
  }
  const checkoutAllowedOrigins = parsed.PHONEPE_CHECKOUT_ALLOWED_ORIGINS
    .split(",")
    .map((value) => value.trim())
  if (checkoutAllowedOrigins.some((value) => value.length === 0)) {
    throw new Error("PHONEPE_CHECKOUT_ALLOWED_ORIGINS must contain exact HTTPS origins")
  }
  for (const origin of checkoutAllowedOrigins) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw new Error("PHONEPE_CHECKOUT_ALLOWED_ORIGINS must contain exact HTTPS origins")
    }
    if (
      url.protocol !== "https:" || url.origin !== origin || url.hostname.includes("*") ||
      url.username !== "" || url.password !== "" ||
      url.pathname !== "/" || url.search !== "" || url.hash !== ""
    ) {
      throw new Error("PHONEPE_CHECKOUT_ALLOWED_ORIGINS must contain exact HTTPS origins")
    }
  }
  if (!/^[1-9][0-9]*$/u.test(parsed.PHONEPE_CLIENT_VERSION as string)) {
    throw new Error("PHONEPE_CLIENT_VERSION must be a positive integer")
  }
  const expectedEnvironment = source.NODE_ENV === "production" ? "production" : "sandbox"
  if (parsed.PHONEPE_ENV !== expectedEnvironment) {
    throw new Error(`PHONEPE_ENV must be ${expectedEnvironment} for the configured NODE_ENV`)
  }
  const expectedHost = parsed.PHONEPE_ENV === "sandbox" ? "dev-app.beonedge.in" : "app.beonedge.in"
  const canonicalUrl = (name: string, value: string, expectedPath: string): string => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error(`${name} must be a canonical BeOnEdge HTTPS URL`)
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== expectedHost ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== expectedPath ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error(`${name} must use the canonical ${expectedHost}${expectedPath} URL for PHONEPE_ENV`)
    }
    return url.toString()
  }
  return Object.freeze({
    clientId: parsed.PHONEPE_CLIENT_ID as string,
    clientSecret: parsed.PHONEPE_CLIENT_SECRET as string,
    clientVersion: parsed.PHONEPE_CLIENT_VERSION as string,
    env: parsed.PHONEPE_ENV,
    callbackUsername: parsed.PHONEPE_CALLBACK_USERNAME as string,
    callbackPassword: parsed.PHONEPE_CALLBACK_PASSWORD as string,
    checkoutAllowedOrigins: Object.freeze([...new Set(checkoutAllowedOrigins)]),
    redirectUrl: canonicalUrl("PHONEPE_REDIRECT_URL", parsed.PHONEPE_REDIRECT_URL, "/payment-return"),
    callbackUrl: canonicalUrl(
      "PHONEPE_CALLBACK_URL",
      parsed.PHONEPE_CALLBACK_URL,
      "/api/v1/provider-events/phonepe/payment",
    ),
    subscriptionCallbackUrl: present(parsed.PHONEPE_SUBSCRIPTION_CALLBACK_URL)
      ? canonicalUrl(
          "PHONEPE_SUBSCRIPTION_CALLBACK_URL",
          parsed.PHONEPE_SUBSCRIPTION_CALLBACK_URL,
          "/api/v1/provider-events/phonepe/subscription",
        )
      : null,
  })
}

export const parseServerConfig = (source: Readonly<Record<string, string | undefined>>): ServerConfig => {
  const parsed = ServerConfigSchema.parse(source)
  const verificationKeysSpki = parseVerificationKeys(parsed.ACCESS_TOKEN_VERIFICATION_KEYS)
  if (verificationKeysSpki[parsed.ACCESS_TOKEN_CURRENT_KID] === undefined) {
    throw new Error("ACCESS_TOKEN_VERIFICATION_KEYS must include the current kid")
  }
  const originsRaw = parsed.WEB_ORIGIN_ALLOWLIST ?? parsed.CORS_ORIGIN ?? ""
  const originAllowlist = originsRaw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  if (originAllowlist.length === 0) {
    throw new Error("WEB_ORIGIN_ALLOWLIST (or CORS_ORIGIN) must list at least one origin")
  }

  // A raw PKCS#8 PEM cannot be a single .env line; accept `\n`-escaped PEMs and
  // restore real newlines. (Verification keys are JSON, whose `\n` escapes are
  // already decoded by JSON.parse.)
  const signingKeyPkcs8 = parsed.ACCESS_TOKEN_SIGNING_KEY.replace(/\\n/gu, "\n")

  const nonEmpty = (value: string | undefined): string | null =>
    value !== undefined && value.length > 0 ? value : null
  const redisUrl = nonEmpty(parsed.REDIS_URL)
  const awsRegion = nonEmpty(parsed.AWS_REGION)
  const topicArn = nonEmpty(parsed.SNS_TOPIC_ARN)
  const sesConfigurationSet = nonEmpty(parsed.SES_CONFIGURATION_SET)
  const emailConfigured = awsRegion !== null && topicArn !== null && sesConfigurationSet !== null
  const isMobileSdkEnabled = parsed.PHONEPE_MOBILE_SDK_ORDER_ENABLED === "true"
  const isAutoPayEnabled = parsed.PHONEPE_AUTOPAY_ENABLED === "true"
  const isAutoPayCollectionEnabled = parsed.PHONEPE_AUTOPAY_COLLECTION_ENABLED === "true"
  if (isAutoPayCollectionEnabled && !isAutoPayEnabled) {
    throw new Error("PHONEPE_AUTOPAY_COLLECTION_ENABLED requires PHONEPE_AUTOPAY_ENABLED=true")
  }
  const subscriptionEventAllowlist = (parsed.PHONEPE_SUBSCRIPTION_EVENT_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (subscriptionEventAllowlist.some((value) => !/^[a-z0-9._-]{1,128}$/u.test(value))) {
    throw new Error("PHONEPE_SUBSCRIPTION_EVENT_ALLOWLIST must contain exact event names")
  }
  const merchantId = nonEmpty(parsed.PHONEPE_MERCHANT_ID)
  const paymentTokenKey = nonEmpty(parsed.CRYPTO_PAYMENT_TOKEN_ENC_KEY)
  const paymentTokenKeyVersion = nonEmpty(parsed.CRYPTO_PAYMENT_TOKEN_ENC_KEY_VERSION)
  if ((isMobileSdkEnabled || isAutoPayEnabled) && (merchantId === null || paymentTokenKey === null || paymentTokenKeyVersion === null)) {
    throw new Error(
      "PHONEPE_MERCHANT_ID, CRYPTO_PAYMENT_TOKEN_ENC_KEY and CRYPTO_PAYMENT_TOKEN_ENC_KEY_VERSION are required when PhonePe mobile payments are enabled",
    )
  }
  const phonepeConfig = parsePhonePeConfig(parsed, source)
  if ((isMobileSdkEnabled || isAutoPayEnabled) && phonepeConfig === null) {
    throw new Error("PhonePe gateway configuration is required when PhonePe mobile payments are enabled")
  }
  if (phonepeConfig !== null && merchantId === null) {
    throw new Error("PHONEPE_MERCHANT_ID is required when PhonePe gateway credentials are configured")
  }
  if (phonepeConfig !== null && phonepeConfig.subscriptionCallbackUrl === null) {
    throw new Error("PHONEPE_SUBSCRIPTION_CALLBACK_URL is required when PhonePe gateway credentials are configured")
  }
  if (phonepeConfig !== null && subscriptionEventAllowlist.length === 0) {
    throw new Error("PHONEPE_SUBSCRIPTION_EVENT_ALLOWLIST is required when PhonePe gateway credentials are configured")
  }

  return Object.freeze({
    access: {
      issuer: parsed.ACCESS_TOKEN_ISSUER,
      audience: parsed.ACCESS_TOKEN_AUDIENCE,
      currentKid: parsed.ACCESS_TOKEN_CURRENT_KID,
      signingKeyPkcs8,
      verificationKeysSpki,
    },
    refreshKey: decode32ByteKey("REFRESH_HMAC_KEY", parsed.REFRESH_HMAC_KEY),
    refreshKeyVersion: parsed.REFRESH_KEY_VERSION,
    csrfKeyVersion: parsed.CSRF_KEY_VERSION,
    cursorKey: decode32ByteKey("CURSOR_HMAC_KEY", parsed.CURSOR_HMAC_KEY),
    web: { cookieSecure: parsed.WEB_COOKIE_SECURE === "true", originAllowlist },
    providerEvents: {
      awsRegion,
      topicArn,
      ttlMs: parsed.PROVIDER_EVENT_TTL_MS,
    },
    // A non-empty value is retained for email_delivery rows even when email is
    // not fully configured (the worker/SES adapter are out-of-band).
    sesConfigurationSet: sesConfigurationSet ?? "unconfigured",
    emailConfigured,
    signup: {
      sharedSecret: nonEmpty(parsed.NEWUSER_SHARED_SECRET),
    },
    payments: {
      provider: parsed.PAYMENT_PROVIDER,
      phonepe: phonepeConfig,
      attemptTtlMs: parsed.PAYMENT_ATTEMPT_TTL_MS,
      mobileSdk: {
        enabled: isMobileSdkEnabled,
        merchantId,
        tokenEncryptionKey: paymentTokenKey === null
          ? null
          : decode32ByteKey("CRYPTO_PAYMENT_TOKEN_ENC_KEY", paymentTokenKey),
        tokenKeyVersion: paymentTokenKeyVersion,
        requestTimeoutMs: parsed.PHONEPE_API_TIMEOUT_MS,
      },
      autoPay: {
        enabled: isAutoPayEnabled,
        collectionEnabled: isAutoPayCollectionEnabled,
        subscriptionEventAllowlist: Object.freeze([...new Set(subscriptionEventAllowlist)]),
      },
    },
    email: {
      fromAddress: nonEmpty(parsed.KYC_EMAIL_FROM),
      // SMTP is enabled only when host + credentials are all present.
      smtp:
        nonEmpty(parsed.EMAIL_SMTP_HOST) !== null &&
        nonEmpty(parsed.EMAIL_SMTP_USER) !== null &&
        nonEmpty(parsed.EMAIL_SMTP_PASSWORD) !== null
          ? {
              host: parsed.EMAIL_SMTP_HOST as string,
              port: parsed.EMAIL_SMTP_PORT,
              user: parsed.EMAIL_SMTP_USER as string,
              password: parsed.EMAIL_SMTP_PASSWORD as string,
              secure: parsed.EMAIL_SMTP_SECURE === "true",
            }
          : null,
      links: {
        supportAddress: nonEmpty(parsed.SUPPORT_EMAIL),
      },
      worker: {
        claimLimit: parsed.EMAIL_WORKER_CLAIM_LIMIT,
        leaseMs: parsed.EMAIL_WORKER_LEASE_MS,
      },
    },
    kyc: {
      codeTtlMs: parsed.KYC_CODE_TTL_MS,
      maxAttempts: parsed.KYC_CODE_MAX_ATTEMPTS,
      resendCooldownMs: parsed.KYC_RESEND_COOLDOWN_MS,
      validityMs: parsed.KYC_VALIDITY_MS,
    },
    ttls: {
      idempotencyTtlMs: parsed.IDEMPOTENCY_TTL_MS,
    },
    clientGrowth: {
      maxBasisPoints: parsed.CLIENT_GROWTH_MAX_BASIS_POINTS,
    },
    fundAum: {
      maxGrowthBasisPoints: parsed.FUND_AUM_MAX_GROWTH_BASIS_POINTS,
      rateLimitWindowMs: parsed.FUND_AUM_RATE_LIMIT_WINDOW_MS,
      rateLimitMaxRequests: parsed.FUND_AUM_RATE_LIMIT_MAX_REQUESTS,
    },
    cache: {
      redisUrl: redisUrl,
      configured: redisUrl !== null,
      namespace: parsed.REDIS_KEY_NAMESPACE,
      connectTimeoutMs: parsed.REDIS_CONNECT_TIMEOUT_MS,
      commandTimeoutMs: parsed.REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: parsed.REDIS_MAX_RETRIES_PER_REQUEST,
      appConfigTtlMs: parsed.CACHE_APP_CONFIG_TTL_MS,
      catalogTtlMs: parsed.CACHE_CATALOG_TTL_MS,
      publicContentTtlMs: parsed.CACHE_PUBLIC_CONTENT_TTL_MS,
    },
    appUpdate: {
      releaseRoot: nonEmpty(parsed.APK_RELEASE_ROOT)?.replace(/\/+$/u, "") ?? null,
      downloadBaseUrl: nonEmpty(parsed.APK_DOWNLOAD_BASE_URL)?.replace(/\/+$/u, "") ?? null,
    },
    deviceLimit: {
      maxDevices: parsed.MAX_NATIVE_DEVICES_PER_USER,
      // `users.email_normalized` is stored lowercased and trimmed, so the
      // exemption list must be normalised the same way to ever match.
      exemptEmails: Object.freeze(
        [nonEmpty(parsed.SEED_CLIENT_EMAIL)]
          .filter((email): email is string => email !== null)
          .map((email) => email.toLowerCase()),
      ),
    },
    passwordHashing: {
      // Falls back to UV_THREADPOOL_SIZE, which is what actually executes the
      // hashing, then to libuv's default of 4. Allowing more concurrent hashes
      // than there are threads to run them buys nothing and only raises peak
      // memory (19 MiB each).
      maxConcurrent:
        parsed.PASSWORD_HASH_MAX_CONCURRENT ?? threadpoolSize(source.UV_THREADPOOL_SIZE),
      maxQueued: parsed.PASSWORD_HASH_MAX_QUEUED,
    },
  })
}
