const HEX_GROUPS = /[^0-9a-z]/giu

export const supportReference = (identifier: string | null | undefined): string | null => {
  if (typeof identifier !== "string") return null
  const compact = identifier.replace(HEX_GROUPS, "").toUpperCase()
  if (compact.length < 8) return null
  return compact.slice(0, 8)
}
