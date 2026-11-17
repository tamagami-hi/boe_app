import { act, cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createTokenStore, createWebPersistence } from "~/api/session/tokenStore"
import type { TokenStore } from "~/api/session/tokenStore"
import { SessionProvider, useSession } from "~/app/providers/SessionProvider"
import type { Principal } from "~/app/providers/SessionProvider"

const PRINCIPAL_KEY = "boe.admin.principal"

const operator = (userId: string, fullName: string): Principal => ({
  userId,
  fullName,
  email: `${fullName.toLowerCase().replace(" ", ".")}@example.com`,
  roles: ["admin"],
  permissions: [],
  accountState: "active",
})

const ADMIN_A = operator("00000000-0000-4000-8000-0000000000a1", "Admin One")
const ADMIN_B = operator("00000000-0000-4000-8000-0000000000b2", "Admin Two")

const SessionLine = (): React.ReactElement => {
  const session = useSession()
  return <p>{`${session.status}:${session.endedReason ?? "none"}`}</p>
}

const renderTab = (restore: () => Promise<Principal | null>): TokenStore => {
  const tokenStore = createTokenStore({ persistence: createWebPersistence(), persistSecrets: false })
  tokenStore.update("admin", { csrfToken: "csrf-of-admin-one", principal: JSON.stringify(ADMIN_A) })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider scope="admin" tokenStore={tokenStore} restore={restore}>
        <SessionLine />
      </SessionProvider>
    </QueryClientProvider>,
  )
  return tokenStore
}

const signedInTab = async (): Promise<TokenStore> => {
  const tokenStore = renderTab(() => Promise.resolve(ADMIN_A))
  await screen.findByText("authenticated:none")
  return tokenStore
}

const anotherTabStoresDuringRestore = (stored: Principal) => (): Promise<Principal> => {
  localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(stored))
  return Promise.resolve(ADMIN_A)
}

const anotherTabWrites = (value: string | null, key = PRINCIPAL_KEY): void => {
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }))
  })
}

const settle = (): Promise<void> =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      }),
  )

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("another tab signing in to the same browser", () => {
  it("ends this tab's session when another tab stores a different user, and keeps that user's stored principal", async () => {
    const tokenStore = await signedInTab()

    anotherTabWrites(JSON.stringify(ADMIN_B))
    await settle()

    expect(screen.getByText("anonymous:revoked")).toBeInTheDocument()
    expect(tokenStore.read("admin", "principal")).toBeNull()
    expect(tokenStore.read("admin", "csrfToken")).toBeNull()
    expect(localStorage.getItem(PRINCIPAL_KEY)).toBe(JSON.stringify(ADMIN_B))
  })

  it("ends this tab's session as it signs in when another tab stored a different user during the restore", async () => {
    const tokenStore = renderTab(anotherTabStoresDuringRestore(ADMIN_B))

    await screen.findByText("anonymous:revoked")
    await settle()

    expect(tokenStore.read("admin", "principal")).toBeNull()
    expect(localStorage.getItem(PRINCIPAL_KEY)).toBe(JSON.stringify(ADMIN_B))
  })

  it("keeps this tab's session as it signs in when the stored principal names the same user", async () => {
    const tokenStore = renderTab(anotherTabStoresDuringRestore({ ...ADMIN_A, fullName: "Admin One Renamed" }))

    await screen.findByText("authenticated:none")
    await settle()

    expect(screen.getByText("authenticated:none")).toBeInTheDocument()
    expect(tokenStore.read("admin", "principal")).toBe(JSON.stringify(ADMIN_A))
  })

  it("keeps this tab's session for a removal, the same user, an unreadable value or another scope", async () => {
    const tokenStore = await signedInTab()

    anotherTabWrites(null)
    anotherTabWrites(JSON.stringify({ ...ADMIN_A, fullName: "Admin One Renamed" }))
    anotherTabWrites("not a principal")
    anotherTabWrites(JSON.stringify(ADMIN_B), "boe.client.principal")
    await settle()

    expect(screen.getByText("authenticated:none")).toBeInTheDocument()
    expect(tokenStore.read("admin", "principal")).toBe(JSON.stringify(ADMIN_A))
  })
})
