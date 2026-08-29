import { chromium } from "playwright"

const HOST = process.env.BOE_VPS_HOST ?? "https://dev-app.beonedge.in"
const EMAIL = process.env.BOE_VPS_EMAIL ?? ""
const PASSWORD = process.env.BOE_VPS_PASSWORD ?? ""
const AMOUNT = process.env.BOE_TEST_AMOUNT ?? "500"

const log = (l) => process.stdout.write(`${l}\n`)

const browser = await chromium.launch({ headless: false, slowMo: 350 })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

page.on("response", async (r) => {
  const u = r.url()
  if (!u.includes("phonepe.com")) return
  if (r.status() < 400) return
  const body = await r.text().catch(() => "<unreadable>")
  log(`\n>>> PhonePe ${String(r.status())} ${r.request().method()} ${u.slice(0, 150)}`)
  log(`    body: ${body.slice(0, 600)}`)
})

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
await page.goto(`${HOST}${href}/invest/lumpsum`, { waitUntil: "networkidle" })
await page.waitForTimeout(1500)

await page.locator('[role="checkbox"]').first().click().catch(() => undefined)
const amount = page.locator('input[inputmode="numeric"]').first()
await amount.fill("")
await amount.fill(AMOUNT)
await page.waitForTimeout(600)
await page.getByRole("button", { name: /pay|invest|continue|proceed/iu }).last().click()
await page.waitForTimeout(8000)

log(`\non PhonePe: ${page.url().slice(0, 90)}`)

log("\n== clicking 'Click to view QR' to force the failing call ==")
await page.getByText("Click to view QR").first().click().catch(() => log("   (no QR button)"))
await page.waitForTimeout(5000)

log("\n== trying the UPI id / number path a real phone would use ==")
await page.getByText(/UPI apps, number or ID/iu).first().click().catch(() => undefined)
await page.waitForTimeout(4000)
log((await page.locator("body").innerText().catch(() => "")).slice(0, 500).split("\n").map((l) => `   | ${l}`).join("\n"))

await page.screenshot({ path: "/tmp/vps-qr400.png" })
log("\nscreenshot /tmp/vps-qr400.png")
await page.waitForTimeout(2000)
await browser.close()
