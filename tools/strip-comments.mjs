#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs"
import { join, extname, relative, resolve } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const loadTypeScript = () => {
  const here = new URL(".", import.meta.url).pathname
  const candidates = [
    "typescript",
    resolve(here, "../backend_controller/node_modules/typescript"),
    resolve(here, "../frontend_stack_ts/node_modules/typescript"),
    resolve(here, "../node_modules/typescript"),
  ]
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      continue
    }
  }
  process.stderr.write(
    "strip-comments: cannot resolve the typescript package.\n" +
    "install it in backend_controller or frontend_stack_ts first.\n",
  )
  process.exit(2)
}

const ts = loadTypeScript()

const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "coverage", ".next", ".git",
  ".venv", "__pycache__", ".turbo", ".cache", "generated",
])

const KEEP = [
  /^\/[/*]\s*eslint-/,
  /^\/[/*]\s*@ts-(expect-error|ignore|nocheck)/,
  /^\/[/*]\s*prettier-ignore/,
  /^\/[/*]\s*(c8|v8|istanbul|node:coverage)\s+ignore/,
  /^\/[/*]\s*biome-ignore/,
  /^\/[/*]\s*@vite-ignore/,
  /^\/[/*]\s*#__PURE__/,
  /^\/\*\*?\s*@(license|preserve|copyright)/,
  /^\/[/*]!/,
]

const args = process.argv.slice(2)
const write = args.includes("--write")
const quiet = args.includes("--quiet")
const targets = args.filter((a) => !a.startsWith("--"))

if (targets.length === 0) {
  process.stderr.write(
    "usage: strip-comments.mjs <file|dir>... [--write] [--quiet]\n" +
    "       dry run by default; prints what would change\n",
  )
  process.exit(2)
}

const scriptKindFor = (file) => {
  switch (extname(file)) {
    case ".tsx": return ts.ScriptKind.TSX
    case ".jsx": return ts.ScriptKind.JSX
    case ".js": case ".mjs": case ".cjs": return ts.ScriptKind.JS
    default: return ts.ScriptKind.TS
  }
}

const collectFiles = (target, out) => {
  const stat = statSync(target)
  if (stat.isFile()) {
    if (EXTENSIONS.has(extname(target))) out.push(target)
    return out
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      collectFiles(join(target, entry.name), out)
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
      out.push(join(target, entry.name))
    }
  }
  return out
}

const commentRangesOf = (text, file) => {
  const source = ts.createSourceFile(
    file, text, ts.ScriptTarget.Latest,  true, scriptKindFor(file),
  )
  const seen = new Map()

  const record = (ranges) => {
    if (ranges === undefined) return
    for (const range of ranges) seen.set(`${range.pos}:${range.end}`, range)
  }

  const walk = (node) => {
    record(ts.getLeadingCommentRanges(text, node.getFullStart()))
    record(ts.getTrailingCommentRanges(text, node.getEnd()))
    for (const child of node.getChildren(source)) walk(child)
  }

  walk(source)
  record(ts.getLeadingCommentRanges(text, 0))
  record(ts.getTrailingCommentRanges(text, 0))

  return [...seen.values()].sort((a, b) => a.pos - b.pos)
}

const shouldKeep = (snippet) => KEEP.some((pattern) => pattern.test(snippet.trimStart()))

const stripFile = (file) => {
  const original = readFileSync(file, "utf8")
  const shebang = original.startsWith("#!") ? original.slice(0, original.indexOf("\n") + 1) : ""
  const text = original

  let ranges
  try {
    ranges = commentRangesOf(text, file)
  } catch (error) {
    return { file, error: String(error) }
  }

  const removable = ranges.filter((range) => {
    if (shebang !== "" && range.pos < shebang.length) return false
    return !shouldKeep(text.slice(range.pos, range.end))
  })
  if (removable.length === 0) return { file, removed: 0 }

  let out = text
  for (const range of [...removable].sort((a, b) => b.pos - a.pos)) {
    const before = out.slice(0, range.pos)
    const after = out.slice(range.end)
    const lineStart = before.lastIndexOf("\n") + 1
    const onlyIndentBefore = before.slice(lineStart).trim() === ""
    const restOfLine = after.slice(0, after.indexOf("\n") === -1 ? after.length : after.indexOf("\n"))
    const nothingAfter = restOfLine.trim() === ""

    if (onlyIndentBefore && nothingAfter) {
      const cutFrom = lineStart
      const newlineAfter = after.indexOf("\n")
      const cutTo = range.end + (newlineAfter === -1 ? after.length : newlineAfter + 1)
      out = out.slice(0, cutFrom) + out.slice(cutTo)
    } else if (nothingAfter) {
      out = before.replace(/[ \t]+$/u, "") + after
    } else {
      out = before + after
    }
  }

  out = out.replace(/\n{3,}/gu, "\n\n").replace(/[ \t]+\n/gu, "\n")
  if (!out.endsWith("\n")) out += "\n"

  if (out === original) return { file, removed: 0 }
  if (write) writeFileSync(file, out, "utf8")
  return { file, removed: removable.length, bytes: original.length - out.length }
}

const files = []
for (const target of targets) collectFiles(resolve(target), files)

let changed = 0
let totalComments = 0
let totalBytes = 0
const failures = []

for (const file of files.sort()) {
  const result = stripFile(file)
  if (result.error !== undefined) { failures.push(result); continue }
  if (result.removed === 0) continue
  changed += 1
  totalComments += result.removed
  totalBytes += result.bytes
  if (!quiet) {
    process.stdout.write(
      `${write ? "stripped" : "would strip"} ${String(result.removed).padStart(4)} ` +
      `comment(s), ${String(result.bytes).padStart(6)} bytes  ${relative(process.cwd(), file)}\n`,
    )
  }
}

process.stdout.write(
  `\n${write ? "STRIPPED" : "DRY RUN"}: ${String(totalComments)} comment(s) across ` +
  `${String(changed)} of ${String(files.length)} file(s), ${String(totalBytes)} bytes\n`,
)
for (const failure of failures) {
  process.stdout.write(`  PARSE FAILED ${relative(process.cwd(), failure.file)}: ${failure.error}\n`)
}
if (!write && totalComments > 0) process.stdout.write("re-run with --write to apply\n")
