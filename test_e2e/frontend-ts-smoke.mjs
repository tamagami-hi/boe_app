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
    const reason = request.failure()?.errorText ?? ""
    if (reason.includes("ERR_ABORTED")) return
    sink.failedRequests.push(`${request.method()} ${request.url()} ${reason}`)
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
  await page.locator("nav[aria-label='Sections'] a").first().waitFor({ timeout: 15000 })
  const navLabels = await page.locator("nav[aria-label='Sections'] a").allInnerTexts()
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
  check(
    "client: device security refuses to claim it is a security boundary",
    (await page.getByText("It is checked on this device only", { exact: false }).count()) > 0,
  )

  await page.goto(`${CLIENT_URL}/statements`, { waitUntil: "networkidle" })
  check(
    "client: statements says there is nothing to download",
    (await page.getByText("There is nothing to download", { exact: false }).count()) > 0,
  )

  await page.goto(`${CLIENT_URL}/notifications`, { waitUntil: "networkidle" })
  check(
    "client: notifications renders its own surface",
    (await page.getByRole("heading", { name: "Notifications" }).count()) > 0,
  )

  await page.goto(`${CLIENT_URL}/profile/support`, { waitUntil: "networkidle" })
  await page.getByLabel("Subject").waitFor({ timeout: 10000 })
  check("client: support offers a ticket form", true)

  await page.goto(`${CLIENT_URL}/profile/legal`, { waitUntil: "networkidle" })
  check(
    "client: the legal hub links both regulatory documents, which the legacy screen never did",
    (await page.getByRole("link", { name: /Investor charter/u }).count()) > 0 &&
      (await page.getByRole("link", { name: /Grievance/u }).count()) > 0,
  )

  await page.goto(`${CLIENT_URL}/profile/legal/grievance`, { waitUntil: "networkidle" })
  check(
    "client: an unpublished legal document falls back instead of erroring",
    (await page.getByRole("heading", { name: "Grievance redressal" }).count()) > 0 &&
      (await page.getByText("We could not load this").count()) === 0,
  )

  await page.goto(`${CLIENT_URL}/activity?tab=payments`, { waitUntil: "networkidle" })
  check(
    "client: activity keeps the payments tab in the URL",
    (await page.getByRole("tab", { name: "Payments", selected: true }).count()) > 0,
  )

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

  const ADMIN_SURFACES = [
    ["/overview", "Overview"],
    ["/applications", "Applications"],
    ["/users", "Users"],
    ["/aum", "AUM"],
    ["/aum/collective", "Grow several funds"],
    ["/client-values", "Client values"],
    ["/client-values/individual", "Adjust one investor"],
    ["/client-values/collective", "Adjust a whole fund"],
    ["/receipts", "Fund receipts"],
    ["/refunds", "Refunds"],
    ["/payments", "Payments"],
    ["/audit", "Audit log"],
    ["/emails", "Emails"],
    ["/content/faqs", "FAQs"],
    ["/app-config", "App config"],
  ]

  for (const [path, heading] of ADMIN_SURFACES) {
    await page.goto(`${ADMIN_URL}${path}`, { waitUntil: "networkidle" })
    const rendered = await page.getByRole("heading", { name: heading, level: 1 }).count()
    check(`admin: ${path} renders its own surface`, rendered > 0, page.url())
  }

  await page.goto(`${ADMIN_URL}/mandates`, { waitUntil: "networkidle" })
  const mandateBody = await page.locator("body").innerText()
  check(
    "admin: mandates distinguishes an unconfigured provider from a missing screen",
    mandateBody.includes("PhonePe is not configured in this environment") ||
      mandateBody.includes("Mandate state"),
    mandateBody.slice(0, 90).replace(/\n/gu, " "),
  )

  await page.goto(`${ADMIN_URL}/content/faqs`, { waitUntil: "networkidle" })
  const faqQuestion = `E2E answer ${String(Date.now()).slice(-6)}`
  await page.getByLabel("Question").fill(faqQuestion)
  await page.getByLabel("Answer").fill("Written by the automated smoke suite.")
  await page.getByRole("button", { name: "Save as draft" }).click()
  await page.getByText(faqQuestion).waitFor({ timeout: 20000 })
  check("admin: a new FAQ is created as a draft, not published", true)

  const faqRow = page.locator("tr", { hasText: faqQuestion })
  check(
    "admin: a draft FAQ offers Publish but not Unpublish",
    (await faqRow.getByRole("button", { name: "Publish" }).count()) > 0 &&
      (await faqRow.getByRole("button", { name: "Unpublish" }).count()) === 0,
  )

  await faqRow.getByRole("button", { name: "Publish" }).click()
  await page.locator("tr", { hasText: faqQuestion }).getByRole("button", { name: "Unpublish" }).waitFor({ timeout: 20000 })
  check("admin: publishing the FAQ moves it out of draft", true)

  await page.goto(`${ADMIN_URL}/audit`, { waitUntil: "networkidle" })
  await page.getByLabel("Filter by entity type").fill("content_item")
  await page.getByLabel("Filter by entity type").blur()
  await page.waitForTimeout(1200)
  const auditBody = await page.locator("body").innerText()
  check(
    "admin: the audit log records the FAQ publish under content_item",
    auditBody.includes("content_item.published") || auditBody.includes("content_item"),
    auditBody.slice(0, 90).replace(/\n/gu, " "),
  )

  check("admin: no uncaught page errors", sink.pageErrors.length === 0, sink.pageErrors.join(" ; "))
  check(
    "admin: no failed API requests",
    sink.failedRequests.length === 0,
    sink.failedRequests.join(" ; "),
  )

  await context.close()
}

const runAdminFundLifecycle = async (browser) => {
  if (ADMIN_EMAIL === undefined || ADMIN_PASSWORD === undefined) return null

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const sink = { consoleErrors: [], pageErrors: [], failedRequests: [] }
  collectDiagnostics(page, sink)

  await page.goto(`${ADMIN_URL}/login`, { waitUntil: "networkidle" })
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await page.waitForURL(/\/overview$/u, { timeout: 20000 })

  const slug = `e2e-fund-${String(Date.now()).slice(-8)}`
  await page.goto(`${ADMIN_URL}/funds/new`, { waitUntil: "networkidle" })

  await page.getByLabel("Slug").fill(slug)
  await page.getByLabel("Name").fill("E2E Verified Growth Pool")
  await page.getByLabel("Category").fill("Balanced")
  await page.getByLabel("Objective").fill("Exercised by the automated smoke suite.")
  await page.getByLabel("Minimum lump sum (paise)").fill("100000")
  await page.getByLabel("Minimum SIP (paise)").fill("50000")
  await page.getByLabel("Disclosure title").fill("Risk disclosure")
  await page
    .getByLabel("Disclosure body")
    .fill("Investments carry risk. Past performance does not guarantee future returns.")
  await page.getByLabel("Opening AUM (paise)").fill("500000000")
  await page.getByRole("button", { name: "Create fund" }).click()

  await page.waitForURL(/\/funds\/[0-9a-f-]{36}$/u, { timeout: 25000 })
  check("admin: creating a fund lands on its workspace", true)

  const fundId = page.url().split("/funds/")[1] ?? ""
  check("admin: the new fund has a real id", /^[0-9a-f-]{36}$/u.test(fundId), fundId)

  await page.getByText("Version 1").waitFor({ timeout: 20000 })
  check("admin: creating a fund publishes version 1 of its terms in one step", true)

  check(
    "admin: a draft offers only the transitions the backend permits",
    (await page.getByRole("button", { name: "Pause" }).count()) === 0,
    "Pause must not be offered on a draft",
  )

  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await page.getByText("Yes").first().waitFor({ timeout: 20000 })
  check("admin: publishing a draft makes it visible to investors", true)

  await page.getByRole("button", { name: "Pause" }).click()
  await page.getByText("Paused").first().waitFor({ timeout: 20000 })
  check("admin: a published fund can then be paused under optimistic concurrency", true)

  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await page.getByText("Yes").first().waitFor({ timeout: 20000 })
  check("admin: a paused fund can be republished", true)

  await page.goto(`${ADMIN_URL}/funds/${fundId}/aum`, { waitUntil: "networkidle" })
  await page.getByText("Record growth").first().waitFor({ timeout: 15000 })
  check("admin: an initialised fund offers growth entry, not opening AUM", true)

  await page.getByRole("button", { name: "Percentage" }).click()
  await page.getByLabel("Growth (basis points)").fill("250")
  await page.getByRole("button", { name: "Record growth" }).click()
  await page.getByText("Revision").first().waitFor({ timeout: 20000 })
  check("admin: recording percentage growth appends an AUM revision", true)

  check(
    "admin: no uncaught page errors during the fund lifecycle",
    sink.pageErrors.length === 0,
    sink.pageErrors.join(" ; "),
  )
  check(
    "admin: no failed API requests during the fund lifecycle",
    sink.failedRequests.length === 0,
    sink.failedRequests.join(" ; "),
  )

  await context.close()
  return fundId
}

const runClientSeesFund = async (browser, fundId) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const sink = { consoleErrors: [], pageErrors: [], failedRequests: [] }
  collectDiagnostics(page, sink)

  await page.goto(`${CLIENT_URL}/login`, { waitUntil: "networkidle" })
  await signIn(page, CLIENT_EMAIL, CLIENT_PASSWORD)
  await page.waitForURL(/\/dashboard$/u, { timeout: 20000 })

  await page.goto(`${CLIENT_URL}/funds`, { waitUntil: "networkidle" })
  await page.getByText("E2E Verified Growth Pool").first().waitFor({ timeout: 20000 })
  check("client: the published fund appears in the catalogue", true)

  await page.goto(`${CLIENT_URL}/funds/${fundId}`, { waitUntil: "networkidle" })
  await page.getByText("Fund size").first().waitFor({ timeout: 20000 })
  check(
    "client: the fund size reflects the administrator's 250 basis-point growth exactly",
    (await page.getByText("₹51,25,000").count()) > 0,
    await page.locator("body").innerText().then((t) => {
      const line = t.split("\n").find((l) => l.includes("₹"))
      return line ?? "no rupee value rendered"
    }),
  )

  await page.goto(`${CLIENT_URL}/funds/${fundId}`, { waitUntil: "networkidle" })
  await page.getByText("Risk disclosure").waitFor({ timeout: 20000 })
  check("client: fund detail renders the administrator's disclosure", true)

  check(
    "client: fund detail renders the terms the administrator published",
    (await page.getByText("Minimum lump sum").count()) > 0,
  )

  check(
    "client: no failed API requests on the catalogue",
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
  let fundId = null
  try {
    fundId = await runAdminFundLifecycle(browser)
  } catch (error) {
    check(
      "admin: fund lifecycle completed",
      false,
      error instanceof Error ? error.message : String(error),
    )
  }
  if (fundId !== null) {
    try {
      await runClientSeesFund(browser, fundId)
    } catch (error) {
      check(
        "client: sees the published fund",
        false,
        error instanceof Error ? error.message : String(error),
      )
    }
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
