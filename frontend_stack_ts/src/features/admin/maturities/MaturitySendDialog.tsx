import { useState } from "react"

import { Modal } from "~/app/overlays/Modal"
import { indiaToday } from "~/features/admin/client-values/indiaToday"
import { HeldWriteNotice } from "~/features/admin/users/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/users/useHeldWrite"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { Switch } from "~/ui/primitives/Toggle"
import { ITEM_TITLE } from "~/ui/recipes/datalist"
import { STACK_LG, STACK_SM } from "~/ui/recipes/layout"
import { BODY_SM } from "~/ui/recipes/text"

import { ExtensionFields, extensionOf, extensionRoom, initialExtensionDraft, type ExtensionDraft } from "./ExtensionFields"
import { FollowUpSipFields, followUpOf, type FollowUpDraft } from "./FollowUpSipFields"
import { formatMaturityDate, monthAfter } from "./maturityPresentation"
import { useSendMaturityOptions, type MaturityScheduleItem } from "./maturityQueries"
import { ActiveSipFacts } from "./ResolutionFacts"
import type { ActiveSip, FactsReload } from "./resolutionCopy"

export type MaturitySendDialogProps = Readonly<{
  userId: string
  schedule: MaturityScheduleItem
  activeSip: ActiveSip | null | undefined
  reload: FactsReload
  onClose: () => void
}>

const laterMonth = (left: string, right: string): string => (left > right ? left : right)

const ExtensionUnavailable = ({ activeSip }: Readonly<{ activeSip: ActiveSip | null }>): React.ReactElement => (
  <Alert tone="info" title="Option 3 is not offered">
    {activeSip === null
      ? "This client has no active SIP schedule for this fund, so there is nothing to extend."
      : "The active SIP schedule already has the most months allowed."}
  </Alert>
)

export const MaturitySendDialog = ({
  userId,
  schedule,
  activeSip,
  reload,
  onClose,
}: MaturitySendDialogProps): React.ReactElement => {
  const { refreshing, onReload } = reload
  const write = useHeldWrite(useSendMaturityOptions(userId), "The options could not be sent. Reload the page and try again.")
  const earliestMonth = laterMonth(monthAfter(schedule.maturityDate), indiaToday().slice(0, 7))
  const [draft, setDraft] = useState<FollowUpDraft>({ rupees: "", startMonth: earliestMonth, months: "12" })
  const [extensionDraft, setExtensionDraft] = useState<ExtensionDraft>(initialExtensionDraft(schedule.maturityDate))
  const room = activeSip === undefined || activeSip === null ? 0 : extensionRoom(activeSip.monthCount)
  const [offerExtension, setOfferExtension] = useState(true)

  const locked = write.pending || write.outcome.kind === "unknown" || write.outcome.kind === "done"
  const includesExtension = offerExtension && room > 0
  const sip = followUpOf(draft, earliestMonth)
  const extension = includesExtension ? extensionOf(extensionDraft, schedule.maturityDate, room) : null
  const ready = sip !== null && activeSip !== undefined && !refreshing && (!includesExtension || extension !== null)

  return (
    <Modal
      open
      title={`Send options for the ${formatMaturityDate(schedule.maturityDate)} maturity`}
      description={`${schedule.fundName}. The client gets an email and a notification and chooses in the app. Nothing changes until you confirm their choice.`}
      onDismiss={() => {
        if (!write.pending) onClose()
      }}
      actions={
        write.outcome.kind === "done" ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button tone="secondary" disabled={write.pending} onClick={onClose}>
              Go back
            </Button>
            <Button
              disabled={locked || !ready}
              loading={write.pending}
              onClick={() => {
                if (sip === null) return
                write.submit({
                  scheduleId: schedule.scheduleId,
                  body: { expectedVersion: schedule.version, offerVersion: schedule.offer?.version ?? null, sip, extension },
                })
              }}
            >
              Send options to client
            </Button>
          </>
        )
      }
    >
      {write.outcome.kind === "done" ? (
        <Alert tone="success" title="Options sent">
          The client has an email and a notification in the app. Their choice appears on this maturity, and nothing changes until you confirm it.
        </Alert>
      ) : (
        <div className={STACK_LG}>
          <HeldWriteNotice write={write} subject="the options were sent" onReload={onReload} />
          {schedule.offer === null ? null : (
            <Alert tone="warning" title="Options were already sent">
              Sending again replaces them. The client sees only the new options, and any choice they made on the old ones is dropped.
            </Alert>
          )}
          <div className={STACK_SM}>
            <span className={ITEM_TITLE}>1. Return all the money</span>
            <p className={BODY_SM}>No figures needed: the amount is the holding&apos;s current value when you confirm.</p>
          </div>
          <div className={STACK_SM}>
            <span className={ITEM_TITLE}>2. One-time investment, then a new SIP</span>
            <FollowUpSipFields draft={draft} earliestMonth={earliestMonth} disabled={locked} onChange={setDraft} />
          </div>
          <div className={STACK_SM}>
            <span className={ITEM_TITLE}>3. Extend the SIP</span>
            {activeSip === undefined ? (
              <ActiveSipFacts choice="sip_extension" activeSip={activeSip} reload={reload} />
            ) : room === 0 ? (
              <ExtensionUnavailable activeSip={activeSip} />
            ) : (
              <>
                <Switch
                  label="Offer this option"
                  hint="Leave it out if extending the SIP is not on the table for this client."
                  checked={offerExtension}
                  disabled={locked}
                  onChange={setOfferExtension}
                />
                {offerExtension ? (
                  <>
                    <ActiveSipFacts choice="sip_extension" activeSip={activeSip} reload={reload} />
                    <ExtensionFields
                      draft={extensionDraft}
                      maturityDate={schedule.maturityDate}
                      room={room}
                      disabled={locked}
                      onChange={setExtensionDraft}
                    />
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
