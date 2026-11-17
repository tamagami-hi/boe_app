import { hasCode } from "~/api/errors"

export const isUnknownRecord = (data: unknown, error: unknown): boolean =>
  data === undefined && hasCode(error, "RESOURCE_NOT_FOUND", "VALIDATION_FAILED")
