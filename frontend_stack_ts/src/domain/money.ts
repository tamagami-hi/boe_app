declare const paiseBrand: unique symbol

export type Paise = string & { readonly [paiseBrand]: true }

const PAISE_PATTERN = /^-?(?:0|[1-9][0-9]*)$/u
const PAISE_PER_RUPEE = 100
const POSTGRES_BIGINT_MAX = 9223372036854775807n
const POSTGRES_BIGINT_MIN = -9223372036854775808n

export class MoneyFormatError extends Error {
  public readonly code = "MONEY_FORMAT_INVALID"

  public constructor(message: string) {
    super(message)
    this.name = "MoneyFormatError"
  }
}

export class MoneyPrecisionError extends Error {
  public readonly code = "MONEY_PRECISION_LOST"

  public constructor(message: string) {
    super(message)
    this.name = "MoneyPrecisionError"
  }
}

const withinBigintRange = (value: string): boolean => {
  const parsed = BigInt(value)
  return parsed <= POSTGRES_BIGINT_MAX && parsed >= POSTGRES_BIGINT_MIN
}

export const isPaise = (value: unknown): value is Paise =>
  typeof value === "string" && PAISE_PATTERN.test(value) && withinBigintRange(value)

export const isWirePaise = (value: unknown): value is Paise =>
  isPaise(value) && !value.startsWith("-")

export const toPaise = (value: string): Paise => {
  if (!isPaise(value)) {
    throw new MoneyFormatError("Amount must be an integer number of paise within bigint range")
  }
  return value
}

export const rupeesToPaise = (rupees: number): Paise => {
  if (!Number.isFinite(rupees)) {
    throw new MoneyFormatError("Amount must be a finite number")
  }
  const paise = Math.round(rupees * PAISE_PER_RUPEE)
  if (!Number.isSafeInteger(paise)) {
    throw new MoneyFormatError("Amount is outside the safe integer range")
  }
  if (paise <= 0) {
    throw new MoneyFormatError("Amount must be greater than zero")
  }
  return String(paise) as Paise
}

export const paiseToRupees = (paise: Paise): number => {
  const parsed = BigInt(paise)
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyPrecisionError("Amount exceeds the range that converts to a number without loss")
  }
  return Number(paise) / PAISE_PER_RUPEE
}

export const addPaise = (left: Paise, right: Paise): Paise =>
  String(BigInt(left) + BigInt(right)) as Paise

export const subtractPaise = (left: Paise, right: Paise): Paise =>
  String(BigInt(left) - BigInt(right)) as Paise

export const comparePaise = (left: Paise, right: Paise): -1 | 0 | 1 => {
  const difference = BigInt(left) - BigInt(right)
  if (difference < 0n) return -1
  if (difference > 0n) return 1
  return 0
}

export const isNegativePaise = (paise: Paise): boolean => paise.startsWith("-")

type FormatOptions = Readonly<{
  showDecimals?: boolean
  showSign?: boolean
}>

const rupeeFormatter = (showDecimals: boolean): Intl.NumberFormat =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  })

export const formatINR = (paise: Paise, options: FormatOptions = {}): string => {
  const showDecimals = options.showDecimals ?? false
  const rupees = paiseToRupees(paise)
  const formatted = rupeeFormatter(showDecimals).format(Math.abs(rupees))
  if (options.showSign === true && rupees > 0) return `+${formatted}`
  if (rupees < 0) return `-${formatted}`
  return formatted
}
