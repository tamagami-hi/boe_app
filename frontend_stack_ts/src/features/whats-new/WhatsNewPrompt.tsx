import { useEffect, useState } from "react"

import { useDeviceLocked } from "~/app/native/DeviceLockGate"
import { Modal } from "~/app/overlays/Modal"
import { useOverlayStack } from "~/app/providers/OverlayStackProvider"
import { useSession } from "~/app/providers/SessionProvider"
import { Button } from "~/ui/primitives/Button"

import type { WhatsNewNotes as Notes } from "./whatsNewEntry"
import { WhatsNewNotes } from "./WhatsNewNotes"
import { whatsNewNotes } from "./whatsNewNotes"
import { browserWhatsNewSeen, type WhatsNewSeen } from "./whatsNewSeen"

export type WhatsNewPromptProps = Readonly<{
  seen?: WhatsNewSeen
  notes?: Notes
}>

export const WhatsNewPrompt = ({
  seen = browserWhatsNewSeen,
  notes = whatsNewNotes(),
}: WhatsNewPromptProps): React.ReactElement | null => {
  const { status, principal, scope } = useSession()
  const { depth } = useOverlayStack()
  const locked = useDeviceLocked()
  const [armedFor, setArmedFor] = useState<string | null>(null)
  const [shownTo, setShownTo] = useState<string | null>(null)

  const latest = notes[0]
  const userId = status === "authenticated" ? (principal?.userId ?? null) : null
  const openFor = userId !== null && shownTo === userId ? userId : null
  const isDue =
    openFor === null && userId !== null && depth === 0 && !locked && seen.lastSeen(scope, userId) !== latest.id

  useEffect(() => {
    if (!isDue) return
    if (armedFor === userId) setShownTo(userId)
    else setArmedFor(userId)
  }, [isDue, armedFor, userId])

  if (openFor === null) return null

  const close = (): void => {
    seen.markSeen(scope, openFor, latest.id)
    setShownTo(null)
  }

  return (
    <Modal
      open
      title="What's new"
      description={`Version ${latest.id}`}
      onDismiss={close}
      actions={<Button onClick={close}>Done</Button>}
    >
      <WhatsNewNotes entry={latest} />
    </Modal>
  )
}
