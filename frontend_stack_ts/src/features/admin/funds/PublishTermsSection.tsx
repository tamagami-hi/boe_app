import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { useToast } from "~/app/providers/ToastProvider"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import type { HeldWrite } from "~/features/admin/shared/useHeldWrite"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"

import { STACK_LG } from "~/ui/recipes/layout"

import type { TermsInput } from "./fundQueries"
import { EMPTY_TERMS, FundTermsFields, SubmitRow, termsBodyOf } from "./FundTermsForm"
import type { FundTerms } from "./FundTermsForm"
import type { LatestTerms } from "./latestTerms"
import { useHeldDone } from "./useHeldDone"

const rejectionText = (code: string | null, message: string): string => {
  if (code === "STATE_CONFLICT") {
    return "This fund changed after the page loaded, so nothing was published. Reload the fund, check the terms and publish again."
  }
  if (code === "AUTHORIZATION_DENIED") return "Your account cannot change this fund."
  return message
}

type StartingTerms = Exclude<LatestTerms, Readonly<{ kind: "unreadable" }>>

const baseOf = (latest: StartingTerms): string => (latest.kind === "found" ? latest.versionId : "none")

const startOf = (latest: StartingTerms): FundTerms => (latest.kind === "found" ? latest.terms : EMPTY_TERMS)

export type PublishTermsSectionProps = Readonly<{
  latest: LatestTerms
  publish: HeldWrite<TermsInput, void>
  isLocked: boolean
  onReload: () => void
}>

const PublishTermsForm = ({
  latest,
  publish,
  isLocked,
  onReload,
}: PublishTermsSectionProps & Readonly<{ latest: StartingTerms }>): React.ReactElement => {
  const { show } = useToast()
  const [base, setBase] = useState(() => baseOf(latest))
  const [terms, setTerms] = useState<FundTerms>(() => startOf(latest))
  const { outcome } = publish

  if (base !== baseOf(latest) && publish.held === null) {
    setBase(baseOf(latest))
    setTerms(startOf(latest))
  }

  useHeldDone(outcome, () => {
    show("New version published.")
  })

  const fields = outcome.kind === "rejected" ? outcome.fields : null

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const body = termsBodyOf(terms)
        if (body === null || isLocked) return
        publish.submit(body)
      }}
      noValidate
      className={STACK_LG}
    >
      {outcome.kind === "unknown" ? (
        <HeldWriteNotice write={publish} subject="the new terms were published" onReload={onReload} reloadLabel="Reload the fund" />
      ) : null}
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Not published">
          {rejectionText(outcome.code, outcome.message)}
        </Alert>
      ) : null}
      <Card>
        <Section
          title="Publish new terms"
          description={
            latest.kind === "found"
              ? `Starts from version ${String(latest.version)} and its disclosure. Publishing writes a new immutable version; earlier versions are kept.`
              : "This fund has no terms yet, so the form starts empty. Publishing writes version 1 with its disclosure."
          }
        >
          <FundTermsFields terms={terms} fields={fields} setTerms={setTerms} disabled={isLocked} />
        </Section>
      </Card>
      <SubmitRow label="Publish version" pending={publish.pending} disabled={isLocked} />
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
