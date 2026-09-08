import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { useSession } from "~/app/providers/SessionProvider"
import { CLIENT_PAYMENT_RETURN_PATH } from "~/app/routing/clientRoutes"
import { closeCheckout } from "~/features/payments/openCheckout"
import { browserPendingPaymentStore, readPendingPayment } from "~/features/payments/pendingPayment"
import type { PendingPayment } from "~/features/payments/pendingPayment"
import { getLaunchUrl, onAppUrlOpen } from "~/platform/lifecycle"

const CLAIMED_PREFIXES: readonly string[] = [CLIENT_PAYMENT_RETURN_PATH]

export const isClaimedPaymentReturn = (incoming: string): boolean => {
  let url: URL
  try {
    url = new URL(incoming)
  } catch {
    return false
  }

  if (url.protocol !== "https:") return false

  return CLAIMED_PREFIXES.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  )
}

export const pendingPaymentDestination = (pending: PendingPayment | null): string | null => {
  if (pending === null) return null
  return pending.kind === "mandate_setup"
    ? `/sips/${pending.sipPlanId}`
    : `/activity/payments/${pending.paymentId}`
}

export const AppLinkRouter = (): null => {
  const navigate = useNavigate()
  const { principal } = useSession()
  const store = useMemo(browserPendingPaymentStore, [])
  const [hasPendingReturn, setHasPendingReturn] = useState(false)

  useEffect(() => {
    let isActive = true
    const receiveReturn = (incoming: string): void => {
      if (!isActive || !isClaimedPaymentReturn(incoming)) return
      void closeCheckout()
      setHasPendingReturn(true)
    }
    const unsubscribe = onAppUrlOpen(receiveReturn)
    void getLaunchUrl().then((incoming) => {
      if (incoming !== null) receiveReturn(incoming)
    })

    return () => {
      isActive = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!hasPendingReturn || principal === null) return
    let isActive = true
    queueMicrotask(() => {
      if (!isActive) return
      const destination = pendingPaymentDestination(readPendingPayment(store, principal.userId, Date.now()))
      setHasPendingReturn(false)
      if (destination !== null) void navigate(destination, { replace: true })
    })
    return () => { isActive = false }
  }, [hasPendingReturn, navigate, principal, store])

  return null
}
