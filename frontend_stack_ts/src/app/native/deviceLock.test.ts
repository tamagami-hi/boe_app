import { beforeEach, describe, expect, it, vi } from "vitest"

import type * as DeviceLockModule from "~/app/native/deviceLock"
import { shouldLock } from "~/features/device-security/lockDecision"

type DeviceLock = typeof DeviceLockModule

const NOW = 1_700_000_000_000

let lock: DeviceLock

beforeEach(async () => {
  vi.resetModules()
  lock = await import("~/app/native/deviceLock")
})

const resumeWouldLock = (now: number): boolean =>
  shouldLock({
    native: true,
    enrolled: true,
    trigger: "resume",
    leftAt: lock.readDeviceLeftAt(),
    now,
  })

describe("device lock state", () => {
  it("starts unlocked with no recorded activity", () => {
    expect(lock.isDeviceLocked()).toBe(false)
    expect(lock.readDeviceLeftAt()).toBeNull()
  })

  it("notifies subscribers when it locks and unlocks", () => {
    const listener = vi.fn()
    lock.subscribeToDeviceLock(listener)

    lock.lockDevice()
    expect(lock.isDeviceLocked()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    lock.lockDevice()
    expect(listener).toHaveBeenCalledTimes(1)

    lock.unlockDevice(NOW)
    expect(lock.isDeviceLocked()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("records the moment of unlocking, so a resume straight afterwards does not re-lock", () => {
    lock.lockDevice()
    lock.unlockDevice(NOW)

    expect(lock.readDeviceLeftAt()).toBe(NOW)
    expect(resumeWouldLock(NOW + 50)).toBe(false)
  })

  it("does not treat a prompt we opened ourselves as leaving the app", () => {
    lock.unlockDevice(NOW)
    lock.beginNativePrompt()
    lock.recordDeviceLeft(NOW + 1_000)

    expect(lock.isNativePromptInFlight()).toBe(true)
    expect(lock.readDeviceLeftAt()).toBe(NOW)

    lock.endNativePrompt()
    expect(lock.isNativePromptInFlight()).toBe(false)
  })

  it("records leaving again once our prompt has closed", () => {
    lock.unlockDevice(NOW)
    lock.beginNativePrompt()
    lock.endNativePrompt()
    lock.recordDeviceLeft(NOW + 1_000)

    expect(lock.readDeviceLeftAt()).toBe(NOW + 1_000)
  })

  it("never lets the prompt depth fall below zero", () => {
    lock.endNativePrompt()
    lock.endNativePrompt()
    expect(lock.isNativePromptInFlight()).toBe(false)

    lock.beginNativePrompt()
    expect(lock.isNativePromptInFlight()).toBe(true)
  })

  it("still locks a resume after a genuinely long absence", () => {
    lock.unlockDevice(NOW)
    lock.recordDeviceLeft(NOW + 1_000)

    expect(resumeWouldLock(NOW + 1_000 + 120_000)).toBe(true)
  })
})

describe("the biometric unlock loop", () => {
  it("does not re-lock when the resume event arrives after the unlock", () => {
    lock.lockDevice()
    lock.beginNativePrompt()
    lock.recordDeviceLeft(NOW)
    lock.unlockDevice(NOW + 2_000)
    lock.endNativePrompt()

    expect(lock.isDeviceLocked()).toBe(false)
    expect(resumeWouldLock(NOW + 2_050)).toBe(false)
  })

  it("does not re-lock when the resume event arrives before the unlock", () => {
    lock.lockDevice()
    lock.beginNativePrompt()
    lock.recordDeviceLeft(NOW)

    expect(lock.isNativePromptInFlight()).toBe(true)

    lock.unlockDevice(NOW + 2_000)
    lock.endNativePrompt()

    expect(lock.isDeviceLocked()).toBe(false)
  })

  it("survives a slow authentication that outlasts the idle threshold", () => {
    lock.lockDevice()
    lock.beginNativePrompt()
    lock.recordDeviceLeft(NOW)
    const slow = NOW + 120_000 + 5_000
    lock.unlockDevice(slow)
    lock.endNativePrompt()

    expect(lock.isDeviceLocked()).toBe(false)
    expect(resumeWouldLock(slow + 100)).toBe(false)
  })

  it("would have looped under the previous behaviour of clearing the timestamp", () => {
    lock.lockDevice()
    lock.recordDeviceLeft(NOW)
    lock.unlockDevice(NOW + 2_000)

    expect(resumeWouldLock(NOW + 2_050)).toBe(false)

    expect(
      shouldLock({
        native: true,
        enrolled: true,
        trigger: "resume",
        leftAt: null,
        now: NOW + 2_050,
      }),
    ).toBe(true)
  })
})
