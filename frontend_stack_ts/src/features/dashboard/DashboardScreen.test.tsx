import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import type { HttpClient } from "~/api/http"
import { ApiProvider } from "~/app/providers/ApiProvider"
import DashboardScreen from "~/features/dashboard/DashboardScreen"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({
    principal: { userId: "11111111-1111-4111-8111-111111111111", fullName: "Asha Rao" },
  }),
}))

const SIP_READ = "listClientSips"

afterEach(() => {
  cleanup()
})

describe("the dashboard SIP plans row", () => {
  it("shows a failed SIP read as an error with retry, never as having no SIP plans", async () => {
    const sipReads: string[] = []
    const api: HttpClient = {
      request: (operation) => {
        if (operation.operationId !== SIP_READ) return new Promise<never>(() => undefined)
        sipReads.push(operation.operationId)
        return Promise.reject(new TransportError("offline", "The SIP read failed."))
      },
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider value={api}>
          <MemoryRouter>
            <DashboardScreen />
          </MemoryRouter>
        </ApiProvider>
      </QueryClientProvider>,
    )

    const failure = await screen.findByText(/Couldn.t check/u)
    const row = screen.getByText("SIP plans").parentElement
    if (row === null) throw new Error("The SIP plans label has no row.")
    expect(row).toContainElement(failure)
    expect(screen.queryByRole("link", { name: "Manage SIPs" })).toBeNull()

    fireEvent.click(within(row).getByRole("button", { name: "Try again" }))
    await waitFor(() => {
      expect(sipReads).toHaveLength(2)
    })
  })
})
