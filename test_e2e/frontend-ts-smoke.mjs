import { chromium } from "playwright"

const CLIENT_URL = process.env.BOE_CLIENT_URL ?? "http://localhost:5174"
const ADMIN_URL = process.env.BOE_ADMIN_URL ?? "http://localhost:5175"
const CLIENT_EMAIL = process.env.BOE_CLIENT_EMAIL ?? "client@beonedge.local"
const CLIENT_PASSWORD = process.env.BOE_CLIENT_PASSWORD ?? "LocalClientPassword123!"
const ADMIN_EMAIL = process.env.BOE_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.BOE_ADMIN_PASSWORD

const results = []
let failures = 0

const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail })
  if (!passed) failures += 1
}

const collectDiagnostics = (page, sink) => {
  page.on("console", (message) => {
    if (message.type() === "error") sink.consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => {
    sink.pageErrors.push(error.message)
  })
  page.on("requestfailed", (request) => {
    if (!request.url().includes("/api/v1/")) return
    sink.failedRequests.push(`${request.method()} ${request.url()}`)
  })
}

const MAIL_API = process.env.BOE_MAIL_API ?? "http://127.0.0.1:8025/api/v1"

const readLatestOtp = async () => {
  try {
    const list = await fetch(`${MAIL_API}/messages?limit=5`)
    if (!list.ok) return null
    const payload = await list.json()
    const messages = payload.messages ?? []
    for (const message of messages) {
      const detail = await fetch(`${MAIL_API}/message/${String(message.ID)}`)
      if (!detail.ok) continue
      const body = await detail.json()
      const text = `${String(body.Text ?? "")} ${String(body.HTML ?? "")}`
      const match = /\b([A-Za-z0-9]{6})\b/u.exec(text.replace(/\s+/gu, " "))
      if (match?.[1] !== undefined) return match[1]
    }
    return null
  } catch {
    return null
  }
}

const signIn = async (page, email, password) => {
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
}

const runClient = async (browser) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const sink = { consoleErrors: [], pageErrors: [], failedRequests: [] }
  collectDiagnostics(page, sink)

  await page.goto(CLIENT_URL, { waitUntil: "networkidle" })

  await page.waitForURL(/\/login$/u, { timeout: 15000 })
  check("client: splash redirects to login once the backend is reachable", true)

  check(
    "client: login screen paints the wordmark",
    (await page.getByText("BeOnEdge").count()) > 0,
  )

  await signIn(page, CLIENT_EMAIL, CLIENT_PASSWORD)
  await page.waitForURL(/\/dashboard$/u, { timeout: 20000 })
  check("client: native login lands on the dashboard", true)

  const tabs = ["Home", "Funds", "Portfolio", "Activity", "Profile"]
  const navLabels = await page.locator("nav[aria-label='Primary'] a").allInnerTexts()
  const flattened = navLabels.join("|")
  check(
    "client: all five bottom-nav tabs render",
    tabs.every((tab) => flattened.includes(tab)),
    flattened,
  )

  await page.getByRole("link", { name: "Portfolio" }).first().click()
  await page.waitForURL(/\/portfolio$/u, { timeout: 10000 })
  check("client: tab navigation reaches /portfolio", true)

  await page.goto(`${CLIENT_URL}/profile/security`, { waitUntil: "networkidle" })
  await page.getByText("Not built yet").waitFor({ timeout: 10000 })
  check("client: an unbuilt surface says so instead of rendering empty", true)

  await page.goto(`${CLIENT_URL}/this-route-does-not-exist`, { waitUntil: "networkidle" })
  check(
    "client: unknown path renders the not-found screen",
    (await page.getByText("This address does not exist").count()) > 0,
  )

  await page.goto(`${CLIENT_URL}/sips`, { waitUntil: "networkidle" })
  check(
    "client: /sips is directly reachable, which the legacy route map never allowed",
    page.url().endsWith("/sips"),
    page.url(),
  )

  await page.goto(`${CLIENT_URL}/dashboard`, { waitUntil: "networkidle" })
  await page.getByText("Current value").first().waitFor({ timeout: 15000 })
  check("client: dashboard renders the server-derived portfolio headline", true)

  check(
    "client: dashboard shows the investing gate while email is unverified",
    (await page.getByText("Investing is locked").count()) > 0,
  )

  await page.goto(`${CLIENT_URL}/funds`, { waitUntil: "networkidle" })
  const fundsBody = await page.locator("body").innerText()
  check(
    "client: fund list renders a real state, not a blank screen",
    fundsBody.includes("No funds are published yet") || fundsBody.includes("Fund size"),
    fundsBody.slice(0, 80).replace(/\n/gu, " "),
  )

  await page.goto(`${CLIENT_URL}/portfolio`, { waitUntil: "networkidle" })
  const portfolioBody = await page.locator("body").innerText()
  check(
    "client: portfolio distinguishes empty from failed",
    portfolioBody.includes("You have not invested yet") || portfolioBody.includes("Current value"),
    portfolioBody.slice(0, 80).replace(/\n/gu, " "),
  )

  await page.goto(`${CLIENT_URL}/activity`, { waitUntil: "networkidle" })
  check(
    "client: activity renders an explicit empty state",
    (await page.getByText("Nothing has happened yet").count()) > 0,
  )

  await page.goto(`${CLIENT_URL}/funds/00000000-0000-4000-8000-000000000000`, {
    waitUntil: "networkidle",
  })
  check(
    "client: an unknown fund id renders not-found, not a crash",
    (await page.getByText("Not found").count()) > 0,
  )

  await page.goto(`${CLIENT_URL}/verify-email`, { waitUntil: "networkidle" })
  await page.getByRole("button", { name: "Send me a code" }).click()
  await page.getByText("Code sent").waitFor({ timeout: 20000 })
  check("client: email verification requests a code and reports it was sent", true)

  const otp = await readLatestOtp()
  check("client: the code actually reached the mail sink", otp !== null, otp ?? "no code found")

  if (otp !== null) {
    await page.getByLabel("Verification code").fill(otp)
    await page.getByRole("button", { name: "Verify" }).click()
    await page.waitForURL(/\/dashboard$/u, { timeout: 20000 })
    check("client: a valid code verifies and returns to the dashboard", true)

    await page.reload({ waitUntil: "networkidle" })
    await page.waitForTimeout(2000)
    check(
      "client: the investing gate clears once verified",
      (await page.getByText("Investing is locked").count()) === 0,
    )
  }

  const reloaded = await context.newPage()
  collectDiagnostics(reloaded, sink)
  await reloaded.goto(`${CLIENT_URL}/dashboard`, { waitUntil: "networkidle" })
  await reloaded.waitForURL(/\/dashboard$/u, { timeout: 20000 })
  check("client: session survives a fresh page load from secure storage fallback", true)

  check(
    "client: no uncaught page errors",
    sink.pageErrors.length === 0,
    sink.pageErrors.join(" ; "),
  )
  check(
    "client: no failed API requests",
    sink.failedRequests.length === 0,
    sink.failedRequests.join(" ; "),
  )

  await context.close()
}

const runAdmin = async (browser) => {
  if (ADMIN_EMAIL === undefined || ADMIN_PASSWORD === undefined) {
    check("admin: credentials supplied", false, "BOE_ADMIN_EMAIL/BOE_ADMIN_PASSWORD unset")
    return
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const sink = { consoleErrors: [], pageErrors: [], failedRequests: [] }
  collectDiagnostics(page, sink)

  await page.goto(ADMIN_URL, { waitUntil: "networkidle" })
  await page.waitForURL(/\/login$/u, { timeout: 15000 })
  check("admin: splash redirects to login", true)

  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await page.waitForURL(/\/overview$/u, { timeout: 20000 })
  check("admin: cookie login lands on overview", true)

  const sidebar = await page.locator("nav[aria-label='Sections'] a").allInnerTexts()
  check(
    "admin: sidebar renders permitted sections at desktop width",
    sidebar.length >= 8,
    `${String(sidebar.length)} entries: ${sidebar.join("|")}`,
  )

  await page.getByRole("link", { name: "Funds", exact: true }).first().click()
  await page.waitForURL(/\/funds$/u, { timeout: 10000 })
  check("admin: sidebar navigation reaches /funds", true)

  const reloaded = await context.newPage()
  collectDiagnostics(reloaded, sink)
  await reloaded.goto(`${ADMIN_URL}/overview`, { waitUntil: "networkidle" })
  await reloaded.waitForURL(/\/overview$/u, { timeout: 20000 })
  check("admin: reload recovers the session via the CSRF endpoint", true)

  const narrow = await context.newPage()
  collectDiagnostics(narrow, sink)
  await narrow.setViewportSize({ width: 390, height: 844 })
  await narrow.goto(`${ADMIN_URL}/overview`, { waitUntil: "networkidle" })
  const bottomNav = await narrow.locator("nav[aria-label='Sections']").last().isVisible()
  check("admin: renders a bottom nav below the shell breakpoint", bottomNav)

  check("admin: no uncaught page errors", sink.pageErrors.length === 0, sink.pageErrors.join(" ; "))
  check(
    "admin: no failed API requests",
    sink.failedRequests.length === 0,
    sink.failedRequests.join(" ; "),
  )

  await context.close()
}

const main = async () => {
  const browser = await chromium.launch()
  try {
    await runClient(browser)
  } catch (error) {
    check("client: suite completed", false, error instanceof Error ? error.message : String(error))
  }
  try {
    await runAdmin(browser)
  } catch (error) {
    check("admin: suite completed", false, error instanceof Error ? error.message : String(error))
  }
  await browser.close()

  for (const result of results) {
    const mark = result.passed ? "PASS" : "FAIL"
    const detail = result.detail === "" ? "" : `  -- ${result.detail}`
    process.stdout.write(`${mark}  ${result.name}${detail}\n`)
  }
  process.stdout.write(`\n${String(results.length - failures)}/${String(results.length)} checks passed\n`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
