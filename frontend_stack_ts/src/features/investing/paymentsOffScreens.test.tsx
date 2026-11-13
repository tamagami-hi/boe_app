import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import type { ComponentType } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { HttpClient } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { ApiProvider } from "~/app/providers/ApiProvider"
import LumpsumInvestScreen from "~/features/orders/LumpsumInvestScreen"
import SipStartScreen from "~/features/sip/SipStartScreen"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({
    principal: { userId: "11111111-1111-4111-8111-111111111111", fullName: "Asha Rao" },
  }),
}))

const FUND_ID = "22222222-2222-4222-8222-222222222222"

const FUND = {
  fund: {
    id: FUND_ID,
    name: "Steady Growth Pool",
    category: "Equity",
    minimumPurchasePaise: "100000",
    minimumSipPaise: "50000",
  },
  disclosure: null,
  stocks: [],
}

const silentApi: HttpClient = {
  request: () => new Promise<never>(() => undefined),
}

const mount = (Screen: ComponentType, path: string, config: unknown): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(qk.app.config(), {
    version: 4,
    config,
    publishedAt: "2026-11-13T10:00:00.000Z",
  })
  queryClient.setQueryData(qk.client.fund(FUND_ID), FUND)
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={silentApi}>
        <MemoryRouter initialEntries={[path.replace(":fundId", FUND_ID)]}>
          <Routes>
            <Route path={path} element={<Screen />} />
          </Routes>
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

const SCREENS = [
  ["lump sum", LumpsumInvestScreen, "/funds/:fundId/invest/lumpsum", "Continue to PhonePe"],
  ["SIP", SipStartScreen, "/funds/:fundId/invest/sip", "Create the SIP"],
] as const

afterEach(() => {
  cleanup()
})

describe.each(SCREENS)("the %s screen", (_name, Screen, path, submitLabel) => {
  it("offers no amount entry or submit while online payments are off", () => {
    mount(Screen, path, { featureFlags: { onlinePayments: false } })

    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button", { name: submitLabel })).toBeNull()
    expect(screen.getByRole("link", { name: "See my portfolio" })).toBeTruthy()
  })

  it("keeps the amount entry and submit when the flag is not published", () => {
    mount(Screen, path, { featureFlags: {} })

    expect(screen.getByRole("textbox")).toBeTruthy()
    expect(screen.getByRole("button", { name: submitLabel })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "See my portfolio" })).toBeNull()
  })
})
