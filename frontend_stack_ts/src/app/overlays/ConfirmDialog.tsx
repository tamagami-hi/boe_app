import type { ReactNode } from "react"

import { Modal } from "~/app/overlays/Modal"
import { Button } from "~/ui/primitives/Button"
import type { ButtonTone } from "~/ui/primitives/Button"

export type ConfirmDialogProps = Readonly<{
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  confirmTone?: ButtonTone
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}>

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Leave it as it is",
  confirmTone = "primary",
  pending = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps): React.ReactElement | null => (
  <Modal
    open={open}
    title={title}
    {...(description === undefined ? {} : { description })}
    onDismiss={onCancel}
    actions={
      <>
        <Button tone="ghost" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button tone={confirmTone} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </>
    }
  >
    {children}
  </Modal>
)
