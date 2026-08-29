import { mkdir, readFile, writeFile } from "node:fs/promises"
import { chromium } from "playwright"

const ROOT = new URL("../frontend_stack_ts/src/app/routing/", import.meta.url)
const OUT = process.env.BOE_AUDIT_DIR ?? "/tmp/boe-audit"
const CLIENT_BASE = "http://localhost:5174"
const ADMIN_BASE = "http://localhost:5175"

const CLIENT_EMAIL = process.env.BOE_CLIENT_EMAIL ?? "client@beonedge.local"
const CLIENT_PASSWORD = process.env.BOE_CLIENT_PASSWORD ?? "LocalClientPassword123!"
const ADMIN_ID = process.env.BOE_ADMIN_ID ?? ""
const ADMIN_PASSWORD = process.env.BOE_ADMIN_PASSWORD ?? ""

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 900 },
]

const readRoutes = async (file) => {
  const source = await readFile(new URL(file, ROOT), "utf8")
  const constants = new Map()
  for (const m of source.matchAll(/export const ([A-Z_]+) = "([^"]+)"/gu)) {
    constants.set(m[1], m[2])
  }
  const paths = []
  for (const m of source.matchAll(/^\s{4}path: (?:"([^"]+)"|([A-Z_]+)),/gmu)) {
    const value = m[1] ?? constants.get(m[2])
    if (value !== undefined && !paths.includes(value)) paths.push(value)
  }
  return paths
}

const findings = []
const record = (entry) => {
  findings.push(entry)
  const tag = entry.severity === "error" ? "ERROR" : "WARN "
  process.stdout.write(`  ${tag} [${entry.scope}] ${entry.message}\n`)
}

const attachListeners = (page, scope) => {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    if (text.includes("Failed to load resource")) return
    record({ severity: "error", scope, message: `console: ${text.slice(0, 220)}` })
  })
  page.on("pageerror", (err) => {
    record({ severity: "error", scope, message: `pageerror: ${String(err.message).slice(0, 220)}` })
  })
  page.on("requestfailed", (req) => {
    const failure = req.failure()
    const why = failure === null ? "unknown" : failure.errorText
    if (why.includes("ERR_ABORTED")) return
    record({ severity: "warn", scope, message: `requestfailed ${req.method()} ${req.url().slice(0, 120)} ${why}` })
  })
}

const AUDIT_IN_PAGE = () => {
  const out = {
    title: document.title,
    h1: [...document.querySelectorAll("h1")].map((n) => (n.textContent ?? "").trim()),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowing: [],
    monoMoney: [],
    smallTargets: [],
    navLabels: [...document.querySelectorAll("nav[aria-label]")].map((n) => n.getAttribute("aria-label")),
    landmarkDupes: [],
    emptyButtons: [],
    bodyText: (document.body.innerText ?? "").slice(0, 400),
  }

  const vw = document.documentElement.clientWidth
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 1.5) {
      const style = getComputedStyle(el)
      if (style.position === "fixed") continue
      let scroller = null
      for (let a = el.parentElement; a !== null; a = a.parentElement) {
        const ov = getComputedStyle(a).overflowX
        if (ov === "auto" || ov === "scroll") { scroller = a; break }
      }
      if (scroller !== null) continue
      out.overflowing.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className ?? "").toString().slice(0, 90),
        right: Math.round(r.right),
        vw,
      })
    }
  }

  const rupee = /[₹]|(?:\bRs\.?\s?\d)/u
  for (const el of document.querySelectorAll("span,td,div,p,strong,h1,h2,h3")) {
    const t = (el.textContent ?? "").trim()
    if (t.length === 0 || t.length > 40) continue
    if (!rupee.test(t)) continue
    if (el.querySelector("*") !== null) continue
    const ff = getComputedStyle(el).fontFamily.toLowerCase()
    if (ff.includes("mono")) out.monoMoney.push({ text: t.slice(0, 30), fontFamily: ff.slice(0, 70) })
  }

  const touch = window.innerWidth < 1024
  for (const el of touch ? document.querySelectorAll("button,a[href],[role='button'],[role='switch'],[role='tab'],[role='radio']") : []) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (el.closest("table") !== null) continue
    if (r.height < 44 || r.width < 24) {
      out.smallTargets.push({
        tag: el.tagName.toLowerCase(),
        label: ((el.getAttribute("aria-label") ?? el.textContent) ?? "").trim().slice(0, 40),
        h: Math.round(r.height),
        w: Math.round(r.width),
      })
    }
  }

  const seen = new Map()
  for (const n of document.querySelectorAll("nav[aria-label]")) {
    const key = n.getAttribute("aria-label")
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [k, v] of seen) if (v > 1) out.landmarkDupes.push(`${k} x${v}`)

  for (const b of document.querySelectorAll("button")) {
    const label = ((b.getAttribute("aria-label") ?? b.textContent) ?? "").trim()
    const r = b.getBoundingClientRect()
    if (label === "" && r.width > 0) out.emptyButtons.push(b.className.toString().slice(0, 60))
  }

  return out
}

const auditPage = async (context, base, path, scope, viewport) => {
  const page = await context.newPage()
  attachListeners(page, scope)
  try {
    await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 25000 })
  } catch {
    record({ severity: "error", scope, message: "navigation timed out" })
    await page.close()
    return null
  }
  await page.waitForTimeout(900)

  const result = await page.evaluate(AUDIT_IN_PAGE)

  if (result.bodyText.trim().length < 5) {
    record({ severity: "error", scope, message: "page rendered essentially no text (blank screen)" })
  }
  if (result.h1.length === 0 && !path.includes("splash")) {
    record({ severity: "warn", scope, message: "no <h1> on page" })
  }
  if (result.h1.length > 1) {
    record({ severity: "warn", scope, message: `${String(result.h1.length)} <h1> elements: ${result.h1.join(" | ").slice(0, 120)}` })
  }
  if (result.scrollWidth > result.clientWidth + 1) {
    record({
      severity: "error",
      scope,
      message: `horizontal overflow: scrollWidth ${String(result.scrollWidth)} > clientWidth ${String(result.clientWidth)}`,
    })
  }
  for (const o of result.overflowing.slice(0, 3)) {
    record({ severity: "warn", scope, message: `element past right edge: <${o.tag}> right=${String(o.right)} vw=${String(o.vw)} class="${o.cls}"` })
  }
  for (const m of result.monoMoney.slice(0, 3)) {
    record({ severity: "error", scope, message: `money in monospace (D-029): "${m.text}" -> ${m.fontFamily}` })
  }
  for (const t of result.smallTargets.slice(0, 4)) {
    record({ severity: "warn", scope, message: `small tap target <${t.tag}> "${t.label}" ${String(t.w)}x${String(t.h)}` })
  }
  for (const d of result.landmarkDupes) {
    record({ severity: "error", scope, message: `duplicate nav landmark label: ${d}` })
  }
  for (const b of result.emptyButtons.slice(0, 2)) {
    record({ severity: "warn", scope, message: `button with no accessible name: class="${b}"` })
  }

  await page.screenshot({ path: `${OUT}/${scope.replace(/[^a-z0-9]+/giu, "_")}.png`, fullPage: false })
  await page.close()
  return result
}

const signInClient = async (context) => {
  const page = await context.newPage()
  await page.goto(`${CLIENT_BASE}/login`, { waitUntil: "networkidle" })
  await page.getByLabel("Email").fill(CLIENT_EMAIL)
  await page.getByLabel("Password").fill(CLIENT_PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(2500)
  const url = page.url()
  await page.close()
  return url
}

const signInAdmin = async (context) => {
  const page = await context.newPage()
  await page.goto(`${ADMIN_BASE}/login`, { waitUntil: "networkidle" })
  const idField = page.getByLabel(/login id|email|administrator/iu).first()
  await idField.fill(ADMIN_ID)
  await page.getByLabel("Password").fill(ADMIN_PASSWORD)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForTimeout(2500)
  const url = page.url()
  await page.close()
  return url
}

const resolveDynamic = async (context, base, staticPath, linkPattern) => {
  const page = await context.newPage()
  await page.goto(`${base}${staticPath}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(900)
  const href = await page.evaluate((pattern) => {
    const re = new RegExp(pattern, "u")
    for (const a of document.querySelectorAll("a[href]")) {
      const h = a.getAttribute("href") ?? ""
      if (re.test(h)) return h
    }
    return null
  }, linkPattern)
  await page.close()
  return href
}

await mkdir(OUT, { recursive: true })

const clientPaths = await readRoutes("clientRoutes.ts")
const adminPaths = await readRoutes("adminRoutes.ts")
process.stdout.write(`client routes discovered: ${String(clientPaths.length)}\n`)
process.stdout.write(`admin routes discovered:  ${String(adminPaths.length)}\n`)

const browser = await chromium.launch()
const summary = { client: {}, admin: {} }

for (const vp of VIEWPORTS) {
  process.stdout.write(`\n===== CLIENT @ ${vp.name} (${String(vp.width)}x${String(vp.height)}) =====\n`)
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const landed = await signInClient(context)
  process.stdout.write(`  signed in -> ${landed}\n`)
  if (landed.includes("/login")) {
    record({ severity: "error", scope: `client/${vp.name}/login`, message: "client sign-in did not leave /login" })
  }

  const fundHref = await resolveDynamic(context, CLIENT_BASE, "/funds", "^/funds/[^/]+$")
  const sipHref = await resolveDynamic(context, CLIENT_BASE, "/sips", "^/sips/[^/]+$")
  const payHref = await resolveDynamic(context, CLIENT_BASE, "/activity", "^/activity/payments/[^/]+$")

  const resolved = []
  for (const p of clientPaths) {
    if (p === "*") continue
    if (!p.includes(":")) { resolved.push(p); continue }
    if (p.startsWith("/funds/:fundId") && fundHref !== null) {
      resolved.push(p.replace("/funds/:fundId", fundHref))
    } else if (p.startsWith("/sips/:sipPlanId") && sipHref !== null) {
      resolved.push(p.replace("/sips/:sipPlanId", sipHref))
    } else if (p.startsWith("/activity/payments/:paymentId") && payHref !== null) {
      resolved.push(payHref)
    } else {
      process.stdout.write(`  skip (no live id): ${p}\n`)
    }
  }

  for (const p of [...new Set(resolved)]) {
    const scope = `client/${vp.name}${p}`
    process.stdout.write(` -> ${p}\n`)
    await auditPage(context, CLIENT_BASE, p, scope, vp)
  }
  summary.client[vp.name] = resolved.length
  await context.close()
}

for (const vp of VIEWPORTS) {
  process.stdout.write(`\n===== ADMIN @ ${vp.name} (${String(vp.width)}x${String(vp.height)}) =====\n`)
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const landed = await signInAdmin(context)
  process.stdout.write(`  signed in -> ${landed}\n`)
  if (landed.includes("/login")) {
    record({ severity: "error", scope: `admin/${vp.name}/login`, message: "admin sign-in did not leave /login" })
  }

  const fundHref = await resolveDynamic(context, ADMIN_BASE, "/funds", "^/funds/[0-9a-f]{8}-")
  const userHref = await resolveDynamic(context, ADMIN_BASE, "/users", "^/users/[0-9a-f]{8}-")

  const resolved = []
  for (const p of adminPaths) {
    if (p === "*") continue
    if (!p.includes(":")) { resolved.push(p); continue }
    if (p.includes(":fundId") && fundHref !== null) {
      const id = fundHref.split("/")[2] ?? ""
      resolved.push(p.replace(":fundId", id))
    } else if (p.includes(":userId") && userHref !== null) {
      const id = userHref.split("/")[2] ?? ""
      resolved.push(p.replace(":userId", id))
    } else {
      process.stdout.write(`  skip (no live id): ${p}\n`)
    }
  }

  for (const p of [...new Set(resolved)]) {
    const scope = `admin/${vp.name}${p}`
    process.stdout.write(` -> ${p}\n`)
    await auditPage(context, ADMIN_BASE, p, scope, vp)
  }
  summary.admin[vp.name] = resolved.length
  await context.close()
}

await browser.close()

const errors = findings.filter((f) => f.severity === "error")
const warns = findings.filter((f) => f.severity === "warn")
await writeFile(`${OUT}/findings.json`, JSON.stringify({ summary, findings }, null, 2))

process.stdout.write(`\n================ AUDIT SUMMARY ================\n`)
process.stdout.write(`pages audited: client ${JSON.stringify(summary.client)} admin ${JSON.stringify(summary.admin)}\n`)
process.stdout.write(`errors: ${String(errors.length)}   warnings: ${String(warns.length)}\n`)

const group = (list) => {
  const byMsg = new Map()
  for (const f of list) {
    const key = f.message.replace(/[0-9a-f]{8,}/giu, "<id>").replace(/\d+/gu, "N")
    byMsg.set(key, [...(byMsg.get(key) ?? []), f.scope])
  }
  return [...byMsg.entries()].sort((a, b) => b[1].length - a[1].length)
}

process.stdout.write(`\n--- ERRORS (grouped) ---\n`)
for (const [msg, scopes] of group(errors)) {
  process.stdout.write(`[${String(scopes.length)}x] ${msg}\n     e.g. ${scopes.slice(0, 3).join(", ")}\n`)
}
process.stdout.write(`\n--- WARNINGS (grouped) ---\n`)
for (const [msg, scopes] of group(warns)) {
  process.stdout.write(`[${String(scopes.length)}x] ${msg}\n     e.g. ${scopes.slice(0, 3).join(", ")}\n`)
}
process.stdout.write(`\nfindings written to ${OUT}/findings.json\n`)
