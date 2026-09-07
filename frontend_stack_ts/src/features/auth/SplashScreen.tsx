import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"

import { AuthLayout } from "~/app/layouts/AuthLayout"
import { useSession } from "~/app/providers/SessionProvider"
import { useAuthPort } from "~/features/auth/authPort"
import { Button } from "~/ui/primitives/Button"
import { Alert, Spinner } from "~/ui/primitives/Feedback"

type Reachability = "probing" | "reachable" | "unreachable"

const SplashScreen = (): React.ReactElement => {
  const port = useAuthPort()
  const session = useSession()
  const [reachability, setReachability] = useState<Reachability>("probing")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setReachability("probing")
    void port
      .probeReachability()
      .then((reachable) => {
        if (!cancelled) setReachability(reachable ? "reachable" : "unreachable")
      })
      .catch(() => {
        if (!cancelled) setReachability("unreachable")
      })
    return () => {
      cancelled = true
    }
  }, [port, attempt])

  if (reachability === "reachable" && session.status === "authenticated") {
    return <Navigate to={port.homePath} replace />
  }

  if (reachability === "reachable" && session.status === "anonymous") {
    return <Navigate to={port.loginPath} replace />
  }

  return (
    <AuthLayout
      eyebrow={port.audienceLabel}
      panelTitle={reachability === "unreachable" ? "No connection" : "Starting BeOnEdge"}
    >
      {reachability === "unreachable" ? (
        <>
          <Alert tone="error" title="We can\u2019t reach BeOnEdge">
            Check your connection and try again.
          </Alert>
          <Button
            size="lg"
            fullWidth
            onClick={() => {
              setAttempt((current) => current + 1)
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <Spinner size="md" label="Starting BeOnEdge" />
      )}
    </AuthLayout>
  )
}

export default SplashScreen
