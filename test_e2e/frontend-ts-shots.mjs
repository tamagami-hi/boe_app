import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"

const OUT = process.env.BOE_SHOT_DIR ?? "/tmp/boe-shots"
const CLIENT = "http://localhost:5174"
const ADMIN = "http://localhost:5175"

const CLIENT_PAGES = [
  ["dashboard", "/dashboard", "Current value"],
  ["funds", "/funds", "Funds"],
  ["portfolio", "/portfolio", "Portfolio"],
  ["activity", "/activity", "Activity"],
  ["payments", "/activity?tab=payments", "Payments"],
  ["sips", "/sips", "SIP plans"],
  ["statements", "/statements", "Statements"],
  ["notifications", "/notifications", "Notifications"],
  ["support", "/profile/support", "Support"],
  ["profile", "/profile", "Profile"],
  ["legal", "/profile/legal", "Legal"],
  ["security", "/profile/security", "Device security"],
]

const ADMIN_PAGES = [
  ["overview", "/overview", "Overview"],
  ["funds", "/funds", "Funds"],
  ["aum", "/aum", "AUM"],
  ["applications", "/applications", "Applications"],
  ["users", "/users", "Users"],
  ["payments", "/payments", "Payments"],
  ["audit", "/audit", "Audit"],
  ["config", "/config", "App config"],
]

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()

const signIn = async (page, email, password) => {
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
}

const shoot = async (context, url, name, waitText) => {
  const page = await context.newPage()
  await page.goto(url, { waitUntil: "networkidle" })
  if (waitText !== undefined) {
    await page.getByText(waitText).first().waitFor({ timeout: 15000 }).catch(() => undefined)
  }
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
  process.stdout.write(`shot ${name}\n`)
  await page.close()
}

const shootSet = async (context, prefix, base, pages) => {
  let index = 2
  for (const [name, path, waitText] of pages) {
    await shoot(context, `${base}${path}`, `${prefix}-${String(index).padStart(2, "0")}-${name}`, waitText)
    index += 1
  }
}

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
await shoot(mobile, `${CLIENT}/login`, "m-01-login", "Sign in")
const mp = await mobile.newPage()
await mp.goto(`${CLIENT}/login`, { waitUntil: "networkidle" })
await signIn(mp, "client@beonedge.local", "LocalClientPassword123!")
await mp.waitForURL(/\/dashboard$/u, { timeout: 20000 })
await mp.close()
await shootSet(mobile, "m", CLIENT, CLIENT_PAGES)
await mobile.close()

const desktop = await browser.newContext({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 1 })
await shoot(desktop, `${CLIENT}/login`, "d-01-login", "Sign in")
const dp = await desktop.newPage()
await dp.goto(`${CLIENT}/login`, { waitUntil: "networkidle" })
await signIn(dp, "client@beonedge.local", "LocalClientPassword123!")
await dp.waitForURL(/\/dashboard$/u, { timeout: 20000 })
await dp.close()
await shootSet(desktop, "d", CLIENT, CLIENT_PAGES)
await desktop.close()

const admin = await browser.newContext({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 1 })
const ap = await admin.newPage()
await ap.goto(`${ADMIN}/login`, { waitUntil: "networkidle" })
await signIn(ap, process.env.BOE_ADMIN_EMAIL ?? "", process.env.BOE_ADMIN_PASSWORD ?? "")
await ap.waitForURL(/\/overview$/u, { timeout: 20000 })
await ap.close()
await shootSet(admin, "a", ADMIN, ADMIN_PAGES)
await admin.close()

const adminMobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
const amp = await adminMobile.newPage()
await amp.goto(`${ADMIN}/login`, { waitUntil: "networkidle" })
await signIn(amp, process.env.BOE_ADMIN_EMAIL ?? "", process.env.BOE_ADMIN_PASSWORD ?? "")
await amp.waitForURL(/\/overview$/u, { timeout: 20000 })
await amp.close()
await shoot(adminMobile, `${ADMIN}/funds`, "am-01-funds", "Funds")
await adminMobile.close()

await browser.close()
