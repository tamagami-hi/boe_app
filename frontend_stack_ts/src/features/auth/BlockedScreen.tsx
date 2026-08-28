import { useNavigate } from "react-router-dom"

import { AuthLayout } from "~/app/layouts/AuthLayout"
import { useSession } from "~/app/providers/SessionProvider"
import { useAuthPort } from "~/features/auth/authPort"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

const BlockedScreen = (): React.ReactElement => {
  const port = useAuthPort()
  const session = useSession()
  const navigate = useNavigate()
  const closed = session.principal?.accountState === "closed"

  return (
    <AuthLayout
      eyebrow={port.audienceLabel}
      panelTitle={closed ? "Account closed" : "Account suspended"}
    >
      <Alert tone="warning" title={closed ? "This account is closed" : "This account is suspended"}>
        {closed
          ? "Investing and account changes are no longer available. Support can explain what this means for any holdings."
          : "Investing is paused on this account. Support can tell you what is needed to restore it."}
      </Alert>
      {port.supportPath === null ? null : (
        <Button
          size="lg"
          fullWidth
          onClick={() => {
            void navigate(port.supportPath ?? port.homePath)
          }}
        >
          Contact support
        </Button>
      )}
      <Button
        tone="ghost"
        size="md"
        fullWidth
        onClick={() => {
          void port.logout().finally(() => {
            session.signedOut()
            void navigate(port.loginPath, { replace: true })
          })
        }}
      >
        Sign out
      </Button>
    </AuthLayout>
  )
}

export default BlockedScreen
