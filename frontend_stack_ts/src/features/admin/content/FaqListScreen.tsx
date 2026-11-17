import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { useHeldDone } from "~/features/admin/funds/useHeldDone"
import { useAdminFaqs } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import type { HeldWrite } from "~/features/admin/shared/useHeldWrite"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Textarea } from "~/ui/primitives/Textarea"

import { ADMIN_CODE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ENTRY_TEXT, PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { useArchiveFaq, useCreateFaq, useEditFaq, useSetFaqStatus } from "./faqQueries"
import type { FaqFields } from "./faqQueries"

const STATUS_TONE = {
  draft: "warning",
  published: "positive",
  archived: "neutral",
} as const

const EMPTY: FaqFields = { question: "", answer: "", category: "general", order: 0 }

const UNSENT = "The change could not be sent. Reload the page and try again."

type AnyHeldWrite = Pick<HeldWrite<never, unknown>, "outcome" | "pending" | "checkAgain">

type HeldEntry = Readonly<{ id: string; write: AnyHeldWrite; subject: string; failure: string }>

const rejectionText = (outcome: AnyHeldWrite["outcome"], conflict: string): string | null => {
  if (outcome.kind !== "rejected") return null
  return outcome.code === "STATE_CONFLICT" ? conflict : outcome.message
}

const FaqListScreen = (): React.ReactElement => {
  const query = useAdminFaqs()
  const create = useHeldWrite(useCreateFaq(), UNSENT)
  const edit = useHeldWrite(useEditFaq(), UNSENT)
  const setStatus = useHeldWrite(useSetFaqStatus(), UNSENT)
  const archive = useHeldWrite(useArchiveFaq(), UNSENT)
  const { hasAnyPermission } = useSession()

  const [draft, setDraft] = useState<FaqFields>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)

  const canPublish = hasAnyPermission(["content.publish"])
  const incomplete = draft.question.trim() === "" || draft.answer.trim() === ""
  const isLocked = create.held !== null || edit.held !== null || setStatus.held !== null || archive.held !== null
  const isSaving = create.pending || edit.pending

  const clearDraft = (): void => {
    setDraft(EMPTY)
    setEditing(null)
  }
  useHeldDone(create.outcome, clearDraft)
  useHeldDone(edit.outcome, clearDraft)

  const held: readonly HeldEntry[] = [
    { id: "create", write: create, subject: "the answer was saved as a draft", failure: "The answer was not saved." },
    { id: "edit", write: edit, subject: "the draft was saved", failure: "Only a draft can be edited. Move it back to draft first, or create a new version." },
    {
      id: "status",
      write: setStatus,
      subject: setStatus.held?.status === "draft" ? "the answer was moved back to draft" : "the answer was published",
      failure: "This answer changed after the page loaded. Reload the FAQs and try again.",
    },
    { id: "archive", write: archive, subject: "the answer was archived", failure: "This answer changed after the page loaded. Reload the FAQs and try again." },
  ]

  const submit = (): void => {
    if (isLocked) return
    const payload = {
      question: draft.question.trim(),
      answer: draft.answer.trim(),
      category: draft.category.trim() === "" ? "general" : draft.category.trim(),
      order: draft.order,
    }
    if (editing === null) {
      create.submit(payload)
      return
    }
    edit.submit({ faqId: editing, ...payload })
  }

  const changeStatus = (faqId: string, status: "published" | "draft"): void => {
    setStatus.submit({ faqId, status })
  }

  return (
    <Page width="wide">
      <PageHeader
        title="FAQs"
        description="Published answers appear in the investor app's support screen. Only one version of a key is published at a time; publishing a new one archives the old."
      />

      {held.map((entry) =>
        entry.write.outcome.kind === "unknown" ? (
          <HeldWriteNotice
            key={entry.id}
            write={entry.write}
            subject={entry.subject}
            onReload={() => {
              query.refetch()
            }}
            reloadLabel="Reload the FAQs"
          />
        ) : null,
      )}
      {held.map((entry) => {
        const text = rejectionText(entry.write.outcome, entry.failure)
        return text === null ? null : (
          <Alert key={entry.id} tone="error" title="Nothing changed">
            {text}
          </Alert>
        )
      })}

      {canPublish ? (
        <Section title={editing === null ? "Add an answer" : "Edit this draft"}>
          <Card elevated>
            <div className={STACK_LG}>
              <FormField label="Question" required>
                {({ id }) => (
                  <Input
                    id={id}
                    disabled={isLocked}
                    value={draft.question}
                    maxLength={8_000}
                    onChange={(event) => {
                      setDraft({ ...draft, question: event.target.value })
                    }}
                  />
                )}
              </FormField>
              <FormField label="Answer" required>
                {({ id }) => (
                  <Textarea
                    id={id}
                    disabled={isLocked}
                    value={draft.answer}
                    maxLength={8_000}
                    onChange={(event) => {
                      setDraft({ ...draft, answer: event.target.value })
                    }}
                  />
                )}
              </FormField>
              <div className={ADMIN_FORM_GRID}>
                <FormField label="Category">
                  {({ id }) => (
                    <Input
                      id={id}
                      disabled={isLocked}
                      value={draft.category}
                      maxLength={200}
                      onChange={(event) => {
                        setDraft({ ...draft, category: event.target.value })
                      }}
                    />
                  )}
                </FormField>
                <FormField label="Order" hint="Lower numbers appear first.">
                  {({ id }) => (
                    <Input
                      id={id}
                      disabled={isLocked}
                      type="number"
                      min={0}
                      max={100_000}
                      value={String(draft.order)}
                      onChange={(event) => {
                        setDraft({ ...draft, order: Number(event.target.value) })
                      }}
                    />
                  )}
                </FormField>
              </div>
              <div className={ACTION_ROW}>
                <Button disabled={incomplete || isLocked} loading={isSaving} onClick={submit} trailing>
                  {editing === null ? "Save as draft" : "Save the draft"}
                </Button>
                {editing === null ? null : (
                  <Button tone="ghost" disabled={isLocked} onClick={clearDraft}>
                    Cancel
                  </Button>
                )}
              </div>
              <p className={PROSE_SM}>
                A new answer is created as a draft. Investors see nothing until you publish it.
              </p>
            </div>
          </Card>
        </Section>
      ) : (
        <Alert tone="info" title="You can read these but not change them">
          Writing or publishing an FAQ needs the content.publish permission.
        </Alert>
      )}

      <Section title="All answers">
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
              title="No answers yet"
              description="Add one above. It starts as a draft, so nothing is visible to investors until you publish it."
            />
          }
        >
          {(data) => (
            <AdminTable
              caption="FAQs"
              rows={data.items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: "question",
                  header: "Question",
                  render: (row) => (
                    <span className={ENTRY_TEXT}>
                      <span>{row.question}</span>
                      <span className={ADMIN_CODE}>{row.contentKey}</span>
                    </span>
                  ),
                },
                { key: "category", header: "Category", render: (row) => row.category },
                {
                  key: "order",
                  header: "Order",
                  numeric: true,
                  render: (row) => String(row.order),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>,
                },
                {
                  key: "version",
                  header: "Version",
                  numeric: true,
                  render: (row) => String(row.version),
                },
                {
                  key: "published",
                  header: "Published",
                  render: (row) =>
                    row.publishedAt === null ? "—" : formatDateTime(row.publishedAt),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (row) =>
                    canPublish ? (
                      <span className={ACTION_ROW}>
                        {row.status === "draft" ? (
                          <Button
                            size="sm"
                            disabled={isLocked}
                            onClick={() => {
                              changeStatus(row.id, "published")
                            }}
                          >
                            Publish
                          </Button>
                        ) : null}
                        {row.status === "published" ? (
                          <Button
                            tone="secondary"
                            size="sm"
                            disabled={isLocked}
                            onClick={() => {
                              changeStatus(row.id, "draft")
                            }}
                          >
                            Unpublish
                          </Button>
                        ) : null}
                        {row.status === "draft" ? (
                          <Button
                            tone="ghost"
                            size="sm"
                            disabled={isLocked}
                            onClick={() => {
                              setEditing(row.id)
                              setDraft({
                                question: row.question,
                                answer: row.answer,
                                category: row.category,
                                order: row.order,
                              })
                            }}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {row.status === "archived" ? null : (
                          <Button
                            tone="danger"
                            size="sm"
                            disabled={isLocked}
                            onClick={() => {
                              setArchiving(row.id)
                            }}
                          >
                            Archive
                          </Button>
                        )}
                      </span>
                    ) : (
                      <span className={META_TEXT}>Read only</span>
                    ),
                },
              ]}
            />
          )}
        </AsyncBoundary>
        <LoadMore list={query} noun="FAQs" />
      </Section>

      <ConfirmDialog
        open={archiving !== null}
        title="Archive this answer?"
        description="It stops appearing in the investor app. Nothing is deleted, and the archive is recorded in the audit log."
        confirmLabel="Archive it"
        confirmTone="danger"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (archiving === null) return
          setArchiving(null)
          archive.submit({ faqId: archiving })
        }}
        onCancel={() => {
          setArchiving(null)
        }}
      />
    </Page>
  )
}

export default FaqListScreen
