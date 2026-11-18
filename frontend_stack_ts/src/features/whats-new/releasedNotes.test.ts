import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"
import { z } from "zod"

import { ADMIN_NOTES } from "./adminNotes"
import { CLIENT_NOTES } from "./clientNotes"
import { unseenEntries, type WhatsNewEntry, type WhatsNewNotes } from "./whatsNewEntry"

const VERSION_FILE = join("..", "VERSION")
const FROZEN_FILE = join("src", "features", "whats-new", "releasedNotes.json")
const RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

const FrozenRow = z.strictObject({ id: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/u) })
const FrozenNotes = z.strictObject({ client: z.array(FrozenRow), admin: z.array(FrozenRow) })

type Release = readonly [number, number, number]

const parseRelease = (text: string): Release => {
  const match = RELEASE_PATTERN.exec(text)
  if (match === null) throw new Error(`"${text}" is not a release version`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const compareReleases = (left: Release, right: Release): number =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2]

const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const canonical = (value: unknown): string => {
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonical(item)).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>
    const keys = Object.keys(record).sort(byCodeUnit)
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`
  }
  throw new Error(`a note holds a ${typeof value}, which this check cannot freeze`)
}

const digest = (entry: WhatsNewEntry): string => createHash("sha256").update(canonical(entry)).digest("hex")

const currentRelease = (): Release => parseRelease(readFileSync(VERSION_FILE, "utf8").trim())

const frozenNotes = (): z.infer<typeof FrozenNotes> =>
  FrozenNotes.parse(JSON.parse(readFileSync(FROZEN_FILE, "utf8")))

const AUDIENCES: readonly (readonly ["client" | "admin", WhatsNewNotes])[] = [
  ["client", CLIENT_NOTES],
  ["admin", ADMIN_NOTES],
]

describe.each(AUDIENCES)("released %s notes", (audience, notes) => {
  it("list one entry per release, newest first", () => {
    const misordered = notes.flatMap((entry, index) => {
      const older = notes[index + 1]
      if (older === undefined) return []
      return compareReleases(parseRelease(entry.id), parseRelease(older.id)) > 0
        ? []
        : [`${entry.id} sits above ${older.id}`]
    })

    expect(misordered).toEqual([])
  })

  it("keep every frozen entry exactly as it was released", () => {
    const changed = frozenNotes()[audience].flatMap((row) => {
      const entry = notes.find((candidate) => candidate.id === row.id)
      if (entry === undefined) return [`${row.id} was removed`]
      return digest(entry) === row.sha256 ? [] : [`${row.id} was edited after release`]
    })

    expect(changed).toEqual([])
  })

  it("freeze every entry up to the release in VERSION", () => {
    const current = currentRelease()
    const frozenIds = new Set(frozenNotes()[audience].map((row) => row.id))
    const unfrozen = notes
      .filter((entry) => compareReleases(parseRelease(entry.id), current) <= 0 && !frozenIds.has(entry.id))
      .map((entry) => ({ id: entry.id, sha256: digest(entry) }))

    expect(unfrozen).toEqual([])
  })
})

const idsOf = (entries: WhatsNewNotes | null): readonly string[] | null =>
  entries === null ? null : entries.map((entry) => entry.id)

describe.each([
  ["client", CLIENT_NOTES, ["0.18.4", "0.18.3", "0.18.1", "0.18.0", "0.17.0", "0.16.2", "0.16.0"]],
  ["admin", ADMIN_NOTES, ["0.18.4", "0.18.3", "0.18.1", "0.18.0", "0.17.0", "0.16.0"]],
] as const)("the shipped %s notes under DEC-73", (_audience, notes, everyRelease) => {
  it("show a dev tester who last saw 0.18.3 only 0.18.4", () => {
    expect(idsOf(unseenEntries(notes, "0.18.3"))).toEqual(["0.18.4"])
  })

  it("show a production upgrader with no record every release since 0.15.4", () => {
    expect(idsOf(unseenEntries(notes, null))).toEqual(everyRelease)
  })
})
