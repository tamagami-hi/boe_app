import { plugin } from "~/platform/capacitor"

type Unsubscribe = () => void

type ListenerHandle = Readonly<{ remove?: () => void }>

type AppPlugin = Readonly<{
  addListener?: (
    event: string,
    handler: (payload: Readonly<Record<string, unknown>>) => void,
  ) => ListenerHandle | Promise<ListenerHandle>
}>

const appPlugin = (): AppPlugin | null => plugin("App")

const subscribe = (
  event: string,
  handler: (payload: Readonly<Record<string, unknown>>) => void,
): Unsubscribe => {
  const target = appPlugin()
  if (target?.addListener === undefined) return () => undefined

  let handle: ListenerHandle | null = null
  let removed = false

  void Promise.resolve(target.addListener(event, handler))
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

export const onHardwareBack = (handler: (canGoBack: boolean) => void): Unsubscribe =>
  subscribe("backButton", (payload) => {
    handler(payload.canGoBack === true)
  })

export const onResume = (handler: () => void): Unsubscribe =>
  subscribe("resume", () => {
    handler()
  })

export const onPause = (handler: () => void): Unsubscribe =>
  subscribe("pause", () => {
    handler()
  })

export const onAppStateChange = (handler: (active: boolean) => void): Unsubscribe =>
  subscribe("appStateChange", (payload) => {
    handler(payload.isActive === true)
  })

export const onVisibilityChange = (handler: (visible: boolean) => void): Unsubscribe => {
  if (typeof document === "undefined") return () => undefined
  const listener = (): void => {
    handler(document.visibilityState === "visible")
  }
  document.addEventListener("visibilitychange", listener)
  return () => {
    document.removeEventListener("visibilitychange", listener)
  }
}
