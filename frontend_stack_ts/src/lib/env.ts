export const APP_TARGETS = ["client", "admin"] as const
export type AppTarget = (typeof APP_TARGETS)[number]

declare global {
  interface Window {
    __BOE_API_BASE__?: string
  }
}

export class ConfigurationError extends Error {
  public readonly code = "CONFIGURATION_INVALID"

  public constructor(message: string) {
    super(message)
    this.name = "ConfigurationError"
  }
}

export const appTarget = (): AppTarget =>
  import.meta.env.VITE_BEO_APP_TARGET === "client" ? "client" : "admin"

export const isNativeShell = (): boolean =>
  typeof window !== "undefined" && window.location.hostname === "localhost" &&
  window.location.protocol === "https:"

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/u, "")

export const resolveApiBase = (): string => {
  const injected = typeof window === "undefined" ? undefined : window.__BOE_API_BASE__
  if (injected !== undefined && injected.trim() !== "") return stripTrailingSlash(injected.trim())

  const configured = import.meta.env.VITE_BEO_API_BASE_URL
  if (configured !== undefined && configured.trim() !== "") return stripTrailingSlash(configured.trim())

  if (isNativeShell()) {
    throw new ConfigurationError(
      "A native shell has no same-origin API. Build with VITE_BEO_API_BASE_URL set to an absolute https origin.",
    )
  }

  if (typeof window === "undefined") {
    throw new ConfigurationError("No API base is configured and there is no window to infer one from.")
  }

  return `${stripTrailingSlash(window.location.origin)}/api`
}

export const assertHttpMode = (): void => {
  if (import.meta.env.VITE_BEO_API_MODE !== "http") {
    throw new ConfigurationError(
      "VITE_BEO_API_MODE must be 'http'. This application has no fixture or demo mode.",
    )
  }
}
