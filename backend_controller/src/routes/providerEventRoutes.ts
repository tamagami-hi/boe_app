/**
 * Amazon SNS provider-event ingress (spec 04 §6.3).
 *
 * `POST /v1/provider-events/aws-sns` consumes the exact raw text/plain bytes
 * (256 KiB limit), retains them for digest/signature verification, then enforces
 * provenance in order: strict outer parse, header cross-check, hardened
 * SigningCertURL, topic match, certificate validity, RSA signature, and 15-minute
 * freshness. Only after provenance does it parse the inner SES event and durably
 * record it. Any provenance failure answers 401 SNS_SIGNATURE_INVALID without
 * revealing which check failed; a valid message returns an empty 200 after
 * durable insertion, and a duplicate MessageId also returns 200.
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyRequest } from "fastify"

import type { UnitOfWork } from "../db/database.js"
import type { CertificateFetcher } from "../email/ports.js"
import {
  headersMatchEnvelope,
  parseSesEvent,
  parseSnsEnvelope,
} from "../email/snsMessages.js"
import { validateSigningCertUrl, verifySnsProvenance } from "../email/snsProvenance.js"
import { AppError } from "../http/errorCatalog.js"
import type { EmailDeliveryWriteRepository } from "../repositories/emailDeliveryRepository.js"
import type { EmailProviderEventWriteRepository } from "../repositories/emailProviderEventRepository.js"
import type { EmailSuppressionWriteRepository } from "../repositories/emailSuppressionRepository.js"
import { recordProviderEvent } from "../domain/email/recordProviderEvent.js"

const SNS_RAW_BODY_LIMIT_BYTES = 262_144
const FRESHNESS_MS = 15 * 60 * 1000

export interface ProviderEventConfig {
  readonly awsRegion: string
  readonly topicArn: string
  readonly providerEventTtlMs: number
}

export interface ProviderEventDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly certificateFetcher: CertificateFetcher
  readonly config: ProviderEventConfig
  readonly emailProviderEventRepository: EmailProviderEventWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly emailSuppressionRepository: EmailSuppressionWriteRepository
}

const headerRecord = (request: FastifyRequest): Record<string, string | undefined> => {
  const flat: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(request.headers)) {
    flat[key] = Array.isArray(value) ? value[0] : value
  }
  return flat
}

const isFresh = (timestampIso: string, now: Date): boolean => {
  const timestamp = Date.parse(timestampIso)
  if (Number.isNaN(timestamp)) return false
  return Math.abs(now.getTime() - timestamp) <= FRESHNESS_MS
}

export const registerProviderEventRoutes = (application: FastifyInstance, deps: ProviderEventDeps): void => {
  application.register((instance, _options, done) => {
    instance.addContentTypeParser(
      "text/plain",
      { parseAs: "string", bodyLimit: SNS_RAW_BODY_LIMIT_BYTES },
      (_request, body, next) => {
        next(null, body)
      },
    )

    instance.post("/v1/provider-events/aws-sns", async (request, reply) => {
      const raw = request.body
      if (typeof raw !== "string") throw new AppError("UNSUPPORTED_MEDIA_TYPE")

      // Provenance is fail-closed: any failure is a uniform 401.
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new AppError("SNS_SIGNATURE_INVALID")
      }

      const envelope = parseSnsEnvelope(parsed)
      if (envelope === null) throw new AppError("SNS_SIGNATURE_INVALID")
      if (!headersMatchEnvelope(headerRecord(request), envelope)) throw new AppError("SNS_SIGNATURE_INVALID")
      if (!validateSigningCertUrl(envelope.SigningCertURL, deps.config.awsRegion)) {
        throw new AppError("SNS_SIGNATURE_INVALID")
      }

      const now = deps.clock()
      if (envelope.Type !== "UnsubscribeConfirmation" && !isFresh(envelope.Timestamp, now)) {
        throw new AppError("SNS_SIGNATURE_INVALID")
      }

      let certificatePem: string
      try {
        const certificate = await deps.certificateFetcher.fetch(envelope.SigningCertURL)
        certificatePem = certificate.pem
      } catch {
        throw new AppError("SNS_SIGNATURE_INVALID")
      }

      const verified = verifySnsProvenance({
        envelope,
        certPem: certificatePem,
        region: deps.config.awsRegion,
        expectedTopicArn: deps.config.topicArn,
        now,
      })
      if (!verified) throw new AppError("SNS_SIGNATURE_INVALID")

      // Provenance established. Parse the inner SES event (Notification only) and
      // durably record the message exactly once.
      const sesEvent = envelope.Type === "Notification" ? parseSesEvent(envelope.Message) : null
      const payloadSha256 = createHash("sha256").update(raw).digest()
      const expiresAt = new Date(now.getTime() + deps.config.providerEventTtlMs)

      await deps.unitOfWork.execute((tx) =>
        recordProviderEvent(
          tx,
          {
            emailProviderEventRepository: deps.emailProviderEventRepository,
            emailDeliveryRepository: deps.emailDeliveryRepository,
            emailSuppressionRepository: deps.emailSuppressionRepository,
          },
          { envelope, sesEvent, payloadSha256, now, expiresAt },
        ),
      )

      return reply.code(200).send()
    })

    done()
  })
}
