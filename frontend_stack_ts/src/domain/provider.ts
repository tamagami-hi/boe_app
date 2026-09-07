const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  phonepe: "PhonePe",
}

export const paymentPartnerName = (provider: string | null): string | null => {
  if (provider === null) return null
  const trimmed = provider.trim()
  if (trimmed === "") return null
  return DISPLAY_NAMES[trimmed.toLowerCase()] ?? null
}
