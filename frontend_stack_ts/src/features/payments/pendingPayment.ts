import { PendingPaymentWriteFailed } from "~/features/payments/checkout"

export const PENDING_PAYMENT_KEY = "beonedge.pending-payment.v1"
export const PENDING_PAYMENT_TTL_MS = 30 * 60 * 1_000

export type PendingPayment = Readonly<{
  paymentId: string
  orderId: string
  ownerId: string
  expiresAt: number
}>

export type PendingPaymentStore = Readonly<{
  read: (key: string) => string | null
  write: (key: string, value: string) => void
  remove: (key: string) => void
}>

export const browserPendingPaymentStore = (): PendingPaymentStore => ({
  read: (key) => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  write: (key, value) => {
    window.localStorage.setItem(key, value)
  },
  remove: (key) => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      void 0
    }
  },
})

const isPendingPayment = (value: unknown): value is PendingPayment => {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.paymentId === "string" &&
    typeof record.orderId === "string" &&
    typeof record.ownerId === "string" &&
    typeof record.expiresAt === "number" &&
    Number.isSafeInteger(record.expiresAt)
  )
}

export const persistPendingPayment = (
  store: PendingPaymentStore,
  pending: PendingPayment,
): void => {
  const serialised = JSON.stringify(pending)
  try {
    store.write(PENDING_PAYMENT_KEY, serialised)
  } catch {
    throw new PendingPaymentWriteFailed("The pending payment could not be recorded on this device")
  }

  const confirmed = store.read(PENDING_PAYMENT_KEY)
  if (confirmed !== serialised) {
    throw new PendingPaymentWriteFailed("The pending payment did not survive being written")
  }
}

export const readPendingPayment = (
  store: PendingPaymentStore,
  ownerId: string,
  now: number,
): PendingPayment | null => {
  const raw = store.read(PENDING_PAYMENT_KEY)
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    store.remove(PENDING_PAYMENT_KEY)
    return null
  }

  if (!isPendingPayment(parsed)) {
    store.remove(PENDING_PAYMENT_KEY)
    return null
  }
  if (parsed.ownerId !== ownerId) return null
  if (parsed.expiresAt <= now) {
    store.remove(PENDING_PAYMENT_KEY)
    return null
  }

  return parsed
}

export const clearPendingPayment = (store: PendingPaymentStore): void => {
  store.remove(PENDING_PAYMENT_KEY)
}
