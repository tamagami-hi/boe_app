import { describe, expect, it } from "vitest"

import { splitBodyOf, tallySplit } from "./earlierGrowthSplit"

const SIP = { kind: "sip", scheduleId: "11111111-1111-4111-8111-111111111111" } as const
const ONE_TIME = { kind: "one_time", allocationId: "22222222-2222-4222-8222-222222222222" } as const

describe("an earlier growth split can be confirmed only when it adds up to the total", () => {
  it("allows Confirm at the exact total and refuses one paisa over or under", () => {
    expect(tallySplit("1234567", ["10000.00", "2345.67"]).canConfirm).toBe(true)
    expect(tallySplit("1234567", ["10000.00", "2345.68"])).toMatchObject({ canConfirm: false, remainingPaise: "-1" })
    expect(tallySplit("1234567", ["10000", "2345.66"])).toMatchObject({ canConfirm: false, remainingPaise: "1" })
  })

  it("holds for a negative total and negative or zero parts", () => {
    expect(tallySplit("-50001", ["-500", "-0.01"]).canConfirm).toBe(true)
    expect(tallySplit("-50001", ["-500.01", "0"]).canConfirm).toBe(true)
    expect(tallySplit("-50001", ["500", "-1000.01"]).canConfirm).toBe(true)
    expect(tallySplit("-50001", ["-500", "0.01"]).canConfirm).toBe(false)
  })

  it("refuses while any part is empty or not an amount, even when the readable parts add up", () => {
    expect(tallySplit("100000", ["1000", ""]).canConfirm).toBe(false)
    expect(tallySplit("100000", ["1000", "0.001"]).canConfirm).toBe(false)
    expect(tallySplit("100000", ["1,000", "0"]).canConfirm).toBe(false)
    expect(tallySplit("100000", ["1000", "--0"]).canConfirm).toBe(false)
    expect(tallySplit("0", []).canConfirm).toBe(false)
  })

  it("sends each investment its own typed amount, and nothing when the sum is off", () => {
    expect(splitBodyOf("cutoff-1", "1234567", [SIP, ONE_TIME], ["2345.67", "10000"])).toEqual({
      cutoffEntryId: "cutoff-1",
      parts: [
        { ref: SIP, amountPaise: "234567" },
        { ref: ONE_TIME, amountPaise: "1000000" },
      ],
    })
    expect(splitBodyOf("cutoff-1", "1234567", [SIP, ONE_TIME], ["2345.67", "10000.01"])).toBeNull()
    expect(splitBodyOf("cutoff-1", "1234567", [SIP], ["2345.67", "10000"])).toBeNull()
  })

  it("leaves zero parts out of the body, so an investment the proposal skipped is not sent", () => {
    const REVERSED = { kind: "one_time", allocationId: "33333333-3333-4333-8333-333333333333" } as const
    expect(splitBodyOf("cutoff-1", "52346", [SIP, REVERSED, ONE_TIME], ["480.33", "0", "43.13"])).toEqual({
      cutoffEntryId: "cutoff-1",
      parts: [
        { ref: SIP, amountPaise: "48033" },
        { ref: ONE_TIME, amountPaise: "4313" },
      ],
    })
    expect(splitBodyOf("cutoff-1", "52346", [SIP, REVERSED, ONE_TIME], ["480.33", "-0.00", "43.13"])?.parts).toHaveLength(2)
    expect(splitBodyOf("cutoff-1", "0", [SIP, ONE_TIME], ["0", "0"])).toEqual({ cutoffEntryId: "cutoff-1", parts: [] })
  })
})
