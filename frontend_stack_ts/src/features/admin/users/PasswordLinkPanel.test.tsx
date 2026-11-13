import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import { PasswordLinkPanel } from "./PasswordLinkPanel"

type Settle = Readonly<{ onSuccess?: (sent: unknown) => void; onError?: (error: unknown) => void }>

let granted = true
const sentKeys: string[] = []

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ hasAnyPermission: () => granted }),
}))

vi.mock("./passwordLinkQueries", () => ({
  useAdminClientPasswordAccess: () => ({
    status: "success",
    isFetching: false,
    data: { userId: "user-1", hasPassword: false, nextLinkAllowedAt: null, latestLink: null },
    refetch: () => Promise.resolve({ isSuccess: true }),
  }),
  useSendClientPasswordLink: () => ({
    mutate: (variables: Readonly<{ idempotencyKey: string }>, settle: Settle) => {
      sentKeys.push(variables.idempotencyKey)
      settle.onError?.(new TransportError("timeout", "The request timed out."))
    },
    isPending: false,
  }),
}))

const panel = (canReceive: boolean): void => {
  render(
    <OverlayStackProvider>
      <PasswordLinkPanel userId="user-1" email="asha@example.com" canReceive={canReceive} />
    </OverlayStackProvider>,
  )
}

const sendDeliberately = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Send a new password link" }))
  fireEvent.click(screen.getByRole("button", { name: "Send the link" }))
}

afterEach(() => {
  cleanup()
  granted = true
  sentKeys.length = 0
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

describe("a password link send whose reply is lost", () => {
  it("repeats the same key on Check again and mints a new one only for a deliberate send after reading the status", async () => {
    panel(true)
    sendDeliberately()
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))

    expect(sentKeys).toHaveLength(2)
    expect(sentKeys[1]).toBe(sentKeys[0])

    fireEvent.click(screen.getByRole("button", { name: "Read the link status" }))
    await waitFor(() => {
      expect(screen.queryByText("Not confirmed")).toBeNull()
    })
    expect(sentKeys).toHaveLength(2)

    sendDeliberately()

    expect(sentKeys).toHaveLength(3)
    expect(sentKeys[2]).not.toBe(sentKeys[0])
  })
})
