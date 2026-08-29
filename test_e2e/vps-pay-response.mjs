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
log(`spend cap ₹${String(MAX_RUPEES)} · submitting ₹${String(rupees)}\n`)

const browser = await chromium.launch({ headless: false, slowMo: 150 })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

let payBody = null

await page.route(/\/api\/v1\/client\/orders\/[^/]+\/pay$/u, async (route) => {
  const response = await route.fetch()
  payBody = await response.text()
  await route.fulfill({ response, body: payBody })
})

await page.route(/mercury[^/]*\.phonepe\.com/u, (route) => route.abort())

try {
  await page.goto(`${HOST}/login`, { waitUntil: "networkidle" })
  await page.getByLabel("Email").fill(EMAIL)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(4000)
  if (page.url().includes("/login")) throw new Error("sign-in failed")

  await page.goto(`${HOST}/funds`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  const href = await page.evaluate(() => {
    for (const a of document.querySelectorAll("a[href]")) {
      const h = a.getAttribute("href") ?? ""
      if (/^\/funds\/[0-9a-f]{8}-/u.test(h)) return h
    }
    return null
  })
  if (href === null) throw new Error("no fund link")

  await page.goto(`${HOST}${href}/invest/lumpsum`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1500)
  await page.locator('[role="checkbox"]').first().click().catch(() => undefined)

  const amount = page.locator('input[inputmode="numeric"]').first()
  const checked = await fillAmountUnderCap(amount, rupees, page)
  log(`typed ₹${checked.typed}, screen shows "${checked.total}"`)
  await page.waitForTimeout(500)
  await fillAmountUnderCap(amount, rupees, page)

  await page.getByRole("button", { name: /pay|invest|continue|proceed/iu }).last().click()
  await page.waitForTimeout(9000)

  log("\n================ the /pay response ================")
  if (payBody === null) {
    log("  never captured")
  } else {
    log(`  ${payBody}`)
    const url = /"url"\s*:\s*"([^"]+)"/u.exec(payBody)
    if (url !== null) {
      const parsed = new URL(url[1])
      log(`\n  checkout host  : ${parsed.host}`)
      log(`  checkout path  : ${parsed.pathname}`)
      log(`  token          : ${(parsed.searchParams.get("token") ?? "").slice(0, 24)}…`)
    }
  }
} finally {
  await page.waitForTimeout(1000)
  await browser.close()
}
