export class CoordError extends Error {
  constructor(message, exitCode = 1, code = "COORD_ERROR") {
    super(message);
    this.name = "CoordError";
    this.exitCode = exitCode;
    this.code = code;
  }
}

export function usageError(message) {
  return new CoordError(message, 2, "USAGE_ERROR");
}

export function operationalError(message, code = "OPERATION_BLOCKED") {
  return new CoordError(message, 1, code);
}
