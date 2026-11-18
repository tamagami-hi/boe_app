import { z } from "zod"

import { isNativeShell } from "~/lib/env"
import { isNative } from "~/platform/capacitor"

export const WEB_VERSION_PATH = "/version.json"
export const WEB_VERSION_INTERVAL_MS = 5 * 60 * 1000
export const WEB_VERSION_WAKE_GAP_MS = 30_000
const WEB_VERSION_TIMEOUT_MS = 10_000

export type RunningBuild = Readonly<{ version: string; target: string }>

export type DeployedBuild = "current" | "replaced" | "unknown"

export type VersionLoader = (path: string, init: RequestInit) => Promise<Response>

const VersionManifest = z.object({
  version: z.string().trim().min(1),
  target: z.string(),
})

export const compareDeployedBuild = (manifest: unknown, running: RunningBuild): DeployedBuild => {
  const parsed = VersionManifest.safeParse(manifest)
  if (!parsed.success || parsed.data.target !== running.target) return "unknown"
  return parsed.data.version === running.version ? "current" : "replaced"
}

const isWebVersionWatched = (): boolean => !isNative() && !isNativeShell()

const loadFromOrigin: VersionLoader = (path, init) => globalThis.fetch(path, init)

const readManifest = async (load: VersionLoader): Promise<unknown> => {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, WEB_VERSION_TIMEOUT_MS)
  try {
    const response = await load(WEB_VERSION_PATH, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type WebVersionWatch = Readonly<{
  running: RunningBuild
  onDeployed: (deployed: Exclude<DeployedBuild, "unknown">) => void
  load?: VersionLoader
}>

export const watchWebVersion = ({ running, onDeployed, load = loadFromOrigin }: WebVersionWatch): (() => void) => {
  if (!isWebVersionWatched()) return () => undefined

  let isChecking = false
  let isStopped = false
  let lastCheckedAt: number | null = null

  const check = (): void => {
    if (isChecking || isStopped || document.visibilityState === "hidden") return
    isChecking = true
    void readManifest(load)
      .then((manifest) => {
        const deployed = compareDeployedBuild(manifest, running)
        if (!isStopped && deployed !== "unknown") onDeployed(deployed)
      })
      .catch((error: unknown) => {
        console.error("Web version check failed", error)
      })
      .finally(() => {
        isChecking = false
        lastCheckedAt = Date.now()
      })
  }

  const wake = (): void => {
    if (lastCheckedAt !== null && Date.now() - lastCheckedAt < WEB_VERSION_WAKE_GAP_MS) return
    check()
  }

  document.addEventListener("visibilitychange", wake)
  window.addEventListener("focus", wake)
  const timer = window.setInterval(check, WEB_VERSION_INTERVAL_MS)
  check()

  return () => {
    isStopped = true
    document.removeEventListener("visibilitychange", wake)
    window.removeEventListener("focus", wake)
    window.clearInterval(timer)
  }
}
