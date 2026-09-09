import { useState } from "react"
import { useParams } from "react-router-dom"

import { isApiError, isTransportError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { useToast } from "~/app/providers/ToastProvider"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import {
  useAdminAumHistory,
  useAdminFund,
  useInitializeAum,
} from "~/features/admin/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"

import {
  ADMIN_FORM_GRID,
  ADMIN_META,
} from "~/ui/recipes/admin"
import { ITEM_TITLE, LIST_LABEL, LIST_VALUE } from "~/ui/recipes/datalist"
import { ACTION_ROW, CARD_COLUMNS_WRAP, ROW_BETWEEN_BASELINE, STACK_LG } from "~/ui/recipes/layout"

import { FundSizeAdjustmentForm } from "./FundSizeAdjustmentForm"

const today = (): string => new Date().toISOString().slice(0, 10)

const failureMessage = (error: unknown): string => {
  if (isTransportError(error)) return "The response was interrupted. Reload the fund to check whether the opening AUM was recorded."
  if (!isApiError(error)) return "That did not work."
  if (error.code === "VALIDATION_FAILED") return error.message
  if (error.code === "STATE_CONFLICT") {
    return "The AUM moved while you were entering this. Reload the history and try again."
  }
  if (error.code === "RATE_LIMITED") {
    const seconds = error.retryAfterSeconds
    return seconds === null
      ? "Too many AUM writes just now. Wait and retry."
      : `Too many AUM writes just now. Retry in ${String(seconds)}s.`
  }
  if (error.code === "AUTHORIZATION_DENIED") return "Recording AUM needs the aum.write permission."
  return "That did not work."
}

const FundAumScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const fund = useAdminFund(fundId)
  const history = useAdminAumHistory(fundId)
  const initialize = useInitializeAum(fundId)
  const toast = useToast()
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["aum.write"])

  const [openingPaise, setOpeningPaise] = useState("0")
  const [openingDate, setOpeningDate] = useState(today)
  const [openingReason, setOpeningReason] = useState("initial_aum")

  const current = fund.data?.fund.aum ?? null
  const initialised = current !== null

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={fund.data?.fund.slug ?? ""}
        title="Fund AUM"
        description="Set the fund size or record an increase or decrease. Every change is saved in the history."
      />

      {initialize.error === null ? null : (
        <Alert tone="error" title="Opening AUM not recorded">
          {failureMessage(initialize.error)}
        </Alert>
      )}


      <Card elevated>
        <span className={LIST_LABEL}>Current fund size</span>
        {current === null ? (
          <span className={LIST_VALUE}>Not set</span>
        ) : (
          <>
            <MoneyValue amount={toPaise(current.aumPaise)} size="xl" />
            <span className={LIST_LABEL}>
              {current.asOfDate === null
                ? "As-of date not recorded"
                : `As of ${formatDate(`${current.asOfDate}T00:00:00Z`)}`}
            </span>
          </>
        )}
      </Card>

      {!canWrite ? (
        <Alert tone="info" title="Read only">
          Recording AUM needs the aum.write permission.
        </Alert>
      ) : initialised ? (
        <FundSizeAdjustmentForm
          fundId={fundId}
          currentAumPaise={current.aumPaise}
          currentAsOfDate={current.asOfDate}
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            initialize.mutate(
              { aumPaise: openingPaise, asOfDate: openingDate, reasonCode: openingReason },
              {
                onSuccess: () => {
                  toast.show("Opening AUM recorded.")
                },
              },
            )
          }}
          noValidate
          className={STACK_LG}
        >
          <Card>
            <Section
              title="Set opening AUM"
              description="This fund has no AUM yet. Record the absolute size once; you can increase or decrease it afterward."
            >
              <div className={ADMIN_FORM_GRID}>
                <FormField label="Opening AUM (paise)" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      mono
                      inputMode="numeric"
                      value={openingPaise}
                      onChange={(event) => {
                        setOpeningPaise(event.target.value.replace(/[^0-9]/gu, ""))
                      }}
                    />
                  )}
                </FormField>
                <FormField label="As of date" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="date"
                      required
                      value={openingDate}
                      onChange={(event) => {
                        setOpeningDate(event.target.value)
                      }}
                    />
                  )}
                </FormField>
                <FormField label="Reason code" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      value={openingReason}
                      onChange={(event) => {
                        setOpeningReason(event.target.value)
                      }}
                    />
                  )}
                </FormField>
              </div>
              <div className={ACTION_ROW}>
                <Button type="submit" size="lg" loading={initialize.isPending}>
                  Record opening AUM
                </Button>
              </div>
            </Section>
          </Card>
        </form>
      )}

      <Section title="History">
        <AsyncBoundary
          query={history}
          skeleton={
            <Card>
              <Skeleton height="1rem" width="40%" />
              <Skeleton height="1rem" width="55%" />
            </Card>
          }
          isEmpty={(data) => data.items.length === 0}
          empty={<EmptyState title="No AUM entries yet" />}
        >
          {(data) => (
            <div className={CARD_COLUMNS_WRAP[3]}>
              {data.items.map((snapshot) => (
                <Card key={snapshot.id}>
                  <div className={ROW_BETWEEN_BASELINE}>
                    <span className={ITEM_TITLE}>
                      {formatDate(`${snapshot.asOfDate}T00:00:00Z`)}
                    </span>
                    <MoneyValue amount={toPaise(snapshot.aumPaise)} size="md" />
                  </div>
                  <div className={ADMIN_META}>
                    <span>Revision {String(snapshot.revision)}</span>
                    <span>{snapshot.reasonCode}</span>
                    {snapshot.note === null ? null : <span>{snapshot.note}</span>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </AsyncBoundary>
        <LoadMore list={history} noun="entries" />
      </Section>
    </Page>
  )
}

export default FundAumScreen
