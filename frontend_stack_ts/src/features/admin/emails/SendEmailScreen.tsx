import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { useAdminUsers } from "~/features/admin/users/userDirectoryQueries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Combobox } from "~/ui/primitives/Combobox"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { TabPanel, Tabs, type TabItem } from "~/ui/primitives/Toggle"
import { ADMIN_EMAIL_PREVIEW, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import type { EmailPreview, QueuedEmail } from "./emailMessageQueries"
import { useChosenClient, useEmailPreview, useSendEmail, useSendTestEmail } from "./emailMessageQueries"
import type { EmailTemplateList } from "./emailTemplateQueries"
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

type ListRead<TData> = Readonly<{ data: TData | undefined; isPending: boolean; error: unknown }>

const hasFailed = <TData,>(read: ListRead<TData>): boolean =>
  read.data === undefined && read.error !== null && read.error !== undefined

type TemplatePicker = Readonly<{
  options: readonly Readonly<{ value: string; label: string }>[]
  isDisabled: boolean
  error?: string
  hint?: string
}>

const templatePicker = (templates: ListRead<EmailTemplateList>): TemplatePicker => {
  if (hasFailed(templates)) {
    return {
      options: [{ value: "", label: "Templates could not be loaded" }],
      isDisabled: true,
      error: "The template list could not be loaded.",
    }
  }
  if (templates.data === undefined) {
    return { options: [{ value: "", label: "Loading templates" }], isDisabled: true }
  }
  if (templates.data.items.length === 0) {
    return {
      options: [{ value: "", label: "No active templates" }],
      isDisabled: true,
      hint: "Create a template on the Templates screen first.",
    }
  }
  return {
    options: [
      { value: "", label: "Choose a template" },
      ...templates.data.items.map((template) => ({ value: template.templateId, label: template.name })),
    ],
    isDisabled: false,
  }
}

type Mode = "client" | "update"

const MODE_TABS_ID = "send-email-mode"

const MODES: readonly TabItem<Mode>[] = [
  { value: "client", label: "One client" },
  { value: "update", label: "App update to all clients" },
]

const CLIENT_HINT = "Search by name, email or phone."

type ClientNaming = Readonly<{ label: string | null; hint: string }>

type NamingSources = Readonly<{
  userId: string
  typed: boolean
  listedLabel: string | null
  chosen: Readonly<{ id: string; fullName: string; email: string }> | null
  chosenFailed: boolean
  recipient: Readonly<{ userId: string; fullName: string }> | null
}>

const clientNaming = ({ userId, typed, listedLabel, chosen, chosenFailed, recipient }: NamingSources): ClientNaming => {
  if (userId === "" || typed) return { label: null, hint: CLIENT_HINT }
  if (listedLabel !== null) return { label: listedLabel, hint: CLIENT_HINT }
  if (chosen !== null && chosen.id === userId) {
    return { label: chosen.fullName === "" ? chosen.email : chosen.fullName, hint: CLIENT_HINT }
  }
  if (recipient !== null && recipient.userId === userId) return { label: recipient.fullName, hint: CLIENT_HINT }
  return {
    label: null,
    hint: chosenFailed
      ? "The chosen client's name could not be read. Choose a template to see who it is, or search for the client."
      : "A client is chosen from their page. Choose a template to see who it is.",
  }
}

const OneClientMode = (): React.ReactElement => {
  const [searchParams] = useSearchParams()
  const { hasAnyPermission } = useSession()
  const [templateId, setTemplateId] = useState(searchParams.get("templateId") ?? "")
  const [userId, setUserId] = useState(searchParams.get("userId") ?? "")
  const [clientQuery, setClientQuery] = useState("")
  const templates = useEmailTemplates(false)
  const search = clientQuery.trim()
  const clients = useAdminUsers(
    search === "" ? { status: "active", segment: "clients" } : { status: "active", segment: "clients", q: search },
  )
  const preview = useEmailPreview(templateId, userId)
  const chosen = useChosenClient(clientQuery === "" ? userId : "", hasAnyPermission(["users.read"]))

  const picker = templatePicker(templates)
  const hasTemplatesFailed = hasFailed(templates)
  const hasClientsFailed = hasFailed(clients)
  const clientOptions = useMemo(
    () =>
      (clients.data?.items ?? []).map((user) => ({
        value: user.id,
        label: user.fullName === "" ? user.email : user.fullName,
        hint: user.email,
      })),
    [clients.data],
  )

  const naming = clientNaming({
    userId,
    typed: clientQuery !== "",
    listedLabel: clientOptions.find((option) => option.value === userId)?.label ?? null,
    chosen: chosen.data?.user ?? null,
    chosenFailed: chosen.error !== null,
    recipient: preview.data?.recipient ?? null,
  })

  return (
    <>
      <Card>
        <div className={ADMIN_FORM_GRID}>
          <FormField label="Template" required error={picker.error} hint={picker.hint}>
            {({ id }) => (
              <Select
                id={id}
                options={picker.options}
                disabled={picker.isDisabled}
                invalid={picker.error !== undefined}
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField
            label="Client"
            hint={naming.hint}
            error={hasClientsFailed ? "The client list could not be loaded." : undefined}
          >
            {({ id }) => (
              <Combobox
                id={id}
                options={clientOptions}
                value={userId}
                onChange={setUserId}
                query={naming.label ?? clientQuery}
                onQueryChange={setClientQuery}
                placeholder="Start typing a name"
                loading={clients.isFetching}
                invalid={hasClientsFailed}
                emptyLabel={hasClientsFailed ? "Clients could not be loaded" : "No active client matches that"}
              />
            )}
          </FormField>
        </div>
        {hasTemplatesFailed || hasClientsFailed ? (
          <Alert
            tone="error"
            title="Could not load the choices"
            action={
              <Button
                tone="secondary"
                size="sm"
                onClick={() => {
                  if (hasTemplatesFailed) void templates.refetch()
                  if (hasClientsFailed) clients.refetch()
                }}
              >
                Try again
              </Button>
            }
          >
            {hasTemplatesFailed && hasClientsFailed
              ? "Neither the templates nor the clients could be loaded."
              : hasTemplatesFailed
                ? "The templates could not be loaded."
                : "The clients could not be loaded."}{" "}
            Nothing has been sent.
          </Alert>
        ) : null}
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
