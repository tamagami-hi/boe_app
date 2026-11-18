import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"

import { ReturnFigures } from "./ReturnFigures"
import { useClientPortfolioSummary } from "./returnQueries"

type Props = Readonly<{ userId: string }>

export const PortfolioSummarySection = ({ userId }: Props): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canRead = hasAnyPermission(["client_values.read"])
  const summary = useClientPortfolioSummary(userId, canRead)

  return (
    <Section
      title="Portfolio summary"
      description="Totals across all funds, worked out from every entry recorded for this client and up to date when you open this page."
    >
      {canRead ? (
        <AsyncBoundary
          query={summary}
          skeleton={
            <Card>
              <Skeleton height="1.2rem" width="45%" />
              <Skeleton height="3rem" />
            </Card>
          }
        >
          {(data) => <ReturnFigures returns={data} asOfDate={data.asOfDate} />}
        </AsyncBoundary>
      ) : (
        <Card>
          <p className={PROSE_SM}>Your account cannot read client values, so this client&apos;s returns are not shown.</p>
        </Card>
      )}
    </Section>
  )
}
