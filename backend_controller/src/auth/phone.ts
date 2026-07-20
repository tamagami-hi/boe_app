/**
 * Phone masking for output (spec 04 §3.3 `phoneMasked`): `+` country calling
 * code, exactly six mask characters, then the final four digits.
 */
import { parsePhoneNumberWithError } from "libphonenumber-js"

export const maskPhone = (e164: string): string => {
  const parsed = parsePhoneNumberWithError(e164)
  const national = parsed.nationalNumber
  return `+${parsed.countryCallingCode}******${national.slice(-4)}`
}
