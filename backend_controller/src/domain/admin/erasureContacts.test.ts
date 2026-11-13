import { describe, expect, test } from "vitest"

import { createContactScrubber } from "./erasureContacts.js"

const USER_ID = "0b6f2a1e-4c3d-4e5f-8a9b-1c2d3e4f5a6b"
const ERASED_EMAIL = "tombstone+0b6f2a1e4c3d4e5f8a9b1c2d3e4f5a6b@invalid.example"

const scrubber = createContactScrubber(
  {
    emails: ["asha.verma@example.in", "released+abc@released.invalid", ERASED_EMAIL],
    phones: ["+919876543210", "+99900000000001", "tombstone"],
    names: ["Asha Verma", "Tombstoned"],
  },
  USER_ID,
)

describe("the erasure contact scrubber", () => {
  test("keeps only real contacts as needles", () => {
    expect(scrubber.emails).toEqual(["asha.verma@example.in"])
    expect(scrubber.phones).toEqual(["+919876543210"])
  })

  test("replaces whole emails in any case and their masked form, but not a longer address", () => {
    expect(scrubber.text("Write to ASHA.Verma@Example.IN today.")).toBe(`Write to ${ERASED_EMAIL} today.`)
    expect(scrubber.text("Shown as a***@example.in")).toBe("Shown as t***@invalid.example")
    expect(scrubber.text("xasha.verma@example.in and asha.verma@example.in.co")).toBe(
      "xasha.verma@example.in and asha.verma@example.in.co",
    )
  })

  test("replaces phones only between digit boundaries", () => {
    expect(scrubber.text("Call +919876543210, 919876543210 or 9876543210.")).toBe(
      "Call tombstone, tombstone or tombstone.",
    )
    expect(scrubber.text("Ref 198765432101 and 98765432100")).toBe("Ref 198765432101 and 98765432100")
  })

  test("replaces the name word by word only in the client's own text", () => {
    expect(scrubber.ownText("Dear asha verma, thanks.")).toBe("Dear Tombstoned, thanks.")
    expect(scrubber.ownText("Asha Vermaji called")).toBe("Asha Vermaji called")
    expect(scrubber.text("Dear Asha Verma")).toBe("Dear Asha Verma")
  })

  test("rewrites JSON values without touching numbers, keys or a bare national number", () => {
    expect(
      scrubber.json({
        userId: USER_ID,
        email: "asha.verma@example.in",
        phone: "+919876543210",
        amountPaise: "9876543210",
        fullName: "Asha Verma",
        nominee: { name: "Ravi Verma", relation: "Brother" },
        items: [{ note: "via +919876543210" }, 42],
      }),
    ).toEqual({
      userId: USER_ID,
      email: ERASED_EMAIL,
      phone: "tombstone",
      amountPaise: "9876543210",
      fullName: "Tombstoned",
      nominee: { name: "Tombstoned", relation: "Tombstoned" },
      items: [{ note: "via tombstone" }, 42],
    })
  })

  test("reports a mention for history reason text", () => {
    expect(scrubber.mentions("called 9876543210 twice")).toBe(true)
    expect(scrubber.mentions("typo in the address")).toBe(false)
  })
})
