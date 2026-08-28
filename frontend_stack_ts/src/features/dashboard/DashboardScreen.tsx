import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { toPaise } from "~/domain/money"
import { emailVerificationState } from "~/domain/status"
import { PendingPaymentRecovery } from "~/features/payments/PendingPaymentRecovery"
import { useEligibility, useFunds, usePortfolio, useSipPlans } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { Reveal } from "~/ui/motion/Reveal"
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
  const sips = useSipPlans()

  const firstName = session.principal?.fullName.split(" ")[0] ?? "there"
  const verificationState = eligibility.data?.emailVerificationState ?? null
  const canInvest = eligibility.data?.canInvest === true

  return (
    <Page width="default">
      <PageHeader title={`Good to see you, ${firstName}`} />

      <PendingPaymentRecovery />

      {verificationState !== null && verificationState !== "verified" ? (
        <Reveal delayMs={60}>
          <Alert tone="warning" title="Investing is locked">
            <span className={styles.gateRow}>
              Verify your email to start investing.
              <Link to="/verify-email">
                <Button size="sm" tone="gold" trailing>
                  Verify now
                </Button>
              </Link>
            </span>
          </Alert>
        </Reveal>
      ) : null}

      <div className={styles.bento}>
        <div className={cx(styles.spanHero)}>
          <Reveal delayMs={100}>
            <AsyncBoundary
              query={portfolio}
              skeleton={
                <Card tone="feature">
                  <Skeleton height="0.7rem" width="26%" />
                  <Skeleton height="2.6rem" width="58%" />
                </Card>
              }
            >
              {(data) => (
                <Card tone="feature">
                  <div className={styles.headlineCell}>
                    <span className={styles.label}>Current value</span>
                    <MoneyValue amount={toPaise(data.currentValuePaise)} size="xl" />
                  </div>
                  <div className={styles.split}>
                    <div className={styles.figure}>
                      <span className={styles.label}>Invested</span>
                      <MoneyValue amount={toPaise(data.totalInvestmentPaise)} size="md" />
                    </div>
                    <div className={styles.figure}>
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
                    <Button tone="secondary" size="sm" trailing>
                      See portfolio
                    </Button>
                  </Link>
                </Card>
              )}
            </AsyncBoundary>
          </Reveal>
        </div>

        <div className={cx(styles.spanAside, styles.spanHalf)}>
          <Reveal delayMs={180}>
            <Card>
              <span className={styles.label}>Account</span>
              <div className={styles.statusRow}>
                <span className={styles.category}>Email verification</span>
                {verificationState === null ? (
                  <span className={styles.category}>Unknown</span>
                ) : (
                  <StatusBadge status={emailVerificationState(verificationState)} />
                )}
              </div>
              <div className={styles.statusRow}>
                <span className={styles.category}>Investing</span>
                <span className={styles.category}>{canInvest ? "Unlocked" : "Locked"}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.category}>SIP plans</span>
                <span className={styles.category}>
                  {sips.data === undefined ? "—" : String(sips.data.items.length)}
                </span>
              </div>
              <Link to="/sips" className={styles.cardAction}>
                <Button tone="ghost" size="sm" trailing>
                  Manage SIPs
                </Button>
              </Link>
            </Card>
          </Reveal>
        </div>
      </div>

      <Section
        title="Funds"
        description="Administrator-managed pools, valued server-side."
        actions={
          <Link to="/funds">
            <Button tone="ghost" size="sm" trailing>
              See all
            </Button>
          </Link>
        }
      >
        <AsyncBoundary
          query={funds}
          skeleton={
            <div className={styles.bento}>
              {[0, 1, 2].map((index) => (
                <div key={index} className={styles.spanThird}>
                  <Card>
                    <Skeleton height="1.1rem" width="65%" />
                    <Skeleton height="0.8rem" width="40%" />
                  </Card>
                </div>
              ))}
            </div>
          }
        >
          {(data) => (
            <div className={styles.bento}>
              {data.items.slice(0, 3).map((fund, index) => (
                <div key={fund.id} className={styles.spanThird}>
                  <Reveal delayMs={index * 80}>
                    <Link to={`/funds/${fund.id}`} className={styles.cardLink}>
                      <Card>
                        <div className={styles.fundRow}>
                          <span className={styles.fundName}>{fund.name}</span>
                        </div>
                        <span className={styles.category}>{fund.category}</span>
                        {fund.fundSize === null ? null : (
                          <MoneyValue amount={toPaise(fund.fundSize.aumPaise)} size="md" />
                        )}
                      </Card>
                    </Link>
                  </Reveal>
                </div>
              ))}
            </div>
          )}
        </AsyncBoundary>
      </Section>
    </Page>
  )
}

export default DashboardScreen
