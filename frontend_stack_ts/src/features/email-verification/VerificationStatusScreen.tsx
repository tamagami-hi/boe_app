

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { CLIENT_VERIFY_EMAIL_PATH } from "~/app/routing/clientRoutes"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { clientEmailVerification } from "~/domain/clientStatus"
import { useEligibility } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { STAT_LABEL, STAT_ROOT } from "~/ui/recipes/datalist"

const REASON_COPY: Readonly<Record<string, string>> = {
  email_verification_required: "Verify your email address to start investing.",
  account_suspended: "Your account is on hold, so investing is paused. Support can explain what is needed.",
  account_not_active: "Your account is not active yet. Support can explain what is needed.",
}

const VerificationStatusScreen = (): React.ReactElement => {
  const query = useEligibility()
  const { principal } = useSession()

  return (
    <Page width="form">
      <PageHeader
        title="Email verification"
        description="Whether you can invest, and what to do if you cannot."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="2rem" width="70%" />
          </Card>
        }
      >
        {(data) => (
          <>
            <Card elevated>
              <div className={STAT_ROOT}>
                <span className={STAT_LABEL}>Verification</span>
                {data.emailVerificationState === null ? null : (
                  <StatusBadge status={clientEmailVerification(data.emailVerificationState)} />
                )}
              </div>

              <DataList>
                <DetailRow label="Investing" emphasis="lead">
                  {data.canInvest ? "Available" : "Not yet available"}
                </DetailRow>
                {principal?.email === undefined ? null : (
                  <DetailRow label="Email">{principal.email}</DetailRow>
                )}
                <DetailRow label="Last checked">{formatDateTime(data.evaluatedAt)}</DetailRow>
              </DataList>
            </Card>

            {data.canInvest ? (
              <Section title="You are all set">
                <Prose>Your email is verified and you can invest.</Prose>
              </Section>
            ) : (
              <Section title="What is needed">
                <Prose>
                  {REASON_COPY[data.reason ?? ""] ??
                    "Investing is not available yet. Support can explain what is needed."}
                </Prose>
                {data.reason === "email_verification_required" ? (
                  <ButtonLink to={CLIENT_VERIFY_EMAIL_PATH} trailing>
Verify my email
</ButtonLink>
                ) : (
                  <ButtonLink to="/profile/support" tone="secondary">
Contact support
</ButtonLink>
                )}
              </Section>
            )}
          </>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default VerificationStatusScreen
