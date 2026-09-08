import { isNative, tryCallPlugin } from "~/platform/capacitor"

export const openCheckout = async (url: string): Promise<void> => {
  if (isNative()) {
    const opened = await tryCallPlugin("Browser", "open", { url })
    if (opened !== null) return
  }

  window.location.assign(url)
}

export const closeCheckout = async (): Promise<void> => {
  if (!isNative()) return

  await tryCallPlugin("Browser", "close")
}
