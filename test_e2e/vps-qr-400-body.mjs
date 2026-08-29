import { chromium } from "playwright"

import { MAX_RUPEES, fillAmountUnderCap, requestedRupees } from "./lib/amount-guard.mjs"

const HOST = process.env.BOE_VPS_HOST ?? "https://dev-app.beonedge.in"
const EMAIL = process.env.BOE_VPS_EMAIL ?? ""
const PASSWORD = process.env.BOE_VPS_PASSWORD ?? ""

const log = (l) => process.stdout.write(`${l}\n`)

if (EMAIL === "" || PASSWORD === "") {
  log("set BOE_VPS_EMAIL and BOE_VPS_PASSWORD")
  process.exit(2)
}

const rupees = requestedRupees()
log(`spend cap ₹${String(MAX_RUPEES)} · this run will submit ₹${String(rupees)}`)

const browser = await chromium.launch({ headless: false, slowMo: 350 })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const phonePeFailures = []
page.on("response", async (r) => {
  const u = r.url()
  if (!u.includes("phonepe.com") || r.status() < 400) return
  const body = await r.text().catch(() => "<unreadable>")
  phonePeFailures.push({ status: r.status(), url: u, body })
  log(`\n>>> PhonePe ${String(r.status())} ${r.request().method()} ${u.slice(0, 150)}`)
  log(`    body: ${body.slice(0, 600)}`)
})

try {
  await page.goto(`${HOST}/login`, { waitUntil: "networkidle" })
  await page.getByLabel("Email").fill(EMAIL)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(3500)

  await page.goto(`${HOST}/funds`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  const href = await page.evaluate(() => {
    for (const a of document.querySelectorAll("a[href]")) {
      const h = a.getAttribute("href") ?? ""
      if (/^\/funds\/[0-9a-f]{8}-/u.test(h)) return h
    }
    return null
  })
  if (href === null) throw new Error("no fund link found — is the account approved?")

  await page.goto(`${HOST}${href}/invest/lumpsum`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)

  await page.locator('[role="checkbox"]').first().click().catch(() => undefined)

  const amount = page.locator('input[inputmode="numeric"]').first()
  const first = await fillAmountUnderCap(amount, rupees, page)
  log(`typed ₹${first.typed} · screen says "${first.total}" — within cap, proceeding`)
  await page.waitForTimeout(600)

  const confirmed = await fillAmountUnderCap(amount, rupees, page)

  log(`final check before real money: screen total "${confirmed.total}"`)
  await page.getByRole("button", { name: /pay|invest|continue|proceed/iu }).last().click()
  await page.waitForTimeout(8000)

  log(`\non PhonePe: ${page.url().slice(0, 90)}`)

  log("\n== forcing the failing call via 'Click to view QR' ==")
  await page.getByText("Click to view QR").first().click().catch(() => log("   (no QR button)"))
  await page.waitForTimeout(5000)

  log("\n== the UPI id / number path a real phone would use ==")
  await page.getByText(/UPI apps, number or ID/iu).first().click().catch(() => undefined)
  await page.waitForTimeout(4000)
  log(
    (await page.locator("body").innerText().catch(() => ""))
      .slice(0, 500)
      .split("\n")
      .map((l) => `   | ${l}`)
      .join("\n"),
  )

  await page.screenshot({ path: "/tmp/vps-qr400.png" })
  log("\nscreenshot /tmp/vps-qr400.png")

  log("\n================ verdict ================")
  const blocked = phonePeFailures.find((f) => f.body.includes("INTERNAL_SECURITY_BLOCK"))
  if (blocked === undefined) {
    log(`no INTERNAL_SECURITY_BLOCK seen (${String(phonePeFailures.length)} PhonePe failures total)`)
  } else {
    log("PhonePe refused the transaction with INTERNAL_SECURITY_BLOCK.")
    log("That is a merchant-side domain whitelist, not a defect in this stack:")
    log(`  ${blocked.body.slice(0, 300)}`)
  }
} finally {
  await page.waitForTimeout(1500)
  await browser.close()
}
