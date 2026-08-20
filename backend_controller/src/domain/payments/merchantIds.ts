/**
 * Merchant reference generation (spec §5.2/§5.3, §7). Both PhonePe-facing ids
 * are server-generated, unique, at most 63 characters, and restricted to
 * letters, digits, `_`, and `-` (the same rule the schema CHECKs enforce), so a
 * generated id can never fail the insert. They are immutable once written and
 * are the idempotency anchors for crash recovery: a retry reuses the same id,
 * an explicit retry after a terminal failure mints a new one.
 */
import { randomUUID } from "node:crypto"

const REFERENCE_PATTERN = /^[A-Za-z0-9_-]+$/u
const MAX_REFERENCE_LENGTH = 63

/** `boe_` + 32 hex chars = 36 characters. */
export const newMerchantOrderId = (): string => `boe_${randomUUID().replaceAll("-", "")}`

/** `boerf_` + 32 hex chars = 38 characters. */
export const newMerchantRefundId = (): string => `boerf_${randomUUID().replaceAll("-", "")}`

export const isValidMerchantReference = (value: string): boolean =>
  value.length > 0 && value.length <= MAX_REFERENCE_LENGTH && REFERENCE_PATTERN.test(value)
