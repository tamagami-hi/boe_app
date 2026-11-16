import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"

import { useHeldWrite } from "./useHeldWrite"
import type { HeldWritePersistence } from "./useHeldWrite"

type Body = Readonly<{ fundId: string; amountPaise: string }>
type Attempt = Body & Readonly<{ idempotencyKey: string }>

const sent: Attempt[] = []
let replies: (() => Promise<string>)[] = []

const parseBody = (value: unknown): Body | null => {
  if (typeof value !== "object" || value === null) return null
  const { fundId, amountPaise } = value as Readonly<Record<string, unknown>>
  return typeof fundId === "string" && typeof amountPaise === "string" ? { fundId, amountPaise } : null
}

const PERSIST: HeldWritePersistence<Body> = { slot: "record:asha:balanced", parseBody }

const timedOut = (): Promise<string> => Promise.reject(new TransportError("timeout", "The request timed out."))
const recorded = (): Promise<string> => Promise.resolve("recorded")

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })

const wrapper = ({ children }: Readonly<{ children: ReactNode }>): ReactNode => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
)

const openForm = () =>
  renderHook(
    () =>
      useHeldWrite<Body, string>(
        useMutation({
          mutationFn: (attempt: Attempt) => {
            sent.push(attempt)
            return (replies.shift() ?? timedOut)()
          },
        }),
        "The investment could not be sent.",
        PERSIST,
      ),
    { wrapper },
  )

beforeEach(() => {
  sent.length = 0
  replies = []
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("a persisted held write", () => {
  it("survives the form closing and reopening, and Check again resends the same key", async () => {
    replies = [timedOut]
    const form = openForm()
    act(() => {
      form.result.current.submit({ fundId: "balanced", amountPaise: "500000" })
    })
    await waitFor(() => {
      expect(form.result.current.outcome.kind).toBe("unknown")
    })
    expect(form.result.current.persisted).toBe(true)
    form.unmount()

    replies = [recorded]
    const reopened = openForm()
    expect(reopened.result.current.outcome.kind).toBe("unknown")
    expect(reopened.result.current.held).toMatchObject({ fundId: "balanced", amountPaise: "500000" })
    expect(reopened.result.current.persisted).toBe(true)
    act(() => {
      reopened.result.current.checkAgain()
    })
    await waitFor(() => {
      expect(reopened.result.current.outcome.kind).toBe("done")
    })

    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(sent[0]?.idempotencyKey.length).toBeGreaterThan(8)
    expect(window.sessionStorage.length).toBe(0)
    expect(reopened.result.current.persisted).toBe(false)
  })

  it("reports the hold as not persisted when the tab refuses to store it", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
    })
    replies = [timedOut]
    const form = openForm()
    act(() => {
      form.result.current.submit({ fundId: "balanced", amountPaise: "500000" })
    })
    await waitFor(() => {
      expect(form.result.current.outcome.kind).toBe("unknown")
    })

    expect(form.result.current.held).toMatchObject({ fundId: "balanced", amountPaise: "500000" })
    expect(form.result.current.persisted).toBe(false)
  })
})
