import { decryptGcm, encryptGcm } from "../../crypto/primitives.js"
import type { EncryptedEnvelope } from "../../crypto/primitives.js"

export interface MandateSetupTokenIdentity {
  readonly mandateId: string
  readonly setupAttemptId: string
  readonly merchantSubscriptionId: string
  readonly merchantOrderId: string
  readonly providerOrderId: string
}

export const mandateSetupTokenAad = (identity: MandateSetupTokenIdentity): Buffer =>
  Buffer.from(
    [
      "phonepe",
      "mandate_setup_sdk_token",
      identity.mandateId,
      identity.setupAttemptId,
      identity.merchantSubscriptionId,
      identity.merchantOrderId,
      identity.providerOrderId,
    ].join("\u0000"),
    "utf8",
  )

export const encryptMandateSetupToken = (
  key: Buffer,
  token: string,
  identity: MandateSetupTokenIdentity,
): EncryptedEnvelope => encryptGcm(key, token, mandateSetupTokenAad(identity))

export const decryptMandateSetupToken = (
  key: Buffer,
  envelope: EncryptedEnvelope,
  identity: MandateSetupTokenIdentity,
): string => decryptGcm(key, envelope.ciphertext, envelope.nonce, mandateSetupTokenAad(identity))
