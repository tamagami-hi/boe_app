export type BackPolicyInput = Readonly<{ pathname: string }>

export type BackPolicy = Readonly<{
  isTransactional: boolean
  parentPath: string | null
  isPrimary: boolean
  isHome: boolean
  isPublic: boolean
  homePath: string
}>

export type BackPolicyResolver = (input: BackPolicyInput) => BackPolicy

export const BACK_RESULT = Object.freeze({
  HANDLED: "handled",
  PASS: "pass",
  EXIT: "exit",
} as const)

export type BackResult = (typeof BACK_RESULT)[keyof typeof BACK_RESULT]
