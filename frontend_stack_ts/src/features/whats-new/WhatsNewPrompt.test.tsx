import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { lockDevice, unlockDevice } from "~/app/native/deviceLock"
import { Modal } from "~/app/overlays/Modal"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import type { WhatsNewNotes } from "./whatsNewEntry"
import { WhatsNewPrompt } from "./WhatsNewPrompt"
import { createWhatsNewSeen, type SeenStorage, type WhatsNewSeen } from "./whatsNewSeen"

const ASHA = "11111111-1111-4111-8111-111111111111"
const RAVI = "22222222-2222-4222-8222-222222222222"

const session = vi.hoisted(() => ({ userId: "" }))

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({
    status: "authenticated",
    scope: "client",
    principal: {
      userId: session.userId,
      fullName: "Test User",
      email: "user@example.com",
      roles: ["client"],
      permissions: [],
      accountState: "active",
    },
  }),
}))

const NOTES: WhatsNewNotes = [
  { id: "0.18.1", sections: [{ heading: "New", items: [{ text: "Fund pages." }] }] },
]

const browserSeen = (): WhatsNewSeen => createWhatsNewSeen(() => window.localStorage)

const tree = (seen: WhatsNewSeen, other = false): React.ReactElement => (
  <OverlayStackProvider>
    <Modal open={other} title="Another dialog" onDismiss={() => undefined} />
    <WhatsNewPrompt seen={seen} notes={NOTES} />
  </OverlayStackProvider>
)

const sheet = (): HTMLElement | null => screen.queryByRole("dialog", { name: "What's new" })

const pressEscape = (): void => {
  fireEvent.keyDown(document.body, { key: "Escape" })
}

const ClosableDialog = (): React.ReactElement => {
  const [open, setOpen] = useState(true)
  return (
    <Modal
      open={open}
      title="Top dialog"
      onDismiss={() => {
        setOpen(false)
      }}
    />
  )
}

beforeEach(() => {
  window.localStorage.clear()
  session.userId = ASHA
})

afterEach(() => {
  cleanup()
  unlockDevice()
  vi.restoreAllMocks()
})

describe("What's new prompt", () => {
  it("shows the newest notes to a user with no record", () => {
    render(tree(browserSeen()))

    expect(sheet()).not.toBeNull()
    expect(screen.getByText("Version 0.18.1")).not.toBeNull()
  })

  it.each([
    ["Done", (): void => { fireEvent.click(screen.getByRole("button", { name: "Done" })) }],
    ["Escape", pressEscape],
  ])("does not show them again to the same user after closing with %s and reloading", (_how, closeSheet) => {
    const first = render(tree(browserSeen()))
    expect(sheet()).not.toBeNull()
    act(closeSheet)
    expect(sheet()).toBeNull()
    first.unmount()

    render(tree(browserSeen()))

    expect(sheet()).toBeNull()
  })

  it("shows them to a different user on the same device", () => {
    const seen = browserSeen()
    const view = render(tree(seen))
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(sheet()).toBeNull()

    session.userId = RAVI
    view.rerender(tree(seen))

    expect(sheet()).not.toBeNull()
  })

  it("waits while another dialog is open, then shows", () => {
    const seen = browserSeen()
    const view = render(tree(seen, true))

    expect(screen.queryByRole("dialog", { name: "Another dialog" })).not.toBeNull()
    expect(sheet()).toBeNull()

    view.rerender(tree(seen, false))

    expect(sheet()).not.toBeNull()
  })

  it("closes only the top dialog on one Escape and keeps the notes open and unseen", () => {
    const seen = browserSeen()
    const stacked = (top: boolean): React.ReactElement => (
      <OverlayStackProvider>
        <WhatsNewPrompt seen={seen} notes={NOTES} />
        {top ? <ClosableDialog /> : null}
      </OverlayStackProvider>
    )
    const view = render(stacked(false))
    expect(sheet()).not.toBeNull()

    view.rerender(stacked(true))
    expect(screen.queryByRole("dialog", { name: "Top dialog" })).not.toBeNull()

    act(pressEscape)

    expect(screen.queryByRole("dialog", { name: "Top dialog" })).toBeNull()
    expect(sheet()).not.toBeNull()
    expect(seen.lastSeen("client", ASHA)).toBeNull()
  })

  it("waits while the device is locked, then shows", () => {
    lockDevice()
    render(tree(browserSeen()))

    expect(sheet()).toBeNull()

    act(() => {
      unlockDevice()
    })

    expect(sheet()).not.toBeNull()
  })

  it("shows at most once per run when storage throws", () => {
    const broken: SeenStorage = {
      getItem: () => {
        throw new Error("storage refused")
      },
      setItem: () => {
        throw new Error("storage refused")
      },
    }
    const seen = createWhatsNewSeen(() => broken)
    const first = render(tree(seen))
    expect(sheet()).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    expect(sheet()).toBeNull()
    first.unmount()

    render(tree(seen))

    expect(sheet()).toBeNull()
  })
})
