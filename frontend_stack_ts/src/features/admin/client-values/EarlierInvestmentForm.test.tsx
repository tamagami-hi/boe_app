import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import { indiaToday } from "~/domain/dates"

import { EarlierInvestmentForm } from "./EarlierInvestmentForm"
import { monthlyPrefillOf } from "./recordingPrefill"
import type { RecordedContributionInput } from "./recordingQueries"
import type { AdminSipScheduleItem } from "./sipScheduleQueries"

type Settle = Readonly<{ onSuccess?: () => void; onError?: (error: unknown) => void }>

const USER_ID = "11111111-1111-4111-8111-111111111111"
const FUND_ID = "22222222-2222-4222-8222-222222222222"
const SCHEDULE_ID = "33333333-3333-4333-8333-333333333333"

const shiftMonth = (month: string, by: number): string => {
  const [year = 0, number = 1] = month.split("-").map(Number)
  const index = year * 12 + number - 1 + by
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, "0")}`
}

const TODAY = indiaToday()
const THIS_MONTH = TODAY.slice(0, 7)
const START_MONTH = shiftMonth(THIS_MONTH, -2)

const SCHEDULE: AdminSipScheduleItem = {
  scheduleId: SCHEDULE_ID,
  userId: USER_ID,
  clientName: "Asha Verma",
  fundId: FUND_ID,
  fundName: "Balanced Fund",
  monthlyAmountPaise: "500050",
  startMonth: START_MONTH,
  endMonth: shiftMonth(START_MONTH, 11),
  monthCount: 12,
  state: "active",
  version: 1,
  monthsPaid: 0,
  monthsDue: 3,
  nextUnpaidMonth: START_MONTH,
  paidMonths: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  closedAt: null,
}

const RECORDED = {
  entryId: "44444444-4444-4444-8444-444444444444",
  principalPaise: "500050",
  currentValuePaise: "500050",
  fundVersionEffectiveOnDate: true,
}

const sent: RecordedContributionInput[] = []
const failures: unknown[] = []

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ hasAnyPermission: () => true }),
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

vi.mock("./sipScheduleQueries", () => ({
  useClientSipSchedules: (userId: string) => ({
    data: userId === "" ? undefined : { items: [SCHEDULE] },
    error: null,
    refetch: () => Promise.resolve(),
  }),
}))

vi.mock("./recordingQueries", () => ({
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

const reviewButton = (): HTMLElement | null => screen.queryByRole("button", { name: /Review and record/u })

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  sent.length = 0
  failures.length = 0
  render(
    <OverlayStackProvider>
      <EarlierInvestmentForm userId={USER_ID} investorLabel="Asha Verma" prefill={monthlyPrefillOf(SCHEDULE, TODAY)} />
    </OverlayStackProvider>,
  )
})

describe("recording a month opened from a SIP schedule row", () => {
  it("prefills a SIP payment for this month and records nothing until it is confirmed", () => {
    expect(screen.getByLabelText<HTMLSelectElement>(/^Fund/u).value).toBe(FUND_ID)
    expect(screen.getByLabelText<HTMLInputElement>(/^Amount in rupees/u).value).toBe("5000.50")
    expect(screen.getByLabelText<HTMLInputElement>(/^Date of the payment/u).value).toBe(TODAY)
    expect(screen.getByLabelText<HTMLSelectElement>(/^Category/u).value).toBe("sip")
    expect(screen.getByLabelText<HTMLSelectElement>(/^SIP schedule month/u).value).toBe(THIS_MONTH)

    const review = reviewButton()
    if (review === null) throw new Error("expected the review button")
    fireEvent.click(review)

    expect(screen.getByText("Record this SIP payment?")).toBeTruthy()
    expect(sent).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Record the payment" }))

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      userId: USER_ID,
      fundId: FUND_ID,
      amountPaise: "500050",
      effectiveDate: TODAY,
      reasonCode: "recorded_offline_monthly_investment",
      category: "sip",
      sipScheduleLink: { scheduleId: SCHEDULE_ID, month: THIS_MONTH },
    })
    expect(screen.getByText("SIP payment recorded")).toBeTruthy()
  })

  it("holds a lost reply on the same key and body, so the month can only be recorded once", () => {
    failures.push(new TransportError("timeout", "The request timed out."))
    const review = reviewButton()
    if (review === null) throw new Error("expected the review button")
    fireEvent.click(review)
    fireEvent.click(screen.getByRole("button", { name: "Record the payment" }))

    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(reviewButton()).toBeNull()
    expect(screen.getByLabelText(/^Amount in rupees/u).hasAttribute("disabled")).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Check again" }))

    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(sent[0]?.sipScheduleLink).toEqual({ scheduleId: SCHEDULE_ID, month: THIS_MONTH })
    expect(screen.getByText("SIP payment recorded")).toBeTruthy()
  })
})
