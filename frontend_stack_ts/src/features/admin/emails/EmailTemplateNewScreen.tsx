import { useNavigate } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { useCreateEmailTemplate, useEmailTemplates } from "./emailTemplateQueries"
import { TemplateContentForm } from "./TemplateContentForm"

const EMPTY = { name: "", description: "", subject: "", body: "Hello {{first_name}},\n\n" }

const EmailTemplateNewScreen = (): React.ReactElement => {
  const navigate = useNavigate()
  const templates = useEmailTemplates(false)
  const create = useCreateEmailTemplate()

  return (
    <Page width="wide">
      <PageHeader
        title="New email template"
        description="Write a message once and send it to one client at a time. Templates cannot contain links, codes or passwords."
      />
      <AsyncBoundary
        query={templates}
        skeleton={
          <Card>
            <Skeleton height="12rem" />
          </Card>
        }
      >
        {(data) => (
          <TemplateContentForm
            initial={EMPTY}
            placeholders={data.placeholders}
            locked={false}
            saveLabel="Create template"
            save={async (content, idempotencyKey) => {
              const created = await create.mutateAsync({ ...content, idempotencyKey })
              void navigate(`/emails/templates/${created.templateId}`, { replace: true })
            }}
          />
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default EmailTemplateNewScreen
