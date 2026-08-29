import { z } from "zod"

const C0_C1_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u
const DECIMAL_NEGATIVE_ZERO_PATTERN = /^-0(?:[.]0+)?$/u
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const UNPAIRED_SURROGATE_PATTERN =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
const MASK_MARKER = "***"
const MASKED_EMAIL_FORBIDDEN_FIRST_SCALARS = ".@*\"\\()[]:;,<>"
const POSTGRES_BIGINT_MAX = "9223372036854775807"
const UTC_YEAR_MINIMUM = 0
const UTC_YEAR_MAXIMUM = 9_999

const countUnicodeScalars = (value: string): number => [...value].length

const hasC0OrC1Control = (value: string): boolean => C0_C1_CONTROL_PATTERN.test(value)

const isWellFormedUnicode = (value: string): boolean => !UNPAIRED_SURROGATE_PATTERN.test(value)

const hasUnicodeScalarLength = (value: string, minimum: number, maximum: number): boolean => {
  if (!isWellFormedUnicode(value)) return false

  const length = countUnicodeScalars(value)
  return length >= minimum && length <= maximum
}

const isSingleUnicodeScalar = (value: string): boolean => {
  return isWellFormedUnicode(value) && countUnicodeScalars(value) === 1
}

const isLowercaseIdnaDomain = (domain: string): boolean => {
  if (domain.length > 253 || domain !== domain.toLowerCase()) return false

  const labels = domain.split(".")
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL_PATTERN.test(label))) return false

  try {
    return new URL("https://" + domain).hostname === domain
  } catch {
    return false
  }
}

const isCanonicalMaskedEmail = (value: string): boolean => {
  const markerIndex = value.indexOf(MASK_MARKER)
  if (markerIndex <= 0) return false

  const firstScalar = value.slice(0, markerIndex)
  const suffix = value.slice(markerIndex + MASK_MARKER.length)
  if (!isSingleUnicodeScalar(firstScalar) || !suffix.startsWith("@")) return false
  if (
    MASKED_EMAIL_FORBIDDEN_FIRST_SCALARS.includes(firstScalar) ||
    hasC0OrC1Control(firstScalar) ||
    /\s/u.test(firstScalar)
  ) {
    return false
  }

  return isLowercaseIdnaDomain(suffix.slice(1))
}

const trimmedUnicodeString = (minimum: number, maximum: number) =>
  z.string().trim().refine((value) => hasUnicodeScalarLength(value, minimum, maximum))

const isWithinUnsignedIntegerMaximum = (value: string, maximum: string): boolean => {
  if (value.length !== maximum.length) return value.length < maximum.length
  return value <= maximum
}

const hasFourDigitUtcYear = (value: string): boolean => {
  const utcYear = new Date(value).getUTCFullYear()
  return utcYear >= UTC_YEAR_MINIMUM && utcYear <= UTC_YEAR_MAXIMUM
}

const toUtcIsoDateTime = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

const fitsDecimalIntegerDigits = (value: string, maximumIntegerDigits: number): boolean => {
  const unsignedValue = value.startsWith("-") ? value.slice(1) : value
  const decimalIndex = unsignedValue.indexOf(".")
  const integerLength = decimalIndex === -1 ? unsignedValue.length : decimalIndex
  return integerLength <= maximumIntegerDigits
}

const toFixedScaleDecimal = (value: string, scale: number): string => {
  const canonicalValue = DECIMAL_NEGATIVE_ZERO_PATTERN.test(value) ? value.slice(1) : value
  const decimalIndex = canonicalValue.indexOf(".")
  if (decimalIndex === -1) return canonicalValue + "." + "0".repeat(scale)

  const fractionalDigits = canonicalValue.length - decimalIndex - 1
  const missingDigits = scale - fractionalDigits
  return missingDigits > 0 ? canonicalValue + "0".repeat(missingDigits) : canonicalValue
}

export const Uuid = z.string().uuid()
export type Uuid = z.infer<typeof Uuid>

export const IsoDateTime = z
  .string()
  .datetime({ offset: true })
  .refine(hasFourDigitUtcYear)
  .overwrite(toUtcIsoDateTime)
export type IsoDateTime = z.infer<typeof IsoDateTime>

export const EmailInput = z.string().trim().email().max(254)
export type EmailInput = z.infer<typeof EmailInput>

export const MaskedEmail = z.string().max(254).refine(isCanonicalMaskedEmail)
export type MaskedEmail = z.infer<typeof MaskedEmail>

export const PhoneInput = z.string().trim().min(8).max(32)
export type PhoneInput = z.infer<typeof PhoneInput>

export const FullName = trimmedUnicodeString(2, 120).refine((value) => !hasC0OrC1Control(value))
export type FullName = z.infer<typeof FullName>

export const ReasonCode = z.string().trim().regex(/^[a-z][a-z0-9_]{2,63}$/u)
export type ReasonCode = z.infer<typeof ReasonCode>

export const ReasonDetail = trimmedUnicodeString(1, 2_000)
export type ReasonDetail = z.infer<typeof ReasonDetail>

export const VersionTag = z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/u)
export type VersionTag = z.infer<typeof VersionTag>

export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u)
export type IdempotencyKey = z.infer<typeof IdempotencyKey>

export const Cursor = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,1024}[.][A-Za-z0-9_-]{16,1024}$/u)
export type Cursor = z.infer<typeof Cursor>

export const Paise = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u)
  .refine((value) => isWithinUnsignedIntegerMaximum(value, POSTGRES_BIGINT_MAX))
export type Paise = z.infer<typeof Paise>

export const SignedPaise = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)$/u)
  .refine((value) =>
    isWithinUnsignedIntegerMaximum(
      value.startsWith("-") ? value.slice(1) : value,
      POSTGRES_BIGINT_MAX,
    ),
  )
export type SignedPaise = z.infer<typeof SignedPaise>

export const Decimal24x8 = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)([.][0-9]{1,8})?$/u)
  .refine((value) => fitsDecimalIntegerDigits(value, 16))
  .overwrite((value) => toFixedScaleDecimal(value, 8))
export type Decimal24x8 = z.infer<typeof Decimal24x8>

export const Decimal30x12 = z
  .string()
  .regex(/^-?(0|[1-9][0-9]*)([.][0-9]{1,12})?$/u)
  .refine((value) => fitsDecimalIntegerDigits(value, 18))
  .overwrite((value) => toFixedScaleDecimal(value, 12))
export type Decimal30x12 = z.infer<typeof Decimal30x12>

export const PasswordInput = z
  .string()
  .refine((value) => hasUnicodeScalarLength(value, 12, 128))
  .refine((value) => !hasC0OrC1Control(value))
export type PasswordInput = z.infer<typeof PasswordInput>
