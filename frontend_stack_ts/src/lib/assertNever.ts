export class UnreachableCaseError extends Error {
  public readonly code = "UNREACHABLE_CASE"

  public constructor(value: never) {
    super(`Unhandled case: ${JSON.stringify(value)}`)
    this.name = "UnreachableCaseError"
  }
}

export const assertNever = (value: never): never => {
  throw new UnreachableCaseError(value)
}
