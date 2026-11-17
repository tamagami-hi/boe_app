import { isIdempotencyKey } from "~/api/idempotency"

export type StoredHold<TBody> = Readonly<{ idempotencyKey: string; body: TBody }>

export type HoldRead<TBody> =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "held"; hold: StoredHold<TBody>; heldAt: number | null }>

export const BACKEND_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export const isPastReceiptLifetime = (heldAt: number | null, now: number): boolean =>
  heldAt === null || now - heldAt >= BACKEND_IDEMPOTENCY_TTL_MS

type SafeParser<T> = Readonly<{ safeParse: (value: unknown) => { success: true; data: T } | { success: false } }>

export const parseWith =
  <T>(schema: SafeParser<T>) =>
  (value: unknown): T | null => {
    const result = schema.safeParse(value)
    return result.success ? result.data : null
  }

const PREFIX = "beo.admin.held-write.v1"

const NONE: HoldRead<never> = { kind: "none" }
const UNREADABLE: HoldRead<never> = { kind: "unreadable" }

const storageKey = (slot: string): string => `${PREFIX}:${slot}`

export const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null ? (value as Readonly<Record<string, unknown>>) : null

export const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export const heldAtOf = (entry: Readonly<Record<string, unknown>> | null): number | null => {
  const heldAt = entry?.heldAt
  return typeof heldAt === "number" && Number.isFinite(heldAt) ? heldAt : null
}

export const sessionStore = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const parseHold = <TBody>(
  held: Readonly<Record<string, unknown>> | null,
  parseBody: (value: unknown) => TBody | null,
): StoredHold<TBody> | null => {
  if (held === null) return null
  const { idempotencyKey } = held
  if (typeof idempotencyKey !== "string" || !isIdempotencyKey(idempotencyKey)) return null
  const body = parseBody(held.body)
  return body === null ? null : { idempotencyKey, body }
}

const isHeldBy = (raw: string | null, adminId: string): boolean =>
  raw !== null && asRecord(parseJson(raw))?.adminId === adminId

export const readHold = <TBody>(
  slot: string,
  adminId: string,
  parseBody: (value: unknown) => TBody | null,
): HoldRead<TBody> => {
  const store = sessionStore()
  if (store === null) return NONE
  try {
    const raw = store.getItem(storageKey(slot))
    if (raw === null) return NONE
    if (!isHeldBy(raw, adminId)) {
      store.removeItem(storageKey(slot))
      return NONE
    }
    const entry = asRecord(parseJson(raw))
    const hold = parseHold(entry, parseBody)
    return hold === null ? UNREADABLE : { kind: "held", hold, heldAt: heldAtOf(entry) }
  } catch {
    return NONE
  }
}

export const loadHold = <TBody>(
  slot: string,
  adminId: string,
  parseBody: (value: unknown) => TBody | null,
): StoredHold<TBody> | null => {
  const read = readHold(slot, adminId, parseBody)
  return read.kind === "held" ? read.hold : null
}

export const keepHold = (slot: string, adminId: string, hold: StoredHold<unknown>, heldAt: number = Date.now()): boolean => {
  const store = sessionStore()
  if (store === null) return false
  try {
    store.setItem(storageKey(slot), JSON.stringify({ adminId, ...hold, heldAt }))
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
