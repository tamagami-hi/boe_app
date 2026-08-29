import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { formatPercent } from "~/domain/percent"
import { emailVerificationState } from "~/domain/status"
import { PendingPaymentRecovery } from "~/features/payments/PendingPaymentRecovery"
import { useEligibility, useFunds, usePortfolio, useSipPlans } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { Reveal } from "~/ui/motion/Reveal"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { STAT_LABEL, STAT_ROOT } from "~/ui/recipes/datalist"
import { CARD_ACTION } from "~/ui/recipes/surface"
import {
  CARD_TITLE,
  META_MUTED,
  META_TEXT,
  MONEY_BASE,
  MONEY_SIZE,
  MONEY_TONE,
} from "~/ui/recipes/text"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"

import {
  BENTO,
  FUND_CARD_LINK,
  FUND_ROW,
  GATE_ROW,
  HEADLINE_CELL,
  HEADLINE_ROW,
  RETURN_CELL,
  SPAN_ASIDE,
  SPAN_HERO,
  SPAN_THIRD,
  SPLIT,
  STATUS_ROW,
} from "./dashboard.recipe"

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
            <span className={GATE_ROW}>
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

      <div className={BENTO}>
        <div className={SPAN_HERO}>
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
                  <div className={HEADLINE_ROW}>
                    <div className={HEADLINE_CELL}>
                      <span className={STAT_LABEL}>Current value</span>
                      <MoneyValue amount={toPaise(data.currentValuePaise)} size="xl" />
                    </div>
                    <div className={RETURN_CELL}>
                      <span className={STAT_LABEL}>Return</span>
                      <span className={cx(MONEY_BASE, MONEY_SIZE.lg, MONEY_TONE.default)}>
                        {formatPercent(data.returnPercent, { showSign: true })}
                      </span>
                      <span className={META_TEXT}>
                        {data.lastUpdated === null
                          ? "No ledger entries yet"
                          : `As at ${formatDate(`${data.lastUpdated}T00:00:00Z`)}`}
                      </span>
                    </div>
                  </div>
                  <div className={SPLIT}>
                    <div className={STAT_ROOT}>
                      <span className={STAT_LABEL}>Invested</span>
                      <MoneyValue amount={toPaise(data.totalInvestmentPaise)} size="md" />
                    </div>
                    <div className={STAT_ROOT}>
                      <span className={STAT_LABEL}>Growth</span>
                      <MoneyValue
                        amount={toPaise(data.totalGrowthPaise)}
                        size="md"
                        tone="signed"
                        showSign
                      />
                    </div>
                  </div>
                  <Link to="/portfolio" className={CARD_ACTION}>
                    <Button tone="secondary" size="sm" trailing>
                      See portfolio
                    </Button>
                  </Link>
                </Card>
              )}
            </AsyncBoundary>
          </Reveal>
        </div>

        <div className={SPAN_ASIDE}>
          <Reveal delayMs={180}>
            <Card>
              <span className={STAT_LABEL}>Account</span>
              <div className={STATUS_ROW}>
                <span className={META_MUTED}>Email verification</span>
                {verificationState === null ? (
                  <span className={META_MUTED}>Unknown</span>
                ) : (
                  <StatusBadge status={emailVerificationState(verificationState)} />
                )}
              </div>
              <div className={STATUS_ROW}>
                <span className={META_MUTED}>Investing</span>
                <span className={META_MUTED}>{canInvest ? "Unlocked" : "Locked"}</span>
              </div>
              <div className={STATUS_ROW}>
                <span className={META_MUTED}>SIP plans</span>
                <span className={META_MUTED}>
                  {sips.data === undefined ? "—" : String(sips.data.items.length)}
                </span>
              </div>
              <Link to="/sips" className={CARD_ACTION}>
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
            <div className={BENTO}>
              {[0, 1, 2].map((index) => (
                <div key={index} className={SPAN_THIRD}>
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
            <div className={BENTO}>
              {data.items.slice(0, 3).map((fund, index) => (
                <div key={fund.id} className={SPAN_THIRD}>
                  <Reveal delayMs={index * 80}>
                    <Link to={`/funds/${fund.id}`} className={FUND_CARD_LINK}>
                      <Card>
                        <div className={FUND_ROW}>
                          <span className={CARD_TITLE}>{fund.name}</span>
                        </div>
                        <span className={META_MUTED}>{fund.category}</span>
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
