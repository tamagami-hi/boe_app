export const PERMISSION_CODES = [
  "applications.read",
  "applications.decide",
  "audit.read",
  "aum.read",
  "aum.write",
  "client_growth.write",
  "client_values.read",
  "config.read",
  "config.publish",
  "content.read",
  "content.publish",
  "email_deliveries.read",
  "email_deliveries.read_masked",
  "finance.operate",
  "finance.read",
  "funds.read",
  "funds.write",
  "funds.receipts.read",
  "funds.receipts.write",
  "payments.read",
  "refunds.write",
  "support.read",
  "support.write",
  "users.read",
  "users.read_limited",
  "users.suspend",
  "users.close",
] as const

export type PermissionCode = (typeof PERMISSION_CODES)[number]

export const ROLE_CODES = ["client", "admin", "superadmin"] as const

export type RoleCode = (typeof ROLE_CODES)[number]

export const isPermissionCode = (value: unknown): value is PermissionCode =>
  typeof value === "string" && (PERMISSION_CODES as readonly string[]).includes(value)

export const hasAny = (
  granted: readonly PermissionCode[],
  required: readonly PermissionCode[],
): boolean => required.length === 0 || required.some((code) => granted.includes(code))

export const hasAll = (
  granted: readonly PermissionCode[],
  required: readonly PermissionCode[],
): boolean => required.every((code) => granted.includes(code))

export const hasRole = (granted: readonly string[], required: RoleCode): boolean =>
  granted.includes(required)
