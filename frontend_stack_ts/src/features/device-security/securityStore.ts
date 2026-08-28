export const DEVICE_PIN_KEY = "beonedge.device-pin.v1"
export const DEVICE_BIOMETRIC_KEY = "beonedge.device-biometric.v1"

export const MIN_PIN_LENGTH = 4
export const MAX_PIN_LENGTH = 6

export type DeviceSecurityStore = Readonly<{
  read: (key: string) => string | null
  write: (key: string, value: string) => void
  remove: (key: string) => void
}>

export const browserDeviceSecurityStore = (): DeviceSecurityStore => ({
  read: (key) => {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  write: (key, value) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      void 0
    }
  },
  remove: (key) => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      void 0
    }
  },
})

export const isPinShaped = (value: string): boolean =>
  new RegExp(`^[0-9]{${String(MIN_PIN_LENGTH)},${String(MAX_PIN_LENGTH)}}$`, "u").test(value)

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

export const digestPin = async (pin: string): Promise<string> => {
  const encoded = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest("SHA-256", encoded)
  return toHex(digest)
}

export const hasDevicePin = (store: DeviceSecurityStore): boolean =>
  store.read(DEVICE_PIN_KEY) !== null

export const setDevicePin = async (
  store: DeviceSecurityStore,
  pin: string,
): Promise<void> => {
  store.write(DEVICE_PIN_KEY, await digestPin(pin))
}

export const verifyDevicePin = async (
  store: DeviceSecurityStore,
  pin: string,
): Promise<boolean> => {
  const stored = store.read(DEVICE_PIN_KEY)
  if (stored === null) return false
  return stored === (await digestPin(pin))
}

export const removeDevicePin = (store: DeviceSecurityStore): void => {
  store.remove(DEVICE_PIN_KEY)
  store.remove(DEVICE_BIOMETRIC_KEY)
}

export const isBiometricEnabled = (store: DeviceSecurityStore): boolean =>
  store.read(DEVICE_BIOMETRIC_KEY) === "on"

export const setBiometricEnabled = (store: DeviceSecurityStore, enabled: boolean): void => {
  if (enabled) {
    store.write(DEVICE_BIOMETRIC_KEY, "on")
    return
  }
  store.remove(DEVICE_BIOMETRIC_KEY)
}
