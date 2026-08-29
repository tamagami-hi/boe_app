import { callPlugin, hasPlugin, isNative } from "~/platform/capacitor"
import { platformError } from "~/platform/errors"

const PLUGIN = "NativeBiometric"

const BIOMETRY_LABELS: Readonly<Record<number, string>> = {
  1: "Touch ID",
  2: "Face ID",
  3: "your fingerprint",
  4: "face unlock",
  5: "iris unlock",
  6: "your enrolled biometrics",
}

const CANCELLED_CODES = new Set([11, 15, 16, 17])
const UNAVAILABLE_CODES = new Set([1, 3, 14])

export type BiometricCapability = Readonly<{
  enrolled: boolean
  strong: boolean
  label: string
}>

export type BiometricOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "cancelled" | "unavailable" | "failed" }>

export const NO_BIOMETRIC: BiometricCapability = {
  enrolled: false,
  strong: false,
  label: "biometrics",
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}

const errorCodeOf = (error: unknown): number | null => {
  const code = asRecord(error).code
  if (typeof code === "number" && Number.isFinite(code)) return code
  if (typeof code === "string") {
    const parsed = Number.parseInt(code, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const labelFor = (biometryType: unknown): string => {
  if (typeof biometryType !== "number") return NO_BIOMETRIC.label
  return BIOMETRY_LABELS[biometryType] ?? NO_BIOMETRIC.label
}

export const canUseBiometrics = (): boolean => isNative() && hasPlugin(PLUGIN)

export const readBiometricCapability = async (): Promise<BiometricCapability> => {
  if (!canUseBiometrics()) return NO_BIOMETRIC
  try {
    const result = asRecord(await callPlugin(PLUGIN, "isAvailable", { useFallback: false }))
    if (result.isAvailable !== true) return NO_BIOMETRIC
    return {
      enrolled: true,
      strong: result.strongBiometryIsAvailable === true,
      label: labelFor(result.biometryType),
    }
  } catch {
    return NO_BIOMETRIC
  }
}

export const verifyBiometric = async (
  prompt: Readonly<{ title: string; subtitle: string; reason: string }>,
): Promise<BiometricOutcome> => {
  if (!isNative()) {
    throw platformError("NOT_NATIVE", "Biometric unlock is only available inside the Android app.")
  }
  if (!hasPlugin(PLUGIN)) {
    throw platformError("BIOMETRY_UNAVAILABLE", "This build has no biometric support.")
  }

  try {
    await callPlugin(PLUGIN, "verifyIdentity", {
      title: prompt.title,
      subtitle: prompt.subtitle,
      reason: prompt.reason,
      negativeButtonText: "Use PIN",
      useFallback: false,
      maxAttempts: 3,
    })
    return { ok: true }
  } catch (error) {
    const code = errorCodeOf(error)
    if (code !== null && CANCELLED_CODES.has(code)) return { ok: false, reason: "cancelled" }
    if (code !== null && UNAVAILABLE_CODES.has(code)) return { ok: false, reason: "unavailable" }
    return { ok: false, reason: "failed" }
  }
}
