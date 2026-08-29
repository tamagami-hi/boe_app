import { useEffect } from "react"
import { Link, useParams } from "react-router-dom"

import { ApiError, isApiError, isTransportError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { useToast } from "~/app/providers/ToastProvider"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { fundState } from "~/domain/status"
import {
  useAdminFund,
  usePublishFundVersion,
  useTransitionFundLifecycle,
} from "~/features/admin/shared/queries"
import {
  EMPTY_TERMS,
  FundTermsFields,
  SubmitRow,
  useFundTerms,
} from "~/features/admin/funds/FundTermsForm"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"

import { ADMIN_FIGURE } from "~/ui/recipes/admin"
import { LIST_LABEL, LIST_ROW, LIST_VALUE } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

const ALLOWED_TRANSITIONS = {
  draft: ["published", "archived"],
  published: ["paused", "archived"],
  paused: ["published", "archived"],
  archived: [],
} as const satisfies Readonly<Record<string, readonly ("published" | "paused" | "archived")[]>>

const TRANSITION_LABEL = {
  published: "Publish",
  paused: "Pause",
  archived: "Archive",
} as const

const failureMessage = (error: unknown): string => {
  if (isTransportError(error)) return "We could not reach the backend. Nothing was changed."
  if (!isApiError(error)) return "That did not work."
  if (error.code === "STATE_CONFLICT") {
    return "This fund changed while you were editing. It has been reloaded — review and try again."
  }
  if (error.code === "VALIDATION_FAILED") return error.message
  if (error.code === "AUTHORIZATION_DENIED") return "Your account cannot change this fund."
  return "That did not work."
}

const Row = ({
  label,
  children,
}: Readonly<{ label: string; children: React.ReactNode }>): React.ReactElement => (
  <div className={LIST_ROW}>
    <span className={LIST_LABEL}>{label}</span>
    <span className={LIST_VALUE}>{children}</span>
  </div>
)

const FundWorkspaceScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const query = useAdminFund(fundId)
  const publish = usePublishFundVersion(fundId)
  const lifecycle = useTransitionFundLifecycle(fundId)
  const toast = useToast()
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["funds.write"])
  const [terms, setTerms] = useFundTerms(EMPTY_TERMS)

  const fund = query.data?.fund

  useEffect(() => {
    if (fund === undefined) return
    setTerms({
      name: fund.name ?? "",
      category: fund.category ?? "",
      objective: fund.objective ?? "",
      riskLevel: fund.riskLevel ?? "moderate",
      returnTier: fund.returnTier ?? "moderate",
      minimumSipPaise: Number(fund.minimumSipPaise ?? "0"),
      minimumPurchasePaise: Number(fund.minimumPurchasePaise ?? "0"),
      minimumDurationMonths: null,
      recommendedHoldingMonths: null,
      disclosure: { title: "", body: "" },
    })
  }, [fund, setTerms])

  const fields = publish.error instanceof ApiError ? publish.error.fields : null

  return (
    <AsyncBoundary
      query={query}
      skeleton={
        <Page width="wide">
          <Card>
            <Skeleton height="1.4rem" width="50%" />
            <Skeleton height="1rem" width="30%" />
          </Card>
        </Page>
      }
    >
      {(data) => (
        <Page width="wide">
          <PageHeader
            eyebrow={data.fund.slug}
            title={data.fund.name ?? "Unnamed draft"}
            actions={<StatusBadge status={fundState(data.fund.status)} />}
          />

          {publish.error === null ? null : (
            <Alert tone="error" title="Not published">
              {failureMessage(publish.error)}
            </Alert>
          )}
          {lifecycle.error === null ? null : (
            <Alert tone="error" title="State unchanged">
              {failureMessage(lifecycle.error)}
            </Alert>
          )}

          <Card>
            <Section title="Current state">
              <Row label="Status">{fundState(data.fund.status).label}</Row>
              <Row label="Visible to investors">
                {data.fund.status === "published" ? "Yes" : "No"}
              </Row>
              <Row label="Published version">
                {data.fund.currentVersion === null
                  ? "None — investors cannot see this fund"
                  : String(data.fund.currentVersion)}
              </Row>
              <Row label="Fund size">
                {data.fund.aum === null ? (
                  "Not set"
                ) : (
                  <MoneyValue amount={toPaise(data.fund.aum.aumPaise)} size="sm" />
                )}
              </Row>
              <Row label="Versions">{String(data.versions.length)}</Row>
              <Row label="Last updated">{formatDateTime(data.fund.updatedAt)}</Row>
              <Row label="Concurrency version">
                <span className={ADMIN_FIGURE}>{String(data.fund.version)}</span>
              </Row>
            </Section>

            <div className={ACTION_ROW}>
              <Link to={`/funds/${fundId}/aum`}>
                <Button tone="secondary" size="sm">
                  Manage AUM
                </Button>
              </Link>
              {canWrite
                ? ALLOWED_TRANSITIONS[data.fund.status].map((status) => (
                    <Button
                      key={status}
                      tone={status === "archived" ? "danger" : "secondary"}
                      size="sm"
                      loading={lifecycle.isPending}
                      disabled={status === "published" && data.fund.currentVersion === null}
                      onClick={() => {
                        lifecycle.mutate(
                          { status, version: data.fund.version },
                          {
                            onSuccess: () => {
                              toast.show(`Fund ${status}.`)
                            },
                          },
                        )
                      }}
                    >
                      {TRANSITION_LABEL[status]}
                    </Button>
                  ))
                : null}
            </div>
          </Card>

          {canWrite ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                publish.mutate(terms, {
                  onSuccess: () => {
                    toast.show("New version published.")
                  },
                })
              }}
              noValidate
              className={STACK_LG}
            >
              <Card>
                <Section
                  title="Publish new terms"
                  description="Publishing writes a new immutable version with its disclosure. Earlier versions are kept."
                >
                  <FundTermsFields terms={terms} fields={fields} setTerms={setTerms} />
                </Section>
              </Card>
              <SubmitRow label="Publish version" pending={publish.isPending} />
            </form>
          ) : (
            <Alert tone="info" title="Read only">
              Changing fund terms needs the funds.write permission.
            </Alert>
          )}
        </Page>
      )}
    </AsyncBoundary>
  )
}

export default FundWorkspaceScreen
