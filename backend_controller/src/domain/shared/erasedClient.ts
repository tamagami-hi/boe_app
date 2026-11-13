import { AppError } from "../../http/errorCatalog.js"

export const ERASED_CLIENT_MESSAGE = "This client was erased, so nothing more can be recorded for them."

export const refuseErasedClient = (piiTombstonedAt: Date | string | null): void => {
  if (piiTombstonedAt !== null) throw new AppError("STATE_CONFLICT", { message: ERASED_CLIENT_MESSAGE })
}
