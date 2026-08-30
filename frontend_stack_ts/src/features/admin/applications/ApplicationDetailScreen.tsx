import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { applicationState, emailDeliveryState } from "~/domain/status"
import { useAdminApplication, useDecideApplication } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

type Confirming = "approved" | "rejected" | null

const ApplicationDetailScreen = (): React.ReactElement => {
  const { applicationId = "" } = useParams()
  const query = useAdminApplication(applicationId)
  const decide = useDecideApplication(applicationId)
  const navigate = useNavigate()
  const { hasAnyPermission } = useSession()
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const canDecide = hasAnyPermission(["applications.decide"])

  const run = (outcome: "approved" | "rejected"): void => {
    setFailure(null)
    decide.mutate(outcome, {
      onError: (error) => {
        setFailure(
          isApiError(error)
            ? error.message
            : "We could not record that decision. Nothing has changed.",
        )
      },
      onSuccess: () => {
        void navigate("/applications", { replace: true })
      },
      onSettled: () => {
        setConfirming(null)
      },
    })
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Application"
        description="Everything the applicant submitted, the consents they accepted, and every email we sent them."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1.2rem" width="45%" />
            <Skeleton height="3rem" />
          </Card>
        }
      >
        {(data) => (
          <>
            {failure === null ? null : (
              <Alert tone="error" title="Nothing changed">
                {failure}
              </Alert>
            )}

            <Card elevated>
              <DataList split>
                <DetailRow label="Name">{data.application.fullName}</DetailRow>
                <DetailRow label="Email">{data.application.email}</DetailRow>
                <DetailRow label="Phone">{data.application.phone}</DetailRow>
                <DetailRow label="Status">
                  <StatusBadge
                    status={applicationState(data.application.status)}
                  />
                </DetailRow>
                <DetailRow label="Signup password">
                  {data.application.hasSignupPassword ? "Set by the applicant" : "Not set"}
                </DetailRow>
                <DetailRow label="Applied">
                  {formatDateTime(data.application.createdAt)}
                </DetailRow>
                <DetailRow label="Version">{String(data.application.version)}</DetailRow>
              </DataList>
            </Card>

            {data.application.status === "submitted" ? (
              <Section
                title="Decide"
                description="Approving activates the account and emails the applicant a welcome with the app download. Rejecting emails them the rejection. Both are recorded in the audit log."
              >
                {canDecide ? (
                  <div className={ACTION_ROW}>
                    <Button
                      disabled={decide.isPending}
                      onClick={() => {
                        setConfirming("approved")
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      tone="danger"
                      disabled={decide.isPending}
                      onClick={() => {
                        setConfirming("rejected")
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                ) : (
                  <Alert tone="info" title="You can read this but not decide it">
                    Deciding an application needs the applications.decide permission.
                  </Alert>
                )}
              </Section>
            ) : null}

            <Section title="Consents">
              {data.consents.length === 0 ? (
                <Card>
                  <p className={PROSE_SM}>No consent records are attached.</p>
                </Card>
              ) : (
                <Card>
                  <DataList>
                    {data.consents.map((consent) => (
                      <DetailRow key={consent.kind} label={consent.kind}>
                        {`v${consent.version} · ${formatDateTime(consent.acceptedAt)}`}
                      </DetailRow>
                    ))}
                  </DataList>
                </Card>
              )}
            </Section>

            <Section title="Decision history">
              {data.reviews.length === 0 ? (
                <Card>
                  <p className={PROSE_SM}>This application has not been decided yet.</p>
                </Card>
              ) : (
                <AdminTable
                  caption="Decisions"
                  rows={data.reviews}
                  rowKey={(row) => row.reviewId}
                  columns={[
                    { key: "decision", header: "Decision", render: (row) => row.decision },
                    { key: "reasonCode", header: "Reason", render: (row) => row.reasonCode },
                    {
                      key: "detail",
                      header: "Detail",
                      render: (row) => row.reasonDetail ?? "—",
                    },
                    {
                      key: "decidedAt",
                      header: "Decided",
                      render: (row) => formatDateTime(row.decidedAt),
                    },
                  ]}
                />
              )}
            </Section>

            <Section
              title="Emails sent"
              description="Recipients are masked unless your account holds the unmasked read permission."
            >
              {data.deliveries.items.length === 0 ? (
                <Card>
                  <p className={PROSE_SM}>No email has been sent for this application.</p>
                </Card>
              ) : (
                <AdminTable
                  caption="Email deliveries"
                  rows={data.deliveries.items}
                  rowKey={(row) => row.emailDeliveryId}
                  columns={[
                    { key: "template", header: "Template", render: (row) => row.templateKey },
                    {
                      key: "recipient",
                      header: "Recipient",
                      render: (row) => row.recipientMasked,
                    },
                    {
                      key: "state",
                      header: "State",
                      render: (row) => (
                        <StatusBadge
                          status={emailDeliveryState(row.state)}
                        />
                      ),
                    },
                    {
                      key: "attempts",
                      header: "Attempts",
                      numeric: true,
                      render: (row) => String(row.attemptCount),
                    },
                    {
                      key: "error",
                      header: "Last error",
                      render: (row) => row.lastErrorCode ?? "—",
                    },
                    {
                      key: "updatedAt",
                      header: "Updated",
                      render: (row) => formatDateTime(row.updatedAt),
                    },
                  ]}
                />
              )}
            </Section>

            <ConfirmDialog
              open={confirming === "approved"}
              title="Approve this application?"
              description="This creates the account, activates it, and emails the applicant. It cannot be undone from here."
              confirmLabel="Approve and notify"
              pending={decide.isPending}
              onConfirm={() => {
                run("approved")
              }}
              onCancel={() => {
                setConfirming(null)
              }}
            />

            <ConfirmDialog
              open={confirming === "rejected"}
              title="Reject this application?"
              description="This emails the applicant that they were not accepted. It cannot be undone from here."
              confirmLabel="Reject and notify"
              confirmTone="danger"
              pending={decide.isPending}
              onConfirm={() => {
                run("rejected")
              }}
              onCancel={() => {
                setConfirming(null)
              }}
            />
          </>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default ApplicationDetailScreen
