import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import type { HttpClient } from "~/api/http"
import { ApiProvider } from "~/app/providers/ApiProvider"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import { indiaToday } from "~/domain/dates"
import { BACKEND_IDEMPOTENCY_TTL_MS } from "~/features/admin/shared/heldWriteStore"

import ClientPositionDetailScreen from "./ClientPositionDetailScreen"
import CollectiveClientGrowthScreen from "./CollectiveClientGrowthScreen"
import { EarlierInvestmentForm, recordingSlot } from "./EarlierInvestmentForm"
import { IndividualGrowthForm } from "./IndividualGrowthForm"
import { LedgerEntries, ledgerReversalSlot } from "./LedgerEntries"
import { MaturityPanel } from "./MaturityPanel"
import { WithdrawalPayoutPanel } from "./WithdrawalPayoutPanel"

const ADMIN_ID = "a1a1a1a1-0000-4000-8000-000000000001"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const OTHER_USER_ID = "77777777-7777-4777-8777-777777777777"
const FUND_ID = "22222222-2222-4222-8222-222222222222"
const MATURITY_ID = "33333333-3333-4333-8333-333333333333"
const PAYOUT_ID = "44444444-4444-4444-8444-444444444444"
const SCHEDULE_ID = "55555555-5555-4555-8555-555555555555"
const SIP_REF = { kind: "sip", scheduleId: SCHEDULE_ID } as const
const TODAY = indiaToday()

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ principal: { userId: ADMIN_ID }, scope: "admin", hasAnyPermission: () => true }),
}))

type Sent = Readonly<{ operationId: string; idempotencyKey: string | undefined; body: unknown; params: unknown }>

type Operation = Readonly<{ operationId: string; method: string }>

type Options = Readonly<{ idempotencyKey?: string; body?: unknown; params?: unknown }>

const POSITION = {
  fundId: FUND_ID,
  principalPaise: "1000000",
  currentValuePaise: "1100000",
  totalGrowthPaise: "100000",
  latestEntryId: null,
}

const ledgerRow = (entryId: string) => ({
  entryId,
  fundId: FUND_ID,
  effectiveDate: "2026-10-01",
  createdAt: "2026-10-01T05:00:00.000Z",
  entryType: "contribution",
  orderType: "recorded_offline",
  principalDeltaPaise: "500000",
  valueDeltaPaise: "500000",
  reasonCode: "recorded_offline_earlier_investment",
  reversedByEntryId: null,
  reversible: true,
})

const PENDING_MATURITY = {
  id: MATURITY_ID,
  fundId: FUND_ID,
  state: "pending",
  maturedOn: "2026-10-01",
  valueAtMaturityPaise: "1100000",
  settlement: null,
}

const PAYOUT = {
  id: PAYOUT_ID,
  userId: USER_ID,
  fundId: FUND_ID,
  ledgerEntryId: "55555555-5555-4555-8555-555555555555",
  state: "pending" as const,
  amountPaise: "200000",
  growthPortionPaise: "100000",
  principalPortionPaise: "100000",
  effectiveDate: "2026-10-02",
  transferReference: null,
  failureCode: null,
  version: "1",
  createdAt: "2026-10-02T05:00:00.000Z",
}

const PAID_PAYOUT = { ...PAYOUT, state: "paid" as const, transferReference: "BANK-OLD-1", version: "2" }

let maturities: readonly unknown[] = []

const READS: Readonly<Record<string, () => unknown>> = {
  listAdminFunds: () => ({ items: [{ id: FUND_ID, name: "Balanced Fund", slug: "balanced" }] }),
  listAdminInvestorPositions: () => ({ userId: USER_ID, items: [POSITION] }),
  listAdminClientLedgerPage: () => ({ items: [ledgerRow("66666666-6666-4666-8666-666666666661"), ledgerRow("66666666-6666-4666-8666-666666666662")] }),
  listAdminClientSipEarlyExits: () => ({ items: [] }),
  listAdminClientRecordings: () => ({ items: [] }),
  listAdminClientMaturities: () => ({ userId: USER_ID, items: maturities }),
  listAdminWithdrawalPayouts: () => ({ userId: USER_ID, items: [] }),
  listAdminUsers: () => ({ items: [] }),
  getAdminUser: () => ({ user: { id: USER_ID, fullName: "Asha Verma", email: "asha@example.com" } }),
  getAdminClientInvestments: () => ({
    userId: USER_ID,
    funds: [
      {
        fundId: FUND_ID,
        fundName: "Balanced Fund",
        status: "ready",
        investments: [{ ref: SIP_REF, label: "SIP", date: null, amountPaise: "1000000", reversed: false }],
        uncategorised: [],
        earlierGrowth: null,
      },
    ],
  }),
}

const TARGET = {
  userId: USER_ID,
  principalPaise: "1000000",
  beforePaise: "1100000",
  currentValuePaise: "1100000",
  deltaPaise: "25000",
  growthPaise: "125000",
  afterPaise: "1125000",
  newValuePaise: "1125000",
}

const PART = { ref: SIP_REF, label: "SIP", investedPaise: TARGET.principalPaise, beforePaise: TARGET.beforePaise, deltaPaise: TARGET.deltaPaise, afterPaise: TARGET.afterPaise }

const ANSWERS: Readonly<Record<string, () => unknown>> = {
  previewAdminInvestmentGrowth: () => ({
    fundId: FUND_ID,
    mode: "percentage",
    basisHash: "b".repeat(64),
    targetCount: 1,
    totalDeltaPaise: "25000",
    entries: [{ userId: USER_ID, beforePaise: TARGET.beforePaise, deltaPaise: TARGET.deltaPaise, afterPaise: TARGET.afterPaise, parts: [PART] }],
    skipped: [],
  }),
}

const sent: Sent[] = []

const request = (operation: Operation, options?: Options): Promise<unknown> => {
  const read = READS[operation.operationId]
  const answer = ANSWERS[operation.operationId]
  if (answer !== undefined) return Promise.resolve({ data: answer(), meta: { requestId: "req", page: null } })
  if (operation.method === "GET") {
    return read === undefined
      ? Promise.reject(new Error(`no read for ${operation.operationId}`))
      : Promise.resolve({ data: read(), meta: { requestId: "req", page: null } })
  }
  sent.push({ operationId: operation.operationId, idempotencyKey: options?.idempotencyKey, body: options?.body, params: options?.params })
  return Promise.reject(new TransportError("timeout", "The request timed out."))
}

const api = { request: request as unknown as HttpClient["request"] } satisfies HttpClient

const renderWith = (node: ReactNode, entry = "/"): (() => void) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <ApiProvider value={api}>
          <OverlayStackProvider>{node}</OverlayStackProvider>
        </ApiProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return view.unmount
}

const AddressProbe = (): React.ReactElement => {
  const navigate = useNavigate()
  const { search } = useLocation()
  return (
    <>
      <output aria-label="Address search">{search}</output>
      <button type="button" onClick={() => void navigate(`/?userId=${OTHER_USER_ID}`)}>
        link to another investor
      </button>
    </>
  )
}

const lastButton = (name: string | RegExp): HTMLElement => {
  const button = screen.getAllByRole("button", { name }).at(-1)
  if (button === undefined) throw new Error(`expected a ${String(name)} button`)
  return button
}

const choose = async (label: RegExp, value: string): Promise<void> => {
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLSelectElement>(label).disabled).toBe(false)
  })
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const type = (label: RegExp, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const isLocked = async (control: () => HTMLElement): Promise<void> => {
  await waitFor(() => {
    expect(control().hasAttribute("disabled")).toBe(true)
  })
}

type HeldWriteCase = Readonly<{
  name: string
  operationId: string
  form: () => ReactNode
  fill: () => Promise<void>
  locked: () => HTMLElement
  setUp?: () => void
}>

const CASES: readonly HeldWriteCase[] = [
  {
    name: "record an investment",
    operationId: "recordAdminClientContribution",
    form: () => <EarlierInvestmentForm userId={USER_ID} investorLabel="Asha Verma" />,
    fill: async () => {
      await choose(/^Fund/u, FUND_ID)
      type(/^Amount in rupees/u, "5000")
      type(/^Date of the investment/u, TODAY)
      fireEvent.click(screen.getByRole("button", { name: /Review and record/u }))
      fireEvent.click(lastButton("Record the investment"))
    },
    locked: () => screen.getByLabelText(/^Amount in rupees/u),
  },
  {
    name: "append a growth adjustment",
    operationId: "appendAdminIndividualInvestmentGrowth",
    form: () => (
      <IndividualGrowthForm
        userId={USER_ID}
        investorLabel="Asha Verma"
        initialFundId={FUND_ID}
        renderPicker={() => null}
        onFundChange={() => undefined}
      />
    ),
    fill: async () => {
      await choose(/^Target/u, `sip:${SCHEDULE_ID}`)
      await waitFor(() => {
        expect(screen.getByText("Current value")).toBeTruthy()
      })
      type(/Rate in basis points/u, "250")
      fireEvent.click(screen.getByRole("button", { name: /Review the adjustment/u }))
      fireEvent.click(lastButton("Append the adjustment"))
    },
    locked: () => screen.getByLabelText(/Rate in basis points/u),
  },
  {
    name: "reverse a ledger entry",
    operationId: "reverseAdminClientLedgerEntry",
    form: () => <LedgerEntries userId={USER_ID} investorLabel="Asha Verma" canWrite />,
    fill: async () => {
      fireEvent.click((await screen.findAllByRole("button", { name: "Reverse" }))[0]!)
      fireEvent.click(lastButton("Append the reversal"))
    },
    locked: () => lastButton("Reverse"),
  },
  {
    name: "mark a position matured",
    operationId: "markAdminClientMatured",
    form: () => <MaturityPanel userId={USER_ID} investorLabel="Asha Verma" canWrite positions={[POSITION]} />,
    fill: async () => {
      await choose(/^Position/u, FUND_ID)
      await waitFor(() => {
        expect(lastButton("Mark matured").hasAttribute("disabled")).toBe(false)
      })
      fireEvent.click(lastButton("Mark matured"))
      fireEvent.click(lastButton("Mark matured"))
    },
    locked: () => screen.getByLabelText(/^Position/u),
  },
  {
    name: "settle a matured position by a withdrawal",
    operationId: "withdrawAdminClientMaturity",
    setUp: () => {
      maturities = [PENDING_MATURITY]
    },
    form: () => <MaturityPanel userId={USER_ID} investorLabel="Asha Verma" canWrite positions={[POSITION]} />,
    fill: async () => {
      await choose(/^Position/u, FUND_ID)
      type(/^Withdrawal amount in rupees/u, "2000")
      fireEvent.click(screen.getByRole("button", { name: "Record withdrawal" }))
      fireEvent.click(lastButton("Record the withdrawal"))
    },
    locked: () => screen.getByLabelText(/^Withdrawal amount in rupees/u),
  },
  {
    name: "record a payout's transfer outcome",
    operationId: "updateAdminWithdrawalPayout",
    form: () => (
      <WithdrawalPayoutPanel
        payout={PAYOUT}
        investorLabel="Asha Verma"
        fundName="Balanced Fund"
        canWrite
        onReload={() => undefined}
      />
    ),
    fill: () => {
      fireEvent.click(screen.getByRole("button", { name: "Record transfer outcome" }))
      fireEvent.click(lastButton("Mark paid"))
      return Promise.resolve()
    },
    locked: () => screen.getByLabelText(/^Transfer outcome/u),
  },
  {
    name: "commit a whole-fund growth batch",
    operationId: "commitAdminInvestmentGrowth",
    form: () => <CollectiveClientGrowthScreen />,
    fill: async () => {
      await choose(/^Fund/u, FUND_ID)
      type(/Rate in basis points/u, "250")
      fireEvent.click(screen.getByRole("button", { name: "Preview the batch" }))
      fireEvent.click(await screen.findByRole("button", { name: /Review and commit/u }))
      fireEvent.click(lastButton("Commit the batch"))
    },
    locked: () => screen.getByLabelText(/Rate in basis points/u),
  },
]

const STORED_KEY = "0f2c3a9e-1111-4222-8333-444455556666"

const caseNamed = (name: string): HeldWriteCase => {
  const found = CASES.find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`expected a case named ${name}`)
  return found
}

const fundsLoaded = (): Promise<HTMLElement> => screen.findByRole("option", { name: "Balanced Fund" })

const maturityControls = (): readonly HTMLElement[] => [
  screen.getByLabelText(/^Position/u),
  screen.getByLabelText(/^Maturity date/u),
  screen.getByLabelText(/^Note/u),
  lastButton("Mark matured"),
]

type UnreadableCase = HeldWriteCase &
  Readonly<{ slot: string; loaded: () => Promise<unknown>; controls: () => readonly HTMLElement[] }>

const UNREADABLE_CASES: readonly UnreadableCase[] = [
  {
    ...caseNamed("reverse a ledger entry"),
    slot: ledgerReversalSlot(USER_ID),
    loaded: () => screen.findAllByRole("button", { name: "Reverse" }),
    controls: () => screen.getAllByRole("button", { name: "Reverse" }),
  },
  {
    ...caseNamed("mark a position matured"),
    slot: `maturity-mark:${USER_ID}`,
    loaded: fundsLoaded,
    controls: maturityControls,
  },
  {
    ...caseNamed("settle a matured position by a withdrawal"),
    slot: `maturity-settle:${USER_ID}`,
    loaded: fundsLoaded,
    controls: maturityControls,
  },
  {
    ...caseNamed("record a payout's transfer outcome"),
    slot: `payout:${PAYOUT_ID}`,
    loaded: () => Promise.resolve(),
    controls: () => [
      screen.getByLabelText(/^Transfer outcome/u),
      screen.getByRole("button", { name: "Record transfer outcome" }),
    ],
  },
]

beforeEach(() => {
  sent.length = 0
  maturities = []
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("a money or ledger write whose reply is lost", () => {
  it.each(CASES)(
    "$name: shows Not confirmed, stays locked across closing and reopening, and Check again resends the same key",
    async ({ operationId, form, fill, locked, setUp }) => {
      setUp?.()
      const close = renderWith(form())
      await fill()

      expect(await screen.findAllByText("Not confirmed")).not.toHaveLength(0)
      await isLocked(locked)
      close()

      renderWith(form())
      expect(await screen.findAllByText("Not confirmed")).not.toHaveLength(0)
      await isLocked(locked)
      fireEvent.click(lastButton("Check again"))
      await waitFor(() => {
        expect(sent).toHaveLength(2)
      })

      expect(sent.map((write) => write.operationId)).toEqual([operationId, operationId])
      expect(sent[0]?.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,128}$/u)
      expect(sent[1]?.idempotencyKey).toBe(sent[0]?.idempotencyKey)
      expect(sent[1]?.body).toEqual(sent[0]?.body)
      expect(sent[1]?.params).toEqual(sent[0]?.params)
      expect(await screen.findAllByText("Not confirmed")).not.toHaveLength(0)
      await isLocked(locked)
    },
  )

  it("still offers Check again on a recorded investment held for days, because its receipt does not expire", async () => {
    window.sessionStorage.setItem(
      `beo.admin.held-write.v1:${recordingSlot(USER_ID)}`,
      JSON.stringify({
        adminId: ADMIN_ID,
        idempotencyKey: "0f2c3a9e-1111-4222-8333-444455556666",
        body: {
          userId: USER_ID,
          fundId: FUND_ID,
          amountPaise: "500000",
          effectiveDate: "2026-10-01",
          reasonCode: "recorded_offline_investment",
        },
        heldAt: Date.now() - 3 * BACKEND_IDEMPOTENCY_TTL_MS,
      }),
    )
    renderWith(<EarlierInvestmentForm userId={USER_ID} investorLabel="Asha Verma" />)

    fireEvent.click(await screen.findByRole("button", { name: "Check again" }))
    await waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    expect(sent[0]?.idempotencyKey).toBe("0f2c3a9e-1111-4222-8333-444455556666")
  })

  it("locks the record form on a held request it cannot read until a new attempt is confirmed", async () => {
    const stored = `beo.admin.held-write.v1:${recordingSlot(USER_ID)}`
    window.sessionStorage.setItem(
      stored,
      JSON.stringify({ adminId: ADMIN_ID, idempotencyKey: "0f2c3a9e-1111-4222-8333-444455556666", body: {} }),
    )
    renderWith(<EarlierInvestmentForm userId={USER_ID} investorLabel="Asha Verma" />)

    expect(screen.getByText("Held request not readable")).toBeTruthy()
    await isLocked(() => screen.getByLabelText(/^Amount in rupees/u))
    expect(window.sessionStorage.getItem(stored)).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Start a new attempt" }))
    fireEvent.click(lastButton("Start a new attempt"))

    expect(screen.getByLabelText(/^Amount in rupees/u).hasAttribute("disabled")).toBe(false)
    expect(window.sessionStorage.getItem(stored)).toBeNull()
    expect(sent).toHaveLength(0)
  })

  it("never sends a whole-fund hold saved by 0.18.3 to the per-investment commit, and locks until it is settled", async () => {
    const oldBody = { fundId: FUND_ID, growthBasisPoints: 250, basisHash: "b".repeat(64), effectiveDate: TODAY, reasonCode: "monthly" }
    window.sessionStorage.setItem(
      "beo.admin.held-write.v1:collective-growth",
      JSON.stringify({ adminId: ADMIN_ID, idempotencyKey: STORED_KEY, body: { body: oldBody }, heldAt: Date.now() }),
    )
    renderWith(<CollectiveClientGrowthScreen />)

    expect(await screen.findByText("An earlier request is held")).toBeTruthy()
    await isLocked(() => screen.getByLabelText(/Rate in basis points/u))
    for (const button of screen.getAllByRole("button", { name: "Check again" })) fireEvent.click(button)
    await waitFor(() => {
      expect(sent.length).toBeGreaterThan(0)
    })

    expect(sent.map((write) => write.operationId)).toEqual(["commitAdminCollectiveClientGrowth"])
    expect(sent[0]?.idempotencyKey).toBe(STORED_KEY)
    expect(sent[0]?.body).toEqual(oldBody)
  })

  it("keeps a growth batch the tab could not save on this page: it says so and refuses to unload", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
    })
    renderWith(<CollectiveClientGrowthScreen />)
    await choose(/^Fund/u, FUND_ID)
    type(/Rate in basis points/u, "250")
    fireEvent.click(screen.getByRole("button", { name: "Preview the batch" }))
    fireEvent.click(await screen.findByRole("button", { name: /Review and commit/u }))
    fireEvent.click(lastButton("Commit the batch"))

    expect(await screen.findByText("Kept on this page only")).toBeTruthy()
    expect(screen.queryByText(/also after leaving this page/u)).toBeNull()
    expect(screen.getByLabelText(/^Fund/u).hasAttribute("disabled")).toBe(true)
    await waitFor(() => {
      expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false)
    })
  })
})

describe("a link to another investor while the investor record holds a write", () => {
  it("keeps the investor, the reversal kept on this page only and its key, and puts the address back", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
    })
    renderWith(
      <>
        <ClientPositionDetailScreen />
        <AddressProbe />
      </>,
      `/?userId=${USER_ID}`,
    )
    fireEvent.click((await screen.findAllByRole("button", { name: "Reverse" }))[0]!)
    fireEvent.click(lastButton("Append the reversal"))
    expect(await screen.findByText("Kept on this page only")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "link to another investor" }))

    expect(await screen.findAllByText("Not confirmed")).not.toHaveLength(0)
    await waitFor(() => {
      expect(screen.getByLabelText("Address search").textContent).toBe(`?userId=${USER_ID}`)
    })
    fireEvent.click(lastButton("Check again"))
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })

    expect(sent.map((write) => write.operationId)).toEqual(["reverseAdminClientLedgerEntry", "reverseAdminClientLedgerEntry"])
    expect(sent[1]?.idempotencyKey).toBe(sent[0]?.idempotencyKey)
    expect(sent[1]?.body).toEqual(sent[0]?.body)
    expect(sent[1]?.params).toEqual(sent[0]?.params)
    expect(sent[0]?.params).toMatchObject({ userId: USER_ID })
  })
})

describe("a money or ledger write whose stored hold cannot be read", () => {
  it.each(UNREADABLE_CASES)(
    "$name: every input and action stays disabled and nothing is sent until the record is checked",
    async ({ operationId, form, fill, setUp, slot, loaded, controls }) => {
      setUp?.()
      const stored = `beo.admin.held-write.v1:${slot}`
      window.sessionStorage.setItem(stored, JSON.stringify({ adminId: ADMIN_ID, idempotencyKey: STORED_KEY, body: {} }))
      renderWith(form())

      expect(await screen.findByText("Held request not readable")).toBeTruthy()
      await loaded()
      expect(controls().filter((control) => !control.hasAttribute("disabled"))).toEqual([])
      expect(screen.queryByRole("button", { name: "Check again" })).toBeNull()
      expect(sent).toHaveLength(0)

      fireEvent.click(screen.getByRole("button", { name: "I have checked the record" }))
      expect(window.sessionStorage.getItem(stored)).toBeNull()
      await fill()
      await waitFor(() => {
        expect(sent).toHaveLength(1)
      })

      expect(sent[0]?.operationId).toBe(operationId)
      expect(sent[0]?.idempotencyKey).not.toBe(STORED_KEY)
    },
  )
})

describe("a payout outcome without a bank transfer reference", () => {
  const payoutPanel = (payout: typeof PAYOUT | typeof PAID_PAYOUT): ReactNode => (
    <WithdrawalPayoutPanel payout={payout} investorLabel="Asha Verma" fundName="Balanced Fund" canWrite onReload={() => undefined} />
  )

  it("marks a payout paid without asking for or sending a reference, and never shows a stored one", async () => {
    const close = renderWith(payoutPanel(PAYOUT))
    expect(screen.queryByLabelText(/reference/iu)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Record transfer outcome" }))
    expect(screen.getByText("This records that the transfer has completed.")).toBeTruthy()
    expect(screen.queryByText(/transfer reference/iu)).toBeNull()
    fireEvent.click(lastButton("Mark paid"))
    await waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    expect(sent[0]?.body).toEqual({ state: "paid", expectedVersion: 1 })
    expect(sent[0]?.body).not.toHaveProperty("transferReference")
    close()
    window.sessionStorage.clear()

    renderWith(payoutPanel(PAID_PAYOUT))
    expect(screen.getByText(/· Paid$/u)).toBeTruthy()
    expect(screen.queryByText(/BANK-OLD-1/u)).toBeNull()
    expect(screen.queryByText(/reference/iu)).toBeNull()
  })

  it("reads a paid hold saved by the previous build with a reference and resends it unchanged", async () => {
    const held = { state: "paid", expectedVersion: 1, transferReference: "TRANSFER-1" }
    window.sessionStorage.setItem(
      `beo.admin.held-write.v1:payout:${PAYOUT_ID}`,
      JSON.stringify({ adminId: ADMIN_ID, idempotencyKey: STORED_KEY, body: { payoutId: PAYOUT_ID, body: held }, heldAt: Date.now() }),
    )
    renderWith(payoutPanel(PAYOUT))

    expect(await screen.findAllByText("Not confirmed")).not.toHaveLength(0)
    expect(screen.queryByText("Held request not readable")).toBeNull()
    expect(screen.queryByText(/TRANSFER-1/u)).toBeNull()
    fireEvent.click(lastButton("Check again"))
    await waitFor(() => {
      expect(sent).toHaveLength(1)
    })
    expect(sent[0]?.idempotencyKey).toBe(STORED_KEY)
    expect(sent[0]?.body).toEqual(held)
  })
})
