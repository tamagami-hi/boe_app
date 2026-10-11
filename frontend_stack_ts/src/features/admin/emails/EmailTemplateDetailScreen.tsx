import { useState } from "react"
import { useParams } from "react-router-dom"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Disclosure, Prose } from "~/ui/patterns/DataList"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import type { EmailTemplateDetail } from "./emailTemplateQueries"
import { useEmailTemplate, useReviseEmailTemplate, useSetTemplateArchived } from "./emailTemplateQueries"
import { TemplateContentForm } from "./TemplateContentForm"

const archiveFailure = (error: unknown): string => {
  if (isUnknownWriteOutcome(error)) {
    return "The reply did not arrive, so it is not known whether this changed. Reload the page to see the current state."
  }
  return isApiError(error) ? error.message : "This could not be changed. Reload the page and try again."
}

const ArchivePanel = ({ template }: Readonly<{ template: EmailTemplateDetail }>): React.ReactElement => {
  const archived = template.archivedAt !== null
  const change = useSetTemplateArchived(template.templateId)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const idempotencyKey = useIdempotencyKey({ templateId: template.templateId, archived: !archived, version: template.version })

  const run = (): void => {
    setFailure(null)
    change.mutate(
      { archived: !archived, expectedVersion: template.version, idempotencyKey },
      {
        onError: (error) => {
          setFailure(archiveFailure(error))
        },
        onSettled: () => {
          setConfirming(false)
        },
      },
    )
  }

  return (
    <Section
      title={archived ? "Archived" : "Archive"}
      description={
        archived
          ? "This template is hidden from the send screen and cannot be edited. Restore it to use it again."
          : "Archiving hides this template from the send screen. Emails already sent are not affected."
      }
    >
      <div className={STACK_LG}>
        {failure === null ? null : (
          <Alert tone="error" title="Not changed">
            {failure}
          </Alert>
        )}
        <span className={ACTION_ROW}>
          <Button
            tone="secondary"
            loading={change.isPending}
            onClick={() => {
              setConfirming(true)
            }}
          >
            {archived ? "Restore template" : "Archive template"}
          </Button>
        </span>
      </div>
      <ConfirmDialog
        open={confirming}
        title={archived ? "Restore this template?" : "Archive this template?"}
        confirmLabel={archived ? "Restore" : "Archive"}
        confirmTone={archived ? "primary" : "danger"}
        pending={change.isPending}
        onConfirm={run}
        onCancel={() => {
          setConfirming(false)
        }}
      />
    </Section>
  )
}

const RevisionHistory = ({ template }: Readonly<{ template: EmailTemplateDetail }>): React.ReactElement => (
  <Section title="Earlier versions" description="Each save adds a version. Versions are never changed or removed.">
    <Card>
      {template.revisions.map((revision) => (
        <Disclosure
          key={revision.revision}
          title={`Version ${String(revision.revision)} · ${formatDateTime(revision.createdAt)} · ${revision.subject}`}
        >
          <Prose>{revision.body}</Prose>
        </Disclosure>
      ))}
    </Card>
  </Section>
)

const TemplateWorkspace = ({ template }: Readonly<{ template: EmailTemplateDetail }>): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["email_templates.write"])
  const canSend = hasAnyPermission(["email_messages.send"])
  const revise = useReviseEmailTemplate(template.templateId)
  const [formKey, setFormKey] = useState(0)
  const [baseVersion, setBaseVersion] = useState(template.version)
  const archived = template.archivedAt !== null

  return (
    <>
      <span className={ACTION_ROW}>
        <Badge tone={template.preloaded ? "info" : "neutral"}>{template.preloaded ? "Preloaded" : "Custom"}</Badge>
        <Badge tone="neutral">{`Version ${String(template.currentRevision)}`}</Badge>
        {archived ? <Badge tone="neutral">Archived</Badge> : null}
      </span>

      {canSend && !archived ? (
        <span className={ACTION_ROW}>
          <ButtonLink to={`/emails/send?templateId=${template.templateId}`} tone="secondary" size="sm" trailing>
            Send this template
          </ButtonLink>
        </span>
      ) : null}

      {canWrite ? null : (
        <Alert tone="info" title="Read only">
          Editing templates needs the email_templates.write permission.
        </Alert>
      )}

      <TemplateContentForm
        key={formKey}
        initial={{ name: template.name, description: template.description, subject: template.subject, body: template.body }}
        placeholders={template.placeholders}
        locked={!canWrite || archived}
        saveLabel="Save as a new version"
        save={async (content, idempotencyKey) => {
          const saved = await revise.mutateAsync({ ...content, expectedVersion: baseVersion, idempotencyKey })
          setBaseVersion(saved.version)
        }}
        onReload={() => {
          setBaseVersion(template.version)
          setFormKey((current) => current + 1)
        }}
      />

      {canWrite ? <ArchivePanel template={template} /> : null}
      <RevisionHistory template={template} />
    </>
  )
}

const EmailTemplateDetailScreen = (): React.ReactElement => {
  const { templateId = "" } = useParams()
  const query = useEmailTemplate(templateId)

  return (
    <Page width="wide">
      <PageHeader
        title={query.data?.name ?? "Email template"}
        {...(query.data === undefined || query.data.description === "" ? {} : { description: query.data.description })}
      />
      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="12rem" />
          </Card>
        }
      >
        {(template) => <TemplateWorkspace key={template.templateId} template={template} />}
      </AsyncBoundary>
    </Page>
  )
}

export default EmailTemplateDetailScreen
