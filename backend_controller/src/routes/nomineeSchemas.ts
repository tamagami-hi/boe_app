import { z } from "zod"

import type { Nominee, NomineeHolder } from "../repositories/userNomineeRepository.js"

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const MIN_LENGTH = 2
const MAX_LENGTH = 120

const nomineeText = z
  .string()
  .trim()
  .refine((value) => Array.from(value).length >= MIN_LENGTH && Array.from(value).length <= MAX_LENGTH, {
    message: `must be ${String(MIN_LENGTH)} to ${String(MAX_LENGTH)} characters`,
  })
  .refine((value) => !CONTROL_CHARACTERS.test(value), { message: "must not contain control characters" })

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
  version: Number(holder.version),
})
