import { describe, expect, test } from "vitest"

import { csvCell, paiseToRupeeText, toCsv } from "./reportCsv"

describe("accounting CSV", () => {
  test.each([
    ["=HYPERLINK(\"http://x\")", "\"'=HYPERLINK(\"\"http://x\"\")\""],
    ["+91 98", "'+91 98"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tcmd", "'\tcmd"],
    ["\rcmd", "\"'\rcmd\""],
    ["-123.45", "-123.45"],
    ["0.05", "0.05"],
    ["Asha, Rao", "\"Asha, Rao\""],
    ["say \"hi\"", "\"say \"\"hi\"\"\""],
    ["two\nlines", "\"two\nlines\""],
    ["Plain name", "Plain name"],
    [" =1+1", "' =1+1"],
    ["  @SUM(A1)", "'  @SUM(A1)"],
    ["\u00A0+cmd", "'\u00A0+cmd"],
    ["\t=cmd", "'\t=cmd"],
    ["\n=cmd", "\"'\n=cmd\""],
    ["\r\n-2+3", "\"'\r\n-2+3\""],
    [" -1.5", "' -1.5"],
    ["-1.5\n", "\"'-1.5\n\""],
    ["\"=1+1\"", "\"\"\"=1+1\"\"\""],
    ["'=1", "'=1"],
    ["a\r\nb", "\"a\r\nb\""],
    ["1,234.50", "\"1,234.50\""],
    ["", ""],
  ])("writes %j as %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected)
  })

  test("joins records with CRLF after a header row", () => {
    expect(toCsv(["Client", "Amount (INR)"], [["=1+1", "-0.50"], ["Ravi", "12.00"]])).toBe(
      "Client,Amount (INR)\r\n'=1+1,-0.50\r\nRavi,12.00\r\n",
    )
  })

  test.each([
    ["0", "0.00"],
    ["5", "0.05"],
    ["-5", "-0.05"],
    ["100", "1.00"],
    ["-12345", "-123.45"],
    ["9223372036854775807", "92233720368547758.07"],
    ["-9223372036854775808", "-92233720368547758.08"],
  ])("converts %s paise to %s rupees without rounding", (paise, rupees) => {
    expect(paiseToRupeeText(paise)).toBe(rupees)
  })

  test.each(["1.5", "1e3", "", "12 ", "0x10"])("refuses %j as paise", (paise) => {
    expect(() => paiseToRupeeText(paise)).toThrow()
  })
})
