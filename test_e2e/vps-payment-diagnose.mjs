import { chromium } from "playwright"

const HOST = process.env.BOE_VPS_HOST ?? "https://dev-app.beonedge.in"
const EMAIL = process.env.BOE_VPS_EMAIL ?? ""
const PASSWORD = process.env.BOE_VPS_PASSWORD ?? ""

const log = (line) => {
  process.stdout.write(`${line}\n`)
}

const browser = await chromium.launch({ headless: false, slowMo: 400 })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

const apiCalls = []
page.on("response", async (response) => {
  const url = response.url()
  if (!url.includes("/api/v1/")) return
  const interesting = /\/(pay|orders|funds)\b/u.test(url)
  let body = null
  if (interesting) {
    body = await response.text().catch(() => null)
  }
  apiCalls.push({ status: response.status(), method: response.request().method(), url, body })
})
page.on("console", (msg) => {
  if (msg.type() === "error") log(`  [console.error] ${msg.text().slice(0, 200)}`)
})

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
  await browser.close()
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
  await browser.close()
  process.exit(1)
}

log("== 3. lump-sum invest screen ==")
await page.goto(`${HOST}${fundHref}/invest/lumpsum`, { waitUntil: "networkidle" })
await page.waitForTimeout(2000)

const amount = page.locator('input[inputmode="numeric"]').first()
if ((await amount.count()) > 0) {
  await amount.fill("1000")
  log("   amount 1000 entered")
}

const consentBox = page.locator('[role="checkbox"]').first()
if ((await consentBox.count()) > 0) {
  await consentBox.click().catch(() => undefined)
  log("   risk consent accepted")
} else {
  log("   no [role=checkbox] found; listing candidate controls")
  const all = page.locator("button")
  for (let i = 0; i < (await all.count()); i += 1) {
    log(`     button ${String(i)}: "${(await all.nth(i).innerText().catch(() => "?")).slice(0, 40)}"`)
  }
}

const target = process.env.BOE_TEST_AMOUNT ?? "500"
if ((await amount.count()) > 0) {
  await amount.fill("")
  await amount.fill(target)
  log(`   amount set LAST to ${target} (presets deliberately not clicked)`)
}
await page.waitForTimeout(800)

log("== 4. submit and watch what happens ==")
const submit = page.getByRole("button", { name: /pay|invest|continue|proceed/iu }).last()
log(`   submit button: "${await submit.innerText().catch(() => "?")}"`)
await submit.click().catch((error) => {
  log(`   click failed: ${String(error).slice(0, 150)}`)
})
await page.waitForTimeout(9000)

log(`   url now: ${page.url()}`)
const visible = (await page.locator("body").innerText().catch(() => "")).slice(0, 700)
log("== 5. what the screen says ==")
log(visible.replace(/\n{2,}/gu, "\n").split("\n").map((l) => `   | ${l}`).join("\n"))

log("== 6. API calls of interest ==")
for (const call of apiCalls) {
  if (!/\/(pay|orders)\b/u.test(call.url)) continue
  log(`   ${call.method} ${call.status} ${call.url.replace(HOST, "")}`)
  if (call.body !== null) log(`     ${call.body.slice(0, 700)}`)
}

log("== 7. all API statuses ==")
for (const call of apiCalls) log(`   ${String(call.status)} ${call.method} ${call.url.replace(HOST, "")}`)

await page.screenshot({ path: "/tmp/vps-payment.png", fullPage: false })
log("\nscreenshot: /tmp/vps-payment.png")
await page.waitForTimeout(3000)
await browser.close()
