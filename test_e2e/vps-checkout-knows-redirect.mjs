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

const phonePeBodies = []
page.on("response", async (r) => {
  if (!r.url().includes("phonepe.com")) return
  const type = r.headers()["content-type"] ?? ""
  if (!/json|javascript|html/iu.test(type)) return
  const body = await r.text().catch(() => "")
  if (body.includes("beonedge")) phonePeBodies.push({ url: r.url(), body })
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
  await page.waitForTimeout(10000)

  const hostsInPage = await page.evaluate(() => {
    const found = new Set()
    const scan = (text) => {
      for (const match of String(text).matchAll(/[a-z0-9.-]*beonedge\.in[^"'`\s,)}\]]*/giu)) {
        found.add(match[0])
      }
    }
    scan(document.documentElement.outerHTML)
    for (const key of Object.keys(window.localStorage)) {
      scan(key)
      scan(window.localStorage.getItem(key) ?? "")
    }
    for (const key of Object.keys(window.sessionStorage)) {
      scan(key)
      scan(window.sessionStorage.getItem(key) ?? "")
    }
    return [...found]
  })

  log("\n===== beonedge references inside the PhonePe checkout page =====")
  if (hostsInPage.length === 0) log("  none in DOM or storage")
  for (const hit of hostsInPage) log(`  ${hit}`)

  log("\n===== beonedge references in PhonePe's own responses =====")
  if (phonePeBodies.length === 0) log("  none")
  for (const entry of phonePeBodies) {
    const hits = [
      ...new Set([...entry.body.matchAll(/[a-z0-9.-]*beonedge\.in[^"'`\s,)}\]]*/giu)].map((m) => m[0])),
    ]
    log(`  ${entry.url.slice(0, 90)}`)
    for (const hit of hits) log(`      ${hit}`)
  }

  const all = [...hostsInPage, ...phonePeBodies.flatMap((e) =>
    [...e.body.matchAll(/[a-z0-9.-]*beonedge\.in[^"'`\s,)}\]]*/giu)].map((m) => m[0]))]
  log("\n===== verdict =====")
  const sawWww = all.some((h) => h.includes("www.beonedge.in"))
  const sawDevApp = all.some((h) => h.includes("dev-app.beonedge.in"))
  log(`  PhonePe knows www.beonedge.in     : ${String(sawWww)}`)
  log(`  PhonePe knows dev-app.beonedge.in : ${String(sawDevApp)}`)
  if (sawWww) {
    log("  => our new redirectUrl DID reach PhonePe, yet Transacting_URL still")
    log("     reports dev-app. The two are unrelated.")
  } else {
    log("  => no evidence the redirect reached PhonePe from this surface;")
    log("     inconclusive on its own.")
  }
} finally {
  await page.waitForTimeout(1000)
  await browser.close()
}
