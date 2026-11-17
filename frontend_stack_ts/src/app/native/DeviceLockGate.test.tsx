import { readFileSync } from "node:fs"
import { join } from "node:path"

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DeviceLockGate } from "~/app/native/DeviceLockGate"
import { lockDevice, unlockDevice } from "~/app/native/deviceLock"
import { Modal } from "~/app/overlays/Modal"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ signedOut: () => undefined }),
}))

const TOKENS = readFileSync(join("src", "ui", "tokens", "tokens-core.css"), "utf8")

const layerOf = (element: HTMLElement): number => {
  const layer = /(?:^|\s)z-([a-z]+)(?:\s|$)/u.exec(element.className)?.[1]
  if (layer === undefined) throw new Error(`no z layer on ${element.className}`)
  const value = new RegExp(`--be-z-${layer}:\\s*(\\d+);`, "u").exec(TOKENS)?.[1]
  if (value === undefined) throw new Error(`no --be-z-${layer} token`)
  return Number(value)
}

const bodyLayerOf = (element: HTMLElement): HTMLElement => {
  let node: HTMLElement = element
  while (node.parentElement !== null && node.parentElement !== document.body) node = node.parentElement
  return node
}

const Statement = ({ late = false, onDismiss = () => undefined }: Readonly<{ late?: boolean; onDismiss?: () => void }>): React.ReactElement => (
  <OverlayStackProvider>
    <DeviceLockGate>
      <Modal open title="Holding statement" onDismiss={onDismiss}>
        <p>Current value 12,40,000.00</p>
      </Modal>
      <Modal open={late} title="Maturities need your decision" onDismiss={() => undefined}>
        <button type="button">Open maturities</button>
      </Modal>
    </DeviceLockGate>
  </OverlayStackProvider>
)

const appRoot = (): HTMLElement => {
  const root = document.createElement("div")
  root.id = "root"
  return document.body.appendChild(root)
}

const dialog = (name: string): HTMLElement => screen.getByRole("dialog", { name, hidden: true })

const lock = (): void => {
  act(() => {
    lockDevice()
  })
}

afterEach(() => {
  cleanup()
  unlockDevice()
  document.body.replaceChildren()
})

describe("locking the app while a dialog is open", () => {
  it("puts the lock screen beside the dialog's portal and above it, not inside the app root", () => {
    const { container } = render(<Statement />, { container: appRoot() })
    const dialogLayer = bodyLayerOf(dialog("Holding statement"))

    lock()

    const lockLayer = dialog("BeOnEdge is locked")
    expect(container.contains(lockLayer)).toBe(false)
    expect(lockLayer.parentElement).toBe(document.body)
    expect(dialogLayer.parentElement).toBe(document.body)
    expect(layerOf(lockLayer)).toBeGreaterThan(layerOf(dialogLayer))
  })

  it("ignores Escape while locked, so the dialog under the lock stays open", () => {
    const dismissed = vi.fn()
    render(<Statement onDismiss={dismissed} />, { container: appRoot() })

    lock()
    fireEvent.keyDown(document.body, { key: "Escape" })

    expect(dismissed).not.toHaveBeenCalled()
    expect(dialog("Holding statement")).toBeInTheDocument()
  })

  it("moves focus into the lock, makes the app and its dialogs inert, keeps a dialog opened while locked from taking focus, and gives focus back on unlock", () => {
    const view = render(<Statement />, { container: appRoot() })
    const before = document.activeElement
    expect(before).not.toBe(document.body)

    lock()

    const lockLayer = dialog("BeOnEdge is locked")
    expect(document.activeElement).toBe(lockLayer)
    expect(view.container).toHaveAttribute("inert")
    expect(bodyLayerOf(dialog("Holding statement"))).toHaveAttribute("inert")

    view.rerender(<Statement late />)

    expect(bodyLayerOf(dialog("Maturities need your decision"))).toHaveAttribute("inert")
    expect(document.activeElement).toBe(lockLayer)

    act(() => {
      unlockDevice()
    })

    expect(view.container).not.toHaveAttribute("inert")
    expect(bodyLayerOf(dialog("Holding statement"))).not.toHaveAttribute("inert")
    expect(document.activeElement).toBe(before)
  })
})
