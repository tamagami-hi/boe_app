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

const ARMS = [
  { name: "A · referer = dev-app.beonedge.in (what the app does today)", referer: `${HOST}/` },
  { name: "B · no referer at all", referer: undefined },
  { name: "C · referer = www.beonedge.in (the onboarded domain)", referer: "https://www.beonedge.in/" },
]

const browser = await chromium.launch({ headless: false, slowMo: 120 })

const mintCheckoutUrl = async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  await page.goto(`${HOST}/login`, { waitUntil: "networkidle" })
  await page.getByLabel("Email").fill(EMAIL)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(4000)
  if (page.url().includes("/login")) throw new Error("sign-in failed")

  await page.goto(`${HOST}/funds`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)
  const href = await page.evaluate(() => {
    for (const a of document.querySelectorAll("a[href]")) {
      const h = a.getAttribute("href") ?? ""
      if (/^\/funds\/[0-9a-f]{8}-/u.test(h)) return h
    }
    return null
  })
  if (href === null) throw new Error("no fund link found")

  await page.goto(`${HOST}${href}/invest/lumpsum`, { waitUntil: "networkidle" })
  await page.waitForTimeout(1200)
  await page.locator('[role="checkbox"]').first().click().catch(() => undefined)

  const amount = page.locator('input[inputmode="numeric"]').first()
  const checked = await fillAmountUnderCap(amount, rupees, page)
  log(`one order for ₹${checked.typed} (screen shows "${checked.total}") — the only money at stake`)
  await page.waitForTimeout(500)
  await fillAmountUnderCap(amount, rupees, page)

  await page.getByRole("button", { name: /pay|invest|continue|proceed/iu }).last().click()
  await page.waitForTimeout(9000)

  const url = page.url()
  await context.close()
  if (!url.includes("phonepe.com")) throw new Error(`did not reach PhonePe, landed on ${url}`)
  return url
}

const probe = async (checkoutUrl, referer) => {
  const context = await browser.newContext({ viewport: { width: 1180, height: 860 } })
  const page = await context.newPage()
  const failures = []
  const sentReferers = new Set()

  page.on("request", (r) => {
    if (r.url().includes("api.phonepe.com")) {
      const h = r.headers()["referer"]
      if (h !== undefined) sentReferers.add(h)
    }
  })
  page.on("response", async (r) => {
    if (!r.url().includes("phonepe.com") || r.status() < 400) return
    failures.push({ status: r.status(), body: await r.text().catch(() => "<unreadable>") })
  })

  await page.goto(checkoutUrl, {
    waitUntil: "domcontentloaded",
    ...(referer === undefined ? {} : { referer }),
  })
  await page.waitForTimeout(4000)

  await page.getByText("Click to view QR").first().click().catch(() => undefined)
  await page.waitForTimeout(4500)

  const screen = await page.locator("body").innerText().catch(() => "")
  const stillAskingForQr = screen.includes("Click to view QR")
  await context.close()
  return { failures, screen, stillAskingForQr, sentReferers: [...sentReferers] }
}

const results = []
try {
  log(`spend cap ₹${String(MAX_RUPEES)} · one order, ${String(ARMS.length)} referrer arms\n`)
  const checkoutUrl = await mintCheckoutUrl()
  log(`checkout URL host: ${new URL(checkoutUrl).host}\n`)

  for (const arm of ARMS) {
    log(`======== ${arm.name} ========`)
    const outcome = await probe(checkoutUrl, arm.referer)

    const blocked = outcome.failures.find((f) => f.body.includes("INTERNAL_SECURITY_BLOCK"))
    let transacting = null
    if (blocked === undefined) {
      log(`   NOT BLOCKED · ${String(outcome.failures.length)} phonepe failures`)
    } else {
      const m = /"Transacting_URL"\s*:\s*"([^"]+)"/u.exec(blocked.body)
      transacting = m === null ? "(absent from body)" : m[1]
      log(`   BLOCKED · Transacting_URL = ${transacting}`)
    }
    log(`   referer actually sent to api.phonepe.com: ${JSON.stringify(outcome.sentReferers)}`)
    log(`   QR still unrendered: ${String(outcome.stillAskingForQr)}`)
    results.push({
      arm: arm.name,
      blocked: blocked !== undefined,
      transacting,
      qrBroken: outcome.stillAskingForQr,
    })
    log("")
  }
} finally {
  await browser.close()
}

log("================ verdict ================")
for (const r of results) {
  log(`${r.blocked ? "BLOCKED" : "ALLOWED"}  ${r.arm}`)
  if (r.transacting !== null) log(`         Transacting_URL = ${r.transacting}`)
}
const distinct = new Set(results.map((r) => r.transacting))
if (results.every((r) => r.blocked) && distinct.size === 1) {
  log("\nThe referrer makes no difference and Transacting_URL never changes.")
  log("=> PhonePe binds it to the ORDER or the MERCHANT, not to the browser.")
  log("=> No client-side or referrer change can fix this. The options are the")
  log("   PhonePe dashboard, the sandbox merchant, or a redirectUrl on the")
  log("   onboarded domain.")
} else {
  log("\nThe referrer DOES change the outcome — this is fixable in our code.")
}
