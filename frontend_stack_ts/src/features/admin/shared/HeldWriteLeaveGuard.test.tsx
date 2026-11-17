import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { Link, Route, RouterProvider, Routes, createMemoryRouter, useNavigate } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import { createTokenStore, createWebPersistence } from "~/api/session/tokenStore"
import { NativeBackCoordinator } from "~/app/native/NativeBackCoordinator"
import { createBackPolicyResolver } from "~/app/native/backPolicy"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import { SessionProvider, useSession } from "~/app/providers/SessionProvider"
import type { Principal } from "~/app/providers/SessionProvider"
import { ADMIN_HOME_PATH, ADMIN_LOGIN_PATH, ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { dropRequestSignalsInThisFile } from "~/app/routing/dataRouterTestSupport"
import { RequireSession } from "~/app/routing/guards"

import { HeldWriteLeaveGuard } from "./HeldWriteLeaveGuard"
import { useHeldDone } from "./useHeldDone"
import { SurvivingHeldWriteScope, useHasUnsettledHeldWrite } from "./unsettledHeldWrites"
import { useHeldWrite } from "./useHeldWrite"
import type { HeldWritePersistence } from "./useHeldWrite"

type Body = Readonly<{ userId: string; rateBasisPoints: string }>

const OPERATOR: Principal = {
  userId: "00000000-0000-4000-8000-0000000000a1",
  fullName: "Admin One",
  email: "admin.one@example.com",
  roles: ["admin"],
  permissions: [],
  accountState: "active",
}

const FORM_PATH = "/client-values/individual"
const PARENT_PATH = "/client-values"
const TARGETS = { loginPath: ADMIN_LOGIN_PATH, blockedPath: null, verifyEmailPath: null }
const LEAVE_PROMPT = "Stay on this page?"

const parseBody = (value: unknown): Body | null => {
  if (typeof value !== "object" || value === null) return null
  const { userId, rateBasisPoints } = value as Readonly<Record<string, unknown>>
  return typeof userId === "string" && typeof rateBasisPoints === "string" ? { userId, rateBasisPoints } : null
}

const PERSIST: HeldWritePersistence<Body> = { slot: "growth:asha", parseBody }

dropRequestSignalsInThisFile()

const hardwareBack = vi.hoisted((): { handler: ((canGoBack: boolean) => void) | null } => ({ handler: null }))

vi.mock("~/platform/lifecycle", () => ({
  onHardwareBack: (handler: (canGoBack: boolean) => void) => {
    hardwareBack.handler = handler
    return () => {
      hardwareBack.handler = null
    }
  },
}))

let replies: (() => Promise<string>)[] = []
let persist: HeldWritePersistence<Body> | undefined
let isFormBehindSession = true
let doneRedirect: string | null = "/users"
let hasFrameHold = false

const timedOut = (): Promise<string> => Promise.reject(new TransportError("timeout", "The request timed out."))

const HeldButton = ({ label, status }: Readonly<{ label: string; status: string }>): React.ReactElement => {
  const navigate = useNavigate()
  const write = useHeldWrite<Body, string>(
    useMutation({ mutationFn: () => (replies.shift() ?? timedOut)() }),
    "The adjustment could not be sent.",
    persist,
  )
  useHeldDone(write.outcome, () => {
    if (doneRedirect !== null) void navigate(doneRedirect, { replace: true })
  })
  return (
    <>
      <button
        type="button"
        onClick={() => {
          write.submit({ userId: "asha", rateBasisPoints: "125" })
        }}
      >
        {label}
      </button>
      {write.outcome.kind === "unknown" ? <p>{status}</p> : null}
    </>
  )
}

const GrowthForm = (): React.ReactElement => (
  <>
    <p>Growth form</p>
    <HeldButton label="Append the adjustment" status="Not confirmed" />
  </>
)

const FrameHold = (): React.ReactElement => {
  const isHoldingPrompts = useHasUnsettledHeldWrite()
  return (
    <SurvivingHeldWriteScope value>
      <HeldButton label="Confirm the maturity choice" status="Maturity choice not confirmed" />
      {isHoldingPrompts ? <p>Console prompts held back</p> : null}
    </SurvivingHeldWriteScope>
  )
}

const SignOut = (): React.ReactElement => {
  const session = useSession()
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => {
        session.signedOut()
        void navigate(ADMIN_LOGIN_PATH, { replace: true })
      }}
    >
      Sign out
    </button>
  )
}

const signedIn = (element: React.ReactElement): React.ReactElement => (
  <RequireSession targets={TARGETS}>{element}</RequireSession>
)

const Console = (): React.ReactElement => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <OverlayStackProvider>
      <SessionProvider
        scope="admin"
        tokenStore={createTokenStore({ persistence: createWebPersistence(), persistSecrets: false })}
        restore={() => Promise.resolve(OPERATOR)}
      >
        <NativeBackCoordinator resolvePolicy={createBackPolicyResolver(ADMIN_ROUTES, ADMIN_HOME_PATH)} />
        <nav>
          <Link to="/users">Users</Link>
        </nav>
        <SignOut />
        {hasFrameHold ? <FrameHold /> : null}
        <Routes>
          <Route path={FORM_PATH} element={isFormBehindSession ? signedIn(<GrowthForm />) : <GrowthForm />} />
          <Route path={PARENT_PATH} element={signedIn(<p>Client values</p>)} />
          <Route path="/users" element={signedIn(<p>Users directory</p>)} />
          <Route path={ADMIN_LOGIN_PATH} element={<p>Sign-in screen</p>} />
        </Routes>
        <HeldWriteLeaveGuard />
      </SessionProvider>
    </OverlayStackProvider>
  </QueryClientProvider>
)

const openForm = async (): Promise<void> => {
  const router = createMemoryRouter([{ path: "*", element: <Console /> }], { initialEntries: [FORM_PATH] })
  render(<RouterProvider router={router} />)
  await screen.findByText("Growth form")
}

const holdUnconfirmed = async (): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: "Append the adjustment" }))
  await screen.findByText("Not confirmed")
}

const leavePrompt = (): HTMLElement | null => screen.queryByRole("dialog", { name: LEAVE_PROMPT })

const pressBack = (): void => {
  act(() => {
    hardwareBack.handler?.(true)
  })
}

beforeEach(() => {
  replies = []
  persist = undefined
  isFormBehindSession = true
  doneRedirect = "/users"
  hasFrameHold = false
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

describe("leaving an admin screen that holds an unconfirmed write", () => {
  it("asks before a sidebar link leaves the held form, stays on Stay, and leaves on Leave anyway", async () => {
    await openForm()
    await holdUnconfirmed()

    fireEvent.click(screen.getByRole("link", { name: "Users" }))
    const prompt = await screen.findByRole("dialog", { name: LEAVE_PROMPT })
    expect(within(prompt).getByText(/kept on this page only/)).toBeTruthy()
    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(screen.queryByText("Users directory")).toBeNull()

    fireEvent.click(within(prompt).getByRole("button", { name: "Stay" }))
    expect(leavePrompt()).toBeNull()
    expect(screen.getByText("Not confirmed")).toBeTruthy()

    fireEvent.click(screen.getByRole("link", { name: "Users" }))
    fireEvent.click(within(await screen.findByRole("dialog", { name: LEAVE_PROMPT })).getByRole("button", { name: "Leave anyway" }))
    await screen.findByText("Users directory")
    expect(leavePrompt()).toBeNull()
  })

  it("does not ask without an unsettled hold, including the screen's own redirect after a confirmed write", async () => {
    await openForm()
    fireEvent.click(screen.getByRole("link", { name: "Users" }))
    await screen.findByText("Users directory")
    expect(leavePrompt()).toBeNull()
    cleanup()

    replies = [() => Promise.resolve("appended")]
    await openForm()
    fireEvent.click(screen.getByRole("button", { name: "Append the adjustment" }))
    await screen.findByText("Users directory")
    expect(leavePrompt()).toBeNull()
  })

  it("never holds sign-out back, even while an unconfirmed write is still mounted", async () => {
    isFormBehindSession = false
    await openForm()
    await holdUnconfirmed()

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    await screen.findByText("Sign-in screen")
    expect(leavePrompt()).toBeNull()
  })

  it("answers Android Back with the same question, closes it on a second Back, and leaves on Leave anyway", async () => {
    persist = PERSIST
    await openForm()
    await holdUnconfirmed()

    pressBack()
    const prompt = await screen.findByRole("dialog", { name: LEAVE_PROMPT })
    expect(within(prompt).getByText(/keeps it in this tab/)).toBeTruthy()
    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(screen.queryByText("Client values")).toBeNull()

    pressBack()
    expect(leavePrompt()).toBeNull()
    expect(screen.getByText("Not confirmed")).toBeTruthy()

    pressBack()
    fireEvent.click(within(await screen.findByRole("dialog", { name: LEAVE_PROMPT })).getByRole("button", { name: "Leave anyway" }))
    await screen.findByText("Client values")
  })

  it("lets the click through when a write still sending settles while the question is open", async () => {
    doneRedirect = null
    let answer: (value: string) => void = () => undefined
    replies = [() => new Promise<string>((resolve) => (answer = resolve))]
    await openForm()
    fireEvent.click(screen.getByRole("button", { name: "Append the adjustment" }))

    fireEvent.click(screen.getByRole("link", { name: "Users" }))
    await screen.findByRole("dialog", { name: LEAVE_PROMPT })
    act(() => {
      answer("appended")
    })
    await screen.findByText("Users directory")
    expect(leavePrompt()).toBeNull()
  })

  it("does not ask for a hold in the console frame, which stays mounted across screens, but still holds the prompts back", async () => {
    hasFrameHold = true
    await openForm()
    fireEvent.click(screen.getByRole("button", { name: "Confirm the maturity choice" }))
    await screen.findByText("Maturity choice not confirmed")
    expect(screen.getByText("Console prompts held back")).toBeTruthy()

    fireEvent.click(screen.getByRole("link", { name: "Users" }))
    await screen.findByText("Users directory")
    expect(leavePrompt()).toBeNull()
    expect(screen.getByText("Maturity choice not confirmed")).toBeTruthy()
    expect(screen.getByText("Console prompts held back")).toBeTruthy()
  })
})
