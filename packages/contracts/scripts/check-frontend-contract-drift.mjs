import { readFile, stat, writeFile } from "node:fs/promises"
import { readdir } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, "../..", "..")
const openApiPath = join(repositoryRoot, "packages/contracts/generated/openapi-v1.json")
const baselinePath = join(scriptDirectory, "frontend-contract-drift-baseline.json")

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"])
const HTTP_METHODS = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"])
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", "generated"])

const DEFAULT_SCAN_ROOTS = [
  "frontend_stack/packages/client",
  "frontend_stack/packages/admin",
  "frontend_stack/packages/shared",
  "frontend_stack_ts/src",
]

const configuredScanRoots = () => {
  const configured = process.env.BOE_FRONTEND_SCAN_ROOTS
  if (configured === undefined || configured.trim() === "") return DEFAULT_SCAN_ROOTS
  return configured
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
}

const directoryExists = async (path) => {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

const resolveScanRoots = async () => {
  const requested = configuredScanRoots()
  const present = []
  for (const relativePath of requested) {
    const absolute = join(repositoryRoot, relativePath)
    if (await directoryExists(absolute)) present.push(absolute)
  }
  if (present.length === 0) {
    throw new Error(
      `No frontend source roots found. Looked for: ${requested.join(", ")}. ` +
        "Set BOE_FRONTEND_SCAN_ROOTS to a comma-separated list of repository-relative directories.",
    )
  }
  return present
}

const collectSourceFiles = async () => {
  const roots = await resolveScanRoots()
  return (await Promise.all(roots.map(walk))).flat()
}

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      files.push(...(await walk(path)))
    } else if (
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

const extractRequestMethods = (source) => {
  const requests = new Map()
  const callPattern = /\b(?:apiRequest|fetch)\s*\(\s*([`"'])(\/v1\/[^`"']+)\1([\s\S]*?)(?=\)\s*[,;]|\)\s*\}|\)\s*$)/g
  for (const match of source.matchAll(callPattern)) {
    const path = normalizeFrontendPath(match[2])
    if (path.includes(" ") || path.includes("\\n")) continue
    const methodMatch = match[3].match(/\bmethod\s*:\s*([`"'])([A-Za-z]+)\1/u)
    const method = methodMatch?.[2]?.toUpperCase() ?? "GET"
    if (!HTTP_METHODS.has(method)) continue
    const methods = requests.get(path) ?? new Set()
    methods.add(method)
    requests.set(path, methods)
  }
  return requests
}

export const discoverFrontendPaths = async () => {
  const files = await collectSourceFiles()
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

export const discoverFrontendRequests = async () => {
  const files = await collectSourceFiles()
  const requests = new Map()
  for (const file of files) {
    const source = await readFile(file, "utf8")
    for (const [path, methods] of extractRequestMethods(source)) {
      const current = requests.get(path) ?? new Set()
      for (const method of methods) current.add(method)
      requests.set(path, current)
    }
  }
  return new Map([...requests.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

const loadOpenApiPaths = async () => {
  const document = JSON.parse(await readFile(openApiPath, "utf8"))
  return new Set(Object.keys(document.paths ?? {}).map(normalizeOpenApiPath))
}

const loadOpenApiOperations = async () => {
  const document = JSON.parse(await readFile(openApiPath, "utf8"))
  const operations = new Map()
  for (const [path, definition] of Object.entries(document.paths ?? {})) {
    const methods = new Set(
      Object.keys(definition)
        .map((method) => method.toUpperCase())
        .filter((method) => HTTP_METHODS.has(method)),
    )
    operations.set(normalizeOpenApiPath(path), methods)
  }
  return operations
}

const loadBaseline = async () => {
  try {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"))
    return {
      paths: new Set(baseline.uncontractedPaths ?? []),
      methods: new Set(baseline.uncontractedMethods ?? []),
    }
  } catch (error) {
    if (error?.code === "ENOENT") return { paths: new Set(), methods: new Set() }
    throw error
  }
}

const writeBaseline = async (paths, methods = []) => {
  const sortedPaths = [...paths].sort()
  const sortedMethods = [...methods].sort()
  await writeFile(
    baselinePath,
    `${JSON.stringify(
      {
        generatedFrom: "generated/openapi-v1.json",
        uncontractedPaths: sortedPaths,
        uncontractedMethods: sortedMethods,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

export const findDrift = ({ frontendPaths, openApiPaths }) =>
  new Map([...frontendPaths].filter(([path]) => !openApiPaths.has(path)))

export const findMethodDrift = ({ frontendRequests, openApiOperations }) => {
  const drift = new Map()
  for (const [path, methods] of frontendRequests) {
    const supportedMethods = openApiOperations.get(path)
    if (!supportedMethods) continue
    const unsupported = [...methods].filter((method) => !supportedMethods.has(method))
    if (unsupported.length > 0) drift.set(path, new Set(unsupported))
  }
  return drift
}

const methodDriftKey = (path, method) => `${method} ${path}`

const run = async () => {
  const frontendPaths = await discoverFrontendPaths()
  const frontendRequests = await discoverFrontendRequests()
  const openApiPaths = await loadOpenApiPaths()
  const openApiOperations = await loadOpenApiOperations()
  const drift = findDrift({ frontendPaths, openApiPaths })
  const methodDrift = findMethodDrift({ frontendRequests, openApiOperations })
  const methodDriftKeys = new Set(
    [...methodDrift].flatMap(([path, methods]) => [...methods].map((method) => methodDriftKey(path, method))),
  )

  if (process.argv.includes("--write-baseline")) {
    await writeBaseline(drift.keys(), methodDriftKeys)
    console.log(`Wrote ${drift.size} known frontend contract gaps and ${methodDriftKeys.size} method gaps to ${relative(repositoryRoot, baselinePath)}`)
    return
  }

  const baseline = await loadBaseline()
  const newDrift = [...drift.keys()].filter((path) => !baseline.paths.has(path))
  const resolved = [...baseline.paths].filter((path) => !drift.has(path))
  const newMethodDrift = [...methodDriftKeys].filter((key) => !baseline.methods.has(key))
  const resolvedMethodDrift = [...baseline.methods].filter((key) => !methodDriftKeys.has(key))

  if (newDrift.length > 0 || resolved.length > 0 || newMethodDrift.length > 0 || resolvedMethodDrift.length > 0) {
    console.error("Frontend/API contract drift changed.")
    if (newDrift.length > 0) console.error(`New uncontracted paths:\n${newDrift.map((path) => `  - ${path}`).join("\n")}`)
    if (resolved.length > 0) console.error(`Contract gaps resolved; regenerate the baseline:\n${resolved.map((path) => `  - ${path}`).join("\n")}`)
    if (newMethodDrift.length > 0) console.error(`New unsupported frontend methods:\n${newMethodDrift.map((key) => `  - ${key}`).join("\n")}`)
    if (resolvedMethodDrift.length > 0) console.error(`Method gaps resolved; regenerate the baseline:\n${resolvedMethodDrift.map((key) => `  - ${key}`).join("\n")}`)
    process.exitCode = 1
    return
  }

  console.log(`Checked ${frontendPaths.size} frontend paths and ${frontendRequests.size} request paths; ${drift.size} known contract gaps; no new drift.`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await run()
