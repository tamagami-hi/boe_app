import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { applicationState, emailDeliveryState } from "~/domain/status"
import { isUnknownRecord } from "~/features/admin/shared/unknownRecord"
import { useHeldDone } from "~/features/admin/shared/useHeldDone"
import { useAdminApplication } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { PROSE_SM } from "~/ui/recipes/datalist"
import { META_MUTED } from "~/ui/recipes/text"
import { ACTION_ROW } from "~/ui/recipes/layout"

import { useDecideApplication } from "./applicationQueries"

type Confirming = "approved" | "rejected" | null

const UNSENT = "The decision could not be sent. Reload the page and try again."

const ApplicationDetailScreen = (): React.ReactElement => {
  const { applicationId = "" } = useParams()
  const query = useAdminApplication(applicationId)
  const decide = useHeldWrite(useDecideApplication(applicationId), UNSENT)
  const navigate = useNavigate()
  const { hasAnyPermission } = useSession()
  const [confirming, setConfirming] = useState<Confirming>(null)

  const canDecide = hasAnyPermission(["applications.decide"])
  const isLocked = decide.held !== null
  const { outcome } = decide

  useHeldDone(outcome, () => {
    void navigate("/applications", { replace: true })
  })

  const run = (decision: "approved" | "rejected"): void => {
    setConfirming(null)
    decide.submit({ outcome: decision })
  }

  const header = (
    <PageHeader
      title="Application"
      description="Everything the applicant submitted, the consents they accepted, and every email we sent them."
    />
  )

  if (isUnknownRecord(query.data, query.error)) {
    return (
      <Page width="wide">
        {header}
        <EmptyState
          title="This application was not found"
          description="No application has this address. It may have been mistyped, or the link may be out of date."
          action={
            <ButtonLink to="/applications" tone="secondary" size="sm">
              Back to applications
            </ButtonLink>
          }
        />
      </Page>
    )
  }

  return (
    <Page width="wide">
      {header}

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
            {outcome.kind === "unknown" ? (
              <HeldWriteNotice
                write={decide}
                subject={decide.held?.outcome === "rejected" ? "the application was rejected" : "the application was approved"}
                onReload={() => {
                  void query.refetch()
                }}
                reloadLabel="Reload the application"
              />
            ) : null}
            {outcome.kind === "rejected" ? (
              <Alert tone="error" title="Nothing changed">
                {outcome.message}
              </Alert>
            ) : null}

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
              {data.linkedUserId === null ? null : (
                <div className={ACTION_ROW}>
                  <ButtonLink to={`/users/${data.linkedUserId}`} tone="secondary" size="sm" trailing>
                    Open the client account
                  </ButtonLink>
                </div>
              )}
            </Card>

            {data.application.status === "submitted" ? (
              <Section
                title="Decide"
                description="Approving activates the account and emails the applicant a welcome with the app download. Rejecting emails them the rejection. Both are recorded in the audit log."
              >
                {canDecide ? (
                  <div className={ACTION_ROW}>
                    <Button
                      disabled={isLocked}
                      loading={decide.pending && decide.held?.outcome === "approved"}
                      onClick={() => {
                        setConfirming("approved")
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      tone="danger"
                      disabled={isLocked}
                      loading={decide.pending && decide.held?.outcome === "rejected"}
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
                <>
                  {data.deliveries.page.hasMore ? (
                    <p className={META_MUTED}>
                      {`Only the first ${String(data.deliveries.items.length)} emails are listed here. This application has more.`}
                    </p>
                  ) : null}
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
                </>
              )}
            </Section>

            <ConfirmDialog
              open={confirming === "approved"}
              title="Approve this application?"
              description="This creates the account, activates it, and emails the applicant. It cannot be undone from here."
              confirmLabel="Approve and notify"
              cancelLabel="Cancel"
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
              cancelLabel="Cancel"
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
