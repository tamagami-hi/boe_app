import { useEffect, useState } from "react"

import { useDeviceLocked } from "~/app/native/DeviceLockGate"
import { Modal } from "~/app/overlays/Modal"
import { useOverlayStack } from "~/app/providers/OverlayStackProvider"
import { useSession } from "~/app/providers/SessionProvider"
import { Button } from "~/ui/primitives/Button"

import { RELEASE, RELEASE_HEADING, RELEASES } from "./whatsNew.recipe"
import { unseenEntries, type WhatsNewNotes as Notes } from "./whatsNewEntry"
import { WhatsNewNotes } from "./WhatsNewNotes"
import { browserWhatsNewSeen, type WhatsNewSeen } from "./whatsNewSeen"

export type WhatsNewPromptProps = Readonly<{
  notes: Notes
  seen?: WhatsNewSeen
  isHeldBack?: boolean
}>

type ShownSheet = Readonly<{ userId: string; entries: Notes }>

const versionLabel = ([newest, ...older]: Notes): string => {
  const oldest = older[older.length - 1]
  return oldest === undefined ? `Version ${newest.id}` : `Versions ${oldest.id} to ${newest.id}`
}

const UnseenNotes = ({ entries }: Readonly<{ entries: Notes }>): React.ReactElement => {
  if (entries.length === 1) return <WhatsNewNotes entry={entries[0]} />
  return (
    <div className={RELEASES}>
      {entries.map((entry) => (
        <div key={entry.id} className={RELEASE}>
          <h3 className={RELEASE_HEADING}>{`Version ${entry.id}`}</h3>
          <WhatsNewNotes entry={entry} headingLevel="h4" />
        </div>
      ))}
    </div>
  )
}

export const WhatsNewPrompt = ({
  notes,
  seen = browserWhatsNewSeen,
  isHeldBack = false,
}: WhatsNewPromptProps): React.ReactElement | null => {
  const { status, principal, scope } = useSession()
  const { depth } = useOverlayStack()
  const locked = useDeviceLocked()
  const [armedFor, setArmedFor] = useState<string | null>(null)
  const [shown, setShown] = useState<ShownSheet | null>(null)

  const userId = status === "authenticated" && principal?.accountState === "active" ? principal.userId : null
  const open = userId !== null && shown?.userId === userId ? shown : null
  const canShow = open === null && depth === 0 && !locked && !isHeldBack
  const unseen = canShow && userId !== null ? unseenEntries(notes, seen.lastSeen(scope, userId)) : null

  useEffect(() => {
    if (unseen === null || userId === null) return
    if (armedFor === userId) setShown({ userId, entries: unseen })
    else setArmedFor(userId)
  }, [unseen, armedFor, userId])

  if (open === null) return null

  const close = (): void => {
    seen.markSeen(scope, open.userId, notes[0].id)
    setShown(null)
  }

  return (
    <Modal
      open
      title="What's new"
      description={versionLabel(open.entries)}
      onDismiss={close}
      actions={<Button onClick={close}>Done</Button>}
    >
      <UnseenNotes entries={open.entries} />
    </Modal>
  )
}
