/**
 * Ports for the email delivery worker and SNS ingress (spec 04 §6.2/§6.3).
 *
 * These are the seams between the pure delivery/provenance logic and the
 * external world. The concrete Amazon SES v2 sender and the SSRF-hardened
 * certificate fetcher are deployment adapters supplied at composition time
 * (production wiring is deferred with the running-server composition, matching
 * BE-010/BE-011); the worker, domain commands, and tests depend only on these
 * interfaces so no live AWS calls are made under the gate.
 */

/** Parameters for a single Amazon SES v2 SendEmail request. */
export interface SesSendRequest {
  /** The email delivery UUID, sent as the non-secret `boe_delivery_id` tag. */
  readonly deliveryId: string
  readonly toAddress: string
  readonly templateKey: string
  readonly templateVersion: string
  readonly configurationSet: string
  /**
   * The queued outbox payload for this delivery (SES `TemplateData`). Carries the
   * transient secret the body needs, e.g. the verification or activation token.
   */
  readonly templateData: Readonly<Record<string, unknown>>
}

/** A successful SES acceptance: the assigned MessageId and acceptance time. */
export interface SesSendAccepted {
  readonly outcome: "accepted"
  readonly sesMessageId: string
  readonly sesRequestId: string | null
}

/**
 * A send that SES (or the transport) refused. `retryable` failures re-enter the
 * backoff schedule; `permanent` failures dead-letter. `errorCode` is a stable,
 * redacted classification never containing recipient PII.
 */
export interface SesSendRejected {
  readonly outcome: "rejected"
  readonly disposition: "retryable" | "permanent"
  readonly errorCode: string
}

export type SesSendResult = SesSendAccepted | SesSendRejected

/** Sends transactional email through Amazon SES v2. */
export interface SesEmailSender {
  send: (request: SesSendRequest) => Promise<SesSendResult>
}

/** A fetched X.509 signing certificate in PEM form. */
export interface FetchedCertificate {
  readonly pem: string
}

/**
 * Fetches an Amazon SNS signing certificate. The adapter enforces the transport
 * hardening the spec requires (HTTPS/443, no redirects, bounded timeout and
 * size, and rejection of private/loopback/link-local/multicast resolved
 * addresses); this port exposes only the retrieval seam.
 */
export interface CertificateFetcher {
  fetch: (certificateUrl: string) => Promise<FetchedCertificate>
}
