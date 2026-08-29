import { SecureStorage } from "@aparajita/capacitor-secure-storage"

import { isNative } from "~/platform/capacitor"
import type { CredentialPersistence } from "~/api/session/tokenStore"

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null)

export const createSecureStoragePersistence = (): CredentialPersistence => ({
  available: async () => {
    if (!isNative()) return false
    try {
      await SecureStorage.keys()
      return true
    } catch {
      return false
    }
  },
  read: async (key: string) => {
    try {
      return asString(await SecureStorage.get(key))
    } catch {
      return null
    }
  },
  write: async (key: string, value: string) => {
    await SecureStorage.set(key, value)
  },
  remove: async (key: string) => {
    try {
      await SecureStorage.remove(key)
    } catch {
      void 0
    }
  },
})
