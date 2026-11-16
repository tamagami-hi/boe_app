const BASE = 36
const T_MIN = 1
const T_MAX = 26
const SKEW = 38
const DAMP = 700
const INITIAL_BIAS = 72
const INITIAL_N = 128
const DELIMITER = "-"
const MAX_INT = 0x7fffffff
const MAX_CODE_POINT = 0x10ffff
const SURROGATE_MIN = 0xd800
const SURROGATE_MAX = 0xdfff
const ASCII_LIMIT = 0x80
const DIGIT_ZERO = 0x30
const DIGIT_NINE = 0x39
const LOWER_A = 0x61
const LOWER_Z = 0x7a
const UPPER_A = 0x41
const UPPER_Z = 0x5a
const LETTER_DIGITS = 26

const adapt = (delta: number, pointCount: number, isFirst: boolean): number => {
  let scaled = isFirst ? Math.floor(delta / DAMP) : Math.floor(delta / 2)
  scaled += Math.floor(scaled / pointCount)
  let k = 0
  while (scaled > Math.floor(((BASE - T_MIN) * T_MAX) / 2)) {
    scaled = Math.floor(scaled / (BASE - T_MIN))
    k += BASE
  }
  return k + Math.floor(((BASE - T_MIN + 1) * scaled) / (scaled + SKEW))
}

const digitValue = (code: number): number | null => {
  if (code >= DIGIT_ZERO && code <= DIGIT_NINE) return code - DIGIT_ZERO + LETTER_DIGITS
  if (code >= LOWER_A && code <= LOWER_Z) return code - LOWER_A
  if (code >= UPPER_A && code <= UPPER_Z) return code - UPPER_A
  return null
}

const threshold = (k: number, bias: number): number => {
  if (k <= bias) return T_MIN
  if (k >= bias + T_MAX) return T_MAX
  return k - bias
}

interface DeltaRead {
  readonly value: number
  readonly next: number
}

const readDelta = (input: string, start: number, initial: number, bias: number): DeltaRead | null => {
  let value = initial
  let weight = 1
  let position = start
  for (let k = BASE; ; k += BASE) {
    if (position >= input.length) return null
    const digit = digitValue(input.charCodeAt(position))
    position += 1
    if (digit === null || digit > Math.floor((MAX_INT - value) / weight)) return null
    value += digit * weight
    const t = threshold(k, bias)
    if (digit < t) return { value, next: position }
    if (weight > Math.floor(MAX_INT / (BASE - t))) return null
    weight *= BASE - t
  }
}

const isScalarValue = (codePoint: number): boolean =>
  codePoint <= MAX_CODE_POINT && (codePoint < SURROGATE_MIN || codePoint > SURROGATE_MAX)

export const decodePunycode = (input: string): string | null => {
  const delimiterIndex = input.lastIndexOf(DELIMITER)
  const basicLength = delimiterIndex > 0 ? delimiterIndex : 0
  const output: number[] = []
  for (let index = 0; index < basicLength; index += 1) {
    const code = input.charCodeAt(index)
    if (code >= ASCII_LIMIT) return null
    output.push(code)
  }

  let codePoint = INITIAL_N
  let bias = INITIAL_BIAS
  let insertAt = 0
  let position = basicLength > 0 ? basicLength + 1 : 0
  while (position < input.length) {
    const previous = insertAt
    const delta = readDelta(input, position, insertAt, bias)
    if (delta === null) return null
    position = delta.next
    const length = output.length + 1
    bias = adapt(delta.value - previous, length, previous === 0)
    const advance = Math.floor(delta.value / length)
    if (advance > MAX_INT - codePoint) return null
    codePoint += advance
    if (!isScalarValue(codePoint)) return null
    insertAt = delta.value % length
    output.splice(insertAt, 0, codePoint)
    insertAt += 1
  }
  return String.fromCodePoint(...output)
}
