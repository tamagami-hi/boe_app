import { useState } from "react"
import { Link, useParams } from "react-router-dom"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { emailVerificationState, orderState, userAccountState } from "~/domain/status"
import { useAdminUser, useUserLifecycle } from "~/features/admin/shared/adminQueries"
import type { UserLifecycle } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import styles from "~/features/admin/shared/Admin.module.css"

const COPY: Readonly<Record<UserLifecycle, Readonly<{ title: string; description: string }>>> = {
  suspend: {
    title: "Suspend this account?",
    description:
      "Every session is revoked immediately and the investor cannot sign in or invest. Their money and values are untouched. You can reinstate them.",
  },
  reinstate: {
    title: "Reinstate this account?",
    description: "The investor can sign in and invest again. Existing sessions stay revoked.",
  },
  close: {
    title: "Close this account?",
    description:
      "Every session is revoked and the account cannot be reopened from here. Their money and values are untouched, and their statements remain.",
  },
}

const UserDetailScreen = (): React.ReactElement => {
  const { userId = "" } = useParams()
  const query = useAdminUser(userId)
  const lifecycle = useUserLifecycle(userId)
  const { hasAnyPermission } = useSession()
  const [pending, setPending] = useState<UserLifecycle | null>(null)
  const [reason, setReason] = useState("")
  const [failure, setFailure] = useState<string | null>(null)

  const canSuspend = hasAnyPermission(["users.suspend"])
  const canClose = hasAnyPermission(["users.close"])

  const run = (action: UserLifecycle): void => {
    setFailure(null)
    lifecycle.mutate(
      { action, reasonCode: `admin_${action}`, ...(reason.trim() === "" ? {} : { reason: reason.trim() }) },
      {
        onError: (error) => {
          setFailure(
            isApiError(error)
              ? error.message
              : "We could not apply that change. Nothing has changed.",
          )
        },
        onSuccess: () => {
          setReason("")
        },
        onSettled: () => {
          setPending(null)
        },
      },
    )
  }

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
            {failure === null ? null : (
              <Alert tone="error" title="Nothing changed">
                {failure}
              </Alert>
            )}

            <Card elevated>
              <DataList>
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

              <div className={styles.actions}>
                <Link to={`/users/${userId}/login-events`} className={styles.rowLink}>
                  <Button tone="secondary" size="sm" trailing>
                    Sign-in history
                  </Button>
                </Link>
              </div>
            </Card>

            <Section
              title="Account lifecycle"
              description="Suspending or closing an account revokes every session on it immediately."
            >
              <Card>
                <FormField
                  label="Reason"
                  hint="Recorded in the audit log. Not shown to the investor."
                >
                  {({ id }) => (
                    <Input
                      id={id}
                      value={reason}
                      maxLength={2_000}
                      onChange={(event) => {
                        setReason(event.target.value)
                      }}
                    />
                  )}
                </FormField>

                <div className={styles.actions}>
                  {data.user.accountState === "active" && canSuspend ? (
                    <Button
                      tone="danger"
                      disabled={lifecycle.isPending}
                      onClick={() => {
                        setPending("suspend")
                      }}
                    >
                      Suspend
                    </Button>
                  ) : null}
                  {data.user.accountState === "suspended" && canSuspend ? (
                    <Button
                      disabled={lifecycle.isPending}
                      onClick={() => {
                        setPending("reinstate")
                      }}
                    >
                      Reinstate
                    </Button>
                  ) : null}
                  {data.user.accountState !== "closed" && canClose ? (
                    <Button
                      tone="danger"
                      disabled={lifecycle.isPending}
                      onClick={() => {
                        setPending("close")
                      }}
                    >
                      Close
                    </Button>
                  ) : null}
                </div>

                {!canSuspend && !canClose ? (
                  <p className={styles.note}>
                    Changing an account state needs the users.suspend or users.close permission.
                  </p>
                ) : null}
              </Card>
            </Section>

            <Section
              title="Recent orders"
              description="The ten most recent orders on this account."
            >
              {data.orders.length === 0 ? (
                <Card>
                  <p className={styles.note}>This account has never placed an order.</p>
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
                        <span className={styles.cellStack}>
                          <span>{row.fundName ?? row.fundSlug}</span>
                          <span className={styles.faint}>{row.type}</span>
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

            {pending === null ? null : (
              <ConfirmDialog
                open
                title={COPY[pending].title}
                description={COPY[pending].description}
                confirmLabel={pending === "reinstate" ? "Reinstate" : "Confirm"}
                confirmTone={pending === "reinstate" ? "primary" : "danger"}
                pending={lifecycle.isPending}
                onConfirm={() => {
                  run(pending)
                }}
                onCancel={() => {
                  setPending(null)
                }}
              />
            )}
          </>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default UserDetailScreen
