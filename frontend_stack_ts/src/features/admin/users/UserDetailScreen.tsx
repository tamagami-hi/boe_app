import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatDateTime, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { emailVerificationState, orderState, userAccountState } from "~/domain/status"
import { PortfolioSummarySection } from "~/features/admin/client-returns/PortfolioSummarySection"
import { EarlierInvestmentForm, type RecordingHold } from "~/features/admin/client-values/EarlierInvestmentForm"
import { monthlyPrefillOf, type RecordingPrefill } from "~/features/admin/client-values/recordingPrefill"
import type { AdminSipScheduleItem } from "~/features/admin/client-values/sipScheduleQueries"
import { ClientMaturitySection } from "~/features/admin/maturities/ClientMaturitySection"
import { useAdminUser } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { ENTRY_TEXT, PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

import { META_TEXT } from "~/ui/recipes/text"

import { ClientContactsSection } from "./ClientContactsSection"
import { ClientHubActions } from "./ClientHubActions"
import { ClientHubTabs } from "./ClientHubTabs"
import { ClientNomineeSection } from "./ClientNomineeSection"
import { PasswordLinkPanel } from "./PasswordLinkPanel"
import { SipScheduleSection } from "./SipScheduleSection"
import { UserLifecyclePanel } from "./UserLifecyclePanel"

const ORDER_TYPE_LABEL = {
  lump_sum: "One-off investment",
  sip_installment: "SIP instalment",
  recorded_offline: "Recorded investment",
} as const

const labelOf = (user: Readonly<{ fullName: string; email: string }>): string =>
  user.fullName === "" ? user.email : user.fullName

const UserDetailScreen = (): React.ReactElement => {
  const { userId = "" } = useParams()
  const query = useAdminUser(userId)
  const { hasAnyPermission } = useSession()

  const canRecordInvestment = hasAnyPermission(["client_position.write"])
  const [isRecording, setRecording] = useState(false)
  const [prefill, setPrefill] = useState<Readonly<{ id: number; values: RecordingPrefill }> | null>(null)
  const [recordHold, setRecordHold] = useState<RecordingHold>("none")
  const recordingForm = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prefill !== null) recordingForm.current?.scrollIntoView({ block: "start" })
  }, [prefill])

  const canRecordFor = (accountState: string): boolean =>
    canRecordInvestment && (accountState === "active" || accountState === "suspended")

  const reloadUser = async (): Promise<boolean> => (await query.refetch()).isSuccess

  const recordMonth = (schedule: AdminSipScheduleItem): void => {
    setPrefill((current) => ({ id: (current?.id ?? 0) + 1, values: monthlyPrefillOf(schedule, indiaToday()) }))
    setRecording(true)
  }

  return (
    <Page width="wide">
      <PageHeader
        title="User"
        description="One page for this account: who it is, what it holds, what to do next and what has happened to it."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1.2rem" width="45%" />
            <Skeleton height="3rem" />
          </Card>
        }
        fallback={
          <Alert
            tone="info"
            title="No account matches this link"
            action={
              <ButtonLink to="/users" tone="secondary" size="sm">
                Open users
              </ButtonLink>
            }
          >
            The link names an account that does not exist. Find the client in the users list.
          </Alert>
        }
      >
        {(data) => (
          <>
            <Card elevated>
              <DataList split>
                <DetailRow label="Name">{data.user.fullName}</DetailRow>
                <DetailRow label="Email">{data.user.email}</DetailRow>
                <DetailRow label="Phone">{data.user.phone}</DetailRow>
                <DetailRow label="Account">
                  <StatusBadge
                    status={userAccountState(data.user.accountState)}
                  />
                </DetailRow>
                <DetailRow label="Email verification">
                  {data.user.emailVerificationStatus === null ? (
                    "—"
                  ) : (
                    <StatusBadge
                      status={emailVerificationState(
                        data.user.emailVerificationStatus,
                      )}
                    />
                  )}
                </DetailRow>
                <DetailRow label="Roles">
                  {data.roles.length === 0 ? "Investor" : data.roles.join(", ")}
                </DetailRow>
                <DetailRow label="Orders">{String(data.user.ordersCount)}</DetailRow>
                <DetailRow label="Joined">{formatDate(data.user.createdAt)}</DetailRow>
                {data.user.suspendedAt === null ? null : (
                  <DetailRow label="Suspended">
                    {formatDateTime(data.user.suspendedAt)}
                  </DetailRow>
                )}
                {data.user.closedAt === null ? null : (
                  <DetailRow label="Closed">{formatDateTime(data.user.closedAt)}</DetailRow>
                )}
                <DetailRow label="Version">{String(data.user.version)}</DetailRow>
              </DataList>

              <div className={ACTION_ROW}>
                <ButtonLink to={`/users/${userId}/login-events`} tone="secondary" size="sm" trailing>
                  Sign-in history
                </ButtonLink>
              </div>
            </Card>

            {data.roles.length === 0 ? (
              <Section
                title="Invite and password link"
                description="Whether this client has a password, the latest invite or reset link, and whether its email went out. A new link replaces every earlier one."
              >
                <PasswordLinkPanel
                  userId={userId}
                  email={data.user.email}
                  canReceive={data.user.accountState === "active"}
                />
              </Section>
            ) : null}

            {data.roles.length === 0 ? <PortfolioSummarySection userId={userId} /> : null}

            {data.roles.length === 0 ? (
              <ClientHubActions
                userId={userId}
                canRecord={canRecordFor(data.user.accountState)}
                isRecording={isRecording}
                canClose={recordHold !== "unsaved"}
                onToggleRecord={() => {
                  setRecording((open) => !open)
                  setPrefill(null)
                }}
              />
            ) : null}

            {data.roles.length === 0 && isRecording && canRecordFor(data.user.accountState) ? (
              <Section
                title="Record an investment"
                description="Records an earlier investment, a monthly investment or a correction, one fund at a time. It is not a charge and not growth."
              >
                <div ref={recordingForm}>
                  <EarlierInvestmentForm
                    key={`${userId}:${prefill === null ? "blank" : `prefill-${String(prefill.id)}`}`}
                    userId={userId}
                    investorLabel={labelOf(data.user)}
                    {...(prefill === null ? {} : { prefill: prefill.values })}
                    onHoldChange={setRecordHold}
                  />
                </div>
              </Section>
            ) : null}

            {data.roles.length === 0 ? (
              <SipScheduleSection
                userId={userId}
                investorLabel={labelOf(data.user)}
                canStart={canRecordFor(data.user.accountState)}
                onRecordMonth={recordMonth}
                isRecordBlocked={recordHold !== "none"}
              />
            ) : null}

            {data.roles.length === 0 ? (
              <ClientMaturitySection userId={userId} canSet={canRecordFor(data.user.accountState)} />
            ) : null}

            <ClientHubTabs userId={userId} investorLabel={labelOf(data.user)} isClient={data.roles.length === 0} />

            {data.roles.length === 0 ? (
              <ClientContactsSection user={data.user} reloading={query.isFetching} onReload={reloadUser} />
            ) : null}

            {data.roles.length === 0 ? (
              <ClientNomineeSection userId={userId} accountState={data.user.accountState} />
            ) : null}

            <UserLifecyclePanel
              userId={userId}
              accountState={data.user.accountState}
              reloading={query.isFetching}
              onReload={reloadUser}
            />

            <Section
              title="Recent orders"
              description="The ten most recent orders on this account."
            >
              {data.orders.length === 0 ? (
                <Card>
                  <p className={PROSE_SM}>This account has never placed an order.</p>
                </Card>
              ) : (
                <AdminTable
                  caption="Recent orders"
                  rows={data.orders}
                  rowKey={(row) => row.id}
                  columns={[
                    {
                      key: "fund",
                      header: "Fund",
                      render: (row) => (
                        <span className={ENTRY_TEXT}>
                          <span>{row.fundName ?? row.fundSlug}</span>
                          <span className={META_TEXT}>{ORDER_TYPE_LABEL[row.type]}</span>
                        </span>
                      ),
                    },
                    {
                      key: "amount",
                      header: "Amount",
                      numeric: true,
                      render: (row) => <MoneyValue amount={toPaise(row.amountPaise)} size="sm" />,
                    },
                    {
                      key: "status",
                      header: "State",
                      render: (row) => (
                        <StatusBadge status={orderState(row.status)} />
                      ),
                    },
                    {
                      key: "requested",
                      header: "Requested",
                      render: (row) => formatDateTime(row.requestedAt),
                    },
                    {
                      key: "failure",
                      header: "Failure",
                      render: (row) => row.failureCode ?? "—",
                    },
                  ]}
                />
              )}
            </Section>

          </>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default UserDetailScreen
