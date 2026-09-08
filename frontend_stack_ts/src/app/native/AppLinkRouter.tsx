import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

import { CLIENT_PAYMENT_RETURN_PATH } from "~/app/routing/clientRoutes"
import { closeCheckout } from "~/features/payments/openCheckout"
import { onAppUrlOpen } from "~/platform/lifecycle"

const CLAIMED_PREFIXES: readonly string[] = [CLIENT_PAYMENT_RETURN_PATH]

export const internalDestinationFor = (incoming: string): string | null => {
  let url: URL
  try {
    url = new URL(incoming)
  } catch {
    return null
  }

  if (url.protocol !== "https:") return null

  const claimed = CLAIMED_PREFIXES.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  )
  if (!claimed) return null

  return `${url.pathname}${url.search}`
}

export const AppLinkRouter = (): null => {
  const navigate = useNavigate()

  useEffect(
    () =>
      onAppUrlOpen((incoming) => {
        const destination = internalDestinationFor(incoming)
        if (destination === null) return

        // The tab that produced this link is only paused, not gone — measured: it stays in
        // the back stack, so Back would return the payer to a stale return page.
        void closeCheckout()
        void navigate(destination, { replace: true })
      }),
    [navigate],
  )

  return null
}
