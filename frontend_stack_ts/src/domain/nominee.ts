import { isApiError } from "~/api/errors"

export type NomineeField = "name" | "relation"

export type NomineeDraft = Readonly<Record<NomineeField, string>>

export type NomineeProblems = Readonly<Partial<Record<NomineeField, string>>>

export type NomineeInput = Readonly<{ name: string; relation: string }> | Readonly<{ name: null; relation: null }>

export const NOMINEE_MAX_LENGTH = 120

const FIELDS: readonly NomineeField[] = ["name", "relation"]
const MIN_LENGTH = 2
const CONTROL_CHARACTERS = /\p{Cc}/u

const LENGTH_COPY = `Use between ${String(MIN_LENGTH)} and ${String(NOMINEE_MAX_LENGTH)} characters.`

const CONTROL_COPY = "Remove tabs, line breaks and other control characters."

const PAIR_COPY: Readonly<Record<NomineeField, string>> = {
  name: "Enter the nominee's name too, or clear both fields.",
  relation: "Enter the relation too, or clear both fields.",
}

const REFUSED_COPY: Readonly<Record<NomineeField, string>> = {
  name: "Check the name: 2 to 120 characters, no tabs or line breaks, entered with a relation.",
  relation: "Check the relation: 2 to 120 characters, no tabs or line breaks, entered with a name.",
}

const trimmed = (draft: NomineeDraft): NomineeDraft => ({ name: draft.name.trim(), relation: draft.relation.trim() })

const textProblem = (value: string): string | null => {
  const length = Array.from(value).length
  if (length < MIN_LENGTH || length > NOMINEE_MAX_LENGTH) return LENGTH_COPY
  return CONTROL_CHARACTERS.test(value) ? CONTROL_COPY : null
}

export const nomineeInput = (draft: NomineeDraft): NomineeInput | null => {
  const { name, relation } = trimmed(draft)
  if (name === "" && relation === "") return { name: null, relation: null }
  if (name === "" || relation === "") return null
  return { name, relation }
}

export const nomineeProblems = (draft: NomineeDraft): NomineeProblems => {
  const values = trimmed(draft)
  const problemOf = (field: NomineeField): string | null => {
    const own = values[field]
    if (own !== "") return textProblem(own)
    const other = field === "name" ? values.relation : values.name
    return other === "" ? null : PAIR_COPY[field]
  }
  return Object.fromEntries(
    FIELDS.flatMap((field) => {
      const problem = problemOf(field)
      return problem === null ? [] : [[field, problem]]
    }),
  )
}

export const nomineeRefusals = (error: unknown): NomineeProblems => {
  if (!isApiError(error) || error.fields === null) return {}
  const fields = error.fields
  return Object.fromEntries(
    FIELDS.filter((field) => Object.hasOwn(fields, field)).map((field) => [field, REFUSED_COPY[field]]),
  )
}

export const sameNominee = (
  input: NomineeInput,
  current: Readonly<{ name: string; relation: string }> | null,
): boolean =>
  current === null
    ? input.name === null
    : input.name === current.name && input.relation === current.relation
