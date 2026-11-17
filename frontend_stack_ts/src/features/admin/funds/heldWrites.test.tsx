import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import type {
  getAdminAppConfig,
  getAdminApplication,
  getAdminFund,
  listAdminFaqs,
  listAdminFunds,
  listAdminFundStocks,
  previewAdminCollectiveAumGrowth,
} from "~/api/generated/operations"
import type { DataOf, HttpClient } from "~/api/http"
import { ApiProvider } from "~/app/providers/ApiProvider"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import { ToastProvider } from "~/app/providers/ToastProvider"
import AppConfigBuilderScreen from "~/features/admin/app-config/AppConfigBuilderScreen"
import ApplicationDetailScreen from "~/features/admin/applications/ApplicationDetailScreen"
import FaqListScreen from "~/features/admin/content/FaqListScreen"
import CollectiveAumGrowthScreen from "~/features/admin/fund-aum/CollectiveAumGrowthScreen"
import FundAumScreen from "~/features/admin/fund-aum/FundAumScreen"

import FundCreateScreen from "./FundCreateScreen"
import FundHoldingsScreen from "./FundHoldingsScreen"
import FundWorkspaceScreen from "./FundWorkspaceScreen"

type Fund = DataOf<typeof getAdminFund>["fund"]
type Sent = Readonly<{ operationId: string; options: Readonly<Record<string, unknown>> }>
type Operation = Readonly<{ operationId: string; method: string }>

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1"
const FUND_ID = "11111111-1111-4111-8111-111111111111"
const VERSION_1 = "22222222-2222-4222-8222-222222222221"
const VERSION_2 = "22222222-2222-4222-8222-222222222222"
const VERSION_3 = "22222222-2222-4222-8222-222222222223"
const DISCLOSURE_1 = "33333333-3333-4333-8333-333333333331"
const DISCLOSURE_2 = "33333333-3333-4333-8333-333333333332"
const STOCK_ID = "44444444-4444-4444-8444-444444444444"
const FAQ_ID = "55555555-5555-4555-8555-555555555555"
const APPLICATION_ID = "66666666-6666-4666-8666-666666666666"
const SNAPSHOT_ID = "77777777-7777-4777-8777-777777777777"
const AT = "2026-11-01T10:00:00.000Z"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({
    principal: { userId: ADMIN_ID, roles: ["admin"], permissions: [] },
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}))

const fundWith = (aum: Fund["aum"]): Fund => ({
  id: FUND_ID,
  slug: "balanced-growth",
  status: "published",
  name: "Balanced Growth",
  category: "Hybrid",
  objective: "Steady growth",
  riskLevel: "moderate",
  returnTier: null,
  currency: "INR",
  minimumSipPaise: "50000",
  minimumPurchasePaise: "500000",
  currentVersion: 2,
  currentVersionId: VERSION_2,
  aum,
  stockCount: 1,
  publishedAt: AT,
  createdAt: AT,
  updatedAt: AT,
  version: 7,
})

const detailWith = (aum: Fund["aum"]): DataOf<typeof getAdminFund> => ({
  fund: fundWith(aum),
  versions: [
    {
      id: VERSION_1,
      version: 1,
      name: "Balanced Growth",
      category: "Hybrid",
      objective: "Old objective",
      riskLevel: "low",
      returnTier: "low",
      currency: "INR",
      minimumSipPaise: "10000",
      minimumPurchasePaise: "100000",
      minimumDurationMonths: 6,
      recommendedHoldingMonths: 12,
      disclosureVersionId: DISCLOSURE_1,
      createdAt: AT,
    },
    {
      id: VERSION_2,
      version: 2,
      name: "Balanced Growth",
      category: "Hybrid",
      objective: "Steady growth",
      riskLevel: "moderate",
      returnTier: null,
      currency: "INR",
      minimumSipPaise: "50000",
      minimumPurchasePaise: "500000",
      minimumDurationMonths: 24,
      recommendedHoldingMonths: 36,
      disclosureVersionId: DISCLOSURE_2,
      createdAt: AT,
    },
  ],
  stocks: [],
  disclosures: [
    { id: DISCLOSURE_2, version: 2, title: "Risk disclosure", body: "Read the scheme documents.", effectiveFrom: AT, createdAt: AT },
    { id: DISCLOSURE_1, version: 1, title: "Old disclosure", body: "Old body.", effectiveFrom: AT, createdAt: AT },
  ],
})

const SIZED = { aumPaise: "100000000", asOfDate: "2026-11-01", updatedAt: AT }

const STOCKS: DataOf<typeof listAdminFundStocks> = {
  items: [
    {
      id: STOCK_ID,
      stockName: "Infosys",
      quarterLabel: "Q3 FY27",
      weightPercent: "12.5",
      state: "active",
      sortOrder: 0,
      exitedAt: null,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
}

const CATALOGUE: DataOf<typeof listAdminFunds> = {
  items: [fundWith(SIZED)],
  summary: { total: 1, byState: { draft: 0, published: 1, paused: 0, archived: 0 } },
}

const PREVIEW: DataOf<typeof previewAdminCollectiveAumGrowth> = {
  basisHash: "a".repeat(64),
  items: [
    {
      fundId: FUND_ID,
      basisSnapshotId: SNAPSHOT_ID,
      basisRevision: 1,
      beforeAumPaise: "100000000",
      deltaPaise: "2500000",
      afterAumPaise: "102500000",
    },
  ],
}

const FAQS: DataOf<typeof listAdminFaqs> = {
  items: [
    {
      id: FAQ_ID,
      contentKey: "faq.withdrawals",
      question: "How do withdrawals work?",
      answer: "Ask your relationship manager.",
      category: "general",
      order: 0,
      status: "draft",
      version: 1,
      publishedAt: null,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
}

const APPLICATION: DataOf<typeof getAdminApplication> = {
  application: {
    applicationId: APPLICATION_ID,
    fullName: "Asha Verma",
    email: "asha@example.com",
    phone: "+919876543210",
    isPiiTombstoned: false,
    status: "submitted",
    hasSignupPassword: true,
    createdAt: AT,
    version: 1,
  },
  linkedUserId: null,
  consents: [],
  reviews: [],
  deliveries: { items: [], page: { nextCursor: null, limit: 25, hasMore: false } },
}

const APP_CONFIG: DataOf<typeof getAdminAppConfig> = {
  version: 3,
  config: { maintenance: { enabled: false } },
  publishedAt: AT,
  publishedBy: ADMIN_ID,
}

let fundDetail = detailWith(SIZED)
const sent: Sent[] = []
let writeReplies: (() => Promise<unknown>)[] = []

const timedOut = (): Promise<unknown> => Promise.reject(new TransportError("timeout", "The request timed out."))
const accepted = (): Promise<unknown> => Promise.resolve({ data: undefined, meta: { page: null } })

const READS: Readonly<Record<string, () => unknown>> = {
  getAdminFund: () => fundDetail,
  listAdminFundStocks: () => STOCKS,
  getAdminFundAumHistory: () => ({ items: [] }),
  listAdminFunds: () => CATALOGUE,
  listAdminFaqs: () => FAQS,
  getAdminApplication: () => APPLICATION,
  getAdminAppConfig: () => APP_CONFIG,
  previewAdminCollectiveAumGrowth: () => PREVIEW,
}

const request = async (operation: Operation, options: Readonly<Record<string, unknown>> = {}): Promise<unknown> => {
  const read = READS[operation.operationId]
  if (read !== undefined) return { data: read(), meta: { requestId: null, timestamp: null, idempotencyReplay: false, page: null } }
  sent.push({ operationId: operation.operationId, options })
  return (writeReplies.shift() ?? timedOut)()
}

const api = { request } as unknown as HttpClient

const SCREENS = [
  { path: "/funds/new", element: <FundCreateScreen /> },
  { path: "/funds/:fundId", element: <FundWorkspaceScreen /> },
  { path: "/funds/:fundId/holdings", element: <FundHoldingsScreen /> },
  { path: "/funds/:fundId/aum", element: <FundAumScreen /> },
  { path: "/aum/collective", element: <CollectiveAumGrowthScreen /> },
  { path: "/faqs", element: <FaqListScreen /> },
  { path: "/applications/:applicationId", element: <ApplicationDetailScreen /> },
  { path: "/app-config", element: <AppConfigBuilderScreen /> },
] as const

const open = (path: string): void => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <ToastProvider>
          <OverlayStackProvider>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                {SCREENS.map(({ path: pattern, element }) => (
                  <Route key={pattern} path={pattern} element={element} />
                ))}
              </Routes>
            </MemoryRouter>
          </OverlayStackProvider>
        </ToastProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
}

const press = (name: string | RegExp): void => {
  fireEvent.click(screen.getByRole("button", { name }))
}

const confirmIn = async (name: string): Promise<void> => {
  const dialog = await screen.findByRole("dialog")
  fireEvent.click(within(dialog).getByRole("button", { name }))
}

const type = (label: RegExp, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

const keyOf = (entry: Sent | undefined): unknown => entry?.options.idempotencyKey

beforeEach(() => {
  sent.length = 0
  writeReplies = []
  fundDetail = detailWith(SIZED)
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type Row = Readonly<{
  write: string
  path: string
  aum?: Fund["aum"]
  act: () => Promise<void>
  locked: () => HTMLElement
}>

const ROWS: readonly Row[] = [
  {
    write: "createAdminFund",
    path: "/funds/new",
    act: async () => {
      type(/^Slug/u, "steady-income")
      type(/^Name/u, "Steady Income")
      type(/^Category/u, "Debt")
      type(/^Risk level/u, "low")
      type(/^Disclosure title/u, "Risk disclosure")
      type(/^Disclosure body/u, "Read the scheme documents.")
      press("Review the new fund")
      await confirmIn("Create the fund")
    },
    locked: () => screen.getByLabelText(/^Slug/u),
  },
  {
    write: "publishAdminFundVersion",
    path: `/funds/${FUND_ID}`,
    act: async () => {
      type(/^Name/u, "Balanced Growth Plus")
      press("Publish version")
      await Promise.resolve()
    },
    locked: () => screen.getByLabelText(/^Name/u),
  },
  {
    write: "transitionAdminFundLifecycle",
    path: `/funds/${FUND_ID}`,
    act: async () => {
      press("Pause")
      await confirmIn("Pause the fund")
    },
    locked: () => screen.getByRole("button", { name: "Archive" }),
  },
  {
    write: "addAdminFundStock",
    path: `/funds/${FUND_ID}/holdings`,
    act: async () => {
      type(/^Stock name/u, "HDFC Bank")
      press(/Add the holding/u)
      await Promise.resolve()
    },
    locked: () => screen.getByLabelText(/^Stock name/u),
  },
  {
    write: "exitAdminFundStock",
    path: `/funds/${FUND_ID}/holdings`,
    act: async () => {
      press("Exit")
      await confirmIn("Mark it exited")
    },
    locked: () => screen.getByRole("button", { name: "Edit" }),
  },
  {
    write: "initializeAdminFundAum",
    path: `/funds/${FUND_ID}/aum`,
    aum: null,
    act: async () => {
      type(/^Opening AUM/u, "250000")
      press("Review the opening AUM")
      await confirmIn("Record opening AUM")
    },
    locked: () => screen.getByLabelText(/^Opening AUM/u),
  },
  {
    write: "appendAdminFundAumGrowth",
    path: `/funds/${FUND_ID}/aum`,
    act: async () => {
      type(/^New fund size/u, "1500000")
      press("Review fund size change")
      await confirmIn("Update fund size")
    },
    locked: () => screen.getByLabelText(/^New fund size/u),
  },
  {
    write: "commitAdminCollectiveAumGrowth",
    path: "/aum/collective",
    act: async () => {
      press("Balanced Growth")
      type(/^Rate in basis points/u, "250")
      press("Preview the batch")
      fireEvent.click(await screen.findByRole("button", { name: /Commit 1 fund size/u }))
      await confirmIn("Commit the batch")
    },
    locked: () => screen.getByLabelText(/^Rate in basis points/u),
  },
  {
    write: "createAdminFaq",
    path: "/faqs",
    act: async () => {
      type(/^Question/u, "Can I invest monthly?")
      type(/^Answer/u, "Yes, through a monthly schedule.")
      press(/Save as draft/u)
      await Promise.resolve()
    },
    locked: () => screen.getByLabelText(/^Question/u),
  },
  {
    write: "editAdminFaq",
    path: "/faqs",
    act: async () => {
      press("Edit")
      type(/^Answer/u, "Write to support for help.")
      press(/Save the draft/u)
      await Promise.resolve()
    },
    locked: () => screen.getByLabelText(/^Answer/u),
  },
  {
    write: "setAdminFaqStatus",
    path: "/faqs",
    act: async () => {
      press("Publish")
      await confirmIn("Publish it")
    },
    locked: () => screen.getByLabelText(/^Question/u),
  },
  {
    write: "archiveAdminFaq",
    path: "/faqs",
    act: async () => {
      press("Archive")
      await confirmIn("Archive it")
    },
    locked: () => screen.getByLabelText(/^Question/u),
  },
  {
    write: "decideAdminApplication",
    path: `/applications/${APPLICATION_ID}`,
    act: async () => {
      press("Approve")
      await confirmIn("Approve and notify")
    },
    locked: () => screen.getByRole("button", { name: "Reject" }),
  },
  {
    write: "publishAdminAppConfig",
    path: "/app-config",
    act: async () => {
      press(/Publish this configuration/u)
      await confirmIn("Publish it")
    },
    locked: () => screen.getByLabelText(/^Configuration/u),
  },
]

describe("admin fund, AUM, FAQ, application and config writes when the reply is lost", () => {
  it.each(ROWS)("$write stays Not confirmed with its inputs locked, and Check again resends the same key", async (row) => {
    if (row.aum !== undefined) fundDetail = detailWith(row.aum)
    open(row.path)
    await screen.findByRole("heading", { level: 1 })
    await waitFor(() => {
      expect(screen.queryAllByText(/Loading|could not be loaded/u)).toHaveLength(0)
    })

    await row.act()
    await screen.findByText("Not confirmed")
    expect(row.locked()).toBeDisabled()

    press("Check again")
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })
    await screen.findByText("Not confirmed")

    expect(sent.map(({ operationId }) => operationId)).toEqual([row.write, row.write])
    expect(typeof keyOf(sent[0])).toBe("string")
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]))
    expect(sent[1]?.options).toEqual(sent[0]?.options)
    expect(row.locked()).toBeDisabled()
  })
})

describe("publishing new terms", () => {
  it("sends every other field of the latest version and its disclosure when one field changed", async () => {
    writeReplies = [accepted]
    open(`/funds/${FUND_ID}`)
    await screen.findByRole("button", { name: "Publish version" })

    type(/^Name/u, "Balanced Growth Plus")
    press("Publish version")
    await waitFor(() => {
      expect(sent).toHaveLength(1)
    })

    expect(sent[0]?.options.body).toEqual({
      name: "Balanced Growth Plus",
      category: "Hybrid",
      objective: "Steady growth",
      riskLevel: "moderate",
      returnTier: null,
      minimumSipPaise: 50_000,
      minimumPurchasePaise: 500_000,
      minimumDurationMonths: 24,
      recommendedHoldingMonths: 36,
      disclosure: { title: "Risk disclosure", body: "Read the scheme documents." },
    })
  })
})

describe("publishing new terms over a newer version", () => {
  it("re-reads the fund before sending and sends nothing when a newer version was published meanwhile", async () => {
    writeReplies = [accepted]
    open(`/funds/${FUND_ID}`)
    await screen.findByRole("button", { name: "Publish version" })
    type(/^Name/u, "Balanced Growth Plus")

    const current = detailWith(SIZED)
    fundDetail = {
      ...current,
      fund: { ...current.fund, currentVersion: 3, currentVersionId: VERSION_3 },
      versions: [
        ...current.versions,
        { ...current.versions[1]!, id: VERSION_3, version: 3, minimumDurationMonths: 48, disclosureVersionId: DISCLOSURE_2 },
      ],
    }
    press("Publish version")

    await screen.findByText("A newer version was published")
    expect(sent).toHaveLength(0)
    expect(screen.getByLabelText(/^Name/u)).toHaveValue("Balanced Growth Plus")
    expect(screen.getByRole("button", { name: "Start again from version 3" })).toBeEnabled()
  })
})

describe("adding a holding when the reply is lost", () => {
  it("keeps the hold across leaving the page, and Check again resends the same key", async () => {
    open(`/funds/${FUND_ID}/holdings`)
    await screen.findByRole("button", { name: /Add the holding/u })
    type(/^Stock name/u, "HDFC Bank")
    press(/Add the holding/u)
    await screen.findByText("Not confirmed")
    cleanup()

    open(`/funds/${FUND_ID}/holdings`)
    await screen.findByText("Not confirmed")
    expect(screen.getByLabelText(/^Stock name/u)).toHaveValue("HDFC Bank")
    expect(screen.getByLabelText(/^Stock name/u)).toBeDisabled()

    press("Check again")
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]))
    expect(sent[1]?.options).toEqual(sent[0]?.options)
  })
})

describe("a fund size change held past a day", () => {
  it("still offers Check again with the same key, because the growth receipt is kept", async () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2026-11-16T10:00:00.000Z"))
    open(`/funds/${FUND_ID}/aum`)
    await screen.findByLabelText(/^New fund size/u)
    type(/^New fund size/u, "1500000")
    press("Review fund size change")
    await confirmIn("Update fund size")
    await screen.findByText("Not confirmed")

    vi.setSystemTime(new Date("2026-11-17T11:00:00.000Z"))
    press("Check again")
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })

    expect(keyOf(sent[1])).toBe(keyOf(sent[0]))
    expect(screen.queryByText("No longer checkable")).toBeNull()
  })
})

describe("an unreadable held fund size", () => {
  it("locks the form and offers only a confirmed new attempt", async () => {
    window.sessionStorage.setItem(
      `beo.admin.held-write.v1:fund-aum-growth:${FUND_ID}`,
      JSON.stringify({ adminId: ADMIN_ID, idempotencyKey: "held-key-0001", body: { asOfDate: "not a date" }, heldAt: Date.now() }),
    )
    open(`/funds/${FUND_ID}/aum`)
    await screen.findByText("Held request not readable")

    expect(screen.getByLabelText(/^New fund size/u)).toBeDisabled()
    expect(screen.queryByRole("button", { name: "I have checked the record" })).toBeNull()

    press("Start a new attempt")
    await confirmIn("Start a new attempt")
    await waitFor(() => {
      expect(screen.getByLabelText(/^New fund size/u)).toBeEnabled()
    })
    expect(sent).toHaveLength(0)
  })
})

describe("a held opening AUM once the fund has an AUM", () => {
  it("stays on the page with Check again instead of being left unseen in the tab", async () => {
    fundDetail = detailWith(null)
    open(`/funds/${FUND_ID}/aum`)
    await screen.findByLabelText(/^Opening AUM/u)
    type(/^Opening AUM/u, "250000")
    press("Review the opening AUM")
    await confirmIn("Record opening AUM")
    await screen.findByText("Not confirmed")
    cleanup()

    fundDetail = detailWith(SIZED)
    open(`/funds/${FUND_ID}/aum`)
    await screen.findByText("Unconfirmed opening AUM")
    press("Check again")
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })

    expect(sent.map(({ operationId }) => operationId)).toEqual(["initializeAdminFundAum", "initializeAdminFundAum"])
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]))
  })
})

describe("default effective dates", () => {
  it.each([
    { form: "new fund", path: "/funds/new", aum: SIZED, label: /^As of date/u },
    { form: "opening AUM", path: `/funds/${FUND_ID}/aum`, aum: null, label: /^As of date/u },
    { form: "fund size", path: `/funds/${FUND_ID}/aum`, aum: SIZED, label: /^As of date/u },
    { form: "collective AUM", path: "/aum/collective", aum: SIZED, label: /^As of\W*$/u },
  ])("the $form form starts on the India day at 23:30 UTC", async ({ path, aum, label }) => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2026-11-16T23:30:00.000Z"))
    fundDetail = detailWith(aum)
    open(path)

    expect(await screen.findByLabelText(label)).toHaveValue("2026-11-17")
  })
})
