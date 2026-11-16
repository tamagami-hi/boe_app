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

const isHeldBy = (raw: string | null, adminId: string): boolean =>
  raw !== null && asRecord(parseJson(raw))?.adminId === adminId

export const loadHold = <TBody>(
  slot: string,
  adminId: string,
  parseBody: (value: unknown) => TBody | null,
): StoredHold<TBody> | null => {
  const store = sessionStore()
  if (store === null) return null
  try {
    const raw = store.getItem(storageKey(slot))
    if (raw === null) return null
    if (isHeldBy(raw, adminId)) return parseHold(raw, parseBody)
    store.removeItem(storageKey(slot))
    return null
  } catch {
    return null
  }
}

export const keepHold = (slot: string, adminId: string, hold: StoredHold<unknown>): boolean => {
  const store = sessionStore()
  if (store === null) return false
  try {
    store.setItem(storageKey(slot), JSON.stringify({ adminId, ...hold }))
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

const removeHeldKeys = (prefix: string, isStale: (raw: string | null) => boolean): boolean => {
  const store = sessionStore()
  if (store === null) return false
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index) ?? "")
    for (const key of keys.filter((candidate) => candidate.startsWith(prefix))) {
      if (isStale(store.getItem(key))) store.removeItem(key)
    }
    return true
  } catch {
    return false
  }
}

export const clearHeldKeys = (prefix: string): boolean => removeHeldKeys(prefix, () => true)

export const dropOtherAdminsKeys = (prefix: string, adminId: string): boolean =>
  removeHeldKeys(prefix, (raw) => !isHeldBy(raw, adminId))

export const clearHolds = (): boolean => clearHeldKeys(`${PREFIX}:`)

export const dropOtherAdminsHolds = (adminId: string): boolean => dropOtherAdminsKeys(`${PREFIX}:`, adminId)
