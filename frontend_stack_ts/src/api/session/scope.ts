export const SESSION_SCOPES = ["client", "admin"] as const

export type SessionScope = (typeof SESSION_SCOPES)[number]

export const isSessionScope = (value: unknown): value is SessionScope =>
  typeof value === "string" && (SESSION_SCOPES as readonly string[]).includes(value)

export const SESSION_INVALIDATED_EVENT = "boe:session-invalidated"

export type SessionInvalidatedDetail = Readonly<{
  scope: SessionScope
  reason: "expired" | "revoked"
}>

export const emitSessionInvalidated = (detail: SessionInvalidatedDetail): void => {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(SESSION_INVALIDATED_EVENT, { detail }))
}

export const subscribeToSessionInvalidated = (
  listener: (detail: SessionInvalidatedDetail) => void,
): (() => void) => {
  if (typeof window === "undefined") return () => undefined
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail
    if (typeof detail !== "object" || detail === null) return
    const candidate = detail as Partial<SessionInvalidatedDetail>
    if (!isSessionScope(candidate.scope)) return
    if (candidate.reason !== "expired" && candidate.reason !== "revoked") return
    listener({ scope: candidate.scope, reason: candidate.reason })
  }
  window.addEventListener(SESSION_INVALIDATED_EVENT, handler)
  return () => {
    window.removeEventListener(SESSION_INVALIDATED_EVENT, handler)
  }
}
