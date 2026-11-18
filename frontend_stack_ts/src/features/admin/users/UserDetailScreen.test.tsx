import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import { indiaToday } from "~/domain/dates"
import type { RecordedContributionInput } from "~/features/admin/client-values/recordingQueries"
import type { AdminSipScheduleItem } from "~/features/admin/client-values/sipScheduleQueries"

import UserDetailScreen from "./UserDetailScreen"

type Settle = Readonly<{ onSuccess?: () => void; onError?: (error: unknown) => void }>

const USER_ID = "11111111-1111-4111-8111-111111111111"
const FUND_ID = "22222222-2222-4222-8222-222222222222"
const THIS_MONTH = indiaToday().slice(0, 7)

const SCHEDULE: AdminSipScheduleItem = {
  scheduleId: "33333333-3333-4333-8333-333333333333",
  userId: USER_ID,
  clientName: "Asha Verma",
  fundId: FUND_ID,
  fundName: "Balanced Fund",
  monthlyAmountPaise: "500000",
  startMonth: THIS_MONTH,
  endMonth: THIS_MONTH,
  monthCount: 1,
  state: "active",
  version: 1,
  monthsPaid: 0,
  monthsDue: 1,
  nextUnpaidMonth: THIS_MONTH,
  paidMonths: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  closedAt: null,
}

const RECORDED = { entryId: "44444444-4444-4444-8444-444444444444", principalPaise: "500000", currentValuePaise: "500000", fundVersionEffectiveOnDate: true }

const sent: RecordedContributionInput[] = []
const failures: unknown[] = []

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ hasAnyPermission: () => true, hasAllPermissions: () => true }),
}))

vi.mock("~/features/admin/shared/adminQueries", () => ({
  useAdminUser: () => ({
    data: {
      user: {
        id: USER_ID,
        fullName: "Asha Verma",
        email: "asha@example.com",
        phone: "+919876543210",
        accountState: "active",
        emailVerificationStatus: "verified",
        ordersCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        suspendedAt: null,
        closedAt: null,
        version: 1,
      },
      roles: [],
      emailVerification: null,
      orders: [],
    },
    error: null,
    isPending: false,
    isFetching: false,
    refetch: () => Promise.resolve({ isSuccess: true }),
  }),
}))

vi.mock("~/features/admin/shared/queries", () => ({
  useAdminFundCatalogue: () => ({
    data: { items: [{ id: FUND_ID, name: "Balanced Fund", slug: "balanced" }] },
    error: null,
    isPending: false,
    isFetching: false,
    refetch: () => undefined,
  }),
}))

vi.mock("~/features/admin/client-values/sipScheduleQueries", () => ({
  useClientSipSchedules: (userId: string) => ({
    data: userId === "" ? undefined : { items: [SCHEDULE] },
    error: null,
    isPending: userId === "",
    refetch: () => Promise.resolve(),
  }),
}))

vi.mock("~/features/admin/client-values/earlyExitQueries", () => ({
  useClientSipEarlyExits: () => ({ data: { items: [] }, error: null, isPending: false, refetch: () => Promise.resolve() }),
}))
vi.mock("~/features/admin/client-values/SipEarlyExitList", () => ({ SipEarlyExitList: () => null }))
vi.mock("./SipEarlyExitPanel", () => ({ SipEarlyExitPanel: () => null }))

vi.mock("~/features/admin/client-values/recordingQueries", () => ({
  useRecordClientContribution: () => {
    const [data, setData] = useState<typeof RECORDED | undefined>(undefined)
    return {
      mutate: (variables: RecordedContributionInput, settle: Settle) => {
        sent.push(variables)
        const failure = failures.shift()
        if (failure === undefined) {
          setData(RECORDED)
          settle.onSuccess?.()
          return
        }
        settle.onError?.(failure)
      },
      reset: () => {
        setData(undefined)
      },
      isPending: false,
      data,
    }
  },
}))

vi.mock("~/features/admin/client-returns/PortfolioSummarySection", () => ({ PortfolioSummarySection: () => null }))
vi.mock("~/features/admin/maturities/ClientMaturitySection", () => ({ ClientMaturitySection: () => null }))
vi.mock("./ClientContactsSection", () => ({ ClientContactsSection: () => null }))
vi.mock("./ClientHubActions", () => ({ ClientHubActions: () => null }))
vi.mock("./ClientHubTabs", () => ({ ClientHubTabs: () => null }))
vi.mock("./ClientNomineeSection", () => ({ ClientNomineeSection: () => null }))
vi.mock("./InvestmentsCategoryBanner", () => ({ InvestmentsCategoryBanner: () => null }))
vi.mock("./PasswordLinkPanel", () => ({ PasswordLinkPanel: () => null }))
vi.mock("./UserLifecyclePanel", () => ({ UserLifecyclePanel: () => null }))
vi.mock("./SipScheduleCreateForm", () => ({ SipScheduleCreateForm: () => null }))
vi.mock("./SipScheduleEditor", () => ({ SipScheduleEditor: () => null }))

const recordThisMonth = (): HTMLButtonElement => screen.getByRole("button", { name: "Record this month" })

const recordThroughConfirm = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /Review and record/u }))
  fireEvent.click(screen.getByRole("button", { name: "Record the payment" }))
}

beforeEach(() => {
  sent.length = 0
  failures.length = 0
  Element.prototype.scrollIntoView = vi.fn()
  render(
    <OverlayStackProvider>
      <MemoryRouter initialEntries={[`/users/${USER_ID}`]}>
        <Routes>
          <Route path="/users/:userId" element={<UserDetailScreen />} />
        </Routes>
      </MemoryRouter>
    </OverlayStackProvider>,
  )
})

afterEach(() => {
  cleanup()
})

describe("Record this month while a recording is held", () => {
  it("is disabled until the unconfirmed recording is checked again, so the form cannot remount with a new key", () => {
    fireEvent.click(recordThisMonth())
    failures.push(new TransportError("timeout", "The request timed out."))
    recordThroughConfirm()

    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(recordThisMonth().disabled).toBe(true)
    fireEvent.click(recordThisMonth())
    expect(screen.getByText("Not confirmed")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Check again" }))

    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).toBe(sent[0]?.idempotencyKey)
    expect(recordThisMonth().disabled).toBe(false)
  })
})
