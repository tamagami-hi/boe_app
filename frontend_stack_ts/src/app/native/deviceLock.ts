type Listener = () => void

const listeners = new Set<Listener>()

let locked = false
let leftAt: number | null = null

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

export const unlockDevice = (): void => {
  leftAt = null
  if (!locked) return
  locked = false
  notify()
}

export const recordDeviceLeft = (at: number): void => {
  leftAt = at
}

export const readDeviceLeftAt = (): number | null => leftAt
