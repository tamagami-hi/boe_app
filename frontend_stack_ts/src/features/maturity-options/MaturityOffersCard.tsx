import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { STACK_SM } from "~/ui/recipes/layout"

import { calendarDate } from "./maturityOptionCopy"
import { useMaturityOffers } from "./maturityOptionQueries"

export const MaturityOffersCard = (): React.ReactElement | null => {
  const offers = useMaturityOffers()
  if (offers.isError && offers.data === undefined) {
    return (
      <Alert
        tone="warning"
        title="Maturity options could not be checked"
        action={
          <Button size="sm" tone="secondary" loading={offers.isFetching} onClick={() => void offers.refetch()}>
            Try again
          </Button>
        }
      >
        We could not check whether the BeOnEdge team has sent you options for a maturing investment.
      </Alert>
    )
  }
  const items = offers.data?.items ?? []
  if (items.length === 0) return null
  return (
    <div className={STACK_SM}>
      {items.map((offer) => (
        <Alert
          key={offer.offerId}
          tone="info"
          title="Your maturity options are ready"
          action={
            <ButtonLink to={`/maturity-options/${offer.offerId}`} size="sm" tone="secondary" trailing>
              {offer.chosenOption === null ? "Choose" : "Review"}
            </ButtonLink>
          }
        >
          {offer.chosenOption === null
            ? `${offer.fundName} matures on ${calendarDate(offer.maturityDate)}. Choose what happens next.`
            : `${offer.fundName} matures on ${calendarDate(offer.maturityDate)}. The BeOnEdge team will confirm your choice.`}
        </Alert>
      ))}
    </div>
  )
}
