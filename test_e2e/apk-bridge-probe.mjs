const listing = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json())
const target = listing.find((t) => t.type === "page")
if (target === undefined) {
  process.stdout.write("no page target on the CDP endpoint\n")
  process.exit(1)
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data))
  const settle = pending.get(message.id)
  if (settle === undefined) return
  pending.delete(message.id)
  settle(message)
})

const send = (method, params) =>
  new Promise((resolve) => {
    const id = nextId
    nextId += 1
    pending.set(id, resolve)
    socket.send(JSON.stringify({ id, method, params }))
  })

await new Promise((ready) => {
  socket.addEventListener("open", ready, { once: true })
})

const EXPRESSION = `(() => {
  const cap = window.Capacitor
  const plugins = cap && cap.Plugins ? cap.Plugins : {}
  const styles = getComputedStyle(document.documentElement)
  return JSON.stringify({
    url: location.href,
    isNative: cap && typeof cap.isNativePlatform === "function" ? cap.isNativePlatform() : null,
    platform: cap && typeof cap.getPlatform === "function" ? cap.getPlatform() : null,
    pluginNames: Object.keys(plugins).sort(),
    safeAreaTop: styles.getPropertyValue("--safe-area-inset-top").trim(),
    safeAreaBottom: styles.getPropertyValue("--safe-area-inset-bottom").trim(),
    body: (document.body.innerText || "").slice(0, 140)
  })
})()`

const reply = await send("Runtime.evaluate", { expression: EXPRESSION, returnByValue: true })
socket.close()

const raw = reply?.result?.result?.value
if (typeof raw !== "string") {
  process.stdout.write(`unexpected CDP reply: ${JSON.stringify(reply).slice(0, 400)}\n`)
  process.exit(1)
}
const probe = JSON.parse(raw)

process.stdout.write(`url                       ${probe.url}\n`)
process.stdout.write(`isNativePlatform()        ${String(probe.isNative)}\n`)
process.stdout.write(`getPlatform()             ${String(probe.platform)}\n`)
process.stdout.write(`Capacitor.Plugins         ${probe.pluginNames.join(", ")}\n`)
process.stdout.write(`--safe-area-inset-top     "${probe.safeAreaTop}"\n`)
process.stdout.write(`--safe-area-inset-bottom  "${probe.safeAreaBottom}"\n`)
process.stdout.write(`body                      ${probe.body.replace(/\n/gu, " | ")}\n`)

const REQUIRED = ["App", "AppUpdate", "Browser", "NativeBiometric", "SecureStorage", "SystemChrome"]
const missing = REQUIRED.filter((name) => !probe.pluginNames.includes(name))
process.stdout.write(`\nrequired plugins missing: ${missing.length === 0 ? "NONE" : missing.join(", ")}\n`)
process.exit(missing.length === 0 && probe.isNative === true ? 0 : 1)
