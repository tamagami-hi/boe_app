import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "~/api/errors"
import type { HttpClient } from "~/api/http"
import { ApiProvider } from "~/app/providers/ApiProvider"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import { WithdrawalPayoutPanel } from "./WithdrawalPayoutPanel"

const ADMIN_ID = "a1a1a1a1-0000-4000-8000-000000000001"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const FUND_ID = "22222222-2222-4222-8222-222222222222"
const PAID_ID = "44444444-4444-4444-8444-444444444441"
const FAILED_ID = "44444444-4444-4444-8444-444444444442"
const PENDING_ID = "44444444-4444-4444-8444-444444444443"
const OUTCOMES = "listAdminWithdrawalPayoutOutcomes"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ principal: { userId: ADMIN_ID }, scope: "admin", hasAnyPermission: () => true }),
}))

type State = "pending" | "paid" | "failed"
type Operation = Readonly<{ operationId: string }>
type Options = Readonly<{ body?: unknown }>
type Reply = Readonly<{ data: unknown; meta: Readonly<{ requestId: string; page: null }> }>

const payout = (id: string, state: State) => ({
  id,
  userId: USER_ID,
  fundId: FUND_ID,
  ledgerEntryId: id.replace(/^4/u, "5"),
  state,
  amountPaise: "200000",
  growthPortionPaise: "100000",
  principalPortionPaise: "100000",
  effectiveDate: "2026-10-02",
  transferReference: null,
  failureCode: state === "failed" ? "bank_rejected" : null,
  version: "1",
  createdAt: "2026-10-02T05:00:00.000Z",
})

const replyOf = (data: unknown): Reply => ({ data, meta: { requestId: "req", page: null } })

const calls: string[] = []
const sent: unknown[] = []

const renderCards = (outcomes: () => Promise<Reply>): void => {
  const request = (operation: Operation, options?: Options): Promise<Reply> => {
    calls.push(operation.operationId)
    if (operation.operationId === OUTCOMES) return outcomes()
    if (operation.operationId === "updateAdminWithdrawalPayout") {
      sent.push(options?.body)
      return Promise.resolve(replyOf({ payoutId: PENDING_ID, state: "paid" }))
    }
    return Promise.reject(new Error(`unexpected ${operation.operationId}`))
  }
  const api = { request: request as unknown as HttpClient["request"] } satisfies HttpClient
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ApiProvider value={api}>
          <OverlayStackProvider>
            {[payout(PAID_ID, "paid"), payout(FAILED_ID, "failed"), payout(PENDING_ID, "pending")].map((row) => (
              <WithdrawalPayoutPanel
                key={row.id}
                payout={row}
                investorLabel="Asha Verma"
                fundName="Balanced Fund"
                canWrite
                onReload={() => undefined}
              />
            ))}
          </OverlayStackProvider>
        </ApiProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  calls.length = 0
  sent.length = 0
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe("a payout card's outcome date", () => {
  it("shows the paid and failed dates in India time from one read, and nothing extra while it loads", async () => {
    let answer: (reply: Reply) => void = () => undefined
    renderCards(
      () =>
        new Promise<Reply>((resolve) => {
          answer = resolve
        }),
    )

    await waitFor(() => {
      expect(calls).toEqual([OUTCOMES])
    })
    expect(screen.queryByText(/ on \d/u)).toBeNull()
    expect(screen.queryByText(/date unavailable/u)).toBeNull()

    answer(
      replyOf({
        userId: USER_ID,
        items: [
          { payoutId: PENDING_ID, state: "pending", paidAt: null, failedAt: null },
          { payoutId: FAILED_ID, state: "failed", paidAt: null, failedAt: "2026-11-15T19:00:00.000Z" },
          { payoutId: PAID_ID, state: "paid", paidAt: "2026-11-16T20:00:00.000Z", failedAt: null },
        ],
      }),
    )

    expect(await screen.findByText("Paid on 17 Nov 2026")).toBeTruthy()
    expect(screen.getByText("Failed on 16 Nov 2026")).toBeTruthy()
    expect(screen.getAllByText(/ on \d/u)).toHaveLength(2)
    expect(screen.getByText("Awaiting transfer confirmation")).toBeTruthy()
    expect(calls).toEqual([OUTCOMES])
  })

  it("says the date is unavailable when the read is refused, and the pending card's outcome form still records", async () => {
    renderCards(() =>
      Promise.reject(new ApiError({ code: "RESOURCE_NOT_FOUND", message: "Not found.", status: 404, retryable: false })),
    )

    expect(await screen.findByText("Paid date unavailable")).toBeTruthy()
    expect(screen.getByText("Failure date unavailable")).toBeTruthy()
    expect(screen.queryByText(/ on \d/u)).toBeNull()
    expect(screen.getAllByText(/date unavailable/u)).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "Record transfer outcome" }))
    fireEvent.click(screen.getByRole("button", { name: "Mark paid" }))
    await waitFor(() => {
      expect(sent).toEqual([{ state: "paid", expectedVersion: 1 }])
    })
  })
})
