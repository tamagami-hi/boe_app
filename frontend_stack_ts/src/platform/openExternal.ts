import { isNative, tryCallPlugin } from "~/platform/capacitor"
import type { Destination } from "~/app/routing/resolveDestination"

export type OpenResult = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>

const openInBrowser = async (url: string): Promise<OpenResult> => {
  if (isNative()) {
    const opened = await tryCallPlugin("Browser", "open", { url })
    if (opened !== null) return { ok: true }
  }
  if (typeof window === "undefined") return { ok: false, reason: "No window to open from." }
  const handle = window.open(url, "_blank", "noopener,noreferrer")
  return handle === null
    ? { ok: false, reason: "The browser blocked opening this link." }
    : { ok: true }
}

const openHandler = (href: string): OpenResult => {
  if (typeof window === "undefined") return { ok: false, reason: "No window to open from." }
  window.location.href = href
  return { ok: true }
}

export const openDestination = async (destination: Destination): Promise<OpenResult> => {
  switch (destination.kind) {
    case "external":
      return openInBrowser(destination.url)
    case "email":
      return openHandler(`mailto:${destination.address}`)
    case "phone":
      return openHandler(`tel:${destination.number}`)
    case "internal":
      return { ok: false, reason: "Internal destinations are navigated, not opened." }
    case "refused":
      return { ok: false, reason: `This link was refused: ${destination.reason}.` }
  }
}
