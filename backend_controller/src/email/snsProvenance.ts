/**
 * Amazon SNS message provenance (spec 04 §6.3). Pure validation and signature
 * verification over `node:crypto`; certificate *fetching* (with its SSRF
 * hardening) lives behind the CertificateFetcher port.
 *
 * Provenance requires, in order: a SigningCertURL that is HTTPS on port 443 with
 * no credentials/query/fragment and the exact regional SNS host and certificate
 * path; a currently-valid certificate; and an RSA signature over the AWS
 * canonical string using SHA-1 (SignatureVersion "1") or SHA-256 ("2").
 */
import { createVerify, X509Certificate } from "node:crypto"
import type { KeyObject } from "node:crypto"

import type { SnsEnvelope } from "./snsMessages.js"

/**
 * Validate a SigningCertURL/SubscribeURL against the configured region. Rejects
 * non-HTTPS, non-443 ports, embedded credentials, any query/fragment, hosts
 * other than `sns.<region>.amazonaws.com`, and paths outside the AWS SNS
 * certificate namespace.
 */
export const validateSigningCertUrl = (rawUrl: string, region: string): boolean => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  if (url.username !== "" || url.password !== "") return false
  if (url.search !== "" || url.hash !== "") return false
  if (url.port !== "" && url.port !== "443") return false
  if (url.hostname !== `sns.${region}.amazonaws.com`) return false
  if (!url.pathname.startsWith("/SimpleNotificationService-")) return false
  if (!url.pathname.endsWith(".pem")) return false
  return true
}

// AWS signs a newline-delimited "key\nvalue\n" string over a fixed, ordered
// subset of fields per outer message type; optional fields are included only
// when present.
const canonicalKeys = (envelope: SnsEnvelope): readonly (readonly [string, string | undefined])[] => {
  if (envelope.Type === "Notification") {
    return [
      ["Message", envelope.Message],
      ["MessageId", envelope.MessageId],
      ["Subject", envelope.Subject],
      ["Timestamp", envelope.Timestamp],
      ["TopicArn", envelope.TopicArn],
      ["Type", envelope.Type],
    ]
  }
  return [
    ["Message", envelope.Message],
    ["MessageId", envelope.MessageId],
    ["SubscribeURL", envelope.SubscribeURL],
    ["Timestamp", envelope.Timestamp],
    ["Token", envelope.Token],
    ["TopicArn", envelope.TopicArn],
    ["Type", envelope.Type],
  ]
}

/** Build the AWS canonical signing string for an SNS envelope. */
export const buildCanonicalMessage = (envelope: SnsEnvelope): string => {
  let canonical = ""
  for (const [key, value] of canonicalKeys(envelope)) {
    if (value === undefined) continue
    canonical += `${key}\n${value}\n`
  }
  return canonical
}

/**
 * Extract the public key from a PEM certificate, rejecting a certificate that is
 * not currently valid at `now`.
 */
export const certificatePublicKey = (certPem: string, now: Date): KeyObject => {
  const certificate = new X509Certificate(certPem)
  const validFrom = new Date(certificate.validFrom)
  const validTo = new Date(certificate.validTo)
  if (now < validFrom || now > validTo) {
    throw new Error("signing certificate is not currently valid")
  }
  return certificate.publicKey
}

/** Verify the RSA signature over the canonical string with the chosen hash. */
export const verifyEnvelopeSignature = (envelope: SnsEnvelope, publicKey: KeyObject): boolean => {
  const algorithm = envelope.SignatureVersion === "1" ? "RSA-SHA1" : "RSA-SHA256"
  const canonical = buildCanonicalMessage(envelope)
  const verifier = createVerify(algorithm)
  verifier.update(canonical, "utf8")
  verifier.end()
  try {
    return verifier.verify(publicKey, envelope.Signature, "base64")
  } catch {
    return false
  }
}

export interface ProvenanceInput {
  readonly envelope: SnsEnvelope
  readonly certPem: string
  readonly region: string
  readonly expectedTopicArn: string
  readonly now: Date
}

/**
 * Full provenance decision: topic match, cert-URL hardening, certificate
 * validity, and signature verification. Any failure returns false so the route
 * answers 401 SNS_SIGNATURE_INVALID without leaking which check failed.
 */
export const verifySnsProvenance = (input: ProvenanceInput): boolean => {
  if (input.envelope.TopicArn !== input.expectedTopicArn) return false
  if (!validateSigningCertUrl(input.envelope.SigningCertURL, input.region)) return false
  let publicKey: KeyObject
  try {
    publicKey = certificatePublicKey(input.certPem, input.now)
  } catch {
    return false
  }
  return verifyEnvelopeSignature(input.envelope, publicKey)
}
