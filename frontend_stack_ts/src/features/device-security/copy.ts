export const DEVICE_PIN_HONESTY =
  "This lock protects against casual access on a shared device. It is checked on this device only: it is not a password, it does not involve the server, and it does not encrypt anything. Anyone who can read this device's storage can bypass it. Your account password remains the thing that protects your money."

export const DEVICE_PIN_SUBTITLE =
  "An optional PIN for this device. It is a convenience, not a security boundary."

export const BIOMETRIC_HINT_NATIVE =
  "Uses whatever fingerprint or face this device already trusts. Enrolment changes on the device are honoured, which is a convenience trade-off, not a trust boundary."

export const BIOMETRIC_HINT_WEB =
  "Biometric unlock needs the Android app. On the web the PIN is the only option."

export const BIOMETRIC_HINT_UNENROLLED =
  "This device reports no enrolled fingerprint or face. Add one in the device settings and this option becomes available."
