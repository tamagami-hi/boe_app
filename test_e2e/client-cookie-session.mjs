import { chromium } from "playwright"

const CLIENT = "http://localhost:5174"
const EMAIL = process.env.BOE_CLIENT_EMAIL ?? "client@beonedge.local"
const PASSWORD = process.env.BOE_CLIENT_PASSWORD ?? "LocalClientPassword123!"

let failures = 0
const check = (name, ok, detail) => {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : `  -- ${detail}`}\n`)
  if (!ok) failures += 1
}

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

await page.goto(`${CLIENT}/login`, { waitUntil: "networkidle" })
await page.getByLabel("Email").fill(EMAIL)
await page.getByLabel("Password").fill(PASSWORD)
await page.getByRole("button", { name: "Sign in" }).click()
await page.waitForURL(/\/dashboard$/u, { timeout: 20000 })
check("client web sign-in reaches the dashboard", true)

const storage = await page.evaluate(() =>
  Object.fromEntries(
    Object.keys(localStorage).map((key) => [key, String(localStorage.getItem(key)).slice(0, 24)]),
  ),
)
const keys = Object.keys(storage)
check(
  "no accessToken in localStorage",
  !keys.some((k) => k.toLowerCase().includes("accesstoken")),
  keys.join(", ") || "(empty)",
)
check(
  "no refreshToken in localStorage",
  !keys.some((k) => k.toLowerCase().includes("refreshtoken")),
)

const cookies = await context.cookies()
const names = cookies.map((c) => c.name)
check("a client session cookie was issued", names.some((n) => n.includes("client")), names.join(", "))
const httpOnly = cookies.filter((c) => c.name.includes("client")).every((c) => c.httpOnly)
check("every client session cookie is HttpOnly", httpOnly)

await page.reload({ waitUntil: "networkidle" })
await page.waitForTimeout(1500)
check(
  "the session survives a full document reload",
  !page.url().includes("/login"),
  page.url(),
)

const fresh = await context.newPage()
await fresh.goto(`${CLIENT}/portfolio`, { waitUntil: "networkidle" })
await fresh.waitForTimeout(1500)
check(
  "a brand-new document in the same context restores from cookies",
  !fresh.url().includes("/login"),
  fresh.url(),
)

const clean = await browser.newContext()
const anon = await clean.newPage()
await anon.goto(`${CLIENT}/dashboard`, { waitUntil: "networkidle" })
await anon.waitForTimeout(1500)
check(
  "a context without the cookies is anonymous",
  anon.url().includes("/login"),
  anon.url(),
)

await browser.close()
process.stdout.write(`\n${failures === 0 ? "all checks passed" : `${String(failures)} FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
