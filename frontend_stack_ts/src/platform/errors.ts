export const PLATFORM_ERROR_CODES = [
  "PLUGIN_UNAVAILABLE",
  "NOT_NATIVE",
  "SECURE_STORAGE_UNAVAILABLE",
  "BIOMETRY_UNAVAILABLE",
  "INVALID_ARGUMENT",
  "OPERATION_FAILED",
] as const

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number]

export class PlatformError extends Error {
  public readonly code: PlatformErrorCode

  public constructor(code: PlatformErrorCode, message: string) {
    super(message)
    this.name = "PlatformError"
    this.code = code
  }
}

export const platformError = (code: PlatformErrorCode, message: string): PlatformError =>
  new PlatformError(code, message)
