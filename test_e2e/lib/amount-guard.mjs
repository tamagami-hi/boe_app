
export const MAX_RUPEES = 2

export class SpendCapExceeded extends Error {
  constructor(message) {
    super(message)
    this.name = "SpendCapExceeded"
  }
}

export const parseRupees = (text) => {
  if (typeof text !== "string") return Number.NaN
  const cleaned = text.replace(/[₹,\s]/gu, "")
  if (cleaned.length === 0) return Number.NaN
  if (!/^\d+(\.\d+)?$/u.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

export const assertWithinCap = (raw, where) => {
  const rupees = parseRupees(raw)
  if (Number.isNaN(rupees)) {
    throw new SpendCapExceeded(
      `refusing to pay: could not read an amount from ${where} (saw ${JSON.stringify(raw)})`,
    )
  }
  if (rupees <= 0) {
    throw new SpendCapExceeded(`refusing to pay: ${where} is ${String(rupees)}, not a positive amount`)
  }
  if (rupees > MAX_RUPEES) {
    throw new SpendCapExceeded(
      `refusing to pay: ${where} is ₹${String(rupees)}, over the ₹${String(MAX_RUPEES)} cap. ` +
        `This script drives the live production merchant.`,
    )
  }
  return rupees
}

export const requestedRupees = () => {
  const raw = process.env.BOE_TEST_AMOUNT ?? String(MAX_RUPEES)
  const rupees = parseRupees(raw)
  if (Number.isNaN(rupees) || rupees <= 0) {
    throw new SpendCapExceeded(`BOE_TEST_AMOUNT=${JSON.stringify(raw)} is not a positive amount`)
  }
  if (rupees > MAX_RUPEES) {
    throw new SpendCapExceeded(
      `BOE_TEST_AMOUNT=₹${String(rupees)} exceeds the ₹${String(MAX_RUPEES)} cap and will not be honoured`,
    )
  }
  return rupees
}

const PAYABLE_TOTAL_LABEL = "You are investing"

export const readPayableTotal = async (page) => {
  const total = page
    .getByText(PAYABLE_TOTAL_LABEL, { exact: false })
    .first()
    .locator("xpath=following-sibling::*[1]")
  if ((await total.count()) === 0) return null
  return await total.innerText().catch(() => null)
}

export const fillAmountUnderCap = async (input, rupees, page) => {
  assertWithinCap(String(rupees), "the requested amount")
  await input.fill("")
  await input.fill(String(rupees))
  const readBack = await input.inputValue()
  assertWithinCap(readBack, "the amount field after typing")

  const total = await readPayableTotal(page)
  if (total === null) {
    throw new SpendCapExceeded(
      `refusing to pay: could not read the "${PAYABLE_TOTAL_LABEL}" total off the screen, ` +
        `so the amount that would actually be submitted is unverified`,
    )
  }
  assertWithinCap(total, `the screen's payable total ("${total}")`)
  return { typed: readBack, total }
}
