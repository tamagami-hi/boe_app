import { describe, expect, test } from "vitest"

import {
  deriveSipStateForMandate,
  transitionMandateState,
  transitionNotifyState,
  transitionSetupState,
  transitionAutoPaySipState,
} from "./mandateStates.js"

describe("mandate state transitions", () => {
  test("permits only provider-authoritative mandate transitions", () => {
    expect(transitionMandateState("setup_pending", "active")).toBe("active")
    expect(transitionMandateState("active", "pause_pending")).toBe("pause_pending")
    expect(transitionMandateState("pause_pending", "paused")).toBe("paused")
    expect(transitionMandateState("paused", "active")).toBe("active")
    expect(transitionMandateState("active", "cancel_pending")).toBe("cancel_pending")
    expect(transitionMandateState("cancel_pending", "cancelled")).toBe("cancelled")
    expect(transitionMandateState("active", "paused")).toBe("paused")
    expect(transitionMandateState("active", "cancelled")).toBe("cancelled")
    expect(transitionMandateState("cancel_pending", "paused")).toBe("paused")
    expect(transitionMandateState("revoke_pending", "paused")).toBe("paused")
    expect(transitionMandateState("paused", "revoked")).toBe("revoked")
    expect(() => transitionMandateState("cancelled", "active")).toThrow("cancelled -> active")
    expect(() => transitionMandateState("setup_pending", "paused")).toThrow("setup_pending -> paused")
  })

  test("keeps setup terminal outcomes final", () => {
    expect(transitionSetupState("created", "dispatching")).toBe("dispatching")
    expect(transitionSetupState("dispatching", "provider_pending")).toBe("provider_pending")
    expect(transitionSetupState("dispatching", "authorized")).toBe("authorized")
    expect(transitionSetupState("dispatching", "failed")).toBe("failed")
    expect(transitionSetupState("dispatching", "expired")).toBe("expired")
    expect(transitionSetupState("provider_pending", "authorized")).toBe("authorized")
    expect(() => transitionSetupState("authorized", "provider_pending")).toThrow("authorized -> provider_pending")
  })

  test("requires mandate setup and cancellation phases for AutoPay SIPs", () => {
    expect(transitionAutoPaySipState("draft", "pending_mandate")).toBe("pending_mandate")
    expect(transitionAutoPaySipState("pending_mandate", "active")).toBe("active")
    expect(transitionAutoPaySipState("active", "cancel_pending")).toBe("cancel_pending")
    expect(transitionAutoPaySipState("cancel_pending", "cancelled")).toBe("cancelled")
    expect(transitionAutoPaySipState("active", "mandate_failed")).toBe("mandate_failed")
    expect(transitionAutoPaySipState("paused", "revoked")).toBe("revoked")
    expect(transitionAutoPaySipState("active", "expired")).toBe("expired")
    expect(() => transitionAutoPaySipState("pending_mandate", "paused")).toThrow("pending_mandate -> paused")
  })

  test("derives SIP truth from provider mandate truth and authorization history", () => {
    expect(deriveSipStateForMandate("active", "pause_pending", true)).toBe("active")
    expect(deriveSipStateForMandate("active", "paused", true)).toBe("paused")
    expect(deriveSipStateForMandate("paused", "cancel_pending", true)).toBe("cancel_pending")
    expect(deriveSipStateForMandate("cancel_pending", "paused", true)).toBe("paused")
    expect(deriveSipStateForMandate("pending_mandate", "failed", false)).toBe("setup_failed")
    expect(deriveSipStateForMandate("active", "failed", true)).toBe("mandate_failed")
    expect(() => deriveSipStateForMandate("active", "pause_pending", false)).toThrow("authorization")
  })

  test("tracks notification acknowledgement independently from collection truth", () => {
    expect(transitionNotifyState("created", "dispatching")).toBe("dispatching")
    expect(transitionNotifyState("dispatching", "notified")).toBe("notified")
    expect(transitionNotifyState("failed", "dispatching")).toBe("dispatching")
    expect(() => transitionNotifyState("notified", "failed")).toThrow("notified -> failed")
  })
})
