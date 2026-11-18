import { QueryClientProvider, onlineManager, useMutation } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import { createQueryClient } from "~/app/providers/QueryProvider"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"

type Body = Readonly<{ question: string }>
type Attempt = Body & Readonly<{ idempotencyKey: string }>

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ principal: { userId: "00000000-0000-4000-8000-0000000000a1" } }),
}))

const lost = (): Promise<string> =>
  Promise.reject(new TransportError("offline", "BeOnEdge could not be reached."))
const recorded = (): Promise<string> => Promise.resolve("recorded")

const openHeldForm = (sent: Attempt[], replies: (() => Promise<string>)[]) => {
  const client = createQueryClient()
  const wrapper = ({ children }: Readonly<{ children: ReactNode }>): ReactNode => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () =>
      useHeldWrite<Body, string>(
        useMutation({
          mutationFn: (attempt: Attempt) => {
            sent.push(attempt)
            return (replies.shift() ?? lost)()
          },
        }),
        "The question could not be sent.",
      ),
    { wrapper },
  )
}

afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
})

describe("a write made while the browser reports offline", () => {
  it("is held as not confirmed, is not sent again when the connection returns, and is resent with its key only on Check again", async () => {
    const sent: Attempt[] = []
    const form = openHeldForm(sent, [lost, recorded])
    act(() => {
      onlineManager.setOnline(false)
    })

    act(() => {
      form.result.current.submit({ question: "How are returns shown?" })
    })
    await waitFor(() => {
      expect(form.result.current.outcome.kind).toBe("unknown")
    })
    expect(sent).toHaveLength(1)

    await act(async () => {
      onlineManager.setOnline(true)
      await Promise.resolve()
    })
    expect(sent).toHaveLength(1)
    expect(form.result.current.outcome.kind).toBe("unknown")
    expect(form.result.current.held).toEqual({ question: "How are returns shown?" })

    act(() => {
      form.result.current.checkAgain()
    })
    await waitFor(() => {
      expect(form.result.current.outcome.kind).toBe("done")
    })
    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).toBe(sent[0]?.idempotencyKey)
  })
})
