export const SUPPORT_CATEGORIES = [
  { value: "general", label: "General question" },
  { value: "payments", label: "A payment or refund" },
  { value: "sip", label: "A SIP or AutoPay" },
  { value: "account", label: "My account or sign-in" },
  { value: "statement", label: "Statements and values" },
] as const

export const supportCategoryLabel = (value: string): string | null =>
  SUPPORT_CATEGORIES.find((category) => category.value === value)?.label ?? null
