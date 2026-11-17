import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useToast } from "~/app/providers/ToastProvider"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { fundState } from "~/domain/status"
import { useHeldDone } from "~/features/admin/shared/useHeldDone"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useRouteAccess } from "~/features/admin/shared/routeAccess"
import type { HeldWrite } from "~/features/admin/shared/useHeldWrite"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"

import { ADMIN_FIGURE } from "~/ui/recipes/admin"
import { LIST_LABEL, LIST_ROW, LIST_VALUE } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

import type { LifecycleInput, LifecycleStatus } from "./fundQueries"
import type { FundDetail } from "./latestTerms"

const ALLOWED_TRANSITIONS = {
  draft: ["published", "archived"],
  published: ["paused", "archived"],
  paused: ["published", "archived"],
  archived: [],
} as const satisfies Readonly<Record<string, readonly LifecycleStatus[]>>

const TRANSITION = {
  published: {
    label: "Publish",
    confirm: "Publish the fund",
    done: "Fund published.",
    subject: "the fund was published",
    tone: "primary",
    effect: "Investors can see this fund and its current terms once it is published.",
  },
  paused: {
    label: "Pause",
    confirm: "Pause the fund",
    done: "Fund paused.",
    subject: "the fund was paused",
    tone: "danger",
    effect: "Investors stop seeing this fund until it is published again.",
  },
  archived: {
    label: "Archive",
    confirm: "Archive the fund",
    done: "Fund archived.",
    subject: "the fund was archived",
    tone: "danger",
    effect: "Archiving cannot be undone. Investors stop seeing this fund, and it can never be published again.",
  },
} as const satisfies Readonly<
  Record<LifecycleStatus, Readonly<{ label: string; confirm: string; done: string; subject: string; tone: "primary" | "danger"; effect: string }>>
>

const rejectionText = (code: string | null, message: string): string => {
  if (code === "STATE_CONFLICT") {
    return "This fund changed after the page loaded, so its state was not changed. Reload the fund and try again."
  }
  if (code === "AUTHORIZATION_DENIED") return "Your account cannot change this fund."
  return message
}

const isStaleRefusal = (outcome: HeldWrite<LifecycleInput, void>["outcome"]): boolean =>
  outcome.kind === "rejected" && outcome.code === "STATE_CONFLICT" && outcome.fields["if-match"] !== undefined

const Row = ({ label, children }: Readonly<{ label: string; children: React.ReactNode }>): React.ReactElement => (
  <div className={LIST_ROW}>
    <span className={LIST_LABEL}>{label}</span>
    <span className={LIST_VALUE}>{children}</span>
  </div>
)

export type FundStateCardProps = Readonly<{
  detail: FundDetail
  lifecycle: HeldWrite<LifecycleInput, void>
  canWrite: boolean
  isLocked: boolean
  onReload: () => void
}>

export const FundStateCard = ({ detail, lifecycle, canWrite, isLocked, onReload }: FundStateCardProps): React.ReactElement => {
  const { show } = useToast()
  const canOpen = useRouteAccess()
  const [confirming, setConfirming] = useState<LifecycleInput | null>(null)
  const [requested, setRequested] = useState<LifecycleStatus | null>(null)
  const { fund } = detail
  const fundName = fund.name ?? fund.slug
  const { outcome, held } = lifecycle
  const heldStatus = held?.status ?? requested
  const isStale = isStaleRefusal(outcome)

  useHeldDone(outcome, () => {
    show(requested === null ? "Fund state changed." : TRANSITION[requested].done)
  })

  const transition = confirming === null ? null : TRANSITION[confirming.status]

  return (
    <Card>
      <Section title="Current state">
        <Row label="Status">{fundState(fund.status).label}</Row>
        <Row label="Visible to investors">{fund.status === "published" ? "Yes" : "No"}</Row>
        <Row label="Published version">
          {fund.currentVersion === null ? "None — investors cannot see this fund" : String(fund.currentVersion)}
        </Row>
        <Row label="Fund size">
          {fund.aum === null ? "Not set" : <MoneyValue amount={toPaise(fund.aum.aumPaise)} size="sm" showDecimals />}
        </Row>
        <Row label="Versions">{String(detail.versions.length)}</Row>
        <Row label="Last updated">{formatDateTime(fund.updatedAt)}</Row>
        <Row label="Concurrency version">
          <span className={ADMIN_FIGURE}>{String(fund.version)}</span>
        </Row>
      </Section>

      {outcome.kind === "unknown" ? (
        <HeldWriteNotice
          write={lifecycle}
          subject={heldStatus === null ? "the fund state changed" : TRANSITION[heldStatus].subject}
          onReload={onReload}
          reloadLabel="Reload the fund"
        />
      ) : null}
      {outcome.kind === "rejected" && !isStale ? (
        <Alert tone="error" title="State unchanged">
          {rejectionText(outcome.code, outcome.message)}
        </Alert>
      ) : null}
      {isStale ? (
        <Alert
          tone="warning"
          title="State unchanged"
          action={
            <Button
              size="sm"
              tone="secondary"
              onClick={() => {
                lifecycle.reset()
                onReload()
              }}
            >
              Reload the fund
            </Button>
          }
        >
          This fund was changed after this page loaded, so its state was not changed. Reload the fund to see its current
          state before changing it.
        </Alert>
      ) : null}

      <div className={ACTION_ROW}>
        <ButtonLink to={`/funds/${fund.id}/holdings`} tone="secondary" size="sm">
          Holdings
        </ButtonLink>
        {canOpen("fund-aum") ? (
          <ButtonLink to={`/funds/${fund.id}/aum`} tone="secondary" size="sm">
            Manage AUM
          </ButtonLink>
        ) : null}
        {canWrite
          ? ALLOWED_TRANSITIONS[fund.status].map((status) => (
              <Button
                key={status}
                tone={TRANSITION[status].tone === "danger" ? "danger" : "secondary"}
                size="sm"
                loading={lifecycle.pending && heldStatus === status}
                disabled={isLocked || (status === "published" && fund.currentVersion === null)}
                onClick={() => {
                  setConfirming({ status, version: fund.version })
                }}
              >
                {TRANSITION[status].label}
              </Button>
            ))
          : null}
      </div>

      <ConfirmDialog
        open={transition !== null}
        title={transition === null ? "" : `${transition.label} ${fundName}?`}
        {...(transition === null ? {} : { description: transition.effect })}
        confirmLabel={transition?.confirm ?? ""}
        cancelLabel="Cancel"
        confirmTone={transition?.tone ?? "primary"}
        onConfirm={() => {
          if (confirming === null) return
          setConfirming(null)
          setRequested(confirming.status)
          lifecycle.submit(confirming)
        }}
        onCancel={() => {
          setConfirming(null)
        }}
      />
    </Card>
  )
}
