import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { BRIDGED_PLUGINS, CORE_REGISTERED_PLUGINS } from "~/platform/plugins"

const SOURCE_ROOT = "src"
const SELF = join("src", "platform", "plugins.ts")

const collect = (directory: string): string[] => {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...collect(path))
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(path)
    }
  }
  return found
}

const BRIDGE_CALL = /(?:callPlugin|tryCallPlugin|hasPlugin)\(\s*"([A-Za-z]+)"/gu
const PLUGIN_CONST = /const PLUGIN = "([A-Za-z]+)"/gu

const requestedNames = (): Set<string> => {
  const names = new Set<string>()
  for (const path of collect(SOURCE_ROOT)) {
    if (path === SELF || path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue
    const source = readFileSync(path, "utf8")
    for (const match of source.matchAll(BRIDGE_CALL)) names.add(match[1] ?? "")
    for (const match of source.matchAll(PLUGIN_CONST)) names.add(match[1] ?? "")
  }
  names.delete("")
  return names
}

describe("native plugin bridge contract", () => {
  it("finds the plugin names the application asks for", () => {
    expect(requestedNames().size).toBeGreaterThan(3)
  })

  it("registers every plugin the application calls through the bridge", () => {
    const registered = new Set<string>([...BRIDGED_PLUGINS, ...CORE_REGISTERED_PLUGINS])
    const unregistered = [...requestedNames()].filter((name) => !registered.has(name)).sort()

    expect(unregistered).toEqual([])
  })

  it("registers nothing the application never calls", () => {
    const requested = requestedNames()
    const unused = [...BRIDGED_PLUGINS].filter((name) => !requested.has(name)).sort()

    expect(unused).toEqual([])
  })

  it("does not re-register a plugin that @capacitor/core already owns", () => {
    const overlap = [...BRIDGED_PLUGINS].filter((name) =>
      (CORE_REGISTERED_PLUGINS as readonly string[]).includes(name),
    )

    expect(overlap).toEqual([])
  })
})
