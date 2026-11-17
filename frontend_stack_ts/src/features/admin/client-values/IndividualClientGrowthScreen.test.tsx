import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, TransportError } from "~/api/errors"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import type { IndividualGrowthInput } from "./growthQueries"
import IndividualClientGrowthScreen from "./IndividualClientGrowthScreen"

type Settle = Readonly<{ onSuccess?: () => void; onError?: (error: unknown) => void }>

const USER_ID = "11111111-1111-4111-8111-111111111111"
const FUND_ID = "22222222-2222-4222-8222-222222222222"

const RECEIPT = {
  batchId: "33333333-3333-4333-8333-333333333333",
  entryId: "44444444-4444-4444-8444-444444444444",
  userId: USER_ID,
  fundId: FUND_ID,
  effectiveDate: "2026-08-20",
  reasonCode: "quarterly",
  principalPaise: "1000000",
  beforePaise: "1000000",
  currentValuePaise: "1000000",
  deltaPaise: "25000",
  growthPaise: "25000",
  afterPaise: "1025000",
  newValuePaise: "1025000",
}

const sent: IndividualGrowthInput[] = []
let nextFailure: unknown = null

vi.mock("./growthQueries", () => ({
  useIndividualClientGrowth: () => {
    const [data, setData] = useState<typeof RECEIPT | undefined>(undefined)
    return {
      mutate: (variables: IndividualGrowthInput, settle: Settle) => {
        sent.push(variables)
        if (nextFailure === null) {
          setData(RECEIPT)
          settle.onSuccess?.()
          return
        }
        settle.onError?.(nextFailure)
      },
      reset: () => {
        setData(undefined)
      },
      isPending: false,
      data,
    }
  },
}))

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ hasAnyPermission: () => true }),
}))

vi.mock("~/features/admin/users/userDirectoryQueries", () => ({
  useAdminUsers: () => ({
    data: { items: [{
        id: USER_ID,
        fullName: "Asha Verma",
        email: "asha@example.com",
        phone: "+919876543210",
        accountState: "active",
        isPiiTombstoned: false,
      }] },
    error: null,
    isPending: false,
    isFetching: false,
    refetch: () => undefined,
  }),
}))

vi.mock("~/features/admin/shared/adminQueries", () => ({
  useAdminUser: () => ({
    data: undefined,
    error: null,
    isPending: true,
    isFetching: false,
    refetch: () => Promise.resolve(),
  }),
  useAdminInvestorPositions: (userId: string) => ({
    data:
      userId === ""
        ? undefined
        : {
            userId,
            items: [
              {
                fundId: FUND_ID,
                principalPaise: "1000000",
                currentValuePaise: "1000000",
                totalGrowthPaise: "0",
                latestEntryId: null,
              },
            ],
          },
    error: null,
    isPending: userId === "",
    refetch: () => Promise.resolve(),
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

const appendButton = (): HTMLElement | null => screen.queryByRole("button", { name: /Review the adjustment/u })

const enterRate = (basisPoints: string): void => {
  fireEvent.change(screen.getByLabelText(/Rate in basis points/u), { target: { value: basisPoints } })
}

const fillForm = (): void => {
  fireEvent.focus(screen.getByPlaceholderText("Start typing a name"))
  fireEvent.click(screen.getByRole("option", { name: /Asha Verma/u }))
  fireEvent.change(screen.getByLabelText(/^Fund/u), { target: { value: FUND_ID } })
  enterRate("250")
}

const submit = (): void => {
  const button = appendButton()
  if (button === null) throw new Error("expected the review button")
  fireEvent.click(button)
  fireEvent.click(screen.getByRole("button", { name: "Append the adjustment" }))
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  sent.length = 0
  nextFailure = null
  render(
    <MemoryRouter>
      <OverlayStackProvider>
        <IndividualClientGrowthScreen />
      </OverlayStackProvider>
    </MemoryRouter>,
  )
  fillForm()
})

describe("appending one investor's growth when the reply is lost", () => {
  it("holds the form and resends the very same key and body on Check again", () => {
    nextFailure = new TransportError("timeout", "The request timed out.")
    submit()

    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(screen.queryByText(/Nothing (has )?changed/u)).toBeNull()
    expect(screen.getByLabelText(/Rate in basis points/u).hasAttribute("disabled")).toBe(true)
    expect(appendButton()).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Check again" }))

    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(sent[0]?.body).toMatchObject({ userId: USER_ID, fundId: FUND_ID, growthBasisPoints: 250 })
  })

  it("treats a gateway failure as unknown too and keeps the form held", () => {
    nextFailure = new ApiError({ code: "INTERNAL_ERROR", message: "Bad gateway", status: 502, retryable: true })
    submit()

    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(screen.getByLabelText(/Rate in basis points/u).hasAttribute("disabled")).toBe(true)
  })
})

describe("appending one investor's growth after a success", () => {
  it("locks the form, and only Adjust again leads to a fresh key for the same adjustment", () => {
    submit()

    expect(screen.getByText("Adjustment recorded")).toBeTruthy()
    expect(appendButton()).toBeNull()
    expect(screen.getByLabelText(/Rate in basis points/u).hasAttribute("disabled")).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Adjust again" }))
    enterRate("250")
    submit()

    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey)
    expect(sent[1]?.body).toEqual(sent[0]?.body)
  })
})
