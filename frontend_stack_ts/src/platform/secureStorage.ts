import { callPlugin, hasPlugin } from "~/platform/capacitor"
import type { CredentialPersistence } from "~/api/session/tokenStore"

const PLUGIN = "SecureStoragePlugin"

const asString = (value: unknown): string | null => {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.value === "string") return record.value
    if (typeof record.data === "string") return record.data
  }
  return null
}

export const createSecureStoragePersistence = (): CredentialPersistence => ({
  available: async () => {
    if (!hasPlugin(PLUGIN)) return false
    try {
      await callPlugin(PLUGIN, "keys")
      return true
    } catch {
      return false
    }
  },
  read: async (key: string) => {
    try {
      return asString(await callPlugin(PLUGIN, "get", { key }))
    } catch {
      return null
    }
  },
  write: async (key: string, value: string) => {
    await callPlugin(PLUGIN, "set", { key, value })
  },
  remove: async (key: string) => {
    try {
      await callPlugin(PLUGIN, "remove", { key })
    } catch {
      void 0
    }
  },
})
