import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, TransportError } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { emitSessionInvalidated } from "~/api/session/scope"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import { keepHeldRecording } from "./heldRecordings"
import type { HeldRecording } from "./heldRecordings"
import PaymentSheetScreen from "./PaymentSheetScreen"
import { recordingBodyOf } from "./recordingSheet"
import type { SheetSchedule } from "./recordingSheet"
import type { RecordedContribution } from "./recordingSheetQueries"
import { useRecordingSheetRecorder } from "./useRecordingSheetRecorder"

type Reply = RecordedContribution

const ADMIN_ID = "a0a0a0a0-0000-4000-8000-000000000001"
const OTHER_ADMIN_ID = "b0b0b0b0-0000-4000-8000-000000000002"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ principal: { userId: ADMIN_ID }, scope: "admin" }),
}))

const replyFor = (held: HeldRecording): Reply => ({
  entryId: "e0e0e0e0-0000-4000-8000-000000000001",
  userId: held.userId,
  fundId: held.body.fundId,
  orderId: "e0e0e0e0-0000-4000-8000-000000000002",
  paymentId: "e0e0e0e0-0000-4000-8000-000000000003",
  allocationId: "e0e0e0e0-0000-4000-8000-000000000004",
  fundVersionId: "e0e0e0e0-0000-4000-8000-000000000005",
  fundVersionEffectiveOnDate: true,
  amountPaise: held.body.amountPaise,
  effectiveDate: held.body.effectiveDate,
  reasonCode: held.body.reasonCode,
  principalPaise: held.body.amountPaise,
  currentValuePaise: held.body.amountPaise,
})

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

type SheetState = Readonly<{ items: readonly SheetSchedule[]; hasMore: boolean }>

const COMPLETE: SheetState = { items: ROWS, hasMore: false }
let sheetState: SheetState = COMPLETE

vi.mock("./recordingSheetQueries", () => ({
  useRecordingSheet: () => ({
    data: { month: "2026-11", items: sheetState.items },
    isPending: false,
    isFetching: sheetState.hasMore,
    error: null,
    refetch: () => undefined,
    hasMore: sheetState.hasMore,
    isLoadingMore: sheetState.hasMore,
    loadedCount: sheetState.items.length,
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

const succeed = (held: HeldRecording): Promise<Reply> => Promise.resolve(replyFor(held))

const timeOut = (): Promise<Reply> => Promise.reject(new TransportError("timeout", "The request timed out."))

const badGateway = (): Promise<Reply> =>
  Promise.reject(new ApiError({ code: "INTERNAL_ERROR", message: "Bad gateway", status: 502, retryable: true }))

const csrfRefused = (): Promise<Reply> =>
  Promise.reject(
    new ApiError({ code: "CSRF_INVALID", message: "The request could not be verified.", status: 403, retryable: false }),
  )

const monthTaken = (): Promise<Reply> =>
  Promise.reject(
    new ApiError({
      code: "VALIDATION_FAILED",
      message: "The request is not valid.",
      status: 400,
      retryable: false,
      fields: { "sipScheduleLink.month": ["is already paid by another recording"] },
    }),
  )

const heldKeys = (): readonly string[] =>
  Array.from({ length: window.sessionStorage.length }, (_, index) => {
    const raw = window.sessionStorage.getItem(window.sessionStorage.key(index) ?? "") ?? "{}"
    return String((JSON.parse(raw) as Readonly<{ idempotencyKey?: unknown }>).idempotencyKey)
  })

const ashaCheckbox = (): HTMLElement => screen.getByRole("checkbox", { name: "Record Asha Rao, Balanced Fund" })

const recordButton = (): HTMLElement | null => screen.queryByRole("button", { name: "Record" })

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
  sheetState = COMPLETE
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe("recording a month of payments row by row", () => {
  it("keeps one key across Check again and a reload, and sends again only after Record another", async () => {
    renderSheet()
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
    renderSheet()
    const pending: (() => void)[] = []
    reply = (held) =>
      new Promise<Reply>((resolve) => {
        pending.push(() => {
          resolve(replyFor(held))
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

  it("sends once when Record the payments is clicked twice", async () => {
    renderSheet()
    reply = succeed
    tick("Asha Rao")
    fireEvent.click(screen.getByRole("button", { name: "Record" }))
    const confirm = screen.getByRole("button", { name: "Record the payments" })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(await screen.findByText("Recorded")).toBeTruthy()
    expect(sent).toHaveLength(1)
  })

  it("sends once when Record fires twice before the screen re-renders", async () => {
    reply = succeed
    const asha = row(1, "Asha Rao")
    const job = {
      userId: asha.userId,
      body: recordingBodyOf(asha, "2026-11", { amountPaise: "500000", effectiveDate: "2026-11-02" }),
    }
    const { result } = renderHook(() => useRecordingSheetRecorder("2026-11", sendRecording, () => Promise.resolve()))

    act(() => {
      result.current.record([job])
      result.current.record([job])
    })

    await waitFor(() => {
      expect(result.current.entries.get(asha.scheduleId)?.kind).toBe("recorded")
    })
    expect(sent).toHaveLength(1)
  })

  it.each([
    { way: "the session-ended event", announce: true, rowsEnd: "recorded" },
    { way: "a row refused because the session ended", announce: false, rowsEnd: "refused" },
  ] as const)("sends no further row once the session ends, learnt from $way", async ({ announce, rowsEnd }) => {
    const answers: (() => void)[] = []
    reply = (held) =>
      new Promise<Reply>((resolve, reject) => {
        answers.push(() => {
          if (announce) resolve(replyFor(held))
          else reject(new ApiError({ code: "AUTHENTICATION_REQUIRED", message: "Sign in to continue.", status: 401, retryable: false }))
        })
      })
    const jobs = ROWS.map((schedule) => ({
      userId: schedule.userId,
      body: recordingBodyOf(schedule, "2026-11", { amountPaise: "500000", effectiveDate: "2026-11-02" }),
    }))
    const { result } = renderHook(() => useRecordingSheetRecorder("2026-11", sendRecording, () => Promise.resolve()))
    act(() => {
      result.current.record(jobs)
    })
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })

    if (announce) emitSessionInvalidated({ scope: "admin", reason: "revoked" })
    for (const answer of answers) answer()
    await waitFor(() => {
      expect(ROWS.slice(0, 2).map(({ scheduleId }) => result.current.entries.get(scheduleId)?.kind)).toEqual([rowsEnd, rowsEnd])
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

    expect(sent).toHaveLength(2)
    expect(result.current.entries.get(ROWS[2]?.scheduleId ?? "")?.kind).toBe("queued")
  })

  it("restores only the rows the signed-in admin left held, and drops another admin's", () => {
    const holdRow = (adminId: string, schedule: SheetSchedule): void => {
      keepHeldRecording(adminId, {
        idempotencyKey: mintIdempotencyKey(),
        userId: schedule.userId,
        body: recordingBodyOf(schedule, "2026-11", { amountPaise: "500000", effectiveDate: "2026-11-02" }),
      })
    }
    const [asha, bala] = [row(1, "Asha Rao"), row(2, "Bala Iyer")]
    holdRow(OTHER_ADMIN_ID, asha)
    holdRow(ADMIN_ID, bala)

    const { result } = renderHook(() => useRecordingSheetRecorder("2026-11", sendRecording, () => Promise.resolve()))

    expect([...result.current.held.keys()]).toEqual([bala.scheduleId])
    expect(result.current.entries.get(asha.scheduleId)).toBeUndefined()
    expect(window.sessionStorage.length).toBe(1)
    expect(sent).toHaveLength(0)
  })

  it("releases the key of a row the server refused, so the next Record mints a new one", async () => {
    renderSheet()
    reply = monthTaken
    tick("Asha Rao")
    recordTicked()

    expect(await screen.findByText("Refused")).toBeTruthy()
    expect(screen.getByText("Month is already paid by another recording")).toBeTruthy()
    expect(heldKeys()).toEqual([])
    expect(ashaCheckbox().getAttribute("aria-checked")).toBe("true")

    reply = succeed
    recordTicked()
    expect(await screen.findByText("Recorded")).toBeTruthy()
    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey)
  })

  it("leaves a row Not confirmed with its key held after a server error", async () => {
    renderSheet()
    reply = badGateway
    tick("Asha Rao")
    recordTicked()

    expect(await screen.findByText("Not confirmed")).toBeTruthy()
    expect(heldKeys()).toEqual([sent[0]?.idempotencyKey])
    expect(ashaCheckbox().hasAttribute("disabled")).toBe(true)
    expect(recordButton()?.hasAttribute("disabled")).toBe(true)

    checkAgain("Asha Rao")
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })
    expect(sent[1]).toEqual(sent[0])
    expect(await screen.findByText("Not confirmed")).toBeTruthy()
    expect(heldKeys()).toEqual([sent[0]?.idempotencyKey])
  })

  it("keeps a row Not confirmed with its key held when Check again is refused before the server reads it", async () => {
    renderSheet()
    reply = badGateway
    tick("Asha Rao")
    recordTicked()
    expect(await screen.findByText("Not confirmed")).toBeTruthy()

    reply = csrfRefused
    checkAgain("Asha Rao")
    await waitFor(() => {
      expect(sent).toHaveLength(2)
    })

    expect(await screen.findByText("Not confirmed")).toBeTruthy()
    expect(screen.queryByText("Refused")).toBeNull()
    expect(sent[1]).toEqual(sent[0])
    expect(heldKeys()).toEqual([sent[0]?.idempotencyKey])
    expect(recordButton()?.hasAttribute("disabled")).toBe(true)
  })

  it("offers no rows, Record or empty message until the walk is complete", () => {
    sheetState = { items: ROWS.slice(0, 1), hasMore: true }
    renderSheet()
    expect(screen.getByText("Loading the schedules due this month: 1 loaded so far.")).toBeTruthy()
    expect(recordButton()).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()

    cleanup()
    sheetState = { items: [], hasMore: true }
    renderSheet()
    expect(screen.queryByText("No SIP schedule is due this month")).toBeNull()
    expect(recordButton()).toBeNull()

    cleanup()
    sheetState = { items: [], hasMore: false }
    renderSheet()
    expect(screen.getByText("No SIP schedule is due this month")).toBeTruthy()
    expect(recordButton()).toBeNull()
  })
})
