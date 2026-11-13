import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import type { HeldRecording } from "./heldRecordings"
import PaymentSheetScreen from "./PaymentSheetScreen"
import type { SheetSchedule } from "./recordingSheet"

type Reply = Readonly<{ amountPaise: string; effectiveDate: string }>

const row = (index: number, clientName: string): SheetSchedule => ({
  scheduleId: `5c5c5c5c-0000-4000-8000-00000000000${String(index)}`,
  userId: `1d1d1d1d-0000-4000-8000-00000000000${String(index)}`,
  clientName,
  clientEmail: `${clientName.toLowerCase().replace(" ", ".")}@example.com`,
  fundId: "f0f0f0f0-0000-4000-8000-000000000001",
  fundName: "Balanced Fund",
  monthlyAmountPaise: "500000",
  startMonth: "2026-01",
  monthCount: 24,
  recorded: null,
})

const ROWS = [row(1, "Asha Rao"), row(2, "Bala Iyer"), row(3, "Chitra Nair")]

const sent: HeldRecording[] = []
let reply: (held: HeldRecording) => Promise<Reply> = () => Promise.reject(new Error("no reply set"))

const sendRecording = (held: HeldRecording): Promise<Reply> => {
  sent.push(held)
  return reply(held)
}

vi.mock("./recordingSheetQueries", () => ({
  useRecordingSheet: () => ({
    data: { month: "2026-11", items: ROWS },
    isPending: false,
    isFetching: false,
    error: null,
    refetch: () => undefined,
    hasMore: false,
    isLoadingMore: false,
    loadedCount: ROWS.length,
    loadMore: () => undefined,
  }),
  useSendRecording: () => sendRecording,
  useRefreshAfterRecording: () => () => Promise.resolve(),
}))

vi.mock("~/features/admin/shared/queries", () => ({
  useAdminFundCatalogue: () => ({
    data: { items: [{ id: "f0f0f0f0-0000-4000-8000-000000000001", name: "Balanced Fund", slug: "balanced" }] },
    error: null,
    isPending: false,
    isFetching: false,
    refetch: () => undefined,
  }),
}))

const succeed = (held: HeldRecording): Promise<Reply> =>
  Promise.resolve({ amountPaise: held.body.amountPaise, effectiveDate: held.body.effectiveDate })

const timeOut = (): Promise<Reply> => Promise.reject(new TransportError("timeout", "The request timed out."))

const renderSheet = (): void => {
  render(
    <OverlayStackProvider>
      <PaymentSheetScreen />
    </OverlayStackProvider>,
  )
}

const tick = (clientName: string): void => {
  fireEvent.click(screen.getByRole("checkbox", { name: `Record ${clientName}, Balanced Fund` }))
}

const recordTicked = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Record" }))
  fireEvent.click(screen.getByRole("button", { name: "Record the payments" }))
}

const checkAgain = (clientName: string): void => {
  fireEvent.click(screen.getByRole("button", { name: `Check again for ${clientName}, Balanced Fund` }))
}

beforeEach(() => {
  sent.length = 0
  window.sessionStorage.clear()
  renderSheet()
})

afterEach(() => {
  cleanup()
})

describe("recording a month of payments row by row", () => {
  it("keeps one key across Check again and a reload, and sends again only after Record another", async () => {
    reply = timeOut
    tick("Asha Rao")
    recordTicked()
    expect(await screen.findByText("Not confirmed")).toBeTruthy()
    expect(window.sessionStorage.length).toBe(1)

    checkAgain("Asha Rao")
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })
    expect(await screen.findByText("Not confirmed")).toBeTruthy()

    cleanup()
    renderSheet()
    reply = succeed
    checkAgain("Asha Rao")
    expect(await screen.findByText("Recorded")).toBeTruthy()

    const firstKey = sent[0]?.idempotencyKey
    expect(sent.map((held) => held.idempotencyKey)).toEqual([firstKey, firstKey, firstKey])
    expect(sent[2]).toEqual(sent[0])
    expect(sent[0]?.body).toMatchObject({
      amountPaise: "500000",
      reasonCode: "recorded_offline_monthly_investment",
      sipScheduleLink: { scheduleId: ROWS[0]?.scheduleId },
    })
    expect(window.sessionStorage.length).toBe(0)
    const checkbox = screen.getByRole("checkbox", { name: "Record Asha Rao, Balanced Fund" })
    expect(checkbox.hasAttribute("disabled")).toBe(true)
    fireEvent.click(checkbox)
    expect(screen.getByRole("button", { name: "Record" }).hasAttribute("disabled")).toBe(true)
    expect(sent).toHaveLength(3)

    fireEvent.click(screen.getByRole("button", { name: "Record another for Asha Rao, Balanced Fund" }))
    tick("Asha Rao")
    recordTicked()
    await waitFor(() => {
      expect(sent).toHaveLength(4)
    })
    expect(sent[3]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey)
    expect(sent[3]?.body).toEqual(sent[0]?.body)
  })

  it("sends at most two rows at a time and starts the next one when a reply arrives", async () => {
    const pending: (() => void)[] = []
    reply = (held) =>
      new Promise<Reply>((resolve) => {
        pending.push(() => {
          resolve({ amountPaise: held.body.amountPaise, effectiveDate: held.body.effectiveDate })
        })
      })
    for (const { clientName } of ROWS) tick(clientName)
    recordTicked()

    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })
    expect(screen.getAllByText("Sending")).toHaveLength(2)
    expect(screen.getByText("Pending")).toBeTruthy()

    pending[0]?.()
    await waitFor(() => {
      expect(sent).toHaveLength(3)
    })
    expect(screen.getAllByText("Sending")).toHaveLength(2)
    expect(new Set(sent.map((held) => held.idempotencyKey)).size).toBe(3)
  })
})
