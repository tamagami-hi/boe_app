import { findRoute, isCatchAll } from "~/app/routing/routeManifest"
import type { RouteManifest } from "~/app/routing/routeManifest"

export type RefusalReason =
  | "empty"
  | "scheme"
  | "cleartext"
  | "protocol-relative"
  | "self-origin"
  | "unknown-route"
  | "malformed"

export type Destination =
  | Readonly<{ kind: "internal"; path: string }>
  | Readonly<{ kind: "external"; url: string }>
  | Readonly<{ kind: "email"; address: string }>
  | Readonly<{ kind: "phone"; number: string }>
  | Readonly<{ kind: "refused"; reason: RefusalReason }>

const WEBVIEW_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

const ENTRY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

type PayloadDestination = Readonly<{ key: string; build: (id: string) => string }>

const PAYLOAD_DESTINATIONS: Readonly<Record<string, PayloadDestination>> = {
  client_value_updated: { key: "entryId", build: (entryId) => `/portfolio/value-updates?entry=${entryId}` },
  client_contribution_recorded: { key: "entryId", build: (entryId) => `/activity/receipts/${entryId}` },
  maturity_options_sent: { key: "offerId", build: (offerId) => `/maturity-options/${offerId}` },
}

export const notificationLink = (kind: string, payload: Readonly<Record<string, unknown>>): unknown => {
  const destination = Object.hasOwn(PAYLOAD_DESTINATIONS, kind) ? PAYLOAD_DESTINATIONS[kind] : undefined
  const id = destination === undefined ? undefined : payload[destination.key]
  if (destination !== undefined && typeof id === "string" && ENTRY_ID_PATTERN.test(id)) {
    return destination.build(id)
  }
  return payload.deepLink ?? payload.link ?? payload.path
}

const refuse = (reason: RefusalReason): Destination => ({ kind: "refused", reason })

const stripFragment = (value: string): string => value.split("#")[0] ?? ""

const isProtocolRelative = (value: string): boolean => value.startsWith("//")

const looksAbsolute = (value: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)

const normalisedInternalPath = (value: string): string => {
  const withoutFragment = stripFragment(value)
  const [pathOnly] = withoutFragment.split("?")
  const path = pathOnly ?? ""
  if (path === "/") return "/"
  return path.replace(/\/+$/u, "")
}

export const resolveDestination = (
  value: unknown,
  manifest: RouteManifest,
): Destination => {
  if (typeof value !== "string") return refuse("malformed")

  const trimmed = value.trim()
  if (trimmed === "") return refuse("empty")

  if (isProtocolRelative(trimmed)) return refuse("protocol-relative")

  if (trimmed.startsWith("/")) {
    const path = normalisedInternalPath(trimmed)
    const route = findRoute(manifest, path === "" ? "/" : path)
    if (route === null || isCatchAll(route.path)) return refuse("unknown-route")
    return { kind: "internal", path: stripFragment(trimmed) }
  }

  if (!looksAbsolute(trimmed)) return refuse("unknown-route")

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return refuse("malformed")
  }

  const scheme = parsed.protocol.toLowerCase()

  if (scheme === "mailto:") {
    const address = parsed.pathname.trim()
    return address === "" ? refuse("malformed") : { kind: "email", address }
  }

  if (scheme === "tel:") {
    const number = parsed.pathname.trim()
    return number === "" ? refuse("malformed") : { kind: "phone", number }
  }

  if (scheme === "http:") return refuse("cleartext")

  if (scheme !== "https:") return refuse("scheme")

  if (parsed.username !== "" || parsed.password !== "") return refuse("scheme")

  if (WEBVIEW_ORIGIN_HOSTS.has(parsed.hostname.toLowerCase())) return refuse("self-origin")

  return { kind: "external", url: parsed.toString() }
}
