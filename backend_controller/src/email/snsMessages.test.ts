import { describe, expect, test } from "vitest"

import {
  classifySesEvent,
  headersMatchEnvelope,
  parseSesEvent,
  parseSnsEnvelope,
} from "./snsMessages.js"
import type { SnsEnvelope } from "./snsMessages.js"

const notification = (): Record<string, unknown> => ({
  Type: "Notification",
  MessageId: "11111111-1111-1111-1111-111111111111",
  TopicArn: "arn:aws:sns:us-east-1:123456789012:boe-ses",
  Message: JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses-1" } }),
  Timestamp: "2026-07-20T10:00:00.000Z",
  SignatureVersion: "1",
  Signature: "c2ln",
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
})

const subscription = (): Record<string, unknown> => ({
  Type: "SubscriptionConfirmation",
  MessageId: "22222222-2222-2222-2222-222222222222",
  TopicArn: "arn:aws:sns:us-east-1:123456789012:boe-ses",
  Message: "You have chosen to subscribe",
  Timestamp: "2026-07-20T10:00:00.000Z",
  SignatureVersion: "1",
  Signature: "c2ln",
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
  Token: "tok".repeat(10),
  SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
})

describe("parseSnsEnvelope", () => {
  test("accepts a well-formed Notification", () => {
    const parsed = parseSnsEnvelope(notification())
    expect(parsed?.Type).toBe("Notification")
  })

  test("accepts a well-formed SubscriptionConfirmation", () => {
    const parsed = parseSnsEnvelope(subscription())
    expect(parsed?.Type).toBe("SubscriptionConfirmation")
  })

  test("rejects an unknown outer Type", () => {
    expect(parseSnsEnvelope({ ...notification(), Type: "Heartbeat" })).toBeNull()
  })

  test("rejects an unexpected SignatureVersion", () => {
    expect(parseSnsEnvelope({ ...notification(), SignatureVersion: "3" })).toBeNull()
  })

  test("rejects an unknown extra field (strict)", () => {
    expect(parseSnsEnvelope({ ...notification(), Injected: "x" })).toBeNull()
  })

  test("rejects a non-object", () => {
    expect(parseSnsEnvelope("not-json")).toBeNull()
  })
})

describe("headersMatchEnvelope", () => {
  const envelope = parseSnsEnvelope(notification()) as SnsEnvelope

  test("passes when headers are absent", () => {
    expect(headersMatchEnvelope({}, envelope)).toBe(true)
  })

  test("passes when all present headers match", () => {
    expect(
      headersMatchEnvelope(
        {
          "x-amz-sns-message-type": "Notification",
          "x-amz-sns-message-id": envelope.MessageId,
          "x-amz-sns-topic-arn": envelope.TopicArn,
        },
        envelope,
      ),
    ).toBe(true)
  })

  test.each([
    ["x-amz-sns-message-type", "Subscription"],
    ["x-amz-sns-message-id", "different"],
    ["x-amz-sns-topic-arn", "arn:aws:sns:us-east-1:0:other"],
  ])("fails when %s mismatches", (header, value) => {
    expect(headersMatchEnvelope({ [header]: value }, envelope)).toBe(false)
  })
})

describe("parseSesEvent", () => {
  test("parses a Delivery event", () => {
    const event = parseSesEvent(JSON.stringify({ eventType: "Delivery", mail: { messageId: "m1" } }))
    expect(event?.eventType).toBe("Delivery")
  })

  test("returns null for invalid JSON", () => {
    expect(parseSesEvent("{not json")).toBeNull()
  })

  test("returns null for an unknown SES event type", () => {
    expect(parseSesEvent(JSON.stringify({ eventType: "Nope", mail: { messageId: "m" } }))).toBeNull()
  })
})

describe("classifySesEvent", () => {
  test("Delivery sets delivered evidence and no suppression", () => {
    const event = parseSesEvent(
      JSON.stringify({
        eventType: "Delivery",
        mail: { messageId: "m1", tags: { boe_delivery_id: ["d-1"] } },
      }),
    )
    const result = classifySesEvent(event!)
    expect(result).toMatchObject({
      category: "Delivery",
      evidence: "delivered",
      suppress: null,
      deliveryTag: "d-1",
      sesMessageId: "m1",
    })
  })

  test("Permanent bounce suppresses; transient bounce does not", () => {
    const permanent = classifySesEvent(
      parseSesEvent(
        JSON.stringify({ eventType: "Bounce", mail: { messageId: "m" }, bounce: { bounceType: "Permanent" } }),
      )!,
    )
    const transient = classifySesEvent(
      parseSesEvent(
        JSON.stringify({ eventType: "Bounce", mail: { messageId: "m" }, bounce: { bounceType: "Transient" } }),
      )!,
    )
    expect(permanent).toMatchObject({ category: "Bounce", evidence: "bounced", suppress: "bounce" })
    expect(transient).toMatchObject({ category: "Bounce", evidence: "bounced", suppress: null })
  })

  test("Complaint always suppresses", () => {
    const result = classifySesEvent(
      parseSesEvent(JSON.stringify({ eventType: "Complaint", mail: { messageId: "m" } }))!,
    )
    expect(result).toMatchObject({ category: "Complaint", evidence: "complained", suppress: "complaint" })
  })

  test("Reject, Rendering Failure, and DeliveryDelay add neither evidence nor suppression", () => {
    for (const [eventType, category] of [
      ["Reject", "Reject"],
      ["Rendering Failure", "RenderingFailure"],
      ["DeliveryDelay", "DeliveryDelay"],
    ] as const) {
      const result = classifySesEvent(parseSesEvent(JSON.stringify({ eventType, mail: { messageId: "m" } }))!)
      expect(result).toMatchObject({ category, evidence: null, suppress: null })
    }
  })

  test("ignores a multi-valued or empty boe_delivery_id tag", () => {
    const multi = classifySesEvent(
      parseSesEvent(
        JSON.stringify({ eventType: "Delivery", mail: { messageId: "m", tags: { boe_delivery_id: ["a", "b"] } } }),
      )!,
    )
    expect(multi.deliveryTag).toBeNull()
  })
})
