import { AppError } from "../../http/errorCatalog.js"

export const RELEASED_EMAIL_DOMAIN = "released.invalid"
export const RELEASED_PHONE_PREFIX = "+999"

export const isReservedEmail = (emailNormalized: string): boolean =>
  emailNormalized.endsWith(`@${RELEASED_EMAIL_DOMAIN}`)

export const refuseReservedEmail = (emailNormalized: string): void => {
  if (isReservedEmail(emailNormalized)) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { email: [`must not use the reserved ${RELEASED_EMAIL_DOMAIN} domain`] },
    })
  }
}
