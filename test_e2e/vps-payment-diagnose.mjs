import { chromium } from "playwright"

import { MAX_RUPEES, fillAmountUnderCap, requestedRupees } from "./lib/amount-guard.mjs"

const HOST = process.env.BOE_VPS_HOST ?? "https://dev-app.beonedge.in"
const EMAIL = process.env.BOE_VPS_EMAIL ?? ""
const PASSWORD = process.env.BOE_VPS_PASSWORD ?? ""

const log = (line) => {
  process.stdout.write(`${line}\n`)
}

if (EMAIL === "" || PASSWORD === "") {
  log("set BOE_VPS_EMAIL and BOE_VPS_PASSWORD")
  process.exit(2)
}

const rupees = requestedRupees()
log(`spend cap ₹${String(MAX_RUPEES)} · this run will submit ₹${String(rupees)}`)

const browser = await chromium.launch({ headless: false, slowMo: 400 })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

const apiCalls = []
page.on("response", async (response) => {
  const url = response.url()
  if (!url.includes("/api/v1/")) return
  const interesting = /\/(pay|orders|funds)\b/u.test(url)
  const body = interesting ? await response.text().catch(() => null) : null
  apiCalls.push({ status: response.status(), method: response.request().method(), url, body })
})
page.on("console", (msg) => {
  if (msg.type() === "error") log(`  [console.error] ${msg.text().slice(0, 200)}`)
})

try {
  log("== 1. sign in ==")
  await page.goto(`${HOST}/login`, { waitUntil: "networkidle" })
  await page.getByLabel("Email").fill(EMAIL)
  await page.getByLabel("Password").fill(PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(4000)
  log(`   landed on ${page.url()}`)
  if (page.url().includes("/login")) {
    log("   SIGN-IN FAILED - stopping")
    log(`   page says: ${(await page.locator("body").innerText()).slice(0, 300).replace(/\n/gu, " | ")}`)
    process.exit(1)
  }

  log("== 2. open the fund catalogue ==")
  await page.goto(`${HOST}/funds`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2000)
  const fundHref = await page.evaluate(() => {
    for (const a of document.querySelectorAll("a[href]")) {
      const h = a.getAttribute("href") ?? ""
      if (/^\/funds\/[0-9a-f]{8}-/u.test(h)) return h
    }
    return null
  })
  log(`   first fund: ${String(fundHref)}`)
  if (fundHref === null) {
    log("   no fund available to invest in - stopping")
    process.exit(1)
  }

  log("== 3. lump-sum invest screen ==")
  await page.goto(`${HOST}${fundHref}/invest/lumpsum`, { waitUntil: "networkidle" })
  await page.waitForTimeout(2000)

  const consentBox = page.locator('[role="checkbox"]').first()
  if ((await consentBox.count()) > 0) {
    await consentBox.click().catch(() => undefined)
    log("   risk consent accepted")
  }

  const amount = page.locator('input[inputmode="numeric"]').first()
  if ((await amount.count()) === 0) throw new Error("no amount input on the invest screen")
  const first = await fillAmountUnderCap(amount, rupees, page)
  log(`   typed ₹${first.typed} · screen says "${first.total}" — within the ₹${String(MAX_RUPEES)} cap`)
  await page.waitForTimeout(800)

  log("== 4. submit and watch what happens ==")
  const confirmed = await fillAmountUnderCap(amount, rupees, page)

  log(`   final check before real money: screen total "${confirmed.total}"`)
  const submit = page.getByRole("button", { name: /pay|invest|continue|proceed/iu }).last()
  log(`   submit button: "${await submit.innerText().catch(() => "?")}"`)
  await submit.click().catch((error) => {
    log(`   click failed: ${String(error).slice(0, 150)}`)
  })
  await page.waitForTimeout(9000)

  log(`   url now: ${page.url()}`)
  log("== 5. what the screen says ==")
  log(
    (await page.locator("body").innerText().catch(() => ""))
      .slice(0, 700)
      .replace(/\n{2,}/gu, "\n")
      .split("\n")
      .map((l) => `   | ${l}`)
      .join("\n"),
  )

  log("== 6. API calls of interest ==")
  for (const call of apiCalls) {
    if (!/\/(pay|orders)\b/u.test(call.url)) continue
    log(`   ${call.method} ${String(call.status)} ${call.url.replace(HOST, "")}`)
    if (call.body !== null) log(`     ${call.body.slice(0, 700)}`)
  }

  log("== 7. all API statuses ==")
  for (const call of apiCalls) log(`   ${String(call.status)} ${call.method} ${call.url.replace(HOST, "")}`)

  await page.screenshot({ path: "/tmp/vps-payment.png", fullPage: false })
  log("\nscreenshot: /tmp/vps-payment.png")
} finally {
  await page.waitForTimeout(2000)
  await browser.close()
}
