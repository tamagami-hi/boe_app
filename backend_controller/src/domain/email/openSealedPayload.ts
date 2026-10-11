import type { CryptoContext, DeliveryPayload } from "../../crypto/context.js"
import type { OutboxEvent, Transaction } from "../../db/repositories.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import { SEALED_EMAIL_TOPIC } from "./emailTopics.js"

const PAYLOAD_MISSING_ERROR_CODE = "EMAIL_PAYLOAD_MISSING"
const PAYLOAD_KEY_MISMATCH_ERROR_CODE = "EMAIL_PAYLOAD_KEY_MISMATCH"
const PAYLOAD_UNREADABLE_ERROR_CODE = "EMAIL_PAYLOAD_UNREADABLE"

export type SealedPayloadResult =
  | { readonly kind: "opened"; readonly data: DeliveryPayload }
  | { readonly kind: "failed"; readonly errorCode: string }

export interface OpenSealedPayloadDeps {
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly crypto: CryptoContext
}

export const openSealedPayload = async (
  deps: OpenSealedPayloadDeps,
  tx: Transaction,
  event: OutboxEvent,
  deliveryId: string,
): Promise<SealedPayloadResult> => {
  if (event.topic !== SEALED_EMAIL_TOPIC) return { kind: "opened", data: {} }

  const stored = await deps.emailDeliveryRepository.findSealedPayload(tx, deliveryId)
  if (stored === null || stored.ciphertext === null || stored.nonce === null) {
    return { kind: "failed", errorCode: PAYLOAD_MISSING_ERROR_CODE }
  }

  const opened = deps.crypto.decryptDeliveryPayload(deliveryId, {
    ciphertext: stored.ciphertext,
    nonce: stored.nonce,
    keyVersion: stored.key_version,
  })
  if (opened.kind === "opened") return { kind: "opened", data: opened.payload }
  return {
    kind: "failed",
    errorCode: opened.kind === "key_version_mismatch" ? PAYLOAD_KEY_MISMATCH_ERROR_CODE : PAYLOAD_UNREADABLE_ERROR_CODE,
  }
}
