import { z } from "zod"

export const MAX_REVIEW_COMMENT_LENGTH = 1_000
export const MAX_REVIEW_NOTE_LENGTH = 1_000

const REVIEW_TEXT_PATTERN = /^(?![\u200c\u200d])(?:[^\p{Cc}\p{Cf}\p{Cs}\u2028\u2029\u034f\u115f\u1160\u2800\u3164\uffa0]|[\n\u200c\u200d])*(?<![\u200c\u200d])$/u
const VISIBLE_CHARACTER_PATTERN = /[\p{L}\p{N}\p{P}\p{S}]/u

export const reviewTextSchema = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => REVIEW_TEXT_PATTERN.test(value), "must not contain control or invisible formatting characters")
    .refine((value) => VISIBLE_CHARACTER_PATTERN.test(value), "must contain a letter, number, punctuation mark or symbol")

export const reviewRatingSchema = z.number().int().min(1).max(5)
