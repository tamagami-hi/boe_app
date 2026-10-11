export const TEMPLATE_PLACEHOLDERS = ["first_name", "full_name"] as const
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number]
export type PlaceholderValues = Readonly<Record<TemplatePlaceholder, string>>

const SUBJECT_MAX = 150
const BODY_MAX = 5_000
const SLUG_MAX = 80
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/gu
const LINE_BREAK = /[\r\n]/u

const isPlaceholder = (name: string): name is TemplatePlaceholder =>
  (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name)

const placeholderProblems = (text: string): readonly string[] => {
  const problems: string[] = []
  for (const match of text.matchAll(TOKEN)) {
    const name = match[1] ?? ""
    if (!isPlaceholder(name)) {
      problems.push(`uses an unknown placeholder {{${name}}}; only ${TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" and ")} are allowed`)
    }
  }
  const leftover = text.replace(TOKEN, "")
  if (leftover.includes("{{") || leftover.includes("}}")) {
    problems.push("has unmatched {{ or }}; write placeholders as {{first_name}}")
  }
  return problems
}

export const templateContentProblems = (
  subject: string,
  body: string,
): Readonly<Partial<Record<"subject" | "body", readonly string[]>>> => {
  const subjectProblems: string[] = []
  if (subject.trim() === "") subjectProblems.push("is required")
  if (subject.length > SUBJECT_MAX) subjectProblems.push(`must be at most ${String(SUBJECT_MAX)} characters`)
  if (LINE_BREAK.test(subject)) subjectProblems.push("must be a single line")
  subjectProblems.push(...placeholderProblems(subject))

  const bodyProblems: string[] = []
  if (body.trim() === "") bodyProblems.push("is required")
  if (body.length > BODY_MAX) bodyProblems.push(`must be at most ${String(BODY_MAX)} characters`)
  bodyProblems.push(...placeholderProblems(body))

  return {
    ...(subjectProblems.length === 0 ? {} : { subject: subjectProblems }),
    ...(bodyProblems.length === 0 ? {} : { body: bodyProblems }),
  }
}

export const fillPlaceholders = (text: string, values: PlaceholderValues): string =>
  text.replace(TOKEN, (whole: string, name: string) => (isPlaceholder(name) ? values[name] : whole))

export const placeholderValuesFor = (fullName: string): PlaceholderValues => {
  const trimmed = fullName.trim()
  const first = trimmed.split(/\s+/u)[0] ?? ""
  return { first_name: first === "" ? "there" : first, full_name: trimmed === "" ? "there" : trimmed }
}

export const slugFromName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/u, "")
  return slug === "" ? "template" : slug
}
