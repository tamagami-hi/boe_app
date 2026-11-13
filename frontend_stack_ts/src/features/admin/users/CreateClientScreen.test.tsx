import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, TransportError } from "~/api/errors"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import type { CreateAdminClientInput } from "~/features/admin/shared/adminQueries"

import CreateClientScreen from "./CreateClientScreen"

type Settle = Readonly<{ onSuccess?: () => void; onError?: (error: unknown) => void }>

const sent: CreateAdminClientInput[] = []
let nextFailure: unknown = null

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ hasAnyPermission: () => true }),
}))

vi.mock("~/features/admin/shared/adminQueries", () => ({
  useCreateAdminClient: () => ({
    mutate: (variables: CreateAdminClientInput, settle: Settle) => {
      sent.push(variables)
      settle.onError?.(nextFailure)
    },
    reset: () => undefined,
    isPending: false,
    data: undefined,
  }),
}))

const fill = (): void => {
  fireEvent.change(screen.getByLabelText(/Full name/u), { target: { value: "Asha Verma" } })
  fireEvent.change(screen.getByLabelText(/^Email/u), { target: { value: "asha@example.com" } })
  fireEvent.change(screen.getByLabelText(/^Phone/u), { target: { value: "+919876543210" } })
}

const submitReviewed = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Review the details" }))
  fireEvent.click(screen.getByRole("button", { name: /Create the account/u }))
}

const isLocked = (label: RegExp): boolean => screen.getByLabelText(label).hasAttribute("disabled")

const lastOf = (items: readonly HTMLElement[]): HTMLElement => {
  const item = items.at(-1)
  if (item === undefined) throw new Error("expected at least one element")
  return item
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  sent.length = 0
  nextFailure = null
  render(
    <MemoryRouter>
      <OverlayStackProvider>
        <CreateClientScreen />
      </OverlayStackProvider>
    </MemoryRouter>,
  )
  fill()
})

describe("reviewing a new client before anything is created", () => {
  it("sends nothing and locks the details until the admin confirms them", () => {
    fireEvent.click(screen.getByRole("button", { name: "Review the details" }))

    expect(sent).toHaveLength(0)
    expect(screen.getByText("+919876543210")).toBeTruthy()
    expect(isLocked(/^Email/u)).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Change the details" }))

    expect(sent).toHaveLength(0)
    expect(isLocked(/^Email/u)).toBe(false)
  })
})

describe("creating a client when the reply is lost", () => {
  it("holds the form and resends the very same key and body on Check again", () => {
    nextFailure = new TransportError("timeout", "The request timed out.")
    submitReviewed()

    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(isLocked(/^Email/u)).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))

    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(sent[0]?.idempotencyKey.length).toBeGreaterThan(8)
  })

  it("treats a gateway failure as unknown too, and does not unlock the form", () => {
    nextFailure = new ApiError({ code: "INTERNAL_ERROR", message: "Bad gateway", status: 502, retryable: true })
    submitReviewed()

    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(isLocked(/Full name/u)).toBe(true)
  })

  it("mints a new key only after the admin confirms a new attempt", () => {
    nextFailure = new TransportError("offline", "Unreachable")
    submitReviewed()
    fireEvent.click(screen.getByRole("button", { name: "Start a new attempt" }))
    fireEvent.click(lastOf(screen.getAllByRole("button", { name: "Start a new attempt" })))

    nextFailure = new ApiError({ code: "VALIDATION_FAILED", message: "Check the details", status: 400, retryable: false })
    submitReviewed()

    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey)
    expect({ ...sent[1], idempotencyKey: "" }).toEqual({ ...sent[0], idempotencyKey: "" })
  })
})

describe("creating a client when the server refuses", () => {
  it("unlocks the form, keeps the key for the same body, and changes it for a corrected one", () => {
    nextFailure = new ApiError({ code: "VALIDATION_FAILED", message: "Check the details", status: 400, retryable: false })
    submitReviewed()
    expect(screen.getByText("Not created")).toBeTruthy()
    expect(isLocked(/^Email/u)).toBe(false)

    submitReviewed()
    fireEvent.change(screen.getByLabelText(/^Email/u), { target: { value: "asha.verma@example.com" } })
    submitReviewed()

    expect(sent).toHaveLength(3)
    expect(sent[1]?.idempotencyKey).toBe(sent[0]?.idempotencyKey)
    expect(sent[2]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey)
  })
})
