import { QueryClientProvider } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, TransportError } from "~/api/errors"
import type { HttpClient } from "~/api/http"
import type { SealedMutationResult } from "~/api/sealedMutation"
import { ApiProvider } from "~/app/providers/ApiProvider"
import { createQueryClient } from "~/app/providers/QueryProvider"
import { useChangeClientNominee } from "~/features/profile/nomineeQueries"
import { useChangeClientPhone, useConfirmEmailChange, useRequestEmailChange } from "~/features/profile/profileQueries"
import { useChangePassword, useRedeemPasswordReset, useVerifyEmail } from "~/features/shared/queries"

vi.mock("~/app/providers/SessionProvider", () => ({
  useSession: () => ({ principal: { userId: "11111111-1111-4111-8111-111111111111" } }),
}))

const PASSWORD = "Sealed-Pass-4821"
const NEW_PASSWORD = "Sealed-New-9375"
const RESET_TOKEN = "reset-token-6c1f0d9e8a7b4c3d"
const CODE = "Zq7Kx2"
const MAX_SCAN_DEPTH = 12

const SUCCESS_DATA = {
  userId: "11111111-1111-4111-8111-111111111111",
  nominee: null,
  version: 2,
  status: "changed",
  profile: { version: 1 },
}

const OUTCOMES = {
  success: () => Promise.resolve({ data: SUCCESS_DATA, meta: { requestId: "req-1", page: null } }),
  refused: () =>
    Promise.reject(
      new ApiError({ code: "INVALID_CREDENTIALS", message: "Wrong password.", status: 401, retryable: false }),
    ),
  unknown: () => Promise.reject(new TransportError("timeout", "The request timed out.")),
} as const

type Outcome = keyof typeof OUTCOMES

const answering = (first: Outcome): Readonly<{ api: HttpClient; bodies: unknown[] }> => {
  const bodies: unknown[] = []
  const request = (_operation: unknown, options?: Readonly<{ body?: unknown }>): Promise<unknown> => {
    bodies.push(options?.body)
    return OUTCOMES[bodies.length === 1 ? first : "success"]()
  }
  return { api: { request: request as unknown as HttpClient["request"] }, bodies }
}

const providers = (api: HttpClient, queryClient: QueryClient) => {
  const Providers = ({ children }: Readonly<{ children: ReactNode }>): React.ReactElement => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>{children}</ApiProvider>
    </QueryClientProvider>
  )
  return Providers
}

const exposedText = (root: unknown): string[] => {
  const seen = new WeakSet<object>()
  const found: string[] = []
  const reveal = (open: () => unknown): unknown => {
    try {
      return open()
    } catch {
      return null
    }
  }
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      found.push(value)
      return
    }
    if (value === null || typeof value !== "object" || depth > MAX_SCAN_DEPTH || seen.has(value)) return
    seen.add(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      const child: unknown = (value as Record<string, unknown>)[key]
      visit(key === "open" && typeof child === "function" ? reveal(child as () => unknown) : child, depth + 1)
    }
  }
  visit(root, 0)
  return found
}

type Mounted = Readonly<{ submit: () => void; observed: () => unknown }>

const credentialCase = <TData, TInput>(
  name: string,
  useHook: () => SealedMutationResult<TData, TInput>,
  input: TInput,
  secrets: readonly string[],
) => ({
  name,
  secrets,
  mount: (api: HttpClient, queryClient: QueryClient): Mounted => {
    const { result } = renderHook(useHook, { wrapper: providers(api, queryClient) })
    return {
      submit: () => {
        act(() => {
          result.current.mutate(input)
        })
      },
      observed: () => result.current,
    }
  },
})

const CASES = [
  credentialCase(
    "the nominee change",
    useChangeClientNominee,
    { input: { name: "Meera Krishnan", relation: "Spouse" }, currentPassword: PASSWORD },
    [PASSWORD],
  ),
  credentialCase("the phone change", useChangeClientPhone, { phone: "+919800000001", currentPassword: PASSWORD }, [
    PASSWORD,
  ]),
  credentialCase(
    "the email change request",
    useRequestEmailChange,
    { newEmail: "asha.new@example.com", currentPassword: PASSWORD },
    [PASSWORD],
  ),
  credentialCase("the email change code", useConfirmEmailChange, { code: CODE }, [CODE]),
  credentialCase("the password reset", useRedeemPasswordReset, { token: RESET_TOKEN, newPassword: NEW_PASSWORD }, [
    RESET_TOKEN,
    NEW_PASSWORD,
  ]),
  credentialCase("the password change", useChangePassword, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, [
    PASSWORD,
    NEW_PASSWORD,
  ]),
  credentialCase("the email verification code", useVerifyEmail, CODE, [CODE]),
]

const RUNS = CASES.flatMap((testCase) =>
  (Object.keys(OUTCOMES) as Outcome[]).map((outcome) => [testCase.name, outcome, testCase] as const),
)

const settled = async (queryClient: QueryClient, bodies: readonly unknown[], sent: number): Promise<void> => {
  await waitFor(() => {
    expect(bodies).toHaveLength(sent)
    expect(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.status)).not.toContain("pending")
  })
}

const leaked = (queryClient: QueryClient, mounted: Mounted, secrets: readonly string[]): string[] =>
  exposedText([queryClient.getMutationCache().getAll().map((mutation) => mutation.state), mounted.observed()]).filter(
    (text) => secrets.some((secret) => text.includes(secret)),
  )

afterEach(() => {
  cleanup()
})

describe("mutations that send a credential", () => {
  it.each(RUNS)(
    "%s sends its credential but leaves none in the mutation cache after a %s outcome and after a retry",
    async (_name, outcome, testCase) => {
      const queryClient = createQueryClient()
      const { api, bodies } = answering(outcome)
      const mounted = testCase.mount(api, queryClient)

      mounted.submit()
      await settled(queryClient, bodies, 1)
      expect(leaked(queryClient, mounted, testCase.secrets)).toEqual([])

      mounted.submit()
      await settled(queryClient, bodies, 2)
      expect(leaked(queryClient, mounted, testCase.secrets)).toEqual([])

      for (const body of bodies) {
        for (const secret of testCase.secrets) expect(JSON.stringify(body)).toContain(secret)
      }
    },
  )
})
