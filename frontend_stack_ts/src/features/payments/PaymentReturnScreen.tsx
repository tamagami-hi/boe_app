import { useSearchParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { ButtonLink } from "~/ui/primitives/ButtonLink"

const PaymentReturnScreen = (): React.ReactElement => {
  const [params] = useSearchParams()
  const paymentId = params.get("paymentId")

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
