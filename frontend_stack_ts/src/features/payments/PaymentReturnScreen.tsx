import { useSearchParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { ButtonLink } from "~/ui/primitives/ButtonLink"

const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/u

const PaymentReturnScreen = (): React.ReactElement => {
  const [params] = useSearchParams()
  const candidate = params.get("paymentId")
  const paymentId = candidate !== null && IDENTIFIER.test(candidate) ? candidate : null

  return (
    <Page width="form">
      <PageHeader
        title="Back from PhonePe"
        description="We do not have the final result of this payment yet."
      />
      <EmptyState
        description="Close this tab and return to the BeOnEdge app. It is already showing this payment and updates on its own."
        action={
          paymentId === null ? null : (
            <ButtonLink to={`/activity/payments/${paymentId}`} trailing>
              Open this payment
            </ButtonLink>
          )
        }
      />
    </Page>
  )
}

export default PaymentReturnScreen
