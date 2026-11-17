import { afterAll, beforeAll, vi } from "vitest"

export const dropRequestSignalsInThisFile = (): void => {
  beforeAll(() => {
    const NodeRequest = globalThis.Request
    vi.stubGlobal(
      "Request",
      class extends NodeRequest {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          super(input, init === undefined ? undefined : { ...init, signal: null })
        }
      },
    )
  })
  afterAll(() => {
    vi.unstubAllGlobals()
  })
}
