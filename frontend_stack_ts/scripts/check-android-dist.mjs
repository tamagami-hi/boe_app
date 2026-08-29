import { readdir, readFile, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const distRoot = join(projectRoot, "dist")
const assetsRoot = join(distRoot, "assets")

const MAX_JS_CHUNK_BYTES = 320 * 1024
const MAX_CSS_BYTES = 640 * 1024
const MAX_TOTAL_BYTES = 2600 * 1024

const FORBIDDEN_FONT_SUBSETS = ["cyrillic", "greek", "vietnamese"]

const CROSS_TARGET_PATTERNS = {
  client: [/admin/i, /website/i, /landing/i],
  admin: [/\bclient\b/i],
}

const CROSS_TARGET_MARKERS = {
  client: ["Administrator console", "Collective AUM growth", "Email deliveries", "Audit log"],
  admin: ["Good to see you", "Manage SIPs", "Value ledger", "Administrator-managed pools"],
}

const variantArgument = process.argv.find((argument) => argument.startsWith("--variant="))
const variant = variantArgument?.slice("--variant=".length) ?? "client"

if (!Object.hasOwn(CROSS_TARGET_PATTERNS, variant)) {
  console.error(`Unknown variant: ${variant}. Expected one of ${Object.keys(CROSS_TARGET_PATTERNS).join(", ")}`)
  process.exit(1)
}

const failures = []
const fail = (message) => failures.push(message)

const listAssets = async () => {
  const entries = await readdir(assetsRoot, { withFileTypes: true })
  const assets = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(assetsRoot, entry.name)
    assets.push({ name: entry.name, path, size: (await stat(path)).size })
  }
  return assets
}

const checkCrossTargetLeakage = (assets) => {
  for (const asset of assets) {
    for (const pattern of CROSS_TARGET_PATTERNS[variant]) {
      if (pattern.test(asset.name)) {
        fail(`${variant} build contains a cross-target asset: ${asset.name} matched ${String(pattern)}`)
      }
    }
  }
}

const checkCrossTargetContents = async (assets) => {
  const markers = CROSS_TARGET_MARKERS[variant]
  const scripts = assets.filter((asset) => asset.name.endsWith(".js"))
  if (scripts.length === 0) {
    fail("no JavaScript assets were emitted, so cross-target contents cannot be verified")
    return
  }
  let sighted = 0
  for (const asset of scripts) {
    const source = await readFile(join(assetsRoot, asset.name), "utf8")
    for (const marker of markers) {
      if (source.includes(marker)) {
        sighted += 1
        fail(`${variant} build contains other-target copy: ${asset.name} contains ${JSON.stringify(marker)}`)
      }
    }
  }
  if (sighted === 0) {
    console.log(
      `cross-target contents: none of ${String(markers.length)} other-target markers found in ${String(scripts.length)} chunks.`,
    )
  }
}

const checkBudgets = (assets) => {
  let total = 0
  for (const asset of assets) {
    total += asset.size
    if (asset.name.endsWith(".js") && asset.size > MAX_JS_CHUNK_BYTES) {
      fail(`JS chunk over budget: ${asset.name} is ${asset.size} bytes, limit ${MAX_JS_CHUNK_BYTES}`)
    }
    if (asset.name.endsWith(".css") && asset.size > MAX_CSS_BYTES) {
      fail(`CSS over budget: ${asset.name} is ${asset.size} bytes, limit ${MAX_CSS_BYTES}`)
    }
  }
  if (total > MAX_TOTAL_BYTES) {
    fail(`Total assets over budget: ${total} bytes, limit ${MAX_TOTAL_BYTES}`)
  }
}

const checkFonts = (assets) => {
  for (const asset of assets) {
    if (asset.name.endsWith(".woff")) {
      fail(`woff fallback shipped: ${asset.name}. Every supported WebView reads woff2.`)
    }
    for (const subset of FORBIDDEN_FONT_SUBSETS) {
      if (asset.name.toLowerCase().includes(subset)) {
        fail(`Unused font subset shipped: ${asset.name} contains "${subset}"`)
      }
    }
  }
}

const buildChunkGraph = async (assets) => {
  const jsAssets = assets.filter((asset) => asset.name.endsWith(".js"))
  const names = new Set(jsAssets.map((asset) => asset.name))
  const graph = new Map()
  for (const asset of jsAssets) {
    const source = await readFile(asset.path, "utf8")
    const edges = new Set()
    for (const candidate of names) {
      if (candidate === asset.name) continue
      if (source.includes(candidate)) edges.add(candidate)
    }
    graph.set(asset.name, edges)
  }
  return graph
}

const findCycle = (graph) => {
  const visiting = new Set()
  const visited = new Set()
  const stack = []

  const walk = (node) => {
    if (visited.has(node)) return null
    if (visiting.has(node)) return [...stack.slice(stack.indexOf(node)), node]
    visiting.add(node)
    stack.push(node)
    for (const next of graph.get(node) ?? []) {
      const cycle = walk(next)
      if (cycle !== null) return cycle
    }
    stack.pop()
    visiting.delete(node)
    visited.add(node)
    return null
  }

  for (const node of graph.keys()) {
    const cycle = walk(node)
    if (cycle !== null) return cycle
  }
  return null
}

const run = async () => {
  const assets = await listAssets()
  if (assets.length === 0) {
    fail("dist/assets is empty. Run the build first.")
  }

  checkCrossTargetLeakage(assets)
  await checkCrossTargetContents(assets)
  checkBudgets(assets)
  checkFonts(assets)

  const cycle = findCycle(await buildChunkGraph(assets))
  if (cycle !== null) {
    fail(
      `Chunk import graph has a cycle: ${cycle.join(" -> ")}. ` +
        "A cycle across a chunk boundary is a launch crash and is invisible to unit tests.",
    )
  }

  if (failures.length > 0) {
    console.error(`check-android-dist failed for variant "${variant}":`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }

  const total = assets.reduce((sum, asset) => sum + asset.size, 0)
  console.log(
    `check-android-dist passed for variant "${variant}": ${assets.length} assets, ${total} bytes total.`,
  )
}

await run()
