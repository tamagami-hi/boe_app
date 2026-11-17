import { EmptyState } from "~/ui/patterns/EmptyState"
import { ButtonLink } from "~/ui/primitives/ButtonLink"

export const FundNotFound = (): React.ReactElement => (
  <EmptyState
    title="This fund was not found"
    description="No fund has this address. It may have been mistyped, or the link may be out of date."
    action={
      <ButtonLink to="/funds" tone="secondary" size="sm">
        Back to funds
      </ButtonLink>
    }
  />
)
