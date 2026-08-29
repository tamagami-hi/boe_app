import { useState } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import {
  useAdminFaqs,
  useArchiveFaq,
  useCreateFaq,
  useEditFaq,
  useSetFaqStatus,
} from "~/features/admin/shared/adminQueries"
import type { FaqFields } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
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

const STATUS_TONE = {
  draft: "warning",
  published: "positive",
  archived: "neutral",
} as const

const EMPTY: FaqFields = { question: "", answer: "", category: "general", order: 0 }

const FaqListScreen = (): React.ReactElement => {
  const query = useAdminFaqs()
  const create = useCreateFaq()
  const edit = useEditFaq()
  const setStatus = useSetFaqStatus()
  const archive = useArchiveFaq()
  const { hasAnyPermission } = useSession()

  const [draft, setDraft] = useState<FaqFields>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const canPublish = hasAnyPermission(["content.publish"])
  const incomplete = draft.question.trim() === "" || draft.answer.trim() === ""

  const describe = (error: unknown): string =>
    isApiError(error)
      ? error.code === "STATE_CONFLICT"
        ? "Only a draft can be edited. Move it back to draft first, or create a new version."
        : error.message
      : "We could not save that. Nothing has changed."

  const submit = (): void => {
    setFailure(null)
    const payload = {
      question: draft.question.trim(),
      answer: draft.answer.trim(),
      category: draft.category.trim() === "" ? "general" : draft.category.trim(),
      order: draft.order,
    }
    const onDone = {
      onError: (error: unknown) => {
        setFailure(describe(error))
      },
      onSuccess: () => {
        setDraft(EMPTY)
        setEditing(null)
      },
    }
    if (editing === null) {
      create.mutate(payload, onDone)
      return
    }
    edit.mutate({ faqId: editing, ...payload }, onDone)
  }

  const pending = create.isPending || edit.isPending || setStatus.isPending || archive.isPending

  return (
    <Page width="wide">
      <PageHeader
        title="FAQs"
        description="Published answers appear in the investor app's support screen. Only one version of a key is published at a time; publishing a new one archives the old."
      />

      {failure === null ? null : (
        <Alert tone="error" title="Nothing changed">
          {failure}
        </Alert>
      )}

      {canPublish ? (
        <Section title={editing === null ? "Add an answer" : "Edit this draft"}>
          <Card elevated>
            <div className={STACK_LG}>
              <FormField label="Question" required>
                {({ id }) => (
                  <Input
                    id={id}
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
                <Button disabled={incomplete} loading={pending} onClick={submit} trailing>
                  {editing === null ? "Save as draft" : "Save the draft"}
                </Button>
                {editing === null ? null : (
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setEditing(null)
                      setDraft(EMPTY)
                    }}
                  >
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
                            disabled={pending}
                            onClick={() => {
                              setFailure(null)
                              setStatus.mutate(
                                { faqId: row.id, status: "published" },
                                {
                                  onError: (error) => {
                                    setFailure(describe(error))
                                  },
                                },
                              )
                            }}
                          >
                            Publish
                          </Button>
                        ) : null}
                        {row.status === "published" ? (
                          <Button
                            tone="secondary"
                            size="sm"
                            disabled={pending}
                            onClick={() => {
                              setFailure(null)
                              setStatus.mutate(
                                { faqId: row.id, status: "draft" },
                                {
                                  onError: (error) => {
                                    setFailure(describe(error))
                                  },
                                },
                              )
                            }}
                          >
                            Unpublish
                          </Button>
                        ) : null}
                        {row.status === "draft" ? (
                          <Button
                            tone="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() => {
                              setFailure(null)
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
                            disabled={pending}
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
      </Section>

      <ConfirmDialog
        open={archiving !== null}
        title="Archive this answer?"
        description="It stops appearing in the investor app. Nothing is deleted, and the archive is recorded in the audit log."
        confirmLabel="Archive it"
        confirmTone="danger"
        pending={archive.isPending}
        onConfirm={() => {
          if (archiving === null) return
          setFailure(null)
          archive.mutate(archiving, {
            onError: (error) => {
              setFailure(describe(error))
            },
            onSettled: () => {
              setArchiving(null)
            },
          })
        }}
        onCancel={() => {
          setArchiving(null)
        }}
      />
    </Page>
  )
}

export default FaqListScreen
