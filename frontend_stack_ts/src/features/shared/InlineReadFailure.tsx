import { Button } from "~/ui/primitives/Button"

import { INLINE_RETRY } from "./shared.recipe"

export type InlineReadFailureProps = Readonly<{
  retrying: boolean
  onRetry: () => void
  label?: string
  className?: string | undefined
}>

export const InlineReadFailure = ({
  retrying,
  onRetry,
  label = "Couldn’t check",
  className,
}: InlineReadFailureProps): React.ReactElement => (
  <span className={INLINE_RETRY}>
    <span className={className}>{label}</span>
    <Button tone="ghost" size="sm" loading={retrying} onClick={onRetry}>
      Try again
    </Button>
  </span>
)
