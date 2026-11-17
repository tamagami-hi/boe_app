import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { useToast } from "~/app/providers/ToastProvider"
import { useHeldDone } from "~/features/admin/shared/useHeldDone"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import type { HeldWrite } from "~/features/admin/shared/useHeldWrite"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"

import { STACK_LG } from "~/ui/recipes/layout"

import type { PublishTermsInput } from "./fundQueries"
import { EMPTY_TERMS, FundTermsFields, SubmitRow, termsBodyOf } from "./FundTermsForm"
import type { FundTerms } from "./FundTermsForm"
import type { LatestTerms } from "./latestTerms"

type StartingTerms = Exclude<LatestTerms, Readonly<{ kind: "unreadable" }>>

type Check = "idle" | "checking" | "failed" | "refused"

type Outcome = HeldWrite<PublishTermsInput, void>["outcome"]

const isStaleRefusal = (outcome: Outcome): boolean =>
  outcome.kind === "rejected" && outcome.code === "STATE_CONFLICT" && outcome.fields.expectedVersion !== undefined

const rejectionText = (code: string | null, message: string): string => {
  if (code === "STATE_CONFLICT") {
    return "This fund changed after the page loaded, so nothing was published. Reload the fund, check the terms and publish again."
  }
  if (code === "AUTHORIZATION_DENIED") return "Your account cannot change this fund."
  return message
}

const baseOf = (latest: LatestTerms): string => (latest.kind === "found" ? latest.versionId : latest.kind)

const startOf = (latest: StartingTerms): FundTerms => (latest.kind === "found" ? latest.terms : EMPTY_TERMS)

const versionText = (latest: StartingTerms): string =>
  latest.kind === "found" ? `version ${String(latest.version)}` : "an empty form"

export type PublishTermsSectionProps = Readonly<{
  latest: LatestTerms
  publish: HeldWrite<PublishTermsInput, void>
  isLocked: boolean
  onReload: () => void
  onReread: () => Promise<LatestTerms | null>
}>

type PublishTermsFormProps = PublishTermsSectionProps & Readonly<{ latest: StartingTerms }>

const PublishTermsForm = ({ latest, publish, isLocked, onReload, onReread }: PublishTermsFormProps): React.ReactElement => {
  const { show } = useToast()
  const [start, setStart] = useState<StartingTerms>(latest)
  const [terms, setTerms] = useState<FundTerms>(() => startOf(latest))
  const [isEdited, setIsEdited] = useState(false)
  const [isAttempted, setIsAttempted] = useState(false)
  const [check, setCheck] = useState<Check>("idle")
  const { outcome } = publish
  const isBehind = baseOf(latest) !== baseOf(start) && publish.held === null
  const hasEdits = isEdited || outcome.kind === "rejected"
  const isFrozen = isLocked || check === "checking"
  const isStale = isStaleRefusal(outcome)

  const startFrom = (next: StartingTerms): void => {
    setStart(next)
    setTerms(startOf(next))
    setIsEdited(false)
    setIsAttempted(false)
  }

  if (isBehind && !hasEdits) startFrom(latest)

  useHeldDone(outcome, () => {
    show("New version published.")
  })

  const edit = (next: FundTerms): void => {
    setTerms(next)
    setIsEdited(true)
    setCheck((current) => (current === "checking" ? current : "idle"))
  }

  const submit = async (): Promise<void> => {
    setIsAttempted(true)
    const body = termsBodyOf(terms)
    if (body === null || isFrozen) return
    if (isBehind) {
      setCheck("refused")
      return
    }
    setCheck("checking")
    const current = await onReread()
    if (current === null) {
      setCheck("failed")
      return
    }
    if (baseOf(current) !== baseOf(start)) {
      setCheck("refused")
      return
    }
    setCheck("idle")
    setIsEdited(false)
    publish.submit(start.kind === "found" ? { ...body, expectedVersion: start.version } : body)
  }

  const fields = outcome.kind === "rejected" ? outcome.fields : null

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      noValidate
      className={STACK_LG}
    >
      {outcome.kind === "unknown" ? (
        <HeldWriteNotice write={publish} subject="the new terms were published" onReload={onReload} reloadLabel="Reload the fund" />
      ) : null}
      {outcome.kind === "rejected" && !isStale ? (
        <Alert tone="error" title="Not published">
          {rejectionText(outcome.code, outcome.message)}
        </Alert>
      ) : null}
      {isStale && !isBehind ? (
        <Alert
          tone="warning"
          title="Not published"
          action={
            <Button size="sm" tone="secondary" onClick={onReload}>
              Reload the fund
            </Button>
          }
        >
          Newer terms were published for this fund after this form was opened, so nothing was published. Reload the fund
          to see them; your edits stay in the form.
        </Alert>
      ) : null}
      {isBehind ? (
        <Alert
          tone="warning"
          title="A newer version was published"
          action={
            <Button
              size="sm"
              tone="secondary"
              disabled={isLocked}
              onClick={() => {
                setCheck("idle")
                if (isStale) publish.reset()
                startFrom(latest)
              }}
            >
              {`Start again from ${versionText(latest)}`}
            </Button>
          }
        >
          {`${check === "refused" || isStale ? "Nothing was published. " : ""}This form started from ${versionText(start)}, and ${versionText(latest)} was published since. Your edits are kept here, but publishing them could undo the newer changes. Start again from ${versionText(latest)} to see them.`}
        </Alert>
      ) : null}
      {!isBehind && check === "refused" ? (
        <Alert tone="warning" title="Nothing was published">
          {`A newer version was published after this page loaded. The form now starts from ${versionText(start)}; check it and publish again.`}
        </Alert>
      ) : null}
      {check === "failed" ? (
        <Alert tone="error" title="Nothing was published">
          The fund&apos;s versions could not be read again before publishing, so nothing was sent. Try again.
        </Alert>
      ) : null}
      <Card>
        <Section
          title="Publish new terms"
          description={
            start.kind === "found"
              ? `Starts from version ${String(start.version)} and its disclosure. Publishing writes a new immutable version; earlier versions are kept.`
              : "This fund has no terms yet, so the form starts empty. Publishing writes version 1 with its disclosure."
          }
        >
          <FundTermsFields terms={terms} fields={fields} setTerms={edit} disabled={isFrozen} isAttempted={isAttempted} />
        </Section>
      </Card>
      <SubmitRow label="Publish version" pending={publish.pending || check === "checking"} disabled={isFrozen} />
    </form>
  )
}

export const PublishTermsSection = (props: PublishTermsSectionProps): React.ReactElement => {
  const { latest } = props
  if (latest.kind === "unreadable") {
    return (
      <Alert tone="error" title="New terms cannot start from the latest version">
        The latest terms of this fund could not be read in full, so this form is not shown. Starting from a blank
        form could publish a version that drops the duration or the disclosure.
      </Alert>
    )
  }
  return <PublishTermsForm {...props} latest={latest} />
}
