import { Alert } from "~/ui/primitives/Feedback"

export const HeldNotKept = (): React.ReactElement => (
  <Alert tone="warning" title="Stay on this page">
    This browser could not keep the unconfirmed request, so leaving or reloading this page loses it. Use Check again
    here until it is confirmed.
  </Alert>
)
