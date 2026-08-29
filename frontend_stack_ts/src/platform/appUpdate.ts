import { callPlugin, hasPlugin, isNative, plugin } from "~/platform/capacitor"
import { platformError } from "~/platform/errors"

const PLUGIN = "AppUpdate"

export const SHA256_HEX = /^[a-f0-9]{64}$/u

export type InstalledApp = Readonly<{
  applicationId: string
  versionName: string
  versionCode: number
  canInstall: boolean
}>

export type UpdateDownloadRequest = Readonly<{
  url: string
  sha256: string
  sizeBytes: number
}>

export type VerifiedDownload = Readonly<{
  path: string
  sizeBytes: number
  sha256: string
  canInstall: boolean
}>

export type DownloadProgress = Readonly<{
  receivedBytes: number
  totalBytes: number
  percent: number | null
}>

type ListenerHandle = Readonly<{ remove?: () => void }>

type ListeningPlugin = Readonly<{
  addListener?: (
    event: string,
    handler: (payload: Readonly<Record<string, unknown>>) => void,
  ) => ListenerHandle | Promise<ListenerHandle>
}>

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}

const asText = (value: unknown): string => (typeof value === "string" ? value : "")

const asCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

const asPercent = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null

const requireNative = (): void => {
  if (!isNative()) {
    throw platformError("NOT_NATIVE", "App updates are only available inside the Android app.")
  }
  if (!hasPlugin(PLUGIN)) {
    throw platformError("PLUGIN_UNAVAILABLE", "This build has no app updater.")
  }
}

export const canCheckForUpdates = (): boolean => isNative() && hasPlugin(PLUGIN)

export const readInstalledApp = async (): Promise<InstalledApp> => {
  requireNative()
  const result = asRecord(await callPlugin(PLUGIN, "getInfo"))
  const applicationId = asText(result.applicationId)
  if (applicationId === "") {
    throw platformError("OPERATION_FAILED", "The installed app did not report its identity.")
  }
  return {
    applicationId,
    versionName: asText(result.versionName),
    versionCode: asCount(result.versionCode),
    canInstall: result.canInstall === true,
  }
}

export const canInstallUpdates = async (): Promise<boolean> => {
  requireNative()
  return asRecord(await callPlugin(PLUGIN, "canInstall")).granted === true
}

export const requestInstallPermission = async (): Promise<boolean> => {
  requireNative()
  return asRecord(await callPlugin(PLUGIN, "requestInstallPermission")).granted === true
}

export const downloadUpdate = async (
  request: UpdateDownloadRequest,
): Promise<VerifiedDownload> => {
  requireNative()
  if (!SHA256_HEX.test(request.sha256)) {
    throw platformError(
      "INVALID_ARGUMENT",
      "An update will not be downloaded without its SHA-256 digest.",
    )
  }
  if (!request.url.startsWith("https://")) {
    throw platformError("INVALID_ARGUMENT", "An update download must use https.")
  }

  const result = asRecord(
    await callPlugin(PLUGIN, "downloadUpdate", {
      url: request.url,
      sha256: request.sha256,
      sizeBytes: request.sizeBytes,
    }),
  )

  const digest = asText(result.sha256)
  const path = asText(result.path)
  if (digest !== request.sha256 || path === "") {
    throw platformError(
      "OPERATION_FAILED",
      "The downloaded update could not be matched to the digest it was checked against.",
    )
  }

  return {
    path,
    sizeBytes: asCount(result.sizeBytes),
    sha256: digest,
    canInstall: result.canInstall === true,
  }
}

export const installUpdate = async (download: VerifiedDownload): Promise<void> => {
  requireNative()
  if (download.path === "" || !SHA256_HEX.test(download.sha256)) {
    throw platformError("INVALID_ARGUMENT", "Only a verified download can be installed.")
  }
  await callPlugin(PLUGIN, "installUpdate", { path: download.path })
}

export const onDownloadProgress = (
  handler: (progress: DownloadProgress) => void,
): (() => void) => {
  const target = plugin(PLUGIN) as ListeningPlugin | null
  if (target?.addListener === undefined) return () => undefined

  let handle: ListenerHandle | null = null
  let removed = false

  void Promise.resolve(
    target.addListener("downloadProgress", (payload) => {
      handler({
        receivedBytes: asCount(payload.receivedBytes),
        totalBytes: asCount(payload.totalBytes),
        percent: asPercent(payload.percent),
      })
    }),
  )
    .then((resolved) => {
      if (removed) {
        resolved.remove?.()
        return
      }
      handle = resolved
    })
    .catch(() => undefined)

  return () => {
    removed = true
    handle?.remove?.()
  }
}
