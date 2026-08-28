import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ContentGrid } from "~/app/layouts/ContentGrid"
import { useSession } from "~/app/providers/SessionProvider"
import { toPaise } from "~/domain/money"
import { emailVerificationState } from "~/domain/status"
import { useEligibility, useFunds, usePortfolio } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"

import styles from "./Dashboard.module.css"

const DashboardScreen = (): React.ReactElement => {
  const session = useSession()
  const portfolio = usePortfolio()
  const funds = useFunds()
  const eligibility = useEligibility()

  const firstName = session.principal?.fullName.split(" ")[0] ?? "there"
  const verificationState = eligibility.data?.emailVerificationState ?? null
  const canInvest = eligibility.data?.canInvest === true

  return (
    <Page width="default">
      <PageHeader eyebrow="Home" title={`Hello, ${firstName}`} />

      {verificationState !== null && verificationState !== "verified" ? (
        <Alert tone="warning" title="Investing is locked">
          <span className={styles.gateRow}>
            Verify your email to start investing.
            <Link to="/verify-email">
              <Button size="sm">Verify now</Button>
            </Link>
          </span>
        </Alert>
      ) : null}

      <AsyncBoundary
        query={portfolio}
        skeleton={
          <Card>
            <Skeleton height="0.9rem" width="30%" />
            <Skeleton height="2.2rem" width="55%" />
          </Card>
        }
      >
        {(data) => (
          <Card elevated>
            <span className={styles.label}>Current value</span>
            <MoneyValue amount={toPaise(data.currentValuePaise)} size="xl" />
            <div className={styles.split}>
              <div>
                <span className={styles.label}>Invested</span>
                <MoneyValue amount={toPaise(data.totalInvestmentPaise)} size="md" />
              </div>
              <div>
                <span className={styles.label}>Growth</span>
                <MoneyValue
                  amount={toPaise(data.totalGrowthPaise)}
                  size="md"
                  tone="signed"
                  showSign
                />
              </div>
            </div>
            <Link to="/portfolio" className={styles.cardAction}>
              <Button tone="ghost" size="sm">
                See portfolio
              </Button>
            </Link>
          </Card>
        )}
      </AsyncBoundary>

      <Section
        title="Funds"
        actions={
          <Link to="/funds">
            <Button tone="ghost" size="sm">
              See all
            </Button>
          </Link>
        }
      >
        <AsyncBoundary
          query={funds}
          skeleton={
            <ContentGrid columns={3}>
              {[0, 1, 2].map((index) => (
                <Card key={index}>
                  <Skeleton height="1.1rem" width="65%" />
                  <Skeleton height="0.9rem" width="40%" />
                </Card>
              ))}
            </ContentGrid>
          }
        >
          {(data) => (
            <ContentGrid columns={3}>
              {data.items.slice(0, 3).map((fund) => (
                <Link key={fund.id} to={`/funds/${fund.id}`} className={styles.cardLink}>
                  <Card>
                    <span className={styles.fundName}>{fund.name}</span>
                    <span className={styles.category}>{fund.category}</span>
                  </Card>
                </Link>
              ))}
            </ContentGrid>
          )}
        </AsyncBoundary>
      </Section>

      <Section title="Account">
        <Card>
          <div className={styles.statusRow}>
            <span className={styles.label}>Email verification</span>
            {verificationState === null ? (
              <span className={styles.category}>Unknown</span>
            ) : (
              <StatusBadge status={emailVerificationState(verificationState)} />
            )}
          </div>
          <div className={styles.statusRow}>
            <span className={styles.label}>Investing</span>
            <span className={styles.category}>{canInvest ? "Unlocked" : "Locked"}</span>
          </div>
        </Card>
      </Section>
    </Page>
  )
}

export default DashboardScreen
