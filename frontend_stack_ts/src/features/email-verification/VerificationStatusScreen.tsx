import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { CLIENT_VERIFY_EMAIL_PATH } from "~/app/routing/clientRoutes"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { emailVerificationState } from "~/domain/status"
import { useEligibility } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

const REASON_COPY: Readonly<Record<string, string>> = {
  email_verification_required:
    "Investing is locked until your email address is verified. Verification takes one code and about a minute.",
  account_suspended:
    "Your account is suspended, so investing is locked regardless of email verification. Support can explain why.",
  account_not_active:
    "Your account is not active, so investing is locked. Support can explain what is needed.",
}

const VerificationStatusScreen = (): React.ReactElement => {
  const query = useEligibility()
  const { principal } = useSession()

  return (
    <Page width="form">
      <PageHeader
        title="Email verification"
        description="Whether investing is unlocked on this account, and why."
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
              <DataList>
                <DetailRow label="Email">{principal?.email ?? "—"}</DetailRow>
                <DetailRow label="Verification">
                  {data.emailVerificationState === null ? (
                    "—"
                  ) : (
                    <StatusBadge status={emailVerificationState(data.emailVerificationState)} />
                  )}
                </DetailRow>
                <DetailRow label="Investing">
                  {data.canInvest ? "Unlocked" : "Locked"}
                </DetailRow>
                <DetailRow label="Evaluated">{formatDateTime(data.evaluatedAt)}</DetailRow>
              </DataList>
            </Card>

            {data.canInvest ? (
              <Section title="Nothing to do">
                <Prose>
                  This account is verified and investing is unlocked. Requesting another code is not
                  necessary.
                </Prose>
              </Section>
            ) : (
              <Section title="What is blocking investing">
                <Prose>
                  {REASON_COPY[data.reason ?? ""] ??
                    "Investing is locked on this account. Support can explain what is needed."}
                </Prose>
                {data.reason === "email_verification_required" ? (
                  <Link to={CLIENT_VERIFY_EMAIL_PATH}>
                    <Button trailing>Verify my email</Button>
                  </Link>
                ) : (
                  <Link to="/profile/support">
                    <Button tone="secondary">Contact support</Button>
                  </Link>
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
