import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { useSession } from "~/app/providers/SessionProvider"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { HONESTY_TEXT } from "~/ui/recipes/text"

import { browserPendingPaymentStore, clearPendingPayment, readPendingPayment } from "./pendingPayment"
import type { PendingPayment } from "./pendingPayment"
import { PAYMENT_RECOVERY } from "./payments.recipe"
import { ITEM_TITLE } from "~/ui/recipes/datalist"

const RECOVERY_COPY = {
  order_payment: {
    title: "You have a payment in progress",
    body: "You were handed to PhonePe and have not come back to a settled result yet. Open it to see where it stands — we will not know it settled until the provider tells us.",
    action: "Open the payment",
  },
  mandate_setup: {
    title: "You have a mandate authorisation in progress",
    body: "You were handed to PhonePe to authorise an AutoPay mandate and have not come back to a settled result yet. Open the plan to see where it stands — returning from the UPI app does not authorise anything on its own.",
    action: "Open the SIP plan",
  },
} as const

export const PendingPaymentRecovery = (): React.ReactElement | null => {
  const { principal } = useSession()
  const store = useMemo(browserPendingPaymentStore, [])
  const [pending, setPending] = useState<PendingPayment | null>(null)

  useEffect(() => {
    if (principal === null) {
      setPending(null)
      return
    }
    setPending(readPendingPayment(store, principal.userId, Date.now()))
  }, [principal, store])

  if (pending === null) return null

  const copy = RECOVERY_COPY[pending.kind]
  const destination =
    pending.kind === "mandate_setup"
      ? `/sips/${pending.sipPlanId}`
      : `/activity/payments/${pending.paymentId}`

  return (
    <Card tone="feature">
      <div className={PAYMENT_RECOVERY}>
        <span className={ITEM_TITLE}>{copy.title}</span>
        <p className={HONESTY_TEXT}>{copy.body}</p>
        <div className={ACTION_ROW}>
          <Link to={destination}>
            <Button trailing>{copy.action}</Button>
          </Link>
          <Button
            tone="ghost"
            onClick={() => {
              clearPendingPayment(store)
              setPending(null)
            }}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </Card>
  )
}
