import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { JSDOM } from "jsdom"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const distRoot = join(projectRoot, "dist")
const assetsRoot = join(distRoot, "assets")

const failures = []
const fail = (message) => failures.push(message)

const installBrowserGlobals = () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://localhost/",
    pretendToBeVisual: true,
  })
  const { window } = dom

  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, "navigator", {
    value: window.navigator,
    configurable: true,
  })

  const forwarded = [
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "MutationObserver",
    "localStorage",
    "sessionStorage",
    "location",
    "history",
    "CSS",
  ]
  for (const key of forwarded) {
    if (window[key] !== undefined) globalThis[key] = window[key]
  }

  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 16)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.matchMedia = () => ({
    matches: false,
    media: "",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })
  globalThis.fetch = () => new Promise(() => undefined)
}

const referencedAssets = async () => {
  const html = await readFile(join(distRoot, "index.html"), "utf8")
  return [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((match) => match[1])
}

const run = async () => {
  const referenced = await referencedAssets()
  if (referenced.length === 0) fail("index.html references no assets. Run the build first.")

  const present = new Set(await readdir(assetsRoot))
  for (const name of referenced) {
    if (!present.has(name)) fail(`index.html references a missing asset: assets/${name}`)
  }

  const chunks = [...present].filter((name) => name.endsWith(".js"))
  if (chunks.length === 0) fail("No JS chunks found in dist/assets.")

  installBrowserGlobals()

  const rejections = []
  process.on("unhandledRejection", (reason) => {
    rejections.push(String(reason))
  })

  for (const chunk of chunks) {
    try {
      await import(pathToFileURL(join(assetsRoot, chunk)).href)
    } catch (error) {
      fail(`evaluating ${chunk} threw: ${error?.message ?? String(error)}`)
    }
  }

  await new Promise((settle) => setTimeout(settle, 50))
  for (const rejection of rejections) {
    fail(`unhandled rejection during boot: ${rejection}`)
  }

  if (failures.length > 0) {
    console.error("check-bundle-boots failed:")
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }

  console.log(`check-bundle-boots passed: ${chunks.length} chunks evaluated with no error.`)
}

await run()
