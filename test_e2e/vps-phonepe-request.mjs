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

const browser = await chromium.launch({ headless: false, slowMo: 150 })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const captured = []

page.on("request", (request) => {
  const url = request.url()
  if (!url.includes("phonepe.com")) return
  if (!/\/checkout\/ui\/v2\/pay|\/checkout\/v2\//u.test(url)) return
  captured.push({
    url,
    method: request.method(),
    referer: request.headers()["referer"] ?? null,
    origin: request.headers()["origin"] ?? null,
    postData: request.postData(),
  })
})

try {
  await page.goto(`${HOST}/login`, { waitUntil: "networkidle" })
  await page.getByLabel("Email").fill(EMAIL)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(4000)

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
  await fillAmountUnderCap(amount, rupees, page)
  await page.waitForTimeout(500)
  await fillAmountUnderCap(amount, rupees, page)
  log(`spend cap ₹${String(MAX_RUPEES)} · submitted ₹${String(rupees)}`)

  await page.getByRole("button", { name: /pay|invest|continue|proceed/iu }).last().click()
  await page.waitForTimeout(9000)
  await page.getByText("Click to view QR").first().click().catch(() => undefined)
  await page.waitForTimeout(5000)

  log("\n============ what the BROWSER sent to PhonePe ============")
  for (const call of captured) {
    log(`\n${call.method} ${call.url.slice(0, 110)}`)
    log(`  referer: ${String(call.referer)}`)
    log(`  origin : ${String(call.origin)}`)
    if (call.postData === null) {
      log("  body   : <none>")
      continue
    }
    log(`  body   : ${call.postData.slice(0, 900)}`)
    const hits = [...call.postData.matchAll(/[a-z0-9.-]*beonedge\.in[^"',\s]*/giu)].map((m) => m[0])
    log(`  beonedge hostnames in body: ${hits.length === 0 ? "NONE" : JSON.stringify([...new Set(hits)])}`)
  }

  log("\n============ verdict ============")
  const anyBody = captured.some((c) => c.postData !== null && /beonedge\.in/iu.test(c.postData))
  if (anyBody) {
    log("The BROWSER is sending our hostname to PhonePe.")
    log("=> the transacting URL comes from the client, so it is fixable here.")
  } else {
    log("The browser sends no beonedge hostname at all.")
    log("=> PhonePe resolves the transacting URL server-side, from the token or")
    log("   from the merchant record. No client or redirect change can alter it.")
  }
} finally {
  await page.waitForTimeout(1000)
  await browser.close()
}
