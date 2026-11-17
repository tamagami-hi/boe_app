import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import type { getAdminAppConfig, getAdminApplication, listAdminFaqs } from "~/api/generated/operations"
import type { DataOf, HttpClient } from "~/api/http"
import { ApiProvider } from "~/app/providers/ApiProvider"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import { ToastProvider } from "~/app/providers/ToastProvider"
import AppConfigBuilderScreen from "~/features/admin/app-config/AppConfigBuilderScreen"
import ApplicationDetailScreen from "~/features/admin/applications/ApplicationDetailScreen"
import FaqListScreen from "~/features/admin/content/FaqListScreen"

type Sent = Readonly<{ operationId: string; options: Readonly<Record<string, unknown>> }>
type Operation = Readonly<{ operationId: string; method: string }>

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1"
const FAQ_ID = "55555555-5555-4555-8555-555555555555"
const APPLICATION_ID = "66666666-6666-4666-8666-666666666666"
const AT = "2026-11-01T10:00:00.000Z"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({
    principal: { userId: ADMIN_ID, roles: ["admin"], permissions: [] },
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}))

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

const sent: Sent[] = []
let writeReplies: (() => Promise<unknown>)[] = []

const timedOut = (): Promise<unknown> => Promise.reject(new TransportError("timeout", "The request timed out."))

const READS: Readonly<Record<string, () => unknown>> = {
  listAdminFaqs: () => FAQS,
  getAdminApplication: () => APPLICATION,
  getAdminAppConfig: () => APP_CONFIG,
}

const request = async (operation: Operation, options: Readonly<Record<string, unknown>> = {}): Promise<unknown> => {
  const read = READS[operation.operationId]
  if (read !== undefined) return { data: read(), meta: { requestId: null, timestamp: null, idempotencyReplay: false, page: null } }
  sent.push({ operationId: operation.operationId, options })
  return (writeReplies.shift() ?? timedOut)()
}

const api = { request } as unknown as HttpClient

const SCREENS = [
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
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

type Row = Readonly<{
  write: string
  path: string
  act: () => Promise<void>
  locked: () => HTMLElement
}>

const ROWS: readonly Row[] = [
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
      await Promise.resolve()
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

describe("admin FAQ, application and config writes when the reply is lost", () => {
  it.each(ROWS)("$write stays Not confirmed with its inputs locked, and Check again resends the same key", async (row) => {
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
