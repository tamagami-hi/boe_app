/**
 * Strict Amazon SNS envelope and inner SES event schemas (spec 04 §6.3).
 *
 * The outer envelope is a discriminated union on `Type` and carries the exact
 * fields AWS signs. Parsing is done only after the raw bytes are retained for
 * signature/digest verification. The inner SES configuration-set event is parsed
 * only after signature validation succeeds. Classification maps an event to the
 * monotonic evidence transition and optional suppression it implies.
 */
import { z } from "zod"

const SnsSignedBase = {
  MessageId: z.string().min(1).max(256),
  TopicArn: z.string().min(1).max(2048),
  Message: z.string().max(262_144),
  Timestamp: z.iso.datetime({ offset: true }),
  SignatureVersion: z.enum(["1", "2"]),
  Signature: z.string().min(1).max(4096),
  SigningCertURL: z.url().max(2048),
}

export const SnsNotificationSchema = z
  .object({
    Type: z.literal("Notification"),
    ...SnsSignedBase,
    Subject: z.string().max(100).optional(),
    UnsubscribeURL: z.url().max(2048).optional(),
  })
  .strict()

export const SnsSubscriptionSchema = z
  .object({
    Type: z.enum(["SubscriptionConfirmation", "UnsubscribeConfirmation"]),
    ...SnsSignedBase,
    Token: z.string().min(1).max(4096),
    SubscribeURL: z.url().max(2048),
  })
  .strict()

export const SnsEnvelopeSchema = z.discriminatedUnion("Type", [
  SnsNotificationSchema,
  SnsSubscriptionSchema,
])

export type SnsEnvelope = z.infer<typeof SnsEnvelopeSchema>
export type SnsNotification = z.infer<typeof SnsNotificationSchema>

/** Parse the outer SNS document; returns null when it is not a valid envelope. */
export const parseSnsEnvelope = (input: unknown): SnsEnvelope | null => {
  const result = SnsEnvelopeSchema.safeParse(input)
  return result.success ? result.data : null
}

/**
 * Cross-check the AWS SNS message headers against the signed body. When a header
 * is present it must equal the corresponding signed field exactly; a mismatch
 * fails provenance (spec 04 §6.3).
 */
export const headersMatchEnvelope = (
  headers: Readonly<Record<string, string | undefined>>,
  envelope: SnsEnvelope,
): boolean => {
  const type = headers["x-amz-sns-message-type"]
  const messageId = headers["x-amz-sns-message-id"]
  const topicArn = headers["x-amz-sns-topic-arn"]
  if (type !== undefined && type !== envelope.Type) return false
  if (messageId !== undefined && messageId !== envelope.MessageId) return false
  if (topicArn !== undefined && topicArn !== envelope.TopicArn) return false
  return true
}

const SES_EVENT_TYPES = [
  "Delivery",
  "Bounce",
  "Complaint",
  "Reject",
  "Rendering Failure",
  "DeliveryDelay",
] as const

// The inner SES payload carries many optional AWS fields; validate the ones the
// worker relies on and tolerate the rest rather than reject real notifications.
export const SesEventSchema = z.object({
  eventType: z.enum(SES_EVENT_TYPES),
  mail: z.object({
    messageId: z.string().min(1).max(512),
    tags: z.record(z.string(), z.array(z.string())).optional(),
  }),
  bounce: z.object({ bounceType: z.string() }).loose().optional(),
})

export type SesEvent = z.infer<typeof SesEventSchema>

export const parseSesEvent = (rawMessage: string): SesEvent | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawMessage)
  } catch {
    return null
  }
  const result = SesEventSchema.safeParse(parsed)
  return result.success ? result.data : null
}

/** Normalized internal event category (raw "Rendering Failure" -> RenderingFailure). */
export type SesEventCategory =
  | "Delivery"
  | "Bounce"
  | "Complaint"
  | "Reject"
  | "RenderingFailure"
  | "DeliveryDelay"

export interface SesEventClassification {
  readonly category: SesEventCategory
  readonly sesMessageId: string
  /** The `boe_delivery_id` tag value when the strict single-value tag is present. */
  readonly deliveryTag: string | null
  /** Evidence timestamp column this event sets, if any (monotonic). */
  readonly evidence: "delivered" | "bounced" | "complained" | null
  /** Suppression reason this event creates, if any. */
  readonly suppress: "bounce" | "complaint" | null
}

const readDeliveryTag = (event: SesEvent): string | null => {
  const values = event.mail.tags?.["boe_delivery_id"]
  if (values === undefined || values.length !== 1) return null
  const value = values[0]
  return value !== undefined && value.length > 0 ? value : null
}

/**
 * Map a parsed SES event to its internal category, evidence, and suppression.
 * Only a *Permanent* bounce and any complaint create a suppression; transient
 * bounces and delays add evidence or nothing but never suppress.
 */
export const classifySesEvent = (event: SesEvent): SesEventClassification => {
  const base = {
    sesMessageId: event.mail.messageId,
    deliveryTag: readDeliveryTag(event),
  }
  switch (event.eventType) {
    case "Delivery":
      return { ...base, category: "Delivery", evidence: "delivered", suppress: null }
    case "Bounce": {
      const permanent = event.bounce?.bounceType === "Permanent"
      return {
        ...base,
        category: "Bounce",
        evidence: "bounced",
        suppress: permanent ? "bounce" : null,
      }
    }
    case "Complaint":
      return { ...base, category: "Complaint", evidence: "complained", suppress: "complaint" }
    case "Reject":
      return { ...base, category: "Reject", evidence: null, suppress: null }
    case "Rendering Failure":
      return { ...base, category: "RenderingFailure", evidence: null, suppress: null }
    case "DeliveryDelay":
      return { ...base, category: "DeliveryDelay", evidence: null, suppress: null }
  }
}
