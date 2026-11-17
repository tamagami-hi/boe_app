import { hasCode } from "~/api/errors"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { ButtonLink } from "~/ui/primitives/ButtonLink"

export const isUnknownRecord = (data: unknown, error: unknown): boolean =>
  data === undefined && hasCode(error, "RESOURCE_NOT_FOUND", "VALIDATION_FAILED")

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
