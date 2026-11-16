import { z } from "zod"

import type { Nominee, NomineeHolder } from "../repositories/userNomineeRepository.js"

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const VISIBLE_TEXT = /^(?!\u200C|\u200D)(?:[^\p{Cf}\p{Zl}\p{Zp}]|\u200C|\u200D)*(?<!\u200C|\u200D)$/u
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const MIN_LENGTH = 2
const MAX_LENGTH = 120
const MAX_DECLINE_REASON_LENGTH = 500

const nomineeText = z
  .string()
  .trim()
  .refine((value) => Array.from(value).length >= MIN_LENGTH && Array.from(value).length <= MAX_LENGTH, {
    message: `must be ${String(MIN_LENGTH)} to ${String(MAX_LENGTH)} characters`,
  })
  .refine((value) => !CONTROL_CHARACTERS.test(value), { message: "must not contain control characters" })
  .refine((value) => VISIBLE_TEXT.test(value), {
    message: "must not contain invisible or formatting characters, or start or end with a joiner",
  })
  .refine((value) => LETTER_OR_NUMBER.test(value), { message: "must contain a letter or a number" })

export const declineReasonSchema = z
  .string()
  .trim()
  .refine((value) => Array.from(value).length >= 1 && Array.from(value).length <= MAX_DECLINE_REASON_LENGTH, {
    message: `must be 1 to ${String(MAX_DECLINE_REASON_LENGTH)} characters`,
  })
  .refine((value) => !CONTROL_CHARACTERS.test(value), { message: "must not contain control characters or line breaks" })
  .refine((value) => VISIBLE_TEXT.test(value), {
    message: "must not contain invisible or formatting characters, or start or end with a joiner",
  })
  .refine((value) => LETTER_OR_NUMBER.test(value), { message: "must contain a letter or a number" })

export const requestedNomineeFields = {
  name: nomineeText,
  relation: nomineeText,
}

export const nomineeFields = {
  name: nomineeText.nullable(),
  relation: nomineeText.nullable(),
}

type NomineeFields = Readonly<{ name: string | null; relation: string | null }>

export const requireBothOrNeither = (body: NomineeFields, context: z.RefinementCtx): void => {
  if (body.name !== null && body.relation === null) {
    context.addIssue({ code: "custom", path: ["relation"], message: "must be given together with the nominee's name" })
  }
  if (body.name === null && body.relation !== null) {
    context.addIssue({ code: "custom", path: ["name"], message: "must be given together with the relation" })
  }
}

export const nomineeOf = (body: NomineeFields): Nominee | null =>
  body.name === null || body.relation === null ? null : { name: body.name, relation: body.relation }

export const nomineeBody = (holder: NomineeHolder) => ({
  userId: holder.userId,
  nominee: holder.nominee === null ? null : { name: holder.nominee.name, relation: holder.nominee.relation },
  version: holder.version,
})
