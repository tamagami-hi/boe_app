import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction } from "../../db/repositories.js"
import type {
  ClientErasureInspectRepository,
  ContactSources,
  ErasureBlockerCounts,
  ErasureReach,
  ErasureSubject,
} from "../../repositories/clientErasureInspectRepository.js"
import type { MandatesRepository } from "../../repositories/mandatesRepository.js"
import { createContactScrubber, realEmails, realPhones, type ContactScrubber } from "./erasureContacts.js"

export interface ErasureReachDeps {
  readonly erasureInspectRepository: ClientErasureInspectRepository
  readonly mandateLookup: Pick<MandatesRepository, "findMandateForAdmin">
  readonly crypto: CryptoContext
}

export interface ClientReach extends ErasureReach {
  readonly scrubber: ContactScrubber
  readonly matchedApplicationIds: readonly string[]
}

const MANDATE_HOLD = "mandate"

const openedRecipients = (crypto: CryptoContext, sources: ContactSources): string[] =>
  sources.sealedRecipients.flatMap((sealed) => {
    if (sealed.keyVersion !== crypto.recipientEncryptionKeyVersion) return []
    try {
      return [crypto.decryptRecipient(sealed.ciphertext, sealed.nonce)]
    } catch {
      return []
    }
  })

export const reachOf = async (tx: Transaction, deps: ErasureReachDeps, subject: ErasureSubject): Promise<ClientReach> => {
  const repository = deps.erasureInspectRepository
  const sources = await repository.collectContactSources(tx, subject)
  const emails = realEmails([...sources.emails, ...openedRecipients(deps.crypto, sources)])
  const phones = realPhones(sources.phones)
  const held = await repository.findHeldContacts(tx, subject.id, { emails, phones })
  const scrubber = createContactScrubber(
    {
      emails: emails.filter((email) => !held.emails.includes(email)),
      phones: phones.filter((phone) => !held.phones.includes(phone)),
      names: sources.names,
    },
    subject.id,
  )
  const matchedApplicationIds = await repository.findMatchedApplications(tx, subject, scrubber.emails)
  const applicationIds = [...(subject.applicationId === null ? [] : [subject.applicationId]), ...matchedApplicationIds]
  const owned = await repository.listOwnedEntities(tx, subject, applicationIds)
  return { scrubber, matchedApplicationIds, applicationIds, owned }
}

const mandateHolds = async (tx: Transaction, deps: ErasureReachDeps, userId: string): Promise<number> => {
  let held = 0
  for (const mandateId of await deps.erasureInspectRepository.listActiveHoldEntityIds(tx, MANDATE_HOLD)) {
    const mandate = await deps.mandateLookup.findMandateForAdmin(tx, mandateId)
    if (mandate?.user_id === userId) held += 1
  }
  return held
}

export const blockerCountsOf = async (
  tx: Transaction,
  deps: ErasureReachDeps,
  subject: ErasureSubject,
  reach: ClientReach,
): Promise<ErasureBlockerCounts> => {
  const counts = await deps.erasureInspectRepository.countBlockers(tx, subject, reach)
  return { ...counts, legal_hold: counts.legal_hold + (await mandateHolds(tx, deps, subject.id)) }
}
