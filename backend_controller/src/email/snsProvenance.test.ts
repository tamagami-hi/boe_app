import { createSign, generateKeyPairSync } from "node:crypto"

import { describe, expect, test } from "vitest"

import { parseSnsEnvelope } from "./snsMessages.js"
import type { SnsEnvelope } from "./snsMessages.js"
import {
  buildCanonicalMessage,
  certificatePublicKey,
  validateSigningCertUrl,
  verifyEnvelopeSignature,
  verifySnsProvenance,
} from "./snsProvenance.js"

// Static self-signed RSA fixture (valid 2026-07-20 .. 2036-07-17), generated
// once with node-forge so the suite needs no certificate tooling or live AWS.
const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDFDCCAfygAwIBAgIJawIxHeB8Z80nMA0GCSqGSIb3DQEBCwUAMCYxJDAiBgNV
BAMTG3Nucy51cy1lYXN0LTEuYW1hem9uYXdzLmNvbTAeFw0yNjA3MjAxNzUyMzJa
Fw0zNjA3MTcxNzUyMzJaMCYxJDAiBgNVBAMTG3Nucy51cy1lYXN0LTEuYW1hem9u
YXdzLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK9XwaEP7yVi
bRdZSI1qPsovbJCAz0W4HgWDRih/a4W/12bT3t3H1sFDKoTRzyHOmkNx8UpZin1o
ZPzKlxlSGknllcRYDawz7Sc+MThfp90YXn1CXsMa8vHJ1IxwnEeX1ggLQQ8UZmhX
e78qBmhSZ7WXr7l+E4H9Y4gmdMQVCSAIGdJEEUDipMpyVVUDVBEdmy450f0Zemz4
yYSC+K9qzw3A/SPNj/0nIIyaY29WNdehfGpf7Oqse1J4qq7M7bgqb1TuM9npPAmH
o/U3vQpglS2YH/DQyPXqzMmkZ4rKTz+ICgl0QaEKz1CQdhFon9hrVEG1M6enaSQb
GdX1Gr5zLnMCAwEAAaNFMEMwDAYDVR0TBAUwAwEB/zALBgNVHQ8EBAMCAvQwJgYD
VR0RBB8wHYYbaHR0cDovL2V4YW1wbGUub3JnL3dlYmlkI21lMA0GCSqGSIb3DQEB
CwUAA4IBAQBGcLbgEUjtdMzzCEMhrzPEaS/cK/BMjiAFDIXRMfQIPjy6tSj+XP5x
lQ4v/mLvMSVhZJRo7ZXfLi2rZouqO0AkpbBdIiUdYFOvRsYEomBI56TgLkMiN49/
3doxotkzoFqojAER4eAaNhSzpH7YJawtlsonMLxia25IawNNKY3U+5oVu/lzgXyq
kfV7B/fm7WWjI6rtXu0jOyWSISsJzorm2BXZcO2rZS5nKgW9i60CJqAmr/yjUNJo
GpM29OjEpTqC3o8b8RovEkgMU4w/2vDNJHEp8pSc3G8WFOAXsySa9EKsIQZYmUNf
/tB1YK4REgDliABBDUKjblAwx20HYMvE
-----END CERTIFICATE-----
`

const KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEAr1fBoQ/vJWJtF1lIjWo+yi9skIDPRbgeBYNGKH9rhb/XZtPe
3cfWwUMqhNHPIc6aQ3HxSlmKfWhk/MqXGVIaSeWVxFgNrDPtJz4xOF+n3RhefUJe
wxry8cnUjHCcR5fWCAtBDxRmaFd7vyoGaFJntZevuX4Tgf1jiCZ0xBUJIAgZ0kQR
QOKkynJVVQNUER2bLjnR/Rl6bPjJhIL4r2rPDcD9I82P/ScgjJpjb1Y116F8al/s
6qx7UniqrsztuCpvVO4z2ek8CYej9Te9CmCVLZgf8NDI9erMyaRnispPP4gKCXRB
oQrPUJB2EWif2GtUQbUzp6dpJBsZ1fUavnMucwIDAQABAoIBADuEGQg3ZWAWIZtM
RfEiP//Wyw3dev1aOm56mYTDg1aZwF55yesTmtRsnPEKWjlKbFg6Q8GN1REuLyET
DuicUqoEkKpdjP6HfZbVaFWPOmY0kFYKAipNamshq9CjpJg0dIS0dTfOH9iI4UsI
07XzSpp7yzy2C58SyAb9rqKj1T4WkVIYmi/9HM+vQts6tNgEPxNd3mB0JjR0a0wF
3k86F1tyeodFyAKIGN0NVzoGAuemdpgkqEoW8MCRIKbSvCYaYfd5thHWmYv6ru2D
noGcBH3n2b+s3aiBLkfL6m4DcI0+DCuVhUO9vRzZ08oEjxgN0DBVZCEvQSbuaEe+
vIAf0GECgYEA6YuhheMEFEj6BzX4W08jzyLVTKKEBzKwFAUNb0TA0Je7MB3yQhaW
yJi4UmjALYolJRfegkjirxSIdBCWDdaC0dvAjNXBDSynSkz9N98UJLi43cgTzc8s
677nMBhCVRq3DtwGaWX5kFsnFCjYBgtkY2aijU0o1vMDTNYHXec9CCMCgYEAwDOO
Ixh1wAORwU0df8N+aqHLROSGzdkLRQAG4a743U+q7q/uzrVXjrrhbis/m00FaZoS
ePN7fH7qP+Tqk1G6HpjXUrZakrOJR7yRnTIVGFyzcG11R/bek4vEUIZK0ObuCN1t
d3SKD4ywDAZGZ/abeXTZrcrs1ruEyuRX4vIo/XECgYAfkdNswMo9X7wEm4QN+72w
c1n3+QP14SEyI5i0UMvrpocUMwgbbOhHB3XrFePchA8PW5GldOrHlfP4FIHkLvoS
Gi2GHCLzf/TBM3ULR2l2qU28FR6wNHAzEeQ4eR8GWA0kwhNPzgwVOm0m6XqCHqoc
UbRpe2Oo4sKwcUIfrHFwlwKBgBhmcyUBdfFqgpaHs7cEmofvAl88o+B+LXAVEMqV
7AIsmwayTx7u5q64CuZxlyGgJY/Cf5XbU1H6ysJRzXXmajp4LN3TSKxXHpZ82f+a
3BK7sgwT2U/Jh3gzxjhy1AyxRIbblYoUwXI36iGcqlOIezRwITJvEKIyLCmV05J8
K7gBAoGAUs8wNdasgFIWxljK1PqjLikDrwSmb+PVYS0ysJQH4u4WslgjsXJtWXPX
jef5u2ANNCcRcqupezIm7UzoTQI+x+VEA8z4BVcpVWZ7jeEGl2kGPHpm5oDCXlOa
jw+0IzR0akwb1JMKvEQnDTHwETx5HxD5GpLzLjwFU0hwR8/R5Qs=
-----END RSA PRIVATE KEY-----
`

const REGION = "us-east-1"
const TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:boe-ses"
const VALID_NOW = new Date("2026-08-01T00:00:00.000Z")
const EXPIRED_NOW = new Date("2037-01-01T00:00:00.000Z")

const baseNotification = (): Record<string, unknown> => ({
  Type: "Notification",
  MessageId: "11111111-1111-1111-1111-111111111111",
  TopicArn: TOPIC_ARN,
  Message: JSON.stringify({ eventType: "Delivery", mail: { messageId: "ses-1" } }),
  Timestamp: "2026-07-20T10:00:00.000Z",
  SignatureVersion: "1",
  Signature: "placeholder",
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem",
})

const sign = (canonical: string, algorithm: "RSA-SHA1" | "RSA-SHA256"): string => {
  const signer = createSign(algorithm)
  signer.update(canonical, "utf8")
  signer.end()
  return signer.sign(KEY_PEM, "base64")
}

// Build an envelope whose Signature is a genuine RSA signature over its own
// canonical string for the given SignatureVersion.
const signedEnvelope = (version: "1" | "2", overrides: Record<string, unknown> = {}): SnsEnvelope => {
  const draft = parseSnsEnvelope({ ...baseNotification(), SignatureVersion: version, ...overrides })
  if (draft === null) throw new Error("fixture envelope failed to parse")
  const canonical = buildCanonicalMessage(draft)
  const signature = sign(canonical, version === "1" ? "RSA-SHA1" : "RSA-SHA256")
  return { ...draft, Signature: signature }
}

describe("validateSigningCertUrl", () => {
  const good = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem"

  test("accepts the canonical AWS certificate URL", () => {
    expect(validateSigningCertUrl(good, REGION)).toBe(true)
    expect(validateSigningCertUrl(good.replace(".com/", ".com:443/"), REGION)).toBe(true)
  })

  test.each([
    ["http scheme", good.replace("https", "http")],
    ["embedded credentials", "https://user:pw@sns.us-east-1.amazonaws.com/SimpleNotificationService-a.pem"],
    ["query string", `${good}?x=1`],
    ["fragment", `${good}#f`],
    ["non-443 port", good.replace(".com/", ".com:8443/")],
    ["wrong host", good.replace("us-east-1", "eu-west-1")],
    ["wrong path prefix", "https://sns.us-east-1.amazonaws.com/evil-abc.pem"],
    ["non-pem path", good.replace(".pem", ".txt")],
    ["malformed url", "://nope"],
  ])("rejects %s", (_label, candidate) => {
    expect(validateSigningCertUrl(candidate, REGION)).toBe(false)
  })
})

describe("buildCanonicalMessage", () => {
  test("orders Notification keys and omits an absent Subject", () => {
    const envelope = parseSnsEnvelope(baseNotification()) as SnsEnvelope
    const canonical = buildCanonicalMessage(envelope)
    expect(canonical).toBe(
      `Message\n${envelope.Message}\nMessageId\n${envelope.MessageId}\n` +
        `Timestamp\n${envelope.Timestamp}\nTopicArn\n${envelope.TopicArn}\nType\nNotification\n`,
    )
  })

  test("includes Subject when present", () => {
    const envelope = parseSnsEnvelope({ ...baseNotification(), Subject: "hello" }) as SnsEnvelope
    expect(buildCanonicalMessage(envelope)).toContain("Subject\nhello\n")
  })

  test("includes SubscribeURL and Token for a subscription envelope", () => {
    const envelope = parseSnsEnvelope({
      ...baseNotification(),
      Type: "SubscriptionConfirmation",
      Token: "tok".repeat(10),
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription",
    }) as SnsEnvelope
    const canonical = buildCanonicalMessage(envelope)
    expect(canonical).toContain("SubscribeURL\n")
    expect(canonical).toContain("Token\n")
  })
})

describe("certificatePublicKey", () => {
  test("returns the RSA public key for a currently-valid certificate", () => {
    const key = certificatePublicKey(CERT_PEM, VALID_NOW)
    expect(key.asymmetricKeyType).toBe("rsa")
  })

  test("throws when the certificate is not valid at the given time", () => {
    expect(() => certificatePublicKey(CERT_PEM, EXPIRED_NOW)).toThrow()
  })
})

describe("verifyEnvelopeSignature", () => {
  test("verifies an RSA-SHA256 (version 2) signature", () => {
    const envelope = signedEnvelope("2")
    const key = certificatePublicKey(CERT_PEM, VALID_NOW)
    expect(verifyEnvelopeSignature(envelope, key)).toBe(true)
  })

  test("verifies an RSA-SHA1 (version 1) signature", () => {
    const envelope = signedEnvelope("1")
    const key = certificatePublicKey(CERT_PEM, VALID_NOW)
    expect(verifyEnvelopeSignature(envelope, key)).toBe(true)
  })

  test("rejects a tampered signature", () => {
    const envelope = { ...signedEnvelope("2"), Message: "tampered" }
    const key = certificatePublicKey(CERT_PEM, VALID_NOW)
    expect(verifyEnvelopeSignature(envelope, key)).toBe(false)
  })

  test("rejects a signature made under a different key", () => {
    const envelope = signedEnvelope("2")
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 })
    expect(verifyEnvelopeSignature(envelope, other.publicKey)).toBe(false)
  })
})

describe("verifySnsProvenance", () => {
  const provenance = (envelope: SnsEnvelope, now = VALID_NOW): boolean =>
    verifySnsProvenance({ envelope, certPem: CERT_PEM, region: REGION, expectedTopicArn: TOPIC_ARN, now })

  test("accepts a fully valid signed notification", () => {
    expect(provenance(signedEnvelope("2"))).toBe(true)
  })

  test("rejects a topic ARN that does not match the configured topic", () => {
    expect(provenance(signedEnvelope("2", { TopicArn: "arn:aws:sns:us-east-1:0:other" }))).toBe(false)
  })

  test("rejects a non-canonical SigningCertURL", () => {
    const envelope = {
      ...signedEnvelope("2"),
      SigningCertURL: "https://evil.example.com/SimpleNotificationService-a.pem",
    }
    expect(provenance(envelope)).toBe(false)
  })

  test("rejects an expired certificate", () => {
    expect(provenance(signedEnvelope("2"), EXPIRED_NOW)).toBe(false)
  })

  test("rejects an invalid signature", () => {
    const envelope = { ...signedEnvelope("2"), Signature: Buffer.from("wrong").toString("base64") }
    expect(provenance(envelope)).toBe(false)
  })
})
