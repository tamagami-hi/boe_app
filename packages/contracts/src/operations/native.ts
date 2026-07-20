import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { EmailInput, FullName, IsoDateTime, Uuid } from "../scalars.js"

export const OpaqueToken43 = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)

export const RefreshToken = OpaqueToken43
export type RefreshToken = z.infer<typeof RefreshToken>

export const AccessToken = z.string().min(100).max(4096)
export type AccessToken = z.infer<typeof AccessToken>

export const AppVersion = z
  .string()
  .regex(/^[0-9]+[.][0-9]+[.][0-9]+([+-][A-Za-z0-9.-]+)?$/u)
export type AppVersion = z.infer<typeof AppVersion>

export const NativeDevice = z.strictObject({
  installationId: Uuid,
  name: z.string().trim().min(1).max(80),
  platform: z.literal("android"),
  appVersion: AppVersion,
})
export type NativeDevice = z.infer<typeof NativeDevice>

export const NativeCompatibilityHeaders = z.strictObject({
  "x-client-platform": z.literal("android"),
  "x-app-version": AppVersion,
})
export type NativeCompatibilityHeaders = z.infer<typeof NativeCompatibilityHeaders>

export const PhoneMasked = z.string().regex(/^\+[1-9][0-9]{0,2}[*]{6}[0-9]{4}$/u)
export type PhoneMasked = z.infer<typeof PhoneMasked>

export const NativeUser = z.strictObject({
  userId: Uuid,
  fullName: FullName,
  email: EmailInput,
  phoneMasked: PhoneMasked,
  accountStatus: z.literal("active"),
})
export type NativeUser = z.infer<typeof NativeUser>

export const NativeCredentialData = z.strictObject({
  accessToken: AccessToken,
  accessTokenExpiresAt: IsoDateTime,
  refreshToken: RefreshToken,
  refreshTokenExpiresAt: IsoDateTime,
  sessionId: Uuid,
})
export type NativeCredentialData = z.infer<typeof NativeCredentialData>

export const NativeSessionData = z.strictObject({
  user: NativeUser,
  ...NativeCredentialData.shape,
})
export type NativeSessionData = z.infer<typeof NativeSessionData>

export const NativeSessionSuccessEnvelope = createSuccessEnvelopeSchema(NativeSessionData)
