import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useAdminUsers } from "~/features/admin/shared/adminQueries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { Card } from "~/ui/primitives/Card"
import { Combobox } from "~/ui/primitives/Combobox"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { TabPanel, Tabs, type TabItem } from "~/ui/primitives/Toggle"
import { ADMIN_EMAIL_PREVIEW, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import type { EmailPreview, QueuedEmail } from "./emailMessageQueries"
import { useEmailPreview, useSendEmail, useSendTestEmail } from "./emailMessageQueries"
import { useEmailTemplates } from "./emailTemplateQueries"
import { AppUpdateAnnouncementPanel } from "./AppUpdateAnnouncementPanel"
import { SendAction, type SendReceipt } from "./SendAction"

const BLOCK_MESSAGES: Readonly<Record<string, string>> = {
  not_client: "This account is not a client account. Messages from this screen go only to clients.",
  inactive: "This client account is not active, so it cannot be sent a message.",
  suppressed: "Mail to this client's address is blocked after a bounce or complaint.",
}

const receiptOf = (queued: QueuedEmail): SendReceipt => ({
  title: queued.test ? "Test queued" : "Email queued",
  detail: `Queued for ${queued.recipient}. The delivery log shows when it is sent, or why it was not.`,
})

const PreviewPanel = ({ preview }: Readonly<{ preview: EmailPreview }>): React.ReactElement => (
  <Section
    title="Preview"
    description={
      preview.sample
        ? "Shown with the sample name Asha Verma. Choose a client to see their name."
        : "Shown exactly as this client will receive it."
    }
  >
    <div className={STACK_LG}>
      <DataList>
        <DetailRow label="Subject">{preview.subject}</DetailRow>
        <DetailRow label="Template version">{String(preview.revision)}</DetailRow>
        {preview.recipient === null ? null : <DetailRow label="To">{preview.recipient.maskedEmail}</DetailRow>}
      </DataList>
      <iframe title="Email preview" sandbox="" srcDoc={preview.html} className={ADMIN_EMAIL_PREVIEW} />
    </div>
  </Section>
)

const SendPanel = ({ preview }: Readonly<{ preview: EmailPreview }>): React.ReactElement => {
  const sendEmail = useSendEmail()
  const sendTest = useSendTestEmail()
  const recipient = preview.recipient
  const blocked = recipient?.block ?? null
  const waitUntil = recipient?.nextSendAllowedAt ?? null
  const testRequest = { templateId: preview.templateId, revision: preview.revision }

  return (
    <Section title="Send" description="Opening this screen and previewing never sends anything. Each send asks you to confirm first.">
      <div className={STACK_LG}>
        <SendAction
          label="Send a test to me"
          tone="secondary"
          disabled={false}
          confirmTitle="Send a test to your own address?"
          confirmLabel="Send the test"
          confirmBody={
            <Prose>
              The test goes only to the address on your admin account. Its subject starts with [Test], it says it was
              not sent to a client, and it uses the sample name Asha Verma.
            </Prose>
          }
          request={{ kind: "test", ...testRequest }}
          send={async (idempotencyKey) => receiptOf(await sendTest.mutateAsync({ ...testRequest, idempotencyKey }))}
        />

        {recipient === null ? (
          <Prose>Choose a client to send this message to them.</Prose>
        ) : (
          <>
            {blocked === null ? null : (
              <Alert tone="warning" title="Cannot send to this client">
                {BLOCK_MESSAGES[blocked] ?? "This client cannot be sent a message."}
              </Alert>
            )}
            {waitUntil === null ? null : (
              <Alert tone="info" title="Sent a moment ago">
                This client was sent a message a moment ago. Wait a minute before sending another.
              </Alert>
            )}
            <SendAction
              label="Send to client"
              disabled={blocked !== null || waitUntil !== null}
              confirmTitle={`Send this email to ${recipient.fullName}?`}
              confirmLabel="Send the email"
              confirmBody={
                <DataList>
                  <DetailRow label="To">{`${recipient.fullName} (${recipient.maskedEmail})`}</DetailRow>
                  <DetailRow label="Subject">{preview.subject}</DetailRow>
                  <DetailRow label="Template">{`${preview.templateName}, version ${String(preview.revision)}`}</DetailRow>
                </DataList>
              }
              request={{
                kind: "client",
                ...testRequest,
                userId: recipient.userId,
                expectedEmailRevision: recipient.emailRevision,
              }}
              send={async (idempotencyKey) =>
                receiptOf(
                  await sendEmail.mutateAsync({
                    ...testRequest,
                    userId: recipient.userId,
                    expectedEmailRevision: recipient.emailRevision,
                    idempotencyKey,
                  }),
                )
              }
            />
          </>
        )}
      </div>
    </Section>
  )
}

type Mode = "client" | "update"

const MODE_TABS_ID = "send-email-mode"

const MODES: readonly TabItem<Mode>[] = [
  { value: "client", label: "One client" },
  { value: "update", label: "App update to all clients" },
]

const OneClientMode = (): React.ReactElement => {
  const [searchParams] = useSearchParams()
  const [templateId, setTemplateId] = useState(searchParams.get("templateId") ?? "")
  const [userId, setUserId] = useState(searchParams.get("userId") ?? "")
  const [clientQuery, setClientQuery] = useState("")
  const templates = useEmailTemplates(false)
  const clients = useAdminUsers(clientQuery.trim() === "" ? { status: "active" } : { status: "active", q: clientQuery.trim() })
  const preview = useEmailPreview(templateId, userId)

  const templateOptions = [
    { value: "", label: "Choose a template" },
    ...(templates.data?.items ?? []).map((template) => ({ value: template.templateId, label: template.name })),
  ]
  const clientOptions = useMemo(
    () =>
      (clients.data?.items ?? []).map((user) => ({
        value: user.id,
        label: user.fullName === "" ? user.email : user.fullName,
        hint: user.email,
      })),
    [clients.data],
  )

  return (
    <>
      <Card>
        <div className={ADMIN_FORM_GRID}>
          <FormField label="Template" required>
            {({ id }) => (
              <Select
                id={id}
                options={templateOptions}
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField label="Client" hint="Search by name, email or phone.">
            {({ id }) => (
              <Combobox
                id={id}
                options={clientOptions}
                value={userId}
                onChange={setUserId}
                query={clientQuery}
                onQueryChange={setClientQuery}
                placeholder="Start typing a name"
                loading={clients.isFetching}
                emptyLabel="No active client matches that"
              />
            )}
          </FormField>
        </div>
      </Card>

      {templateId === "" ? null : (
        <AsyncBoundary
          query={preview}
          skeleton={
            <Card>
              <Skeleton height="20rem" />
            </Card>
          }
        >
          {(data) => (
            <>
              <PreviewPanel preview={data} />
              <SendPanel key={`${data.templateId}:${String(data.revision)}:${data.recipient?.userId ?? ""}`} preview={data} />
            </>
          )}
        </AsyncBoundary>
      )}
    </>
  )
}

const SendEmailScreen = (): React.ReactElement => {
  const [mode, setMode] = useState<Mode>("client")

  return (
    <Page width="wide">
      <PageHeader
        title="Send an email"
        description="Send one template to one client, or announce a new app version to every active client. Each send asks you to confirm first."
      />
      <Tabs id={MODE_TABS_ID} label="What to send" value={mode} items={MODES} onChange={setMode} />
      <TabPanel id={MODE_TABS_ID} value={mode}>
        <div className={STACK_LG}>{mode === "client" ? <OneClientMode /> : <AppUpdateAnnouncementPanel />}</div>
      </TabPanel>
    </Page>
  )
}

export default SendEmailScreen
