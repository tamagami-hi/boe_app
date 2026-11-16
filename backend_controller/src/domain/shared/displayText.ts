const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

const LAKH_GROUPS = /\B(?=(?:[0-9]{2})+$)/gu

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => HTML_ESCAPES[character] ?? character)

export const groupIndian = (digits: string): string => {
  if (digits.length <= 3) return digits
  const head = digits.slice(0, -3)
  return `${head.replace(LAKH_GROUPS, ",")},${digits.slice(-3)}`
}
