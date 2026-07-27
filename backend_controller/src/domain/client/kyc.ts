/**
 * Email-OTP KYC commands (decisions 8-10). `requestKycCode` ensures the user's
 * KYC case is open, issues a fresh 6-digit code (hash stored, raw returned to the
 * caller for a post-commit send), and enforces a resend cooldown.
 * `verifyKyc` checks the code (constant-time, expiry + attempt-capped) and, on
 * success, approves the case with an expiry — after which the user is eligible.
 *
 * The raw code is returned from `requestKycCode` only so the route can email it
 * after the transaction commits; it is never persisted, logged, or put in an
 * HTTP response.
 */
import { randomInt } from "node:crypto"

import { bytesEqual } from "../../crypto/primitives.js"
import type { CryptoContext } from "../../crypto/context.js"
import type { KycCase, Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { KycWriteRepository } from "../../repositories/kycRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

export interface KycConfig {
  readonly codeTtlMs: number
  readonly maxAttempts: number
  readonly resendCooldownMs: number
  readonly validityMs: number
}

export interface KycDeps {
  readonly kycRepository: KycWriteRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: KycConfig
}

const generateSixDigitCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0")

const isApprovedAndCurrent = (kycCase: KycCase, now: Date): boolean =>
  kycCase.state === "approved" &&
  (kycCase.expires_at === null || new Date(kycCase.expires_at).getTime() > now.getTime())

export interface RequestKycCodeResult {
  readonly alreadyApproved: boolean
  readonly email: string
  readonly rawCode: string | null
  readonly expiresAt: string | null
}

/**
 * Issue (or re-issue) the KYC verification code. Idempotent when already
 * approved. Enforces the resend cooldown and supersedes any active code.
 */
export const requestKycCode = async (
  tx: Transaction,
  deps: KycDeps,
  input: Readonly<{ userId: string; requestId: string }>,
): Promise<RequestKycCodeResult> => {
  const now = deps.clock()
  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")

  const approved = await deps.kycRepository.findApprovedByUser(tx, input.userId)
  if (approved !== null && isApprovedAndCurrent(approved, now)) {
    return { alreadyApproved: true, email: user.email_normalized, rawCode: null, expiresAt: null }
  }

  const open = await deps.kycRepository.lockOpenCaseByUser(tx, input.userId)
  const kycCase = open ?? (await deps.kycRepository.createCase(tx, input.userId))

  const submitted = await deps.kycRepository.markSubmitted(tx, { caseId: kycCase.id, userId: input.userId, now })
  if (submitted === null) throw new AppError("STATE_CONFLICT")

  // Resend cooldown: reject a new code within the cooldown of the previous one.
  const latest = await deps.kycRepository.latestCodeCreatedAt(tx, kycCase.id)
  if (latest !== null && now.getTime() - latest.getTime() < deps.config.resendCooldownMs) {
    throw new AppError("RATE_LIMITED", { retryAfterSeconds: Math.ceil(deps.config.resendCooldownMs / 1000) })
  }

  await deps.kycRepository.consumeActiveCode(tx, { kycCaseId: kycCase.id, now })
  const rawCode = generateSixDigitCode()
  const hashed = deps.crypto.hashToken(rawCode)
  const expiresAt = new Date(now.getTime() + deps.config.codeTtlMs)
  await deps.kycRepository.createCode(tx, {
    kycCaseId: kycCase.id,
    userId: input.userId,
    codeHash: hashed.hash,
    codeKeyVersion: hashed.keyVersion,
    expiresAt,
  })

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "kyc.code_requested",
    entityType: "kyc_case",
    entityId: kycCase.id,
    toState: "submitted",
    requestId: input.requestId,
    entityVersion: Number(submitted.version),
    metadata: { provider: "email_otp" },
  })

  return { alreadyApproved: false, email: user.email_normalized, rawCode, expiresAt: expiresAt.toISOString() }
}

/**
 * Outcome of a verify attempt. Returned (not thrown) so a failed attempt's
 * increment COMMITS — throwing inside the transaction would roll it back and the
 * attempt cap would never advance. The route maps each outcome to a wire error.
 */
export type VerifyKycOutcome =
  | { readonly kind: "approved"; readonly kycCase: KycCase }
  | { readonly kind: "already_approved"; readonly kycCase: KycCase }
  | { readonly kind: "no_active_case" }
  | { readonly kind: "no_code" }
  | { readonly kind: "expired" }
  | { readonly kind: "locked" }
  | { readonly kind: "invalid" }

/** Verify the submitted code; on success approve the case (with expiry). */
export const verifyKyc = async (
  tx: Transaction,
  deps: KycDeps,
  input: Readonly<{ userId: string; code: string; requestId: string }>,
): Promise<VerifyKycOutcome> => {
  const now = deps.clock()

  const approved = await deps.kycRepository.findApprovedByUser(tx, input.userId)
  if (approved !== null && isApprovedAndCurrent(approved, now)) {
    return { kind: "already_approved", kycCase: approved }
  }

  const kycCase = await deps.kycRepository.lockOpenCaseByUser(tx, input.userId)
  if (kycCase === null || kycCase.state !== "submitted") return { kind: "no_active_case" }

  const code = await deps.kycRepository.lockActiveCode(tx, kycCase.id)
  if (code === null) return { kind: "no_code" }
  if (new Date(code.expires_at).getTime() <= now.getTime()) return { kind: "expired" }
  if (code.attempt_count >= deps.config.maxAttempts) return { kind: "locked" }

  const presented = deps.crypto.hashToken(input.code).hash
  const stored = Buffer.from(code.code_hash as unknown as Uint8Array)
  if (!bytesEqual(presented, stored)) {
    // Commit the incremented attempt (do NOT throw — that would roll it back).
    await deps.kycRepository.incrementCodeAttempt(tx, code.id)
    return { kind: "invalid" }
  }

  await deps.kycRepository.consumeCode(tx, { codeId: code.id, now })
  const decided = await deps.kycRepository.approveCase(tx, {
    caseId: kycCase.id,
    userId: input.userId,
    expiresAt: new Date(now.getTime() + deps.config.validityMs),
    now,
  })
  if (decided === null) return { kind: "no_active_case" }

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "kyc.approve",
    entityType: "kyc_case",
    entityId: decided.id,
    fromState: "submitted",
    toState: "approved",
    requestId: input.requestId,
    entityVersion: Number(decided.version),
    metadata: { provider: "email_otp" },
  })
  return { kind: "approved", kycCase: decided }
}
