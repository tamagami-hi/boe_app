import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, TransportError } from "~/api/errors"

import ClientEraseScreen from "./ClientEraseScreen"
import type * as ErasureQueries from "./erasureQueries"
import type { ErasureCheck, ErasureInput } from "./erasureQueries"

type Settle = Readonly<{ onSuccess?: (outcome: unknown) => void; onError?: (error: unknown) => void }>
type Reply = Readonly<{ kind: "fail"; error: unknown }> | Readonly<{ kind: "succeed" }>

const USER_ID = "7f3c2b1a-0d9e-4f8a-9b7c-6d5e4f3a2b1c"
const ERASABLE: ErasureCheck = {
  userId: USER_ID,
  state: "erasable",
  fullName: "Asha Verma",
  emailVerified: true,
  path: "kept_as_record",
  keptBecause: "email_verified",
  blockers: [],
  erasedAt: null,
}

const sent: ErasureInput[] = []
let replies: Reply[] = []
let checkQuery: Readonly<{ data: ErasureCheck | undefined; error: unknown; isPending: boolean }> = {
  data: ERASABLE,
  error: null,
  isPending: false,
}

vi.mock("./erasureQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof ErasureQueries>()),
  useClientErasureCheck: () => ({ ...checkQuery, isFetching: false, refetch: () => Promise.resolve() }),
  useEraseClient: () => ({
    isPending: false,
    mutate: (variables: ErasureInput, settle: Settle) => {
      sent.push(variables)
      const reply = replies.shift() ?? { kind: "succeed" }
      if (reply.kind === "fail") {
        settle.onError?.(reply.error)
        return
      }
      settle.onSuccess?.({
        userId: USER_ID,
        outcome: "erased",
        path: variables.expectedPath,
        keptBecause: "email_verified",
        erasedAt: "2026-11-14T10:00:00.000Z",
      })
    },
  }),
}))

const conflict = new ApiError({
  code: "STATE_CONFLICT",
  status: 409,
  retryable: false,
  message: "What erasure would do for this client changed since you checked.",
})

const confirmation = (): HTMLInputElement => screen.getByLabelText(/Type ERASE to confirm/u)
const eraseButton = (): HTMLElement => screen.getByRole("button", { name: "Erase client" })
const type = (text: string): void => {
  fireEvent.change(confirmation(), { target: { value: text } })
}

beforeEach(() => {
  sent.length = 0
  replies = []
  checkQuery = { data: ERASABLE, error: null, isPending: false }
})

afterEach(() => {
  cleanup()
})

const renderScreen = (): void => {
  render(
    <MemoryRouter initialEntries={[`/users/${USER_ID}/erase`]}>
      <Routes>
        <Route path="/users/:userId/erase" element={<ClientEraseScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("erasing a client", () => {
  it("sends nothing until ERASE is typed exactly", () => {
    renderScreen()
    expect(eraseButton().hasAttribute("disabled")).toBe(true)
    type("erase")
    expect(eraseButton().hasAttribute("disabled")).toBe(true)
    type("ERASE")
    expect(eraseButton().hasAttribute("disabled")).toBe(false)
    fireEvent.click(eraseButton())
    expect(sent).toEqual([{ expectedPath: "kept_as_record", idempotencyKey: expect.any(String) as string }])
  })

  it("keeps the held key when the reply is lost and replays exactly that request", () => {
    replies = [{ kind: "fail", error: new TransportError("timeout", "The request timed out.") }, { kind: "succeed" }]
    renderScreen()
    type("ERASE")
    fireEvent.click(eraseButton())
    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(eraseButton().hasAttribute("disabled")).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Check again" }))

    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(screen.getByText(/Client erased/u)).toBeTruthy()
  })

  it("clears the typed confirmation after a refusal, so a changed outcome must be confirmed again", () => {
    replies = [{ kind: "fail", error: conflict }]
    renderScreen()
    type("ERASE")
    fireEvent.click(eraseButton())
    expect(screen.getByText("Nothing changed")).toBeTruthy()
    expect(confirmation().value).toBe("")
    expect(eraseButton().hasAttribute("disabled")).toBe(true)
    type("ERASE")
    fireEvent.click(eraseButton())
    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey)
  })

  it("shows a failed check as an error with retry and offers no erase action", () => {
    checkQuery = {
      data: undefined,
      isPending: false,
      error: new ApiError({ code: "INTERNAL_ERROR", status: 500, retryable: true, message: "boom" }),
    }
    renderScreen()
    expect(screen.queryByRole("button", { name: "Erase client" })).toBeNull()
    expect(screen.queryByLabelText(/Type ERASE to confirm/u)).toBeNull()
    expect(screen.getByRole("button", { name: /Try again/u })).toBeTruthy()
  })
})
