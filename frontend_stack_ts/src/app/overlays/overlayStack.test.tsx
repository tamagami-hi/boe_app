import { act, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Modal } from "~/app/overlays/Modal"
import { OverlayStackProvider, useOverlayStack } from "~/app/providers/OverlayStackProvider"
import type { OverlayStack } from "~/app/providers/OverlayStackProvider"

const RENDER_BUDGET = 12

afterEach(() => {
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
