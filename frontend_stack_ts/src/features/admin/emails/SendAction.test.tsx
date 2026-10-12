import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ApiError, TransportError } from "~/api/errors"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import { SendAction, type SendReceipt } from "./SendAction"

const keys: string[] = []
let failures: Error[] = []

const QUEUED: SendReceipt = { title: "Email queued", detail: "Queued for m***@example.com." }

const send = (idempotencyKey: string): Promise<SendReceipt> => {
  keys.push(idempotencyKey)
  const failure = failures.shift()
  return failure === undefined ? Promise.resolve(QUEUED) : Promise.reject(failure)
}

const lastOf = (items: readonly HTMLElement[]): HTMLElement => {
  const item = items.at(-1)
  if (item === undefined) throw new Error("expected at least one element")
  return item
}

const confirmSend = async (): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: "Send to client" }))
  fireEvent.click(await screen.findByRole("button", { name: "Send the email" }))
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  keys.length = 0
  failures = []
  render(
    <MemoryRouter>
      <OverlayStackProvider>
        <SendAction
          label="Send to client"
          disabled={false}
          confirmTitle="Send this email?"
          confirmLabel="Send the email"
          confirmBody="To Meera"
          request={{ templateId: "t", revision: 1, userId: "u", expectedEmailRevision: "1" }}
          send={send}
        />
      </OverlayStackProvider>
    </MemoryRouter>,
  )
})

describe("sending when the reply is lost", () => {
  it("sends nothing until the admin confirms", () => {
    fireEvent.click(screen.getByRole("button", { name: "Send to client" }))

    expect(keys).toEqual([])
  })

  it("resends the very same key on Check again, never a new one", async () => {
    failures = [new TransportError("timeout", "The request timed out."), new ApiError({ code: "IDEMPOTENCY_IN_PROGRESS", message: "busy", status: 409, retryable: true })]
    await confirmSend()
    await screen.findByText("Not confirmed")

    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    await waitFor(() => {
      expect(keys).toHaveLength(2)
    })
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }))

    await screen.findByText("Email queued")
    expect(new Set(keys).size).toBe(1)
  })

  it("uses a new key only after the admin confirms a new attempt", async () => {
    failures = [new TransportError("timeout", "The request timed out.")]
    await confirmSend()
    await screen.findByText("Not confirmed")

    fireEvent.click(screen.getByRole("button", { name: "Start a new attempt" }))
    fireEvent.click(lastOf(await screen.findAllByRole("button", { name: "Start a new attempt" })))
    await confirmSend()

    await screen.findByText("Email queued")
    expect(keys).toHaveLength(2)
    expect(keys[1]).not.toBe(keys[0])
  })

  it("shows a refusal plainly and lets the admin try again", async () => {
    failures = [new ApiError({ code: "STATE_CONFLICT", message: "This template changed after you previewed it.", status: 409, retryable: false })]
    await confirmSend()

    expect(await screen.findByText("This template changed after you previewed it.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Send to client" }).hasAttribute("disabled")).toBe(false)
  })
})
