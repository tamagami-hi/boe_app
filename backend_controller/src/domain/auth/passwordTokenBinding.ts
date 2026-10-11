import type { User } from "../../db/repositories.js"
import type { PasswordTokenPurpose } from "../../db/types.js"
import type { LockedCredential } from "../../repositories/credentialRepository.js"
import type { PasswordCredentialToken, PasswordTokenBinding } from "../../repositories/passwordTokenRepository.js"

export const NO_CREDENTIAL_VERSION = "0"

export type PasswordTokenRejection =
  | "unbound"
  | "inactive_account"
  | "stale_email"
  | "stale_credential"
  | "credential_present"

export const credentialVersionOf = (credential: LockedCredential | null): string =>
  credential === null ? NO_CREDENTIAL_VERSION : credential.version

export const derivePasswordTokenPurpose = (credential: LockedCredential | null): PasswordTokenPurpose =>
  credential?.hasPassword === true ? "reset" : "set"

export const bindingFor = (
  user: Pick<User, "email_revision">,
  credential: LockedCredential | null,
): PasswordTokenBinding => ({
  emailRevision: user.email_revision,
  credentialVersion: credentialVersionOf(credential),
})

export const assessPasswordTokenBinding = (
  input: Readonly<{
    token: Pick<PasswordCredentialToken, "purpose" | "binding">
    user: Pick<User, "account_state" | "email_revision">
    credential: LockedCredential | null
  }>,
): PasswordTokenRejection | null => {
  const { token, user, credential } = input
  if (token.binding === null) return "unbound"
  if (user.account_state !== "active") return "inactive_account"
  if (token.binding.emailRevision !== user.email_revision) return "stale_email"
  if (token.binding.credentialVersion !== credentialVersionOf(credential)) return "stale_credential"
  if (token.purpose === "set" && credential?.hasPassword === true) return "credential_present"
  return null
}
