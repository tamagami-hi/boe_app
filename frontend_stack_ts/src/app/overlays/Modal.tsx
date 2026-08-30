import { useEffect, useId, useRef } from "react"
import type { ReactNode } from "react"

import { useOverlayStack } from "~/app/providers/OverlayStackProvider"
import { Sheet } from "~/ui/primitives/Sheet"

export type ModalProps = Readonly<{
  open: boolean
  title: string
  description?: string
  actions?: ReactNode
  onDismiss: () => void
  children?: ReactNode
}>

export const Modal = ({
  open,
  title,
  description,
  actions,
  onDismiss,
  children,
}: ModalProps): React.ReactElement | null => {
  const { register } = useOverlayStack()
  const id = useId()
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (!open) return
    return register({
      id,
      dismiss: () => {
        dismiss.current()
      },
    })
  }, [open, register, id])

  return (
    <Sheet
      open={open}
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(actions === undefined ? {} : { actions })}
      onDismiss={onDismiss}
    >
      {children}
    </Sheet>
  )
}
