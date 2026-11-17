import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WhatsNewEntry } from "./whatsNewEntry"
import { WhatsNewNotes } from "./WhatsNewNotes"

const native = vi.hoisted(() => ({ value: false }))

vi.mock("~/platform/capacitor", () => ({ isNative: () => native.value }))

const ENTRY: WhatsNewEntry = {
  id: "0.18.1",
  sections: [
    {
      heading: "New",
      items: [
        { text: "Shared line." },
        { text: "Web line.", platform: "web" },
        { text: "Android line.", platform: "android" },
      ],
    },
    { heading: "Fixed", items: [{ text: "Android fix.", platform: "android" }] },
  ],
}

afterEach(() => {
  cleanup()
  native.value = false
})

describe("What's new platform filter", () => {
  it("hides Android items on the web", () => {
    render(<WhatsNewNotes entry={ENTRY} />)

    expect(screen.queryByText("Android line.")).toBeNull()
    expect(screen.queryByText("Fixed")).toBeNull()
    expect(screen.getByText("Web line.")).not.toBeNull()
    expect(screen.getByText("Shared line.")).not.toBeNull()
  })

  it("hides web items in the Android app", () => {
    native.value = true
    render(<WhatsNewNotes entry={ENTRY} />)

    expect(screen.queryByText("Web line.")).toBeNull()
    expect(screen.getByText("Android line.")).not.toBeNull()
    expect(screen.getByText("Shared line.")).not.toBeNull()
  })
})
