import { isIdempotencyKey } from "~/api/idempotency"

export type StoredHold<TBody> = Readonly<{ idempotencyKey: string; body: TBody }>

const PREFIX = "beo.admin.held-write.v1"

const storageKey = (slot: string): string => `${PREFIX}:${slot}`

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null ? (value as Readonly<Record<string, unknown>>) : null

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

const sessionStore = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const parseHold = <TBody>(raw: string, parseBody: (value: unknown) => TBody | null): StoredHold<TBody> | null => {
  const held = asRecord(parseJson(raw))
  if (held === null) return null
  const { idempotencyKey } = held
  if (typeof idempotencyKey !== "string" || !isIdempotencyKey(idempotencyKey)) return null
  const body = parseBody(held.body)
  return body === null ? null : { idempotencyKey, body }
}

export const loadHold = <TBody>(slot: string, parseBody: (value: unknown) => TBody | null): StoredHold<TBody> | null => {
  const store = sessionStore()
  if (store === null) return null
  try {
    const raw = store.getItem(storageKey(slot))
    return raw === null ? null : parseHold(raw, parseBody)
  } catch {
    return null
  }
}

export const keepHold = (slot: string, hold: StoredHold<unknown>): boolean => {
  const store = sessionStore()
  if (store === null) return false
  try {
    store.setItem(storageKey(slot), JSON.stringify(hold))
    return true
  } catch {
    return false
  }
}

export const releaseHold = (slot: string): boolean => {
  const store = sessionStore()
  if (store === null) return false
  try {
    store.removeItem(storageKey(slot))
    return true
  } catch {
    return false
  }
}
