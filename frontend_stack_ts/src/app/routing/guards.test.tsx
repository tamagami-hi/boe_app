import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import { createTokenStore, createWebPersistence } from "~/api/session/tokenStore"
import { SessionProvider } from "~/app/providers/SessionProvider"
import type { Principal } from "~/app/providers/SessionProvider"
import { RequireSession } from "~/app/routing/guards"

const OPERATOR: Principal = {
  userId: "00000000-0000-4000-8000-0000000000a1",
  fullName: "Admin One",
  email: "admin.one@example.com",
  roles: ["admin"],
  permissions: [],
  accountState: "active",
}

const TARGETS = { loginPath: "/login", blockedPath: null, verifyEmailPath: null }

const unreachable = (): Promise<Principal | null> =>
  Promise.reject(new TransportError("offline", "BeOnEdge could not be reached."))

const reloadAtDeepUrl = (restore: () => Promise<Principal | null>): void => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionProvider
        scope="admin"
        tokenStore={createTokenStore({ persistence: createWebPersistence(), persistSecrets: false })}
        restore={restore}
      >
        <MemoryRouter initialEntries={["/users"]}>
          <Routes>
            <Route
              path="/users"
              element={
                <RequireSession targets={TARGETS}>
                  <p>Users directory</p>
                </RequireSession>
              }
            />
            <Route path="/login" element={<p>Sign-in screen</p>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe("reloading at a signed-in deep URL while the session read fails with an outage", () => {
  it("shows the failure with Try again instead of an endless spinner, and restores once the browser is online", async () => {
    const restore = vi.fn(unreachable)
    reloadAtDeepUrl(restore)

    await screen.findByRole("button", { name: "Try again" })
    expect(screen.queryByRole("progressbar", { name: "Restoring your session" })).toBeNull()
    expect(screen.queryByText("Sign-in screen")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByRole("button", { name: "Try again" })
    expect(restore).toHaveBeenCalledTimes(2)

    restore.mockImplementation(() => Promise.resolve(OPERATOR))
    act(() => {
      window.dispatchEvent(new Event("online"))
    })

    await screen.findByText("Users directory", {}, { timeout: 5000 })
    expect(restore).toHaveBeenCalledTimes(3)
  }, 15000)
})
