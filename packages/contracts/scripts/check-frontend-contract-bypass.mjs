import { readFile, readdir, stat } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, "../..", "..")
const openApiPath = join(repositoryRoot, "packages/contracts/generated/openapi-v1.json")

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"])
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage"])

const DEFAULT_SCAN_ROOTS = ["frontend_stack_ts/src"]

const ALLOWED_LITERAL_FILES = new Set(["frontend_stack_ts/src/api/generated/operations.ts"])

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
  for (const root of requested) {
    const absolute = join(repositoryRoot, root)
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

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      files.push(...(await walk(path)))
      continue
    }
    if (/(?:\.test|\.spec)\.[^.]+$/u.test(entry.name)) continue
    if (SOURCE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) files.push(path)
  }
  return files
}

const collectSourceFiles = async () => {
  const roots = await resolveScanRoots()
  return (await Promise.all(roots.map(walk))).flat()
}

export const findContractBypasses = async () => {
  const files = await collectSourceFiles()
  const bypasses = []
  for (const file of files) {
    const relativePath = relative(repositoryRoot, file)
    if (ALLOWED_LITERAL_FILES.has(relativePath)) continue
    const source = await readFile(file, "utf8")
    for (const match of source.matchAll(/[`"'](\/v1\/[^`"'\s]*)[`"']/gu)) {
      bypasses.push({ file: relativePath, path: match[1] })
    }
  }
  return bypasses
}

export const contractedOperationCount = async () => {
  const document = JSON.parse(await readFile(openApiPath, "utf8"))
  return Object.values(document.paths ?? {}).reduce(
    (total, methods) => total + Object.keys(methods).length,
    0,
  )
}

export const generatedOperationCount = async () => {
  const source = await readFile(
    join(repositoryRoot, "frontend_stack_ts/src/api/generated/operations.ts"),
    "utf8",
  )
  const exported = source.match(/^export \{$([\s\S]*?)^\}$/mu)
  if (exported === null) throw new Error("Could not read the generated operation export block.")
  return exported[1].split(",").filter((entry) => entry.trim() !== "").length
}

const run = async () => {
  const bypasses = await findContractBypasses()
  if (bypasses.length > 0) {
    process.stderr.write(
      "Frontend code addresses the API by literal path instead of a contract operation:\n",
    )
    for (const bypass of bypasses) {
      process.stderr.write(`  - ${bypass.path} in ${bypass.file}\n`)
    }
    process.stderr.write(
      "Every request must go through api.request(operation) with an operation from @beonedge/contracts.\n",
    )
    process.exitCode = 1
    return
  }

  const contracted = await contractedOperationCount()
  const generated = await generatedOperationCount()
  if (contracted !== generated) {
    process.stderr.write(
      `Contract drift: ${String(contracted)} contracted operations but ${String(generated)} in the generated client. Run npm run generate:api in frontend_stack_ts.\n`,
    )
    process.exitCode = 1
    return
  }

  process.stdout.write(
    `No contract bypasses. ${String(contracted)} contracted operations, all reachable through the generated client.\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await run()
}
