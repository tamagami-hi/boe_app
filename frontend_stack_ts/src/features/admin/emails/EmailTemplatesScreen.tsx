import { useState } from "react"
import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Badge } from "~/ui/primitives/Badge"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { useEmailTemplates } from "./emailTemplateQueries"

const EmailTemplatesScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["email_templates.write"])
  const [includeArchived, setIncludeArchived] = useState(false)
  const templates = useEmailTemplates(includeArchived)

  return (
    <Page width="wide">
      <PageHeader
        title="Email templates"
        description="Messages admins can send to one client at a time. Password and verification emails are built into the app and are not listed here."
        actions={
          canWrite ? (
            <span className={ACTION_ROW}>
              <ButtonLink to="/emails/templates/new" tone="secondary" size="sm" trailing>
                New template
              </ButtonLink>
            </span>
          ) : null
        }
      />

      <FilterRow label="Show">
        <FilterChip
          active={!includeArchived}
          label="In use"
          onSelect={() => {
            setIncludeArchived(false)
          }}
        />
        <FilterChip
          active={includeArchived}
          label="Including archived"
          onSelect={() => {
            setIncludeArchived(true)
          }}
        />
      </FilterRow>

      <AsyncBoundary
        query={templates}
        skeleton={
          <Card>
            <Skeleton height="3rem" />
          </Card>
        }
      >
        {(data) => (
          <AdminTable
            caption="Email templates"
            rows={data.items}
            rowKey={(row) => row.templateId}
            columns={[
              {
                key: "name",
                header: "Template",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <Link className={ADMIN_CELL_LINK} to={`/emails/templates/${row.templateId}`}>
                      {row.name}
                    </Link>
                    <span className={META_TEXT}>{row.subject}</span>
                  </span>
                ),
              },
              {
                key: "kind",
                header: "Kind",
                render: (row) => (
                  <span className={ACTION_ROW}>
                    <Badge tone={row.preloaded ? "info" : "neutral"}>{row.preloaded ? "Preloaded" : "Custom"}</Badge>
                    {row.archivedAt === null ? null : <Badge tone="neutral">Archived</Badge>}
                  </span>
                ),
              },
              { key: "revision", header: "Revision", numeric: true, render: (row) => String(row.currentRevision) },
              { key: "updated", header: "Updated", render: (row) => formatDateTime(row.updatedAt) },
            ]}
          />
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default EmailTemplatesScreen
