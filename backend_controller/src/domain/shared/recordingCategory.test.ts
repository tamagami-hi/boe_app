import { describe, expect, test } from "vitest"

import { recordingNoticeOf, type RecordingNoticeInput } from "./recordingCategory.js"

const FUND = "Harbour Growth Fund"

const noticeOf = (input: Omit<RecordingNoticeInput, "fundName">) => recordingNoticeOf({ ...input, fundName: FUND })

describe("the in-app notice for a new recording", () => {
  test("names a SIP payment and its SIP month", () => {
    expect(
      noticeOf({ reasonCode: "recorded_offline_monthly_investment", assigned: "sip", sipMonth: "2026-09" }),
    ).toEqual({
      title: "SIP payment recorded",
      body: `Your SIP payment for September 2026 in ${FUND} is now in your portfolio. Contact support if you do not recognise it.`,
    })
  })

  test("names a one-time investment", () => {
    expect(noticeOf({ reasonCode: "recorded_offline_investment", assigned: "one_time", sipMonth: null })).toEqual({
      title: "One-time investment recorded",
      body: `Your one-time investment in ${FUND} is now in your portfolio. Contact support if you do not recognise it.`,
    })
  })

  test.each([
    ["recorded_offline_investment", "Investment added", `Your earlier investment in ${FUND} is now in your portfolio.`],
    ["recorded_offline_monthly_investment", "Investment added", `Your monthly investment in ${FUND} is now in your portfolio.`],
    ["recorded_offline_correction", "Investment record corrected", `Your ${FUND} record now includes a correction.`],
  ])("keeps the released wording for an uncategorised %s", (reasonCode, title, opening) => {
    const notice = noticeOf({ reasonCode, assigned: null, sipMonth: null })

    expect(notice.title).toBe(title)
    expect(notice.body.startsWith(opening)).toBe(true)
  })
})
