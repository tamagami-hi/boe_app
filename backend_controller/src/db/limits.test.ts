import { describe, expect, test } from "vitest"

import {
  MAX_APPLICATION_CONSENTS,
  MAX_APPLICATION_REVIEWS,
  MAX_EMAIL_DELIVERIES_PER_APPLICATION,
  MAX_OUTBOX_CLAIM,
  MAX_PROVIDER_EVENT_CLAIM,
  MAX_QUERY_LIMIT,
} from "./limits.js"

describe("repository hard bounds", () => {
  test("pins the spec 03 §7 ceilings", () => {
    expect(MAX_QUERY_LIMIT).toBe(100)
    expect(MAX_APPLICATION_CONSENTS).toBe(2)
    expect(MAX_APPLICATION_REVIEWS).toBe(1)
    expect(MAX_EMAIL_DELIVERIES_PER_APPLICATION).toBe(100)
    expect(MAX_PROVIDER_EVENT_CLAIM).toBe(100)
    expect(MAX_OUTBOX_CLAIM).toBe(100)
  })
})
