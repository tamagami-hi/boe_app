import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"

import logoMark from "~/assets/logo-mark.svg"
import logoAdmin from "~/assets/logo-admin.svg"
import { useSession } from "~/app/providers/SessionProvider"
import { useAuthPort } from "~/features/auth/authPort"
import { canCheckForUpdates, readInstalledApp } from "~/platform/appUpdate"
import { Button } from "~/ui/primitives/Button"
import { Alert, Spinner } from "~/ui/primitives/Feedback"

import "./splash.css"

const SPLASH_MIN_VISIBLE_MS = 1_600

type Reachability = "probing" | "reachable" | "unreachable"

const SplashScreen = (): React.ReactElement => {
  const port = useAuthPort()
  const session = useSession()
  const [reachability, setReachability] = useState<Reachability>("probing")
  const [attempt, setAttempt] = useState(0)
  const [hasShownBrand, setHasShownBrand] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const isAdmin = session.scope === "admin"
  const needsRetry = reachability === "unreachable" || (session.status === "restoring" && session.error !== null)

  useEffect(() => {
    if (!canCheckForUpdates()) return
    let cancelled = false
    void readInstalledApp()
      .then((installed) => {
        if (!cancelled) setVersion(installed.versionName.trim() || null)
      })
      .catch(() => {
        if (!cancelled) setVersion(null)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { setHasShownBrand(true) }, SPLASH_MIN_VISIBLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [])

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

  if (hasShownBrand && reachability === "reachable" && session.status === "authenticated") {
    return <Navigate to={port.homePath} replace />
  }

  if (hasShownBrand && reachability === "reachable" && session.status === "anonymous") {
    return <Navigate to={port.loginPath} replace />
  }

  return (
    <main className="be-splash" aria-label={isAdmin ? "Starting BeOnEdge admin" : "Starting BeOnEdge"}>
      <div className="be-splash-brand">
        <img className="be-splash-logo" src={isAdmin ? logoAdmin : logoMark} width={52} height={104} alt="" aria-hidden="true" />
        <div className="be-splash-wordmark">
          <div className="be-splash-mask"><span className="be-splash-name">BeOnEdge</span></div>
          {isAdmin ? <div className="be-splash-mask"><span className="be-splash-role">Admin</span></div> : null}
        </div>
      </div>
      <div className="be-splash-status" role="status" aria-live="polite">
        {hasShownBrand && needsRetry ? (
          <>
            <Alert tone="error" title="We can’t reach BeOnEdge">
              Check your connection and try again.
            </Alert>
            <Button
              size="lg"
              fullWidth
              onClick={() => {
                setAttempt((current) => current + 1)
                if (session.error !== null) session.retryRestore()
              }}
            >
              Try again
            </Button>
          </>
        ) : hasShownBrand ? <Spinner size="md" label="Connecting to BeOnEdge" /> : null}
      </div>
      <footer className="be-splash-footer">
        {version !== null && <span className="be-splash-version">{`v${version}`}</span>}
        <p>{isAdmin ? "Internal operations console." : "Investments are subject to market risk."}</p>
      </footer>
    </main>
  )
}

export default SplashScreen
