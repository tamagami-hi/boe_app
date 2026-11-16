import { isApiError } from "~/api/errors"

export type NomineeField = "name" | "relation"

export type NomineeDraft = Readonly<Record<NomineeField, string>>

export type NomineeProblems = Readonly<Partial<Record<NomineeField, string>>>

export type NomineeInput = Readonly<{ name: string; relation: string }> | Readonly<{ name: null; relation: null }>

export type RequestedNominee = Readonly<{ name: string; relation: string }>

export const NOMINEE_MAX_LENGTH = 120

export const DECLINE_REASON_MAX_LENGTH = 500

const FIELDS: readonly NomineeField[] = ["name", "relation"]
const MIN_LENGTH = 2
const CONTROL_CHARACTERS = /\p{Cc}/u
const INVISIBLE_CHARACTERS = /(?!\u200C|\u200D)[\p{Cf}\p{Zl}\p{Zp}]/u
const EDGE_JOINER = /^(?:\u200C|\u200D)|(?:\u200C|\u200D)$/u
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u

const lengthCopy = (min: number, max: number): string => `Use between ${String(min)} and ${String(max)} characters.`

const CONTROL_COPY = "Remove tabs, line breaks and other control characters."

const INVISIBLE_COPY = "Remove invisible characters, such as zero-width spaces or direction marks."

const EDGE_JOINER_COPY = "A joining character cannot be the first or last character."

const LETTER_COPY = "Include at least one letter or number."

const PAIR_COPY: Readonly<Record<NomineeField, string>> = {
  name: "Enter the nominee's name too, or clear both fields.",
  relation: "Enter the relation too, or clear both fields.",
}

const REFUSED_COPY: Readonly<Record<NomineeField, string>> = {
  name: "Check the name: 2 to 120 characters with a letter, no hidden characters, entered with a relation.",
  relation: "Check the relation: 2 to 120 characters with a letter, no hidden characters, entered with a name.",
}

const trimmed = (draft: NomineeDraft): NomineeDraft => ({ name: draft.name.trim(), relation: draft.relation.trim() })

const textProblem = (value: string, min = MIN_LENGTH, max = NOMINEE_MAX_LENGTH): string | null => {
  const length = Array.from(value).length
  if (length < min || length > max) return lengthCopy(min, max)
  if (CONTROL_CHARACTERS.test(value)) return CONTROL_COPY
  if (INVISIBLE_CHARACTERS.test(value)) return INVISIBLE_COPY
  if (EDGE_JOINER.test(value)) return EDGE_JOINER_COPY
  return LETTER_OR_NUMBER.test(value) ? null : LETTER_COPY
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

export const requestedNomineeOf = (draft: NomineeDraft): RequestedNominee | null => {
  const { name, relation } = trimmed(draft)
  return name === "" || relation === "" ? null : { name, relation }
}

export const declineReasonProblem = (value: string): string | null => {
  const trimmedValue = value.trim()
  return trimmedValue === "" ? null : textProblem(trimmedValue, 1, DECLINE_REASON_MAX_LENGTH)
}
