import { describe, expect, it } from "vitest"

import { PasswordResetData } from "./client-web-auth.js"

const reset = (downloadUrl: string | null) => ({ status: "password_set", downloadEmailStatus: "queued", downloadUrl })

describe("password reset response", () => {
  it("accepts the download link the backend builds, with its version query", () => {
    for (const url of [
      "https://app.beonedge.in/downloads/client/boe.prod.client.1.4.0.apk?v=140",
      "https://dev-app.beonedge.in/downloads/client/boe.dev.client.1.0.0.apk?v=100",
      "https://app.beonedge.in/downloads/client/boe.prod.client.1.4.0.apk",
    ]) {
      expect(PasswordResetData.safeParse(reset(url)).success, url).toBe(true)
    }
  })

  it("still refuses a link to another host, another path, or with any other query", () => {
    for (const url of [
      "https://evil.example/downloads/client/boe.prod.client.1.4.0.apk?v=140",
      "https://app.beonedge.in/downloads/admin/boe.prod.admin.1.4.0.apk?v=140",
      "https://app.beonedge.in/downloads/client/boe.prod.client.1.4.0.apk?v=140&next=evil",
      "https://app.beonedge.in/downloads/client/boe.prod.client.1.4.0.apk?v=0",
      "https://app.beonedge.in/downloads/client/boe.prod.client.1.4.0.apk#v=140",
    ]) {
      expect(PasswordResetData.safeParse(reset(url)).success, url).toBe(false)
    }
  })

  it("reports a queued download mail, and no longer claims one was sent", () => {
    expect(PasswordResetData.safeParse({ ...reset(null), downloadEmailStatus: "queued" }).success).toBe(true)
    expect(PasswordResetData.safeParse({ ...reset(null), downloadEmailStatus: "sent" }).success).toBe(false)
  })
})
