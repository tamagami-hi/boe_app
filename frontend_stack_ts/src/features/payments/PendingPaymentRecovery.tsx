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

  return (
    <Card tone="feature">
      <div className={PAYMENT_RECOVERY}>
        <span className={ITEM_TITLE}>You have a payment in progress</span>
        <p className={HONESTY_TEXT}>
          You were handed to PhonePe and have not come back to a settled result yet. Open it to see
          where it stands — we will not know it settled until the provider tells us.
        </p>
        <div className={ACTION_ROW}>
          <Link to={`/activity/payments/${pending.paymentId}`}>
            <Button trailing>Open the payment</Button>
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
