import { describe, expect, test } from "vitest"

import { resolveRescrubInvocation } from "./rescrubErasedPhones.js"

describe("the erased-phone re-scrub invocation", () => {
  test("is a dry run unless --apply is given", () => {
    expect(resolveRescrubInvocation([], { NODE_ENV: "development" })).toEqual({ kind: "run", apply: false })
    expect(resolveRescrubInvocation(["--apply"], { NODE_ENV: "test" })).toEqual({ kind: "run", apply: true })
  })

  test("refuses a production database without --allow-production, in either mode", () => {
    expect(resolveRescrubInvocation([], { NODE_ENV: "production" }).kind).toBe("refused")
    expect(resolveRescrubInvocation(["--apply"], { NODE_ENV: "production" }).kind).toBe("refused")
    expect(resolveRescrubInvocation(["--allow-production"], { NODE_ENV: "production" })).toEqual({ kind: "run", apply: false })
    expect(resolveRescrubInvocation(["--apply", "--allow-production"], { NODE_ENV: "production" })).toEqual({
      kind: "run",
      apply: true,
    })
  })

  test("refuses an unknown or misspelt flag instead of running", () => {
    expect(resolveRescrubInvocation(["--allow-prod"], { NODE_ENV: "production" }).kind).toBe("refused")
    expect(resolveRescrubInvocation(["--aply"], { NODE_ENV: "development" }).kind).toBe("refused")
  })
})
