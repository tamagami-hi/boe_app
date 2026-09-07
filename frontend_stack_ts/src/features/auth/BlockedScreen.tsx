import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"

import { AuthLayout } from "~/app/layouts/AuthLayout"
import { useSession } from "~/app/providers/SessionProvider"
import { useAuthPort } from "~/features/auth/authPort"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

type Unavailable = Readonly<{
  panelTitle: string
  alertTitle: string
  body: string
}>

const SUSPENDED: Unavailable = {
  panelTitle: "Account on hold",
  alertTitle: "Your account is on hold",
  body: "Investing is paused for now. Support can tell you what is needed to lift it.",
}

const CLOSED: Unavailable = {
  panelTitle: "Account closed",
  alertTitle: "Your account is closed",
  body: "Investing and account changes are no longer available. Support can help with anything you still hold.",
}

const UNKNOWN: Unavailable = {
  panelTitle: "Account unavailable",
  alertTitle: "We can't open your account right now",
  body: "Support can look into this for you.",
}

const BlockedScreen = (): React.ReactElement => {
  const port = useAuthPort()
  const session = useSession()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const accountState = session.principal?.accountState ?? null

  if (accountState === "active" || accountState === "invited") {
    return <Navigate to={port.homePath} replace />
  }

  const copy =
    accountState === "closed" ? CLOSED : accountState === "suspended" ? SUSPENDED : UNKNOWN

  return (
    <AuthLayout eyebrow={port.audienceLabel} panelTitle={copy.panelTitle}>
      <Alert tone="warning" title={copy.alertTitle}>
        {copy.body}
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
        tone="secondary"
        size="lg"
        fullWidth
        loading={signingOut}
        onClick={() => {
          setSigningOut(true)
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
