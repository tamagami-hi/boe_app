import { EmailValidationError, safeActionUrl } from "../../email/emailValidation.js"
import { AppError } from "../../http/errorCatalog.js"

export const PASSWORD_LINK_SETTING = "CLIENT_PASSWORD_LINK_URL"

export interface PasswordLinkSettings {
  readonly clientUrl: string | null
  readonly requireHttps: boolean
}

export type PasswordLinkProblem = "missing" | "malformed" | "insecure" | "credentials" | "query_or_fragment"

export type PasswordLinkBaseResult =
  | { readonly kind: "ready"; readonly base: string }
  | { readonly kind: "unusable"; readonly problem: PasswordLinkProblem }

const PROBLEM_REASONS: Readonly<Record<PasswordLinkProblem, string>> = {
  missing: "is not set",
  malformed: "is not an absolute http or https address",
  insecure: "must use https in production",
  credentials: "must not contain a username or password",
  query_or_fragment: "must not contain a query or a fragment",
}

const unusable = (problem: PasswordLinkProblem): PasswordLinkBaseResult => ({ kind: "unusable", problem })

export const resolvePasswordLinkBase = (settings: PasswordLinkSettings): PasswordLinkBaseResult => {
  const configured = settings.clientUrl
  if (configured === null || configured.length === 0) return unusable("missing")
  let parsed: URL
  try {
    parsed = new URL(safeActionUrl(configured))
  } catch (error) {
    if (error instanceof EmailValidationError) return unusable("malformed")
    throw error
  }
  if (settings.requireHttps && parsed.protocol !== "https:") return unusable("insecure")
  if (parsed.username !== "" || parsed.password !== "") return unusable("credentials")
  if (/[?#]/u.test(configured)) return unusable("query_or_fragment")
  return { kind: "ready", base: parsed.href }
}

export const describePasswordLinkProblem = (problem: PasswordLinkProblem): string =>
  `${PASSWORD_LINK_SETTING} ${PROBLEM_REASONS[problem]}`

export const requirePasswordLinkBase = (settings: PasswordLinkSettings): string => {
  const resolved = resolvePasswordLinkBase(settings)
  if (resolved.kind === "ready") return resolved.base
  throw new AppError("DEPENDENCY_UNAVAILABLE", {
    message: `Password links are not available because ${describePasswordLinkProblem(resolved.problem)}. Nothing was saved.`,
  })
}

export const buildPasswordLink = (base: string, rawToken: string): string => {
  const url = new URL(base)
  url.searchParams.set("token", rawToken)
  return url.toString()
}
