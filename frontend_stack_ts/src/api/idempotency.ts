import { useRef } from "react"

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u

export const isIdempotencyKey = (value: string): boolean => IDEMPOTENCY_KEY_PATTERN.test(value)

export const mintIdempotencyKey = (): string => crypto.randomUUID()

const canonicalise = (value: unknown): string => {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "bigint") return value.toString()
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalise(entryValue)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}

export const fingerprintBody = (body: unknown): string => canonicalise(body)

export interface IdempotencyKeyStore {
  readonly resolve: (fingerprint: string) => string
}

export const createIdempotencyKeyStore = (): IdempotencyKeyStore => {
  let currentFingerprint: string | null = null
  let currentKey: string | null = null

  return {
    resolve: (fingerprint: string): string => {
      if (currentKey === null || currentFingerprint !== fingerprint) {
        currentFingerprint = fingerprint
        currentKey = mintIdempotencyKey()
      }
      return currentKey
    },
  }
}

export const useIdempotencyKey = (body: unknown): string => {
  const store = useRef<IdempotencyKeyStore | null>(null)
  store.current ??= createIdempotencyKeyStore()
  return store.current.resolve(fingerprintBody(body))
}
