import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import { UserLifecyclePanel } from "./UserLifecyclePanel"

const OWN_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_ADMIN_ID = "22222222-2222-4222-8222-222222222222"
const OWN_LINE = "You cannot suspend or close your own account. Another admin can do this."

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({
    principal: { userId: OWN_ID, roles: ["superadmin"], permissions: ["users.suspend", "users.close"] },
    hasAnyPermission: () => true,
  }),
}))

vi.mock("./userLifecycleQueries", () => ({
  useUserLifecycle: () => ({ mutate: vi.fn(), isPending: false }),
}))

const panelFor = (userId: string): void => {
  render(
    <OverlayStackProvider>
      <UserLifecyclePanel userId={userId} accountState="active" reloading={false} onReload={() => Promise.resolve(true)} />
    </OverlayStackProvider>,
  )
}

const action = (name: string): HTMLElement | null => screen.queryByRole("button", { name })

afterEach(() => {
  cleanup()
})

describe("suspending or closing an admin account from the lifecycle panel", () => {
  it("withholds Suspend and Close on the signed-in admin's own record and says why in plain words", () => {
    panelFor(OWN_ID)

    expect(action("Suspend")).toBeNull()
    expect(action("Close")).toBeNull()
    expect(screen.getByText(OWN_LINE)).toBeTruthy()
    expect(screen.queryByText(/users\.(suspend|close)/u)).toBeNull()
  })

  it("still offers Suspend and Close on another admin's record", () => {
    panelFor(OTHER_ADMIN_ID)

    expect(action("Suspend")).not.toBeNull()
    expect(action("Close")).not.toBeNull()
    expect(screen.queryByText(OWN_LINE)).toBeNull()
  })
})
