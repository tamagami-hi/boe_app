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
  WEB_ORIGIN_ALLOWLIST: z.string().trim().min(1),
  AWS_REGION: z.string().trim().min(1),
  SNS_TOPIC_ARN: z.string().trim().min(1),
  SES_CONFIGURATION_SET: z.string().trim().min(1),
  PROVIDER_EVENT_TTL_MS: z.coerce.number().int().min(1).default(7 * DAY_MS),
  VERIFICATION_TOKEN_TTL_MS: z.coerce.number().int().min(1).default(DAY_MS),
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().min(1).default(DAY_MS),
  ACTIVATION_INVITE_TTL_MS: z.coerce.number().int().min(1).default(7 * DAY_MS),
})

export interface ServerConfig {
  readonly access: AccessTokenConfig
  readonly refreshKey: Buffer
  readonly refreshKeyVersion: string
  readonly csrfKeyVersion: string
  readonly cursorKey: Buffer
  readonly web: { readonly cookieSecure: boolean; readonly originAllowlist: readonly string[] }
  readonly providerEvents: { readonly awsRegion: string; readonly topicArn: string; readonly ttlMs: number }
  readonly sesConfigurationSet: string
  readonly emailConfigured: boolean
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
  const originAllowlist = parsed.WEB_ORIGIN_ALLOWLIST.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  if (originAllowlist.length === 0) throw new Error("WEB_ORIGIN_ALLOWLIST must list at least one origin")

  return Object.freeze({
    access: {
      issuer: parsed.ACCESS_TOKEN_ISSUER,
      audience: parsed.ACCESS_TOKEN_AUDIENCE,
      currentKid: parsed.ACCESS_TOKEN_CURRENT_KID,
      signingKeyPkcs8: parsed.ACCESS_TOKEN_SIGNING_KEY,
      verificationKeysSpki,
    },
    refreshKey: decode32ByteKey("REFRESH_HMAC_KEY", parsed.REFRESH_HMAC_KEY),
    refreshKeyVersion: parsed.REFRESH_KEY_VERSION,
    csrfKeyVersion: parsed.CSRF_KEY_VERSION,
    cursorKey: decode32ByteKey("CURSOR_HMAC_KEY", parsed.CURSOR_HMAC_KEY),
    web: { cookieSecure: parsed.WEB_COOKIE_SECURE === "true", originAllowlist },
    providerEvents: {
      awsRegion: parsed.AWS_REGION,
      topicArn: parsed.SNS_TOPIC_ARN,
      ttlMs: parsed.PROVIDER_EVENT_TTL_MS,
    },
    sesConfigurationSet: parsed.SES_CONFIGURATION_SET,
    emailConfigured: true,
    ttls: {
      verificationTokenTtlMs: parsed.VERIFICATION_TOKEN_TTL_MS,
      idempotencyTtlMs: parsed.IDEMPOTENCY_TTL_MS,
      activationInviteTtlMs: parsed.ACTIVATION_INVITE_TTL_MS,
    },
  })
}
