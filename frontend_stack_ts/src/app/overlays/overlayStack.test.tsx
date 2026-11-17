import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useLayoutEffect, useState } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { Modal } from "~/app/overlays/Modal"
import { OverlayStackProvider, useOverlayStack } from "~/app/providers/OverlayStackProvider"
import type { OverlayStack } from "~/app/providers/OverlayStackProvider"

const RENDER_BUDGET = 12

afterEach(() => {
  cleanup()
  document.body.removeAttribute("data-be-scroll-locked")
  document.body.style.removeProperty("overflow")
})

const Probe = ({ seen }: Readonly<{ seen: OverlayStack[] }>): null => {
  const overlays = useOverlayStack()
  seen.push(overlays)
  if (seen.length > RENDER_BUDGET) {
    throw new Error(
      `overlay stack did not settle: ${String(seen.length)} context identities for one overlay`,
    )
  }
  return null
}

const tree = (seen: OverlayStack[], open: boolean): React.ReactElement => (
  <OverlayStackProvider>
    <Probe seen={seen} />
    <Modal open={open} title="One" onDismiss={() => undefined} />
  </OverlayStackProvider>
)

describe("overlay stack registration", () => {
  it("reaches a fixed point while an overlay is open", () => {
    const seen: OverlayStack[] = []
    render(tree(seen, true))

    expect(seen.length).toBeLessThanOrEqual(RENDER_BUDGET)
    expect(new Set(seen.map((overlays) => overlays.register)).size).toBe(1)
    expect(seen.at(-1)?.depth).toBe(1)
    expect(document.body.hasAttribute("data-be-scroll-locked")).toBe(true)
  })

  it("unwinds to an empty stack when the overlay closes", () => {
    const seen: OverlayStack[] = []
    const view = render(tree(seen, true))

    act(() => {
      view.rerender(tree(seen, false))
    })

    expect(seen.length).toBeLessThanOrEqual(RENDER_BUDGET)
    expect(seen.at(-1)?.depth).toBe(0)
    expect(document.body.hasAttribute("data-be-scroll-locked")).toBe(false)
  })
})

const EscapeOnCommit = ({ shown }: Readonly<{ shown: boolean[] }>): null => {
  useLayoutEffect(() => {
    shown.push(document.querySelector('[role="dialog"]') !== null)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }))
  }, [shown])
  return null
}

const ConfirmWithEarlyEscape = ({ shown }: Readonly<{ shown: boolean[] }>): React.ReactElement => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        Remove
      </button>
      <ConfirmDialog
        open={open}
        title="Remove this entry?"
        confirmLabel="Remove it"
        onConfirm={() => undefined}
        onCancel={() => {
          setOpen(false)
        }}
      />
      {open ? <EscapeOnCommit shown={shown} /> : null}
    </>
  )
}

describe("Escape right after a confirm opens", () => {
  it("closes the confirm when Escape arrives in the same commit that shows it", () => {
    const shown: boolean[] = []
    render(
      <OverlayStackProvider>
        <ConfirmWithEarlyEscape shown={shown} />
      </OverlayStackProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Remove" }))

    expect(shown).toEqual([true])
    expect(screen.queryByRole("dialog", { name: "Remove this entry?" })).toBeNull()
    expect(document.body.hasAttribute("data-be-scroll-locked")).toBe(false)
  })
})
