import { act, cleanup, render, waitFor } from "@testing-library/react"
import { createElement, Fragment } from "react"
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import type * as ReactRouter from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppLinkRouter, isClaimedPaymentReturn, pendingPaymentDestination } from "~/app/native/AppLinkRouter"
import { PENDING_PAYMENT_KEY, PENDING_PAYMENT_TTL_MS } from "~/features/payments/pendingPayment"
import type { PendingPayment } from "~/features/payments/pendingPayment"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useSession: vi.fn(),
  getLaunchUrl: vi.fn<() => Promise<string | null>>(),
  onAppUrlOpen: vi.fn<(handler: (url: string) => void) => () => void>(),
  closeCheckout: vi.fn<() => Promise<void>>(),
}))

vi.mock("react-router-dom", async (importOriginal) => ({
  ...await importOriginal<typeof ReactRouter>(),
  useNavigate: vi.fn(() => mocks.navigate),
}))
vi.mock("~/app/providers/SessionProvider", () => ({ useSession: mocks.useSession }))
vi.mock("~/platform/lifecycle", () => ({
  getLaunchUrl: mocks.getLaunchUrl,
  onAppUrlOpen: mocks.onAppUrlOpen,
}))
vi.mock("~/features/payments/openCheckout", () => ({ closeCheckout: mocks.closeCheckout }))

const orderPayment: PendingPayment = Object.freeze({
  kind: "order_payment",
  paymentId: "pay-1",
  orderId: "ord-1",
  ownerId: "user-1",
  expiresAt: 1_800_000_000_000,
})

const mandateSetup: PendingPayment = Object.freeze({
  kind: "mandate_setup",
  paymentId: "pay-2",
  orderId: "ord-2",
  sipPlanId: "sip-9",
  ownerId: "user-1",
  expiresAt: 1_800_000_000_000,
})

describe("isClaimedPaymentReturn", () => {
  it("claims the payment return path and anything under it", () => {
    expect(isClaimedPaymentReturn("https://dev-app.beonedge.in/pay/return")).toBe(true)
    expect(isClaimedPaymentReturn("https://dev-app.beonedge.in/pay/return?paymentId=pay-1")).toBe(true)
    expect(isClaimedPaymentReturn("https://app.beonedge.in/pay/return/extra")).toBe(true)
  })

  it("claims nothing else", () => {
    expect(isClaimedPaymentReturn("https://dev-app.beonedge.in/dashboard")).toBe(false)
    expect(isClaimedPaymentReturn("https://dev-app.beonedge.in/pay/returnish")).toBe(false)
    expect(isClaimedPaymentReturn("https://dev-app.beonedge.in/pay")).toBe(false)
  })

  it("refuses anything that is not https", () => {
    expect(isClaimedPaymentReturn("http://dev-app.beonedge.in/pay/return")).toBe(false)
    expect(isClaimedPaymentReturn("javascript:alert(1)//pay/return")).toBe(false)
    expect(isClaimedPaymentReturn("beonedge://pay/return")).toBe(false)
  })

  it("refuses a value that is not a URL", () => {
    expect(isClaimedPaymentReturn("")).toBe(false)
    expect(isClaimedPaymentReturn("/pay/return")).toBe(false)
  })
})

describe("pendingPaymentDestination", () => {
  it("sends an order payment to its payment screen", () => {
    expect(pendingPaymentDestination(orderPayment)).toBe("/activity/payments/pay-1")
  })

  it("sends an AutoPay setup to its SIP plan", () => {
    expect(pendingPaymentDestination(mandateSetup)).toBe("/sips/sip-9")
  })

  it("resolves nothing when no payment is in flight", () => {
    expect(pendingPaymentDestination(null)).toBeNull()
  })
})

describe("payment returns across session restoration", () => {
  const incoming = "https://dev-app.beonedge.in/pay/return?paymentId=foreign-payment"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useNavigate).mockImplementation(() => mocks.navigate)
    localStorage.clear()
    mocks.useSession.mockReturnValue({ principal: null, status: "restoring" })
    mocks.getLaunchUrl.mockResolvedValue(null)
    mocks.onAppUrlOpen.mockReturnValue(() => undefined)
    mocks.closeCheckout.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it.each(["cold launch", "warm return"])(
    "preserves a %s until authentication and uses only the owner's persisted payment",
    async (source) => {
      localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
        ...orderPayment,
        expiresAt: Date.now() + PENDING_PAYMENT_TTL_MS,
      }))
      if (source === "cold launch") mocks.getLaunchUrl.mockResolvedValue(incoming)
      const view = render(createElement(AppLinkRouter))

      await act(async () => {
        if (source === "warm return") mocks.onAppUrlOpen.mock.calls.at(-1)?.[0](incoming)
        await Promise.resolve()
      })

      expect(mocks.navigate).not.toHaveBeenCalled()
      mocks.useSession.mockReturnValue({
        principal: { userId: "user-1" },
        status: "authenticated",
      })
      view.rerender(createElement(AppLinkRouter))

      await waitFor(() => {
        expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
          "/activity/payments/pay-1", { replace: true },
        )
      })
    },
  )

  it.each(["cold launch", "warm return"])(
    "does not restore another owner's payment after a %s",
    async (source) => {
      localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
        ...orderPayment,
        expiresAt: Date.now() + PENDING_PAYMENT_TTL_MS,
      }))
      if (source === "cold launch") mocks.getLaunchUrl.mockResolvedValue(incoming)
      const view = render(createElement(AppLinkRouter))

      await act(async () => {
        if (source === "warm return") mocks.onAppUrlOpen.mock.calls.at(-1)?.[0](incoming)
        await Promise.resolve()
      })

      mocks.useSession.mockReturnValue({
        principal: { userId: "different-user" },
        status: "authenticated",
      })
      view.rerender(createElement(AppLinkRouter))

      expect(mocks.navigate).not.toHaveBeenCalled()
    },
  )

  it.each(["/", "/login"])("keeps the payment destination when authentication redirects from %s", async (start) => {
    const actual = await vi.importActual<typeof ReactRouter>("react-router-dom")
    vi.mocked(useNavigate).mockImplementation(actual.useNavigate)
    localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
      ...orderPayment,
      expiresAt: Date.now() + PENDING_PAYMENT_TTL_MS,
    }))
    mocks.getLaunchUrl.mockResolvedValue(incoming)
    const AuthRedirect = () => (mocks.useSession() as { principal: unknown }).principal === null
      ? null : createElement(Navigate, { to: "/dashboard", replace: true })
    const CurrentPath = () => createElement("output", null, useLocation().pathname)
    const tree = () => createElement(MemoryRouter, { initialEntries: [start] },
      createElement(Fragment, null,
        createElement(AppLinkRouter),
        createElement(Routes, null,
          createElement(Route, { path: start, element: createElement(AuthRedirect) }),
          createElement(Route, { path: "*", element: null }),
        ),
        createElement(CurrentPath),
      ),
    )
    const view = render(tree())
    await act(async () => { await Promise.resolve() })

    mocks.useSession.mockReturnValue({ principal: { userId: "user-1" }, status: "authenticated" })
    view.rerender(tree())

    await waitFor(() => expect(view.getByRole("status")).toHaveTextContent("/activity/payments/pay-1"))
  })
})
