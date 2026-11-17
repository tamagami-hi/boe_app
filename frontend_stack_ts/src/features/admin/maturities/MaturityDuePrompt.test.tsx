import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"

import { MaturityDuePrompt } from "./MaturityDuePrompt"
import type * as MaturityQueries from "./maturityQueries"
import type { DueMaturities } from "./maturityQueries"

type DateBody = Readonly<{ fundId: string; maturityDate: string }>

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1"
const PROMPT = "Maturities need your decision"

const DUE: DueMaturities = { asOf: "2026-11-17", dueThrough: "2026-12-17", windowDays: 30, total: 1, items: [] }

const dueRead = vi.hoisted((): { data: DueMaturities | undefined } => ({ data: undefined }))
let replies: (() => Promise<string>)[] = []

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({
    principal: { userId: ADMIN_ID },
    hasAnyPermission: (required: readonly string[]) => required.includes("client_values.read"),
  }),
}))

vi.mock("./maturityQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof MaturityQueries>()),
  useDueMaturities: () => ({
    data: dueRead.data,
    error: null,
    isError: false,
    isPending: dueRead.data === undefined,
    isFetching: false,
    refetch: () => undefined,
  }),
}))

const timedOut = (): Promise<string> => Promise.reject(new TransportError("timeout", "The request timed out."))

const HeldDateForm = (): React.ReactElement => {
  const write = useHeldWrite<DateBody, string>(
    useMutation({ mutationFn: () => (replies.shift() ?? timedOut)() }),
    "The date could not be sent.",
  )
  return (
    <>
      <button
        type="button"
        onClick={() => {
          write.submit({ fundId: "balanced", maturityDate: "2026-12-01" })
        }}
      >
        Set the date
      </button>
      <button type="button" onClick={write.checkAgain}>
        Check again
      </button>
      <p>{`outcome:${write.outcome.kind}`}</p>
    </>
  )
}

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })

const tree = (): React.ReactElement => (
  <MemoryRouter>
    <QueryClientProvider client={queryClient}>
      <OverlayStackProvider>
        <HeldDateForm />
        <MaturityDuePrompt dismissed={false} onDismiss={() => undefined} />
      </OverlayStackProvider>
    </QueryClientProvider>
  </MemoryRouter>
)

const prompt = (): HTMLElement | null => screen.queryByRole("dialog", { name: PROMPT })

beforeEach(() => {
  dueRead.data = undefined
  replies = []
})

afterEach(() => {
  cleanup()
})

describe("the console maturity prompt and a held admin write", () => {
  it("does not open over a held form while its outcome is unknown, and opens once the write settles", async () => {
    const view = render(tree())
    fireEvent.click(screen.getByRole("button", { name: "Set the date" }))
    await screen.findByText("outcome:unknown")

    dueRead.data = DUE
    view.rerender(tree())
    await act(() => Promise.resolve())

    expect(prompt()).toBeNull()

    replies = [() => Promise.resolve("saved")]
    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    await screen.findByText("outcome:done")

    expect(await screen.findByRole("dialog", { name: PROMPT })).not.toBeNull()
  })
})
