import { formatDate } from "~/domain/dates"
import { formatINR, toPaise } from "~/domain/money"
import { earlyExitText, useSipEarlyExits } from "~/features/portfolio/sipEarlyExitQueries"
import { InlineReadFailure } from "~/features/shared/InlineReadFailure"
import { Skeleton } from "~/ui/primitives/Feedback"

import { STATEMENT_NOTES } from "./statements.recipe"

export const StatementEarlyExits = (): React.ReactElement | null => {
  const exits = useSipEarlyExits()
  if (exits.isError) {
    return (
      <InlineReadFailure
        label="Couldn’t load the early exits this statement mentions"
        retrying={exits.isFetching}
        onRetry={() => {
          void exits.refetch()
        }}
      />
    )
  }
  if (exits.data === undefined) return <Skeleton height="1rem" width="60%" />
  if (exits.data.items.length === 0) return null
  return (
    <ul className={STATEMENT_NOTES}>
      {exits.data.items.map((exit) => (
        <li key={exit.earlyExitId}>
          {earlyExitText(exit, formatDate(`${exit.effectiveDate}T00:00:00Z`), formatINR(toPaise(exit.amountPaise)))}
        </li>
      ))}
    </ul>
  )
}
