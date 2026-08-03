import { z } from "zod"

import type { AccessTokenConfig } from "../auth/accessToken.js"

const DEFAULT_PORT = 47502
const DAY_MS = 24 * 60 * 60 * 1000

const RuntimeEnvironmentSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
})

export type RuntimeEnvironment = Readonly<{
  host: string
  logLevel: z.infer<typeof RuntimeEnvironmentSchema>["LOG_LEVEL"]
  nodeEnvironment: z.infer<typeof RuntimeEnvironmentSchema>["NODE_ENV"]
  port: number
}>

export const parseRuntimeEnvironment = (
  source: Readonly<Record<string, string | undefined>>,
): RuntimeEnvironment => {
  const parsed = RuntimeEnvironmentSchema.parse(source)

  return Object.freeze({
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    nodeEnvironment: parsed.NODE_ENV,
    port: parsed.PORT,
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
  VERIFICATION_TOKEN_TTL_MS: z.coerce.number().int().min(1).default(DAY_MS),
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().min(1).default(DAY_MS),
  ACTIVATION_INVITE_TTL_MS: z.coerce.number().int().min(1).default(7 * DAY_MS),
  // Payment gateway. `manual` is the built-in mock provider (instant success,
  // auto-settled by the worker). A real gateway (e.g. `razorpay`) supplies its
  // API credentials and a webhook signing secret; when the secret is present the
  // signed payment webhook is enabled and drives the paid/failed confirmation.
  PAYMENT_PROVIDER: z.string().trim().min(1).default("manual"),
  PAYMENT_WEBHOOK_SECRET: z.string().trim().optional(),
  PAYMENT_GATEWAY_KEY_ID: z.string().trim().optional(),
  PAYMENT_GATEWAY_KEY_SECRET: z.string().trim().optional(),
  PAYMENT_ATTEMPT_TTL_MS: z.coerce.number().int().min(1).default(15 * 60 * 1000),
  // Transactional email (KYC codes). The company mailbox is both the SMTP login
  // and the `From`. When SMTP is not fully configured, a local/log sender is used
  // (dev/test). Decision 10.
  KYC_EMAIL_FROM: z.string().trim().optional(),
  EMAIL_SMTP_HOST: z.string().trim().optional(),
  EMAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  EMAIL_SMTP_USER: z.string().trim().optional(),
  EMAIL_SMTP_PASSWORD: z.string().optional(),
  EMAIL_SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  // Where onboarding emails point. Verification continues on the public site;
  // activation happens in the app, which has no deep-link scheme yet, so the
  // invite carries the code as text unless an activation URL is configured.
  PUBLIC_LANDING_ORIGIN: z.string().trim().optional(),
  APP_ACTIVATION_URL: z.string().trim().optional(),
  SUPPORT_EMAIL: z.string().trim().optional(),
  // Outbox email delivery worker knobs (mirrors the payment worker).
  EMAIL_WORKER_CLAIM_LIMIT: z.coerce.number().int().min(1).max(200).default(25),
  EMAIL_WORKER_LEASE_MS: z.coerce.number().int().min(1000).default(60_000),
  // KYC email-OTP policy.
  KYC_CODE_TTL_MS: z.coerce.number().int().min(1).default(10 * 60 * 1000),
  KYC_CODE_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  KYC_RESEND_COOLDOWN_MS: z.coerce.number().int().min(1).default(60 * 1000),
  KYC_VALIDITY_MS: z.coerce.number().int().min(1).default(365 * DAY_MS),
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
  readonly payments: {
    readonly provider: string
    /** Mock provider: the worker auto-confirms + books. Real gateway: the webhook does. */
    readonly autoConfirm: boolean
    readonly webhookSecret: string | null
    readonly webhookConfigured: boolean
    readonly gatewayKeyId: string | null
    readonly gatewayKeySecret: string | null
    readonly attemptTtlMs: number
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
    /** Link targets baked into onboarding email bodies. */
    readonly links: {
      readonly landingOrigin: string | null
      readonly activationUrl: string | null
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
    readonly verificationTokenTtlMs: number
    readonly idempotencyTtlMs: number
    readonly activationInviteTtlMs: number
  }
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
  const awsRegion = nonEmpty(parsed.AWS_REGION)
  const topicArn = nonEmpty(parsed.SNS_TOPIC_ARN)
  const sesConfigurationSet = nonEmpty(parsed.SES_CONFIGURATION_SET)
  const emailConfigured = awsRegion !== null && topicArn !== null && sesConfigurationSet !== null

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
    payments: {
      provider: parsed.PAYMENT_PROVIDER,
      autoConfirm: parsed.PAYMENT_PROVIDER === "manual",
      webhookSecret: nonEmpty(parsed.PAYMENT_WEBHOOK_SECRET),
      webhookConfigured: nonEmpty(parsed.PAYMENT_WEBHOOK_SECRET) !== null,
      gatewayKeyId: nonEmpty(parsed.PAYMENT_GATEWAY_KEY_ID),
      gatewayKeySecret: nonEmpty(parsed.PAYMENT_GATEWAY_KEY_SECRET),
      attemptTtlMs: parsed.PAYMENT_ATTEMPT_TTL_MS,
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
        landingOrigin: nonEmpty(parsed.PUBLIC_LANDING_ORIGIN),
        activationUrl: nonEmpty(parsed.APP_ACTIVATION_URL),
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
      verificationTokenTtlMs: parsed.VERIFICATION_TOKEN_TTL_MS,
      idempotencyTtlMs: parsed.IDEMPOTENCY_TTL_MS,
      activationInviteTtlMs: parsed.ACTIVATION_INVITE_TTL_MS,
    },
  })
}
