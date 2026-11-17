import { readFileSync } from "node:fs"
import { join } from "node:path"

import { act, cleanup, render, screen } from "@testing-library/react"
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

afterEach(() => {
  cleanup()
  unlockDevice()
})

describe("locking the app while a dialog is open", () => {
  it("puts the lock screen beside the dialog's portal and above it, not inside the app root", () => {
    const { container } = render(
      <OverlayStackProvider>
        <DeviceLockGate>
          <Modal open title="Holding statement" onDismiss={() => undefined}>
            <p>Current value 12,40,000.00</p>
          </Modal>
        </DeviceLockGate>
      </OverlayStackProvider>,
    )
    const dialogLayer = bodyLayerOf(screen.getByRole("dialog", { name: "Holding statement" }))

    act(() => {
      lockDevice()
    })

    const lockLayer = screen.getByRole("dialog", { name: "BeOnEdge is locked" })
    expect(container.contains(lockLayer)).toBe(false)
    expect(lockLayer.parentElement).toBe(document.body)
    expect(dialogLayer.parentElement).toBe(document.body)
    expect(layerOf(lockLayer)).toBeGreaterThan(layerOf(dialogLayer))
  })
})
