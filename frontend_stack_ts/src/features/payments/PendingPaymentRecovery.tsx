import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { useSession } from "~/app/providers/SessionProvider"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"

import { browserPendingPaymentStore, clearPendingPayment, readPendingPayment } from "./pendingPayment"
import type { PendingPayment } from "./pendingPayment"

import styles from "./Payments.module.css"

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
      <div className={styles.recovery}>
        <span className={styles.recoveryTitle}>You have a payment in progress</span>
        <p className={styles.honesty}>
          You were handed to PhonePe and have not come back to a settled result yet. Open it to see
          where it stands — we will not know it settled until the provider tells us.
        </p>
        <div className={styles.actions}>
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
