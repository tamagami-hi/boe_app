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
  useAppendAumGrowth,
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
  ADMIN_FILTER,
  ADMIN_FILTER_ROW,
  ADMIN_FORM_GRID,
  ADMIN_META,
} from "~/ui/recipes/admin"
import { ITEM_TITLE, LIST_LABEL, LIST_VALUE } from "~/ui/recipes/datalist"
import { ACTION_ROW, CARD_COLUMNS_WRAP, ROW_BETWEEN_BASELINE, STACK_LG } from "~/ui/recipes/layout"

const today = (): string => new Date().toISOString().slice(0, 10)

const failureMessage = (error: unknown): string => {
  if (isTransportError(error)) return "We could not reach the backend. Nothing was recorded."
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

type GrowthMode = "amount" | "percent"

const FundAumScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const fund = useAdminFund(fundId)
  const history = useAdminAumHistory(fundId)
  const initialize = useInitializeAum(fundId)
  const growth = useAppendAumGrowth(fundId)
  const toast = useToast()
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["aum.write"])

  const [openingPaise, setOpeningPaise] = useState("0")
  const [openingDate, setOpeningDate] = useState(today)
  const [openingReason, setOpeningReason] = useState("initial_aum")

  const [mode, setMode] = useState<GrowthMode>("amount")
  const [growthPaise, setGrowthPaise] = useState("")
  const [basisPoints, setBasisPoints] = useState("")
  const [growthDate, setGrowthDate] = useState(today)
  const [growthReason, setGrowthReason] = useState("periodic_growth")
  const [note, setNote] = useState("")

  const current = fund.data?.fund.aum ?? null
  const initialised = current !== null

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={fund.data?.fund.slug ?? ""}
        title="Fund AUM"
        description="The absolute fund size, and the growth entries that move it. Every entry is append-only and audited."
      />

      {initialize.error === null ? null : (
        <Alert tone="error" title="Opening AUM not recorded">
          {failureMessage(initialize.error)}
        </Alert>
      )}
      {growth.error === null ? null : (
        <Alert tone="error" title="Growth not recorded">
          {failureMessage(growth.error)}
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
        <form
          onSubmit={(event) => {
            event.preventDefault()
            growth.mutate(
              {
                ...(mode === "amount"
                  ? { growthPaise }
                  : { growthBasisPoints: Number.parseInt(basisPoints, 10) }),
                asOfDate: growthDate,
                reasonCode: growthReason,
                ...(note.trim() === "" ? {} : { note: note.trim() }),
              },
              {
                onSuccess: () => {
                  toast.show("Growth recorded.")
                  setGrowthPaise("")
                  setBasisPoints("")
                  setNote("")
                },
              },
            )
          }}
          noValidate
          className={STACK_LG}
        >
          <Card>
            <Section
              title="Record growth"
              description="Give either an absolute amount or a percentage in basis points, not both. A negative value records a fall."
            >
              <div className={ADMIN_FILTER_ROW} role="group" aria-label="Growth entry mode">
                <button
                  type="button"
                  className={ADMIN_FILTER}
                  aria-pressed={mode === "amount"}
                  onClick={() => {
                    setMode("amount")
                  }}
                >
                  Amount
                </button>
                <button
                  type="button"
                  className={ADMIN_FILTER}
                  aria-pressed={mode === "percent"}
                  onClick={() => {
                    setMode("percent")
                  }}
                >
                  Percentage
                </button>
              </div>

              <div className={ADMIN_FORM_GRID}>
                {mode === "amount" ? (
                  <FormField
                    label="Growth (paise)"
                    required
                    hint="Signed integer paise. Prefix with a minus for a fall."
                  >
                    {({ id }) => (
                      <Input
                        id={id}
                        required
                        mono
                        inputMode="numeric"
                        value={growthPaise}
                        onChange={(event) => {
                          setGrowthPaise(event.target.value.replace(/[^0-9-]/gu, ""))
                        }}
                      />
                    )}
                  </FormField>
                ) : (
                  <FormField
                    label="Growth (basis points)"
                    required
                    hint="100 basis points is 1%. Range -10000 to 100000, and never 0."
                  >
                    {({ id }) => (
                      <Input
                        id={id}
                        required
                        mono
                        inputMode="numeric"
                        value={basisPoints}
                        onChange={(event) => {
                          setBasisPoints(event.target.value.replace(/[^0-9-]/gu, ""))
                        }}
                      />
                    )}
                  </FormField>
                )}

                <FormField label="As of date" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="date"
                      required
                      value={growthDate}
                      onChange={(event) => {
                        setGrowthDate(event.target.value)
                      }}
                    />
                  )}
                </FormField>

                <FormField label="Reason code" required>
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      value={growthReason}
                      onChange={(event) => {
                        setGrowthReason(event.target.value)
                      }}
                    />
                  )}
                </FormField>

                <FormField label="Note">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={note}
                      onChange={(event) => {
                        setNote(event.target.value)
                      }}
                    />
                  )}
                </FormField>
              </div>

              <div className={ACTION_ROW}>
                <Button type="submit" size="lg" loading={growth.isPending}>
                  Record growth
                </Button>
              </div>
            </Section>
          </Card>
        </form>
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
              description="This fund has no AUM yet. Record the absolute size once; every later change is a growth entry."
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
