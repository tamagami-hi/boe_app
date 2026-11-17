import type { SessionScope } from "~/api/session/scope"

export type SeenStorage = Pick<Storage, "getItem" | "setItem">

export type WhatsNewSeen = Readonly<{
  lastSeen: (scope: SessionScope, userId: string) => string | null
  markSeen: (scope: SessionScope, userId: string, entryId: string) => void
}>

export const whatsNewSeenKey = (scope: SessionScope, userId: string): string =>
  `boe.${scope}.whatsNew.${userId}`

export const createWhatsNewSeen = (storage: () => SeenStorage): WhatsNewSeen => {
  const thisRun = new Map<string, string>()
  return {
    lastSeen: (scope, userId) => {
      const key = whatsNewSeenKey(scope, userId)
      const held = thisRun.get(key)
      if (held !== undefined) return held
      try {
        return storage().getItem(key)
      } catch {
        return null
      }
    },
    markSeen: (scope, userId, entryId) => {
      const key = whatsNewSeenKey(scope, userId)
      thisRun.set(key, entryId)
      try {
        storage().setItem(key, entryId)
      } catch {
        void 0
      }
    },
  }
}

export const browserWhatsNewSeen: WhatsNewSeen = createWhatsNewSeen(() => window.localStorage)
