import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"

import AppConfigBuilderScreen from "./AppConfigBuilderScreen"

type Settle = Readonly<{ onSuccess?: (value: unknown) => void; onError?: (error: unknown) => void }>

const CONFIRMATION = "c".repeat(43)

const PUBLISHED = {
  version: 7,
  config: {
    featureFlags: { onlinePayments: false, beta: true },
    minimumSupportedVersion: { android: "0.18.0" },
    downloads: {},
    maintenance: { enabled: false },
    presentation: { theme: "dark" },
  },
  publishedAt: "2026-11-01T04:30:00.000Z",
  publishedBy: "11111111-1111-4111-8111-111111111111",
  contentSha256: "a".repeat(64),
}

const confirmations: unknown[] = []
const published: unknown[] = []

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ hasAnyPermission: () => true, principal: { userId: "admin-1" } }),
}))

vi.mock("./appConfigQueries", () => ({
  useAdminAppConfig: () => ({
    data: PUBLISHED,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: () => Promise.resolve({ isError: false, data: PUBLISHED }),
  }),
  useConfirmPublishPassword: () => ({
    isPending: false,
    mutate: (input: unknown, settle: Settle) => {
      confirmations.push(input)
      settle.onSuccess?.({ confirmation: CONFIRMATION, action: "app_config.publish", expiresAt: "2026-11-18T08:05:00.000Z" })
    },
  }),
  usePublishAppConfig: () => ({
    isPending: false,
    reset: () => undefined,
    mutate: (variables: unknown) => {
      published.push(variables)
    },
  }),
}))

const renderScreen = (): void => {
  render(
    <OverlayStackProvider>
      <AppConfigBuilderScreen />
    </OverlayStackProvider>,
  )
}

const jsonArea = (): HTMLTextAreaElement => screen.getByLabelText("Configuration JSON")

const openAdvanced = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "Advanced: the configuration as JSON" }))
}

const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  vi.stubEnv("VITE_BEO_APP_VERSION", "0.18.3")
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  confirmations.length = 0
  published.length = 0
})

describe("the app config form and its Advanced JSON", () => {
  it("writes exactly what the admin set, follows JSON edits back into the form, and publishes that JSON", () => {
    renderScreen()
    openAdvanced()

    fireEvent.click(screen.getByRole("switch", { name: "Online payments in the client app" }))
    type("Android", "0.18.3")
    type("Message", "Upgrade tonight.")
    type("Planned start, India time", "2026-11-20T22:30")
    type("Add a flag", "newFlag")
    fireEvent.click(screen.getByRole("button", { name: "Add the flag" }))

    expect(JSON.parse(jsonArea().value)).toEqual({
      featureFlags: { onlinePayments: true, beta: true, newFlag: false },
      minimumSupportedVersion: { android: "0.18.3" },
      downloads: {},
      maintenance: { enabled: false, message: "Upgrade tonight.", scheduledFor: "2026-11-20T22:30:00+05:30" },
      presentation: { theme: "dark" },
    })

    const edited = { ...(JSON.parse(jsonArea().value) as Record<string, unknown>) }
    fireEvent.change(jsonArea(), {
      target: {
        value: JSON.stringify({
          ...edited,
          minimumSupportedVersion: { android: "0.18.1" },
          maintenance: { enabled: true, message: "Upgrade tonight.", scheduledFor: "2026-11-20T17:00:00.000Z" },
        }),
      },
    })

    expect(screen.getByLabelText<HTMLInputElement>("Android").value).toBe("0.18.1")
    expect(screen.getByRole("switch", { name: "Maintenance in progress" }).getAttribute("aria-checked")).toBe("true")
    expect(screen.getByLabelText<HTMLInputElement>("Planned start, India time").value).toBe("2026-11-20T22:30")

    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/Your password/u), { target: { value: "the admin password" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }))

    const reviewed = { config: JSON.parse(jsonArea().value) as Record<string, unknown>, expectedVersion: 7 }
    expect(confirmations).toEqual([{ password: "the admin password", body: reviewed }])
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ ...reviewed, confirmation: CONFIRMATION })
  })
})

describe("a minimum version above this release", () => {
  it("warns on the form and again before the password that every installed app would be locked out", () => {
    renderScreen()

    type("Android", "0.18.3")
    expect(screen.queryByText("This would lock out every installed app")).toBeNull()

    type("Android", "0.18.4")
    expect(screen.getByText("This would lock out every installed app")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }))
    expect(within(screen.getByRole("dialog")).getByText("This would lock out every installed app")).toBeTruthy()
  })
})
