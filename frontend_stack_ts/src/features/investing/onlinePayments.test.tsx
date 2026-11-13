import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ApiError, TransportError } from "~/api/errors"
import type { HttpClient } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { ApiProvider } from "~/app/providers/ApiProvider"

import { useOnlinePaymentsOff } from "./onlinePayments"

const Probe = (): React.ReactElement => (
  <span data-testid="pay-actions">{useOnlinePaymentsOff() ? "hidden" : "shown"}</span>
)

const clientAnswering = (answer: () => Promise<unknown>): HttpClient => ({
  request: answer as unknown as HttpClient["request"],
})

const publishing = (config: unknown): HttpClient =>
  clientAnswering(() =>
    Promise.resolve({
      data: { version: 7, config, publishedAt: "2026-11-13T10:00:00.000Z" },
      meta: { requestId: "req-1", page: null },
    }),
  )

const mount = (api: HttpClient): QueryClient => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <Probe />
      </ApiProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

const settled = async (queryClient: QueryClient): Promise<void> => {
  await waitFor(() => {
    expect(queryClient.getQueryState(qk.app.config())?.status).not.toBe("pending")
  })
}

const payActions = (): string | null => screen.getByTestId("pay-actions").textContent

afterEach(() => {
  cleanup()
})

describe("online payments flag", () => {
  it("hides pay actions only when the published flag is exactly false", async () => {
    const queryClient = mount(publishing({ featureFlags: { onlinePayments: false } }))
    await settled(queryClient)

    expect(payActions()).toBe("hidden")
  })

  it.each([
    ["the flag is true", { featureFlags: { onlinePayments: true } }],
    ["the flag is absent", { featureFlags: { otherFlag: false } }],
    ["there are no feature flags", { maintenance: { enabled: false } }],
    ["nothing has been published", null],
    ["the flag is the text false", { featureFlags: { onlinePayments: "false" } }],
    ["the flags are not an object", { featureFlags: [false] }],
  ])("keeps pay actions when %s", async (_case, config) => {
    const queryClient = mount(publishing(config))
    await settled(queryClient)

    expect(queryClient.getQueryState(qk.app.config())?.status).toBe("success")
    expect(payActions()).toBe("shown")
  })

  it.each([
    ["the device is offline", new TransportError("offline", "No connection.")],
    [
      "the server fails",
      new ApiError({ code: "INTERNAL_ERROR", message: "failed", status: 500, retryable: true }),
    ],
  ])("keeps pay actions when the read fails because %s", async (_case, failure) => {
    const queryClient = mount(clientAnswering(() => Promise.reject(failure)))
    await settled(queryClient)

    expect(queryClient.getQueryState(qk.app.config())?.status).toBe("error")
    expect(payActions()).toBe("shown")
  })

  it("keeps pay actions while the read is still loading", () => {
    const queryClient = mount(clientAnswering(() => new Promise<never>(() => undefined)))

    expect(queryClient.getQueryState(qk.app.config())?.status).toBe("pending")
    expect(payActions()).toBe("shown")
  })
})
