import { describe, expect, test, vi } from "vitest"

import type { EmailMessage, EmailSender } from "./emailSender.js"
import type { EmailTemplateConfig } from "./emailTemplates.js"
import { createTransactionalEmailSender } from "./transactionalEmailSender.js"

const TEMPLATES: EmailTemplateConfig = {
  supportAddress: null,
}

const REQUEST = {
  deliveryId: "11111111-1111-4111-8111-111111111111",
  toAddress: "investor@example.com",
  templateKey: "account_approved",
  templateVersion: "v1",
  configurationSet: "boe-transactional",
  templateData: { downloadUrl: "https://downloads.beonedge.example/client/boe.apk" },
} as const

describe("createTransactionalEmailSender", () => {
  test("renders the body and reports the transport message id", async () => {
    const sent: EmailMessage[] = []
    const transport: EmailSender = {
      send: (message) => {
        sent.push(message)
        return Promise.resolve({ messageId: "<smtp-1@mailbox>" })
      },
    }

    const result = await createTransactionalEmailSender({ sender: transport, templates: TEMPLATES }).send(
      REQUEST,
    )

    expect(result).toEqual({
      outcome: "accepted",
      sesMessageId: "<smtp-1@mailbox>",
      sesRequestId: null,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe("investor@example.com")
    expect(sent[0]?.text).toContain("https://downloads.beonedge.example/client/boe.apk")
  })

  test("synthesises a correlation id when the transport supplies none", async () => {
    const transport: EmailSender = { send: () => Promise.resolve({ messageId: null }) }
    const result = await createTransactionalEmailSender({ sender: transport, templates: TEMPLATES }).send(
      REQUEST,
    )
    if (result.outcome !== "accepted") throw new Error("expected acceptance")
    expect(result.sesMessageId).toMatch(/^local-[0-9a-f-]{36}$/u)
  })

  test("a 5xx SMTP refusal is permanent so it dead-letters", async () => {
    const transport: EmailSender = {
      send: () => Promise.reject(Object.assign(new Error("no such user"), { responseCode: 550 })),
    }
    const result = await createTransactionalEmailSender({ sender: transport, templates: TEMPLATES }).send(
      REQUEST,
    )
    expect(result).toEqual({
      outcome: "rejected",
      disposition: "permanent",
      errorCode: "SMTP_PERMANENT_REJECT",
    })
  })

  test("a transport error or greylist is retryable", async () => {
    for (const error of [
      new Error("ECONNRESET"),
      Object.assign(new Error("try later"), { responseCode: 451 }),
    ]) {
      const transport: EmailSender = { send: () => Promise.reject(error) }
      const result = await createTransactionalEmailSender({ sender: transport, templates: TEMPLATES }).send(
        REQUEST,
      )
      expect(result).toMatchObject({ disposition: "retryable", errorCode: "SMTP_TRANSPORT_ERROR" })
    }
  })

  test("an unrenderable template is permanent and never touches the transport", async () => {
    const send = vi.fn()
    const result = await createTransactionalEmailSender({
      sender: { send },
      templates: TEMPLATES,
    }).send({ ...REQUEST, templateKey: "statement_ready", templateData: {} })

    expect(result).toEqual({
      outcome: "rejected",
      disposition: "permanent",
      errorCode: "TEMPLATE_UNKNOWN",
    })
    expect(send).not.toHaveBeenCalled()
  })
})
