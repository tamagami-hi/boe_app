/**
 * Argon2id password hashing (spec 02 §3.5, 03 user_credentials, 04 §2.1). Uses
 * the pinned `argon2` binding with OWASP-recommended Argon2id parameters; the
 * encoded hash begins with `$argon2id$` to satisfy the `user_credentials`
 * prefix CHECK. Passwords are never trimmed, normalized, or logged.
 *
 * Placed under `src/auth/` (not `src/security/`) to avoid a basename collision
 * with the legacy `src/security/passwords.js` at module resolution.
 */
import { argon2id, hash, verify } from "argon2"
import { z } from "zod"

const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/** `PasswordInput`: 12-128 Unicode code points, no NUL/control characters. */
export const passwordInputSchema = z
  .string()
  .refine((value) => {
    const length = [...value].length
    return length >= 12 && length <= 128
  }, "must be 12 to 128 characters")
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "must not contain control characters")

/** Hash a password into an encoded Argon2id string. */
export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2_OPTIONS)

/** Verify a password against an encoded Argon2id hash. */
export const verifyPassword = (encodedHash: string, password: string): Promise<boolean> =>
  verify(encodedHash, password)

let dummyHash: Promise<string> | undefined

/**
 * Perform a bounded dummy Argon2id verification so an unknown identifier or a
 * user with no credential takes the same timing class as a real verification
 * (spec 03). Always resolves to false.
 */
export const verifyDummyPassword = async (password: string): Promise<false> => {
  dummyHash ??= hash("timing-equalisation-placeholder", ARGON2_OPTIONS)
  try {
    await verify(await dummyHash, password)
  } catch {
    // ignored; the dummy verification exists only to equalise timing
  }
  return false
}
