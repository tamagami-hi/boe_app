import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import { PasswordLinkPanel } from "./PasswordLinkPanel"

let granted = true

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ hasAnyPermission: () => granted }),
}))

vi.mock("./passwordLinkQueries", () => ({
  useAdminClientPasswordAccess: () => ({
    status: "success",
    isFetching: false,
    data: { userId: "user-1", hasPassword: false, nextLinkAllowedAt: null, latestLink: null },
    refetch: () => undefined,
  }),
  useSendClientPasswordLink: () => ({ mutate: vi.fn(), isPending: false }),
}))

const panel = (canReceive: boolean): void => {
  render(
    <OverlayStackProvider>
      <PasswordLinkPanel userId="user-1" email="asha@example.com" canReceive={canReceive} />
    </OverlayStackProvider>,
  )
}

afterEach(() => {
  cleanup()
  granted = true
})

describe("who can send a client a password link", () => {
  it("offers the send action to an admin holding the permission, for an active client", () => {
    panel(true)
    expect(screen.queryByRole("button", { name: "Send a new password link" })).not.toBeNull()
  })

  it("never offers it without the permission", () => {
    granted = false
    panel(true)
    expect(screen.queryByRole("button", { name: "Send a new password link" })).toBeNull()
    expect(screen.getByText(/needs the clients.password_links.send permission/u)).toBeTruthy()
  })

  it("never offers it for an account that cannot receive one", () => {
    panel(false)
    expect(screen.queryByRole("button", { name: "Send a new password link" })).toBeNull()
  })
})
