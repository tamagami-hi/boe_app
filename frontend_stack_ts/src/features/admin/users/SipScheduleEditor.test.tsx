import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import type { HttpClient } from "~/api/http"
import { ApiProvider } from "~/app/providers/ApiProvider"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import type { AdminSipScheduleItem } from "~/features/admin/client-values/sipScheduleQueries"

import { SipScheduleEditor } from "./SipScheduleEditor"

const USER_ID = "11111111-1111-4111-8111-111111111111"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ principal: { userId: "a1a1a1a1-0000-4000-8000-000000000001" }, hasAnyPermission: () => true }),
}))

const SCHEDULE: AdminSipScheduleItem = {
  scheduleId: "33333333-3333-4333-8333-333333333333",
  userId: USER_ID,
  clientName: "Asha Verma",
  fundId: "22222222-2222-4222-8222-222222222222",
  fundName: "Balanced Fund",
  monthlyAmountPaise: "500000",
  startMonth: "2026-01",
  endMonth: "2026-12",
  monthCount: 12,
  state: "active",
  version: 3,
  monthsPaid: 2,
  monthsDue: 10,
  nextUnpaidMonth: "2026-03",
  paidMonths: ["2026-01", "2026-02"],
  createdAt: "2026-01-01T05:00:00.000Z",
  updatedAt: "2026-01-01T05:00:00.000Z",
  closedAt: null,
}

const sentKeys: (string | undefined)[] = []

const request = (operation: Readonly<{ method: string }>, options?: Readonly<{ idempotencyKey?: string }>): Promise<unknown> => {
  if (operation.method === "GET") return Promise.resolve({ data: { items: [SCHEDULE] }, meta: { requestId: "req", page: null } })
  sentKeys.push(options?.idempotencyKey)
  return Promise.reject(new TransportError("timeout", "The request timed out."))
}

const api = { request: request as unknown as HttpClient["request"] } satisfies HttpClient

afterEach(() => {
  cleanup()
  sentKeys.length = 0
})

describe("the SIP schedule editor's Done while a change is not confirmed", () => {
  it("stays disabled, so the editor cannot unmount and drop the held key", async () => {
    const onClose = vi.fn()
    const onHoldChange = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider value={api}>
          <OverlayStackProvider>
            <SipScheduleEditor userId={USER_ID} schedule={SCHEDULE} onReload={vi.fn()} onClose={onClose} onHoldChange={onHoldChange} />
          </OverlayStackProvider>
        </ApiProvider>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText(/^Monthly amount in rupees/u), { target: { value: "6000" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await screen.findByText("Not confirmed")

    const done = screen.getByRole("button", { name: "Done" })
    expect(done.hasAttribute("disabled")).toBe(true)
    fireEvent.click(done)
    expect(onClose).not.toHaveBeenCalled()
    expect(onHoldChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    await waitFor(() => {
      expect(sentKeys).toHaveLength(2)
    })
    expect(sentKeys[0]).toBeDefined()
    expect(sentKeys[1]).toBe(sentKeys[0])
  })
})
