import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { QueryClientProvider, onlineManager, useQuery } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TransportError } from "~/api/errors"
import type { TransportOutcome } from "~/api/http"
import { qk } from "~/api/queryKeys"
import { NetworkStatusProvider, useNetworkStatus } from "~/app/providers/NetworkStatusProvider"
import { createQueryClient } from "~/app/providers/QueryProvider"
import { TransportReporter } from "~/app/providers/TransportReporter"

const OFFLINE: TransportOutcome = { ok: false, kind: "offline", status: null }
const ANSWERED: TransportOutcome = { ok: true, kind: "success", status: 200 }
const PROBE_INTERVAL_MS = 10_000

type Call = Readonly<{ answer: () => void; lose: () => void }>

const createTransport = () => {
  let report: (outcome: TransportOutcome) => void = () => undefined
  const calls: Record<"plan" | "config", Call[]> = { plan: [], config: [] }
  const read = (name: "plan" | "config", value: string) => (): Promise<string> =>
    new Promise((resolve, reject) => {
      calls[name].push({
        answer: () => {
          report(ANSWERED)
          resolve(value)
        },
        lose: () => {
          report(OFFLINE)
          reject(new TransportError("offline", "BeOnEdge could not be reached."))
        },
      })
    })
  return {
    calls,
    read,
    bind: (next: (outcome: TransportOutcome) => void): void => {
      report = next
    },
  }
}

type Transport = ReturnType<typeof createTransport>

const Screen = ({ transport }: Readonly<{ transport: Transport }>): React.ReactElement => {
  const { degraded } = useNetworkStatus()
  useQuery({ queryKey: qk.app.config(), queryFn: transport.read("config", "config"), retry: false })
  const plan = useQuery({ queryKey: ["test", "plan"], queryFn: transport.read("plan", "Monthly plan"), retry: false })
  return (
    <>
      {degraded ? <p>Connection lost</p> : null}
      {plan.data === undefined ? null : <p>{plan.data}</p>}
    </>
  )
}

const renderApp = (transport: Transport): void => {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <NetworkStatusProvider>
        <TransportReporter bind={transport.bind} />
        <Screen transport={transport} />
      </NetworkStatusProvider>
    </QueryClientProvider>,
  )
}

const loseEverything = async (transport: Transport): Promise<void> => {
  await waitFor(() => {
    expect(transport.calls.plan).toHaveLength(1)
    expect(transport.calls.config).toHaveLength(1)
  })
  act(() => {
    transport.calls.config[0]?.lose()
    transport.calls.plan[0]?.lose()
  })
  await screen.findByText("Connection lost")
}

const connectionReturns = (): void => {
  act(() => {
    window.dispatchEvent(new Event("online"))
  })
}

afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  vi.useRealTimers()
})

describe("network status after the transport loses the connection", () => {
  it("clears the offline state as soon as the browser reports the connection back, before any request answers", async () => {
    const transport = createTransport()
    renderApp(transport)
    await loseEverything(transport)

    connectionReturns()

    expect(screen.queryByText("Connection lost")).toBeNull()
  })

  it("re-reads the failed queries when the connection returns and shows the offline state again if that read is lost", async () => {
    const transport = createTransport()
    renderApp(transport)
    await loseEverything(transport)

    connectionReturns()
    await waitFor(() => {
      expect(transport.calls.plan).toHaveLength(2)
    })
    act(() => {
      transport.calls.plan[1]?.lose()
    })
    await screen.findByText("Connection lost")

    connectionReturns()
    await waitFor(() => {
      expect(transport.calls.plan).toHaveLength(3)
    })
    act(() => {
      transport.calls.plan[2]?.answer()
    })
    await screen.findByText("Monthly plan")
    expect(screen.queryByText("Connection lost")).toBeNull()
  })

  it("keeps checking every 10 s while the device still reports online, and re-reads the screen once a check answers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const transport = createTransport()
    renderApp(transport)
    await loseEverything(transport)

    act(() => {
      vi.advanceTimersByTime(PROBE_INTERVAL_MS - 1)
    })
    expect(transport.calls.config).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(transport.calls.config).toHaveLength(2)
    expect(transport.calls.plan).toHaveLength(1)
    await act(async () => {
      transport.calls.config[1]?.lose()
      await Promise.resolve()
    })

    act(() => {
      vi.advanceTimersByTime(PROBE_INTERVAL_MS)
    })
    expect(transport.calls.config).toHaveLength(3)
    act(() => {
      transport.calls.config[2]?.answer()
    })

    await waitFor(() => {
      expect(screen.queryByText("Connection lost")).toBeNull()
    })
    await waitFor(() => {
      expect(transport.calls.plan).toHaveLength(2)
    })
    act(() => {
      transport.calls.plan[1]?.answer()
    })
    await screen.findByText("Monthly plan")
  })

  it("keeps checking every 10 s after the browser reported offline and its online event never came, and recovers on the first answer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const transport = createTransport()
    renderApp(transport)
    await loseEverything(transport)
    act(() => {
      window.dispatchEvent(new Event("offline"))
    })

    act(() => {
      vi.advanceTimersByTime(PROBE_INTERVAL_MS)
    })
    expect(transport.calls.config).toHaveLength(2)
    act(() => {
      transport.calls.config[1]?.answer()
    })

    await waitFor(() => {
      expect(screen.queryByText("Connection lost")).toBeNull()
    })
    await waitFor(() => {
      expect(transport.calls.plan).toHaveLength(2)
    })
    act(() => {
      transport.calls.plan[1]?.answer()
    })
    await screen.findByText("Monthly plan")
  })
})
