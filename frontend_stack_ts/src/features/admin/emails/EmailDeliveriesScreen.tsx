import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { emailDeliveryState } from "~/domain/status"
import { useAdminEmailDeliveries } from "~/features/admin/shared/adminQueries"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import styles from "~/features/admin/shared/Admin.module.css"

const STATES = [
  { value: "any", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "sending", label: "Sending" },
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "retryable_failed", label: "Retrying" },
  { value: "permanent_failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const

const TEMPLATES = [
  { value: "any", label: "Any template" },
  { value: "account_approved", label: "Account approved" },
  { value: "application_rejected", label: "Application rejected" },
] as const

const EmailDeliveriesScreen = (): React.ReactElement => {
  const [state, setState] = useState<string>("any")
  const [templateKey, setTemplateKey] = useState<string>("any")
  const query = useAdminEmailDeliveries({
    ...(state === "any" ? {} : { state }),
    ...(templateKey === "any" ? {} : { templateKey }),
  })
  const { hasAnyPermission } = useSession()
  const masked = !hasAnyPermission(["email_deliveries.read"])

  return (
    <Page width="wide">
      <PageHeader
        title="Emails"
        description="Every transactional email the platform has attempted, and what the mail provider said about it."
      />

      {masked ? (
        <Alert tone="info" title="Recipients are masked for your account">
          You hold the masked read permission, so addresses are partially hidden and the provider
          identifiers are withheld. This is deliberate, not a load failure.
        </Alert>
      ) : null}

      <FilterRow label="Delivery state">
        {STATES.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === state}
            label={option.label}
            onSelect={() => {
              setState(option.value)
            }}
          />
        ))}
      </FilterRow>

      <FilterRow label="Template">
        {TEMPLATES.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === templateKey}
            label={option.label}
            onSelect={() => {
              setTemplateKey(option.value)
            }}
          />
        ))}
      </FilterRow>

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No email matches"
            description="Clear the filters to see every delivery."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Email deliveries"
            rows={data.items}
            rowKey={(row) => row.emailDeliveryId}
            columns={[
              { key: "template", header: "Template", render: (row) => row.templateKey },
              { key: "recipient", header: "Recipient", render: (row) => row.recipientMasked },
              {
                key: "state",
                header: "State",
                render: (row) => <StatusBadge status={emailDeliveryState(row.state)} />,
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
                key: "provider",
                header: "Provider message",
                render: (row) => (
                  <span className={styles.code}>{row.sesMessageId ?? "withheld"}</span>
                ),
              },
              {
                key: "updated",
                header: "Updated",
                render: (row) => formatDateTime(row.updatedAt),
              },
            ]}
          />
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default EmailDeliveriesScreen
