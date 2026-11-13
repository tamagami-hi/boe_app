import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { emailVerificationState, orderState, userAccountState } from "~/domain/status"
import { EarlierInvestmentForm } from "~/features/admin/client-values/EarlierInvestmentForm"
import { useAdminUser } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ENTRY_TEXT, PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

import { META_TEXT } from "~/ui/recipes/text"

import { PasswordLinkPanel } from "./PasswordLinkPanel"
import { UserLifecyclePanel } from "./UserLifecyclePanel"

const ORDER_TYPE_LABEL = {
  lump_sum: "One-off investment",
  sip_installment: "SIP instalment",
  recorded_offline: "Recorded earlier investment",
} as const

const UserDetailScreen = (): React.ReactElement => {
  const { userId = "" } = useParams()
  const query = useAdminUser(userId)
  const { hasAnyPermission } = useSession()

  const canRecordInvestment = hasAnyPermission(["client_position.write"])

  const reloadUser = async (): Promise<boolean> => (await query.refetch()).isSuccess

  return (
    <Page width="wide">
      <PageHeader
        title="User"
        description="The account, its verification state, its roles and its most recent orders."
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
                title="Password link"
                description="Whether this client has a password, the latest set or reset link, and whether its email went out."
              >
                <PasswordLinkPanel
                  userId={userId}
                  email={data.user.email}
                  canReceive={data.user.accountState === "active"}
                />
              </Section>
            ) : null}

            {data.roles.length === 0 &&
            canRecordInvestment &&
            (data.user.accountState === "active" || data.user.accountState === "suspended") ? (
              <Section
                title="Record an earlier investment"
                description="Records money this client invested before using BeOnEdge, one fund at a time. It is not a charge and not growth."
              >
                <EarlierInvestmentForm
                  userId={userId}
                  investorLabel={data.user.fullName === "" ? data.user.email : data.user.fullName}
                />
              </Section>
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
