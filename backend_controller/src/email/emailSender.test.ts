import { beforeEach, describe, expect, test, vi } from "vitest"

import { createSmtpEmailSender } from "./emailSender.js"

const sendMail = vi.hoisted(() => vi.fn<(options: Record<string, unknown>) => Promise<{ messageId: string }>>())

vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }))

const sender = createSmtpEmailSender({
  host: "smtp.example.com",
  port: 465,
  secure: true,
  user: "mailer",
  password: "not-a-real-password",
  fromAddress: "no-reply@example.com",
})

beforeEach(() => {
  sendMail.mockReset()
  sendMail.mockResolvedValue({ messageId: "<message-1@example.com>" })
})

describe("createSmtpEmailSender", () => {
  test("refuses a recipient or subject carrying a line break before the transport sees it", async () => {
    await expect(
      sender.send({ to: "victim@example.com\r\nBcc: attacker@example.com", subject: "Hello", text: "Body" }),
    ).rejects.toMatchObject({ code: "EMAIL_HEADER_INVALID" })
    await expect(
      sender.send({ to: "victim@example.com", subject: "Hello\nBcc: attacker@example.com", text: "Body" }),
    ).rejects.toMatchObject({ code: "EMAIL_HEADER_INVALID" })

    expect(sendMail).not.toHaveBeenCalled()
  })

  test("hands a clean message, including its HTML body, to the transport", async () => {
    const result = await sender.send({
      to: "client@example.com",
      subject: "Hello",
      text: "Body",
      html: "<p>Body</p>",
    })

    expect(result).toEqual({ messageId: "<message-1@example.com>" })
    expect(sendMail).toHaveBeenCalledWith({
      from: "no-reply@example.com",
      to: "client@example.com",
      subject: "Hello",
      text: "Body",
      html: "<p>Body</p>",
    })
  })
})
