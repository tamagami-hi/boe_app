import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useEffect, useState } from "react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import type { HttpClient } from "~/api/http"
import { ApiProvider } from "~/app/providers/ApiProvider"
import type { RouteManifest } from "~/app/routing/routeManifest"
import { useEmailVerificationStatus } from "~/features/profile/EmailVerificationStatus"
import { ClientRoutes } from "~/shells/client/ClientRoutes"

const ELIGIBILITY_READ = "getClientEligibility"

const draft = vi.hoisted(() => ({ path: "/draft", mounts: 0 }))

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({
    status: "authenticated",
    principal: {
      userId: "11111111-1111-4111-8111-111111111111",
      fullName: "Asha Rao",
      email: "asha@example.com",
      roles: ["client"],
      permissions: [],
      accountState: "active",
    },
    hasRole: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}))

vi.mock("~/app/routing/clientRoutes", (): Readonly<{
  CLIENT_SPLASH_PATH: string
  CLIENT_ROUTES: RouteManifest
}> => ({
  CLIENT_SPLASH_PATH: draft.path,
  CLIENT_ROUTES: [
    {
      id: "draft",
      path: draft.path,
      title: "Draft",
      access: "session",
      element: () => Promise.resolve({ default: DraftScreen }),
      back: { kind: "exit" },
    },
  ],
}))

const DraftScreen = (): React.ReactElement => {
  const [amount, setAmount] = useState("")
  const emailStatus = useEmailVerificationStatus()

  useEffect(() => {
    draft.mounts += 1
  }, [])

  return (
    <main>
      <p>{emailStatus}</p>
      <label>
        Amount
        <input
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value)
          }}
        />
      </label>
    </main>
  )
}

const VERIFIED_ELIGIBILITY = {
  data: {
    eligibility: "eligible",
    reason: null,
    canInvest: true,
    emailVerificationState: "verified",
    evaluatedAt: "2026-11-16T09:00:00.000Z",
  },
  meta: {},
}

afterEach(() => {
  cleanup()
})

describe("the client router", () => {
  it("keeps the open screen and its draft mounted while eligibility fails and is read again", async () => {
    const service = { isAnswering: false, eligibilityReads: 0 }
    const request = (operation: Readonly<{ operationId: string }>): Promise<unknown> => {
      if (operation.operationId !== ELIGIBILITY_READ) return new Promise<never>(() => undefined)
      service.eligibilityReads += 1
      if (!service.isAnswering) {
        return Promise.reject(new TransportError("offline", "The eligibility read failed."))
      }
      return Promise.resolve(VERIFIED_ELIGIBILITY)
    }
    const api: HttpClient = { request: request as unknown as HttpClient["request"] }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider value={api}>
          <MemoryRouter initialEntries={[draft.path]}>
            <ClientRoutes targets={{ loginPath: "/login", blockedPath: null, verifyEmailPath: null }} />
          </MemoryRouter>
        </ApiProvider>
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: "25000" } })
    const retry = await screen.findByRole("button", { name: "Try again" })

    expect(draft.mounts).toBe(1)
    expect(service.eligibilityReads).toBe(1)

    service.isAnswering = true
    fireEvent.click(retry)
    await screen.findByText("Verified")

    expect(draft.mounts).toBe(1)
    expect(service.eligibilityReads).toBe(2)
    expect(screen.getByLabelText("Amount")).toHaveValue("25000")
  })
})
