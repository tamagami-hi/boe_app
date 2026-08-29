/**
 * A hard spend cap for scripts that drive the REAL PhonePe production merchant.
 *
 * These scripts move real money. An earlier run created an unintended ₹50,000
 * order because it clicked an amount *preset* chip rather than typing into the
 * field, and nothing checked the amount before submitting. Nothing here trusts
 * what was typed: the caller must read the value back off the page and pass it
 * to `assertWithinCap` before the pay button is allowed to be clicked.
 *
 * The cap is a module constant on purpose. It is deliberately NOT overridable
 * from the environment — a cap you can raise with an env var is not a cap.
 */

/** Maximum rupees any script in this directory may ever submit. */
export const MAX_RUPEES = 2

export class SpendCapExceeded extends Error {
  constructor(message) {
    super(message)
    this.name = "SpendCapExceeded"
  }
}

/** Parses "₹1,234.50", "1234", " 2 " → 1234.5, 1234, 2. Returns NaN if unparseable. */
export const parseRupees = (text) => {
  if (typeof text !== "string") return Number.NaN
  const cleaned = text.replace(/[₹,\s]/gu, "")
  if (cleaned.length === 0) return Number.NaN
  if (!/^\d+(\.\d+)?$/u.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

/**
 * Throws unless `raw` parses to a positive amount within the cap.
 * `where` names the source so a failure says which field disagreed.
 */
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

/** The amount to type in. Env may only lower it, never raise it. */
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

/**
 * The label the invest screen renders immediately before the payable total.
 * `LumpsumInvestScreen` renders `<MoneyValue amount={amountPaise}>` as the next
 * sibling of this label, and that figure — not the input, and not the "Common
 * amounts" preset chips — is what the order will actually be created for.
 */
const PAYABLE_TOTAL_LABEL = "You are investing"

/**
 * Reads the payable total the screen is currently showing.
 *
 * Deliberately narrow. An earlier version scanned the whole page body, which
 * also picks up the preset chips (₹1,000, ₹5,000 …) and the fund's minimum, so
 * it refused every run for amounts it was never going to submit. Scanning
 * everything is not a stricter check, it is a useless one.
 *
 * Returns null when the total is not on screen yet.
 */
export const readPayableTotal = async (page) => {
  const total = page
    .getByText(PAYABLE_TOTAL_LABEL, { exact: false })
    .first()
    .locator("xpath=following-sibling::*[1]")
  if ((await total.count()) === 0) return null
  return await total.innerText().catch(() => null)
}

/**
 * Fills an amount input, reads it back, and checks the screen's own payable
 * total against the cap. Call this immediately before the pay button; it is the
 * only thing standing between a typo and real money.
 *
 * Fails closed: if the payable total cannot be read, the run is refused rather
 * than proceeding on the strength of the input field alone.
 */
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
