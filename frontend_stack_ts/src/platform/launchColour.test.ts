import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { DEFAULT_BAR_BACKGROUND } from "~/platform/systemChrome"

const INDEX_HTML = "index.html"
const COLORS_XML = join("android", "app", "src", "main", "res", "values", "colors.xml")
const TOKENS_CORE = join("src", "ui", "tokens", "tokens-core.css")
const TOKENS_ELEVATION = join("src", "ui", "tokens", "tokens-elevation.css")

const read = (path: string): string => readFileSync(path, "utf8")

describe("launch colour contract", () => {
  const expected = DEFAULT_BAR_BACKGROUND.toLowerCase()

  it("resolves --be-bg to the same colour the native bars are painted", () => {
    const core = read(TOKENS_CORE)
    const bg = /--be-bg:\s*var\((--be-[a-z0-9-]+)\)/u.exec(core)
    expect(bg, "--be-bg must alias a palette token").not.toBeNull()

    const alias = bg?.[1] ?? ""
    const palette = `${core}\n${read(TOKENS_ELEVATION)}`
    const literal = new RegExp(`${alias}:\\s*(#[0-9a-fA-F]{6})`, "u").exec(palette)
    expect(literal, `${alias} must resolve to a hex literal`).not.toBeNull()
    expect((literal?.[1] ?? "").toLowerCase()).toBe(expected)
  })

  it("uses the same colour for the document inline launch background", () => {
    const html = read(INDEX_HTML)
    const inline = /background:\s*(#[0-9a-fA-F]{6})/u.exec(html)
    expect(inline).not.toBeNull()
    expect((inline?.[1] ?? "").toLowerCase()).toBe(expected)
  })

  it("uses the same colour for the document theme-color", () => {
    const html = read(INDEX_HTML)
    const theme = /name="theme-color"\s+content="(#[0-9a-fA-F]{6})"/u.exec(html)
    expect(theme).not.toBeNull()
    expect((theme?.[1] ?? "").toLowerCase()).toBe(expected)
  })

  it("uses the same colour for the Android window and splash background", () => {
    const xml = read(COLORS_XML)
    const launch = /<color name="launchBackground">(#[0-9a-fA-F]{6})<\/color>/u.exec(xml)
    expect(launch).not.toBeNull()
    expect((launch?.[1] ?? "").toLowerCase()).toBe(expected)
  })

  it("never paints the app background with a raw literal outside the token layer", () => {
    const base = read(join("src", "ui", "styles", "base.css"))
    expect(base).toContain("background: var(--be-bg)")
    expect(/background:\s*#[0-9a-fA-F]{3,8}/u.test(base)).toBe(false)
  })
})
