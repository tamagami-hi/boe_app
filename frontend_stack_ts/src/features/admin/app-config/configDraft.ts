import { AdminAppConfigPayload } from "@beonedge/contracts"
import type { z } from "zod"

export type JsonRecord = Readonly<Record<string, unknown>>

export const SECTION_KEYS = ["featureFlags", "minimumSupportedVersion", "downloads", "maintenance", "presentation"] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const PLATFORMS = ["android", "ios", "web"] as const
export type Platform = (typeof PLATFORMS)[number]

export const DOWNLOAD_KEYS = ["androidUrl", "iosUrl"] as const
export type DownloadKey = (typeof DOWNLOAD_KEYS)[number]

export const KEY_MAX = 80
export const UPDATE_MESSAGE_MAX = 500
export const MAINTENANCE_MESSAGE_MAX = 8_000
export const PRESENTATION_TEXT_MAX = 500
export const URL_MAX = 2_048

export const EMPTY_CONFIG: JsonRecord = {
  featureFlags: {},
  minimumSupportedVersion: {},
  downloads: {},
  maintenance: { enabled: false },
  presentation: {},
}

const VERSION_FORM = /^[0-9]+\.[0-9]+\.[0-9]+$/u
const LEADING_VERSION = /^[0-9]+(?:\.[0-9]+)*/u
const INDIA_OFFSET_MS = 330 * 60_000
const LOCAL_INPUT_FORM = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2})?$/u

export type DraftEditorProps = Readonly<{
  draft: JsonRecord
  disabled: boolean
  onChange: (next: JsonRecord) => void
}>

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const sectionOf = (draft: JsonRecord, section: SectionKey): JsonRecord => {
  const value = draft[section]
  return isRecord(value) ? value : {}
}

export const textOf = (record: JsonRecord, key: string): string => {
  const value = record[key]
  return typeof value === "string" ? value : ""
}

const withoutKey = (record: JsonRecord, key: string): JsonRecord =>
  Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key))

export const withEntry = (draft: JsonRecord, section: SectionKey, key: string, value: unknown): JsonRecord => {
  const current = sectionOf(draft, section)
  const next = value === undefined ? withoutKey(current, key) : { ...current, [key]: value }
  return { ...draft, [section]: next }
}

export const withText = (draft: JsonRecord, section: SectionKey, key: string, text: string): JsonRecord =>
  withEntry(draft, section, key, text === "" ? undefined : text)

export const serialise = (draft: JsonRecord): string => JSON.stringify(draft, null, 2)

export const parseDraft = (text: string): JsonRecord | null => {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

export const draftOf = (published: JsonRecord | null): JsonRecord => published ?? EMPTY_CONFIG

export const baseVersion = (value: string): string => LEADING_VERSION.exec(value)?.[0] ?? value

export const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10))
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export const isVersionForm = (value: string): boolean => VERSION_FORM.test(value)

export type VersionAbove = Readonly<{ platform: Platform; value: string }>

export const versionsAboveRelease = (draft: JsonRecord, release: string): readonly VersionAbove[] => {
  const minimums = sectionOf(draft, "minimumSupportedVersion")
  const current = baseVersion(release)
  return PLATFORMS.flatMap((platform) => {
    const value = textOf(minimums, platform).trim()
    return isVersionForm(value) && compareVersions(value, current) > 0 ? [{ platform, value }] : []
  })
}

export const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

export const indiaInputOf = (iso: string): string => {
  const moment = Date.parse(iso)
  return Number.isNaN(moment) ? "" : new Date(moment + INDIA_OFFSET_MS).toISOString().slice(0, 16)
}

export const isoFromIndiaInput = (local: string): string | undefined =>
  LOCAL_INPUT_FORM.test(local) ? `${local.length === 16 ? `${local}:00` : local}+05:30` : undefined

export type FieldProblems = Readonly<Record<string, string>>

const versionProblems = (draft: JsonRecord): [string, string][] => {
  const minimums = sectionOf(draft, "minimumSupportedVersion")
  return PLATFORMS.flatMap((platform): [string, string][] => {
    const value = textOf(minimums, platform).trim()
    return value === "" || isVersionForm(value) ? [] : [[`minimumSupportedVersion.${platform}`, "Use three numbers, such as 0.18.3."]]
  })
}

const downloadProblems = (draft: JsonRecord): [string, string][] => {
  const downloads = sectionOf(draft, "downloads")
  return DOWNLOAD_KEYS.flatMap((key): [string, string][] => {
    const value = textOf(downloads, key).trim()
    return value === "" || isHttpsUrl(value) ? [] : [[`downloads.${key}`, "Use a full address that starts with https://."]]
  })
}

export const fieldProblems = (draft: JsonRecord): FieldProblems =>
  Object.fromEntries([...versionProblems(draft), ...downloadProblems(draft)])

export type ConfigPayload = z.input<typeof AdminAppConfigPayload>

export type ContractCheck =
  | Readonly<{ kind: "valid"; payload: ConfigPayload }>
  | Readonly<{ kind: "refused"; problems: readonly string[] }>

export const checkContract = (draft: JsonRecord): ContractCheck => {
  const parsed = AdminAppConfigPayload.safeParse(draft)
  if (parsed.success) return { kind: "valid", payload: draft }
  return {
    kind: "refused",
    problems: parsed.error.issues.map((issue) => {
      const path = issue.path.map(String).join(".")
      return path === "" ? issue.message : `${path}: ${issue.message}`
    }),
  }
}

export type ConfigChange = Readonly<{
  path: string
  kind: "added" | "removed" | "changed"
  before: unknown
  after: unknown
}>

const flatten = (record: JsonRecord, prefix: string): [string, unknown][] =>
  Object.entries(record).flatMap(([key, value]): [string, unknown][] => {
    const path = prefix === "" ? key : `${prefix}.${key}`
    return isRecord(value) ? flatten(value, path) : [[path, value]]
  })

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

export const diffConfig = (published: JsonRecord | null, draft: JsonRecord): readonly ConfigChange[] => {
  const before = new Map(flatten(published ?? {}, ""))
  const after = new Map(flatten(draft, ""))
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort()
  return paths.flatMap((path): ConfigChange[] => {
    const was = before.get(path)
    const now = after.get(path)
    if (!before.has(path)) return [{ path, kind: "added", before: undefined, after: now }]
    if (!after.has(path)) return [{ path, kind: "removed", before: was, after: undefined }]
    return sameValue(was, now) ? [] : [{ path, kind: "changed", before: was, after: now }]
  })
}
