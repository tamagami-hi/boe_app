import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { dropRequestSignalsInThisFile } from "~/app/routing/dataRouterTestSupport"

vi.mock("~/shells/admin/adminRuntime", async () => {
  const { createTokenStore, createWebPersistence } = await import("~/api/session/tokenStore")
  const operator = {
    userId: "00000000-0000-4000-8000-0000000000a1",
    fullName: "Admin One",
    email: "admin.one@example.com",
    roles: ["admin"],
    permissions: [],
    accountState: "active",
  }
  return {
    createAdminRuntime: () => ({
      tokenStore: createTokenStore({ persistence: createWebPersistence(), persistSecrets: false }),
      refreshCoordinator: { refreshOnce: () => new Promise(() => undefined), inFlight: () => false },
      http: { request: () => new Promise(() => undefined) },
      login: () => Promise.reject(new Error("Sign-in is not part of this test.")),
      logout: () => Promise.resolve(),
      restore: () => Promise.resolve(operator),
      probeReachability: () => Promise.resolve(true),
      setOutcomeReporter: () => undefined,
    }),
  }
})

dropRequestSignalsInThisFile()

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

describe("the admin shell on its data router", () => {
  it("restores the session, renders a lazy screen in the console frame and moves to another one", async () => {
    window.history.replaceState(null, "", "/account")
    const { default: AdminShellRoot } = await import("./AdminShellRoot")
    render(<AdminShellRoot />)

    expect(await screen.findByRole("heading", { level: 1, name: "Account" }, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy()

    fireEvent.click(screen.getByRole("link", { name: "Read what's new" }))
    expect(await screen.findByRole("heading", { level: 1, name: "What's new" }, { timeout: 5000 })).toBeTruthy()
    expect(window.location.pathname).toBe("/account/whats-new")
    expect(screen.queryByRole("dialog", { name: "Stay on this page?" })).toBeNull()
  }, 15000)
})
