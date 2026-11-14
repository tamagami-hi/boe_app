export type PublishedDocument = Readonly<Record<string, unknown>>

export type LegalContact = Readonly<{ label: string; value: string; href: string | null }>

export type LegalSection = Readonly<{
  heading: string
  body: string | null
  items: readonly string[]
  note: string | null
  contacts: readonly LegalContact[]
}>

export type LegalFact = Readonly<{ label: string; value: string }>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const PHONE_PATTERN = /^\+?[0-9][0-9 -]{5,}[0-9]$/u

export const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null

const asRecord = (value: unknown): PublishedDocument | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as PublishedDocument) : null

const presentOnly = <T,>(values: readonly (T | null)[]): readonly T[] =>
  values.flatMap((value) => (value === null ? [] : [value]))

const asRecords = (value: unknown): readonly PublishedDocument[] =>
  Array.isArray(value) ? presentOnly(value.map(asRecord)) : []

const asStrings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? presentOnly(value.map(asString)) : []

const firstString = (record: PublishedDocument, keys: readonly string[]): string | null =>
  keys.map((key) => asString(record[key])).find((value) => value !== null) ?? null

const emailContact = (label: string, value: string | null): readonly LegalContact[] =>
  value === null ? [] : [{ label, value, href: EMAIL_PATTERN.test(value) ? `mailto:${value}` : null }]

const phoneContact = (label: string, value: string | null): readonly LegalContact[] =>
  value === null ? [] : [{ label, value, href: PHONE_PATTERN.test(value) ? `tel:${value.replace(/[ -]/gu, "")}` : null }]

const textContact = (label: string, value: string | null): readonly LegalContact[] =>
  value === null ? [] : [{ label, value, href: null }]

const hrefOf = (record: PublishedDocument, value: string): string | null => {
  const explicit = firstString(record, ["url", "href"])
  if (explicit !== null) return explicit
  if (asString(record.email) === value && EMAIL_PATTERN.test(value)) return `mailto:${value}`
  if (asString(record.phone) === value && PHONE_PATTERN.test(value)) return `tel:${value.replace(/[ -]/gu, "")}`
  return null
}

const listedContacts = (document: PublishedDocument): readonly LegalContact[] =>
  asRecords(document.contacts).flatMap((record) => {
    const label = firstString(record, ["label", "name"])
    const value = firstString(record, ["value", "email", "phone", "url"])
    if (label === null || value === null) return []
    return [{ label, value, href: hrefOf(record, value) }]
  })

const contactBlock = (document: PublishedDocument): readonly LegalContact[] => {
  const record = asRecord(document.contact)
  if (record === null) return []
  return [
    ...textContact("Name", firstString(record, ["officerName", "name"])),
    ...emailContact("Email", asString(record.email)),
    ...phoneContact("Phone", asString(record.phone)),
    ...textContact("Hours", asString(record.hours)),
    ...textContact("Address", asString(record.address)),
  ]
}

export const readContacts = (document: PublishedDocument): readonly LegalContact[] => [
  ...listedContacts(document),
  ...contactBlock(document),
]

export const readBody = (document: PublishedDocument): string | null =>
  firstString(document, ["body", "summary", "description"])

const readSection = (record: PublishedDocument): readonly LegalSection[] => {
  const heading = firstString(record, ["heading", "title", "stage"])
  const body = firstString(record, ["body", "text", "detail", "description"])
  const items = asStrings(record.items)
  if (heading === null || (body === null && items.length === 0)) return []
  return [
    {
      heading,
      body,
      items,
      note: asString(record.timeline),
      contacts: [
        ...emailContact("Email", asString(record.contactEmail)),
        ...phoneContact("Phone", asString(record.contactPhone)),
      ],
    },
  ]
}

export const readSections = (document: PublishedDocument, key: "sections" | "steps"): readonly LegalSection[] =>
  asRecords(document[key]).flatMap(readSection)

export const readFacts = (document: PublishedDocument, key: string): readonly LegalFact[] =>
  asRecords(document[key]).flatMap((record) => {
    const label = asString(record.label)
    const value = asString(record.value)
    return label === null || value === null ? [] : [{ label, value }]
  })
