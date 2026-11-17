import { SESSION_SCOPES } from "~/api/session/scope"
import type { SessionScope } from "~/api/session/scope"

export const CREDENTIAL_FIELDS = ["accessToken", "refreshToken", "principal", "csrfToken"] as const

export type CredentialField = (typeof CREDENTIAL_FIELDS)[number]

export const SECRET_FIELDS: readonly CredentialField[] = ["accessToken", "refreshToken"]

const SHARED_FIELDS: readonly CredentialField[] = CREDENTIAL_FIELDS.filter(
  (field) => !SECRET_FIELDS.includes(field),
)

export type ScopeCredentials = Readonly<Record<CredentialField, string | null>>

export type CredentialPersistence = Readonly<{
  available: () => Promise<boolean>
  read: (key: string) => Promise<string | null>
  write: (key: string, value: string) => Promise<void>
  remove: (key: string) => Promise<void>
}>

export type ScopeCredentialStatus = Readonly<{
  scope: SessionScope
  hasAccessToken: boolean
  hasRefreshToken: boolean
  hasPrincipal: boolean
  hasCsrfToken: boolean
}>

export class CredentialStoreUnavailableError extends Error {
  public readonly code = "CREDENTIAL_STORE_UNAVAILABLE"

  public constructor(message: string) {
    super(message)
    this.name = "CredentialStoreUnavailableError"
  }
}

const emptyCredentials = (): ScopeCredentials => ({
  accessToken: null,
  refreshToken: null,
  principal: null,
  csrfToken: null,
})

export const credentialStorageKey = (scope: SessionScope, field: CredentialField): string =>
  `boe.${scope}.${field}`

export const createWebPersistence = (): CredentialPersistence => ({
  available: () => Promise.resolve(typeof localStorage !== "undefined"),
  read: (key: string) => Promise.resolve(localStorage.getItem(key)),
  write: (key: string, value: string) => {
    localStorage.setItem(key, value)
    return Promise.resolve()
  },
  remove: (key: string) => {
    localStorage.removeItem(key)
    return Promise.resolve()
  },
})

export type TokenStoreOptions = Readonly<{
  persistence: CredentialPersistence
  persistSecrets: boolean
}>

export const purgeLegacyLocalSecrets = (): void => {
  if (typeof localStorage === "undefined") return
  for (const scope of SESSION_SCOPES) {
    for (const field of SECRET_FIELDS) {
      localStorage.removeItem(credentialStorageKey(scope, field))
    }
  }
}
export type TokenStore = Readonly<{
  read: (scope: SessionScope, field: CredentialField) => string | null
  set: (scope: SessionScope, field: CredentialField, value: string) => void
  update: (scope: SessionScope, values: Partial<Record<CredentialField, string>>) => void
  clear: (scope: SessionScope) => void
  hydrate: () => Promise<void>
  isHydrated: () => boolean
  status: (scope: SessionScope) => ScopeCredentialStatus
}>

export const createTokenStore = (options: TokenStoreOptions): TokenStore => {
  const memory = new Map<SessionScope, ScopeCredentials>(
    SESSION_SCOPES.map((scope) => [scope, emptyCredentials()]),
  )

  let hydrated = false
  let hydration: Promise<void> | null = null

  const shouldPersist = (field: CredentialField): boolean =>
    options.persistSecrets || !SECRET_FIELDS.includes(field)

  const current = (scope: SessionScope): ScopeCredentials =>
    memory.get(scope) ?? emptyCredentials()

  const writeMemory = (scope: SessionScope, next: ScopeCredentials): void => {
    memory.set(scope, next)
  }

  const persistField = (scope: SessionScope, field: CredentialField, value: string): void => {
    if (!shouldPersist(field)) return
    void options.persistence.write(credentialStorageKey(scope, field), value).catch(() => undefined)
  }

  const removeField = (scope: SessionScope, field: CredentialField): void => {
    void options.persistence.remove(credentialStorageKey(scope, field)).catch(() => undefined)
  }

  const removeIfStillHeld = async (
    scope: SessionScope,
    field: CredentialField,
    held: string | null,
  ): Promise<void> => {
    const key = credentialStorageKey(scope, field)
    const persisted = await options.persistence.read(key).catch(() => null)
    if (persisted === null || persisted !== held || current(scope)[field] !== null) return
    await options.persistence.remove(key).catch(() => undefined)
  }

  const runHydration = async (): Promise<void> => {
    const available = await options.persistence.available().catch(() => false)
    if (!available) {
      if (options.persistSecrets) {
        hydrated = true
        throw new CredentialStoreUnavailableError(
          "Secure credential storage is unavailable. Credentials stay in memory only.",
        )
      }
      hydrated = true
      return
    }

    for (const scope of SESSION_SCOPES) {
      const next: Record<CredentialField, string | null> = { ...emptyCredentials() }
      for (const field of CREDENTIAL_FIELDS) {
        if (!shouldPersist(field)) continue
        next[field] = await options.persistence.read(credentialStorageKey(scope, field)).catch(() => null)
      }
      writeMemory(scope, next)
    }
    hydrated = true
  }

  return {
    read: (scope, field) => current(scope)[field],

    set: (scope, field, value) => {
      writeMemory(scope, { ...current(scope), [field]: value })
      persistField(scope, field, value)
    },

    update: (scope, values) => {
      const next: Record<CredentialField, string | null> = { ...current(scope) }
      for (const field of CREDENTIAL_FIELDS) {
        const value = values[field]
        if (value === undefined) continue
        next[field] = value
        persistField(scope, field, value)
      }
      writeMemory(scope, next)
    },

    clear: (scope) => {
      const held = current(scope)
      writeMemory(scope, emptyCredentials())
      for (const field of SECRET_FIELDS) removeField(scope, field)
      for (const field of SHARED_FIELDS) void removeIfStillHeld(scope, field, held[field])
    },

    hydrate: () => {
      hydration ??= runHydration()
      return hydration
    },

    isHydrated: () => hydrated,

    status: (scope) => {
      const credentials = current(scope)
      return {
        scope,
        hasAccessToken: credentials.accessToken !== null,
        hasRefreshToken: credentials.refreshToken !== null,
        hasPrincipal: credentials.principal !== null,
        hasCsrfToken: credentials.csrfToken !== null,
      }
    },
  }
}
