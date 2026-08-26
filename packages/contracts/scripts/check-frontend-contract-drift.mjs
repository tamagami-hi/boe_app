import { readFile, writeFile } from "node:fs/promises"
import { readdir } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, "../..", "..")
const openApiPath = join(repositoryRoot, "packages/contracts/generated/openapi-v1.json")
const frontendRoot = join(repositoryRoot, "frontend_stack/packages")
const baselinePath = join(scriptDirectory, "frontend-contract-drift-baseline.json")

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"])
const SERVICE_DIRECTORIES = new Set(["client", "admin", "shared"])

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(path)))
    else if (
      SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf("."))) &&
      !/(?:\.test|\.spec)\.[^.]+$/u.test(entry.name)
    ) files.push(path)
  }
  return files
}

const normalizeFrontendPath = (value) => {
  const withoutQuery = value.split("?")[0]
  return withoutQuery
    .replace(/\$\{(?:query|search|params)\}$/u, "")
    .replace(/\$\{[^}]+\}/g, "{param}")
    .replace(/:[A-Za-z0-9_]+/g, "{param}")
    .replace(/\/(?!v1(?:\/|$))([a-z]+(?:_[a-z]+)?_\d+|[a-z]+\d+)(?=\/|$)/giu, "/{param}")
}

const normalizeOpenApiPath = (value) => value.replace(/\{[^}]+\}/g, "{param}")

const extractPaths = (source) => {
  const paths = new Set()
  const literalPattern = /[`"'](\/v1\/[^`"']+)[`"']/g
  for (const match of source.matchAll(literalPattern)) {
    const path = normalizeFrontendPath(match[1])
    if (path.includes(" ") || path.includes("\\n")) continue
    paths.add(path)
  }
  return paths
}

export const discoverFrontendPaths = async () => {
  const packageDirectories = (await readdir(frontendRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && SERVICE_DIRECTORIES.has(entry.name))
    .map((entry) => join(frontendRoot, entry.name))
  const files = (await Promise.all(packageDirectories.map(walk))).flat()
  const paths = new Map()
  for (const file of files) {
    const source = await readFile(file, "utf8")
    for (const path of extractPaths(source)) {
      const locations = paths.get(path) ?? []
      locations.push(relative(repositoryRoot, file))
      paths.set(path, locations)
    }
  }
  return new Map([...paths.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

const loadOpenApiPaths = async () => {
  const document = JSON.parse(await readFile(openApiPath, "utf8"))
  return new Set(Object.keys(document.paths ?? {}).map(normalizeOpenApiPath))
}

const loadBaseline = async () => {
  try {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"))
    return new Set(baseline.uncontractedPaths ?? [])
  } catch (error) {
    if (error?.code === "ENOENT") return new Set()
    throw error
  }
}

const writeBaseline = async (paths) => {
  const sortedPaths = [...paths].sort()
  await writeFile(
    baselinePath,
    `${JSON.stringify({ generatedFrom: "generated/openapi-v1.json", uncontractedPaths: sortedPaths }, null, 2)}\n`,
    "utf8",
  )
}

export const findDrift = ({ frontendPaths, openApiPaths }) =>
  new Map([...frontendPaths].filter(([path]) => !openApiPaths.has(path)))

const run = async () => {
  const frontendPaths = await discoverFrontendPaths()
  const openApiPaths = await loadOpenApiPaths()
  const drift = findDrift({ frontendPaths, openApiPaths })

  if (process.argv.includes("--write-baseline")) {
    await writeBaseline(drift.keys())
    console.log(`Wrote ${drift.size} known frontend contract gaps to ${relative(repositoryRoot, baselinePath)}`)
    return
  }

  const baseline = await loadBaseline()
  const newDrift = [...drift.keys()].filter((path) => !baseline.has(path))
  const resolved = [...baseline].filter((path) => !drift.has(path))

  if (newDrift.length > 0 || resolved.length > 0) {
    console.error("Frontend/API contract drift changed.")
    if (newDrift.length > 0) console.error(`New uncontracted paths:\n${newDrift.map((path) => `  - ${path}`).join("\n")}`)
    if (resolved.length > 0) console.error(`Contract gaps resolved; regenerate the baseline:\n${resolved.map((path) => `  - ${path}`).join("\n")}`)
    process.exitCode = 1
    return
  }

  console.log(`Checked ${frontendPaths.size} frontend paths; ${drift.size} known contract gaps; no new drift.`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await run()
