type Listener = () => void

const listeners = new Set<Listener>()

let locked = false
let lastSeenAt: number | null = null
let nativePromptDepth = 0

const notify = (): void => {
  for (const listener of listeners) listener()
}

export const isDeviceLocked = (): boolean => locked

export const subscribeToDeviceLock = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const lockDevice = (): void => {
  if (locked) return
  locked = true
  notify()
}

export const unlockDevice = (at: number = Date.now()): void => {
  lastSeenAt = at
  if (!locked) return
  locked = false
  notify()
}

export const recordDeviceLeft = (at: number): void => {
  if (nativePromptDepth > 0) return
  lastSeenAt = at
}

export const readDeviceLeftAt = (): number | null => lastSeenAt

export const beginNativePrompt = (): void => {
  nativePromptDepth += 1
}

export const endNativePrompt = (): void => {
  nativePromptDepth = nativePromptDepth > 0 ? nativePromptDepth - 1 : 0
}

export const isNativePromptInFlight = (): boolean => nativePromptDepth > 0
