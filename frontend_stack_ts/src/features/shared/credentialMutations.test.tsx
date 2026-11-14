import { QueryClientProvider } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, TransportError } from "~/api/errors"
import type { HttpClient } from "~/api/http"
import { useSealedMutation } from "~/api/sealedMutation"
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

type Answering = Readonly<{ api: HttpClient; send: (body: unknown) => Promise<unknown>; bodies: unknown[] }>

const answering = (first: Outcome): Answering => {
  const bodies: unknown[] = []
  const send = (body: unknown): Promise<unknown> => {
    bodies.push(body)
    return OUTCOMES[bodies.length === 1 ? first : "success"]()
  }
  const request = (_operation: unknown, options?: Readonly<{ body?: unknown }>): Promise<unknown> => send(options?.body)
  return { api: { request: request as unknown as HttpClient["request"] }, send, bodies }
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

const HOOK_RUNS = CASES.map((testCase) => [testCase.name, testCase] as const)

const HELPER_INPUT = { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }

const HELPER_SECRETS = [PASSWORD, NEW_PASSWORD]

const settled = async (queryClient: QueryClient, bodies: readonly unknown[], sent: number): Promise<void> => {
  await waitFor(() => {
    expect(bodies).toHaveLength(sent)
    expect(queryClient.getMutationCache().getAll().map((mutation) => mutation.state.status)).not.toContain("pending")
  })
}

const leaked = (queryClient: QueryClient, observed: unknown, secrets: readonly string[]): string[] =>
  exposedText([queryClient.getMutationCache().getAll().map((mutation) => mutation.state), observed]).filter((text) =>
    secrets.some((secret) => text.includes(secret)),
  )

const expectSent = (bodies: readonly unknown[], secrets: readonly string[]): void => {
  for (const body of bodies) {
    for (const secret of secrets) expect(JSON.stringify(body)).toContain(secret)
  }
}

afterEach(() => {
  cleanup()
})

describe("useSealedMutation", () => {
  it.each(Object.keys(OUTCOMES) as Outcome[])(
    "keeps a stable mutate and leaves no input in the mutation cache after a %s outcome and after a retry",
    async (outcome) => {
      const queryClient = createQueryClient()
      const { api, send, bodies } = answering(outcome)
      const { result } = renderHook(
        () => useSealedMutation({ mutationFn: async (input: typeof HELPER_INPUT) => send(input) }),
        { wrapper: providers(api, queryClient) },
      )
      const { mutate, mutateAsync } = result.current
      const submit = (): void => {
        act(() => {
          result.current.mutate(HELPER_INPUT)
        })
      }

      submit()
      await settled(queryClient, bodies, 1)
      expect(leaked(queryClient, result.current, HELPER_SECRETS)).toEqual([])

      submit()
      await settled(queryClient, bodies, 2)
      expect(leaked(queryClient, result.current, HELPER_SECRETS)).toEqual([])

      expect(result.current.mutate).toBe(mutate)
      expect(result.current.mutateAsync).toBe(mutateAsync)
      expectSent(bodies, HELPER_SECRETS)
    },
  )
})

describe("mutations that send a credential", () => {
  it.each(HOOK_RUNS)("%s sends its credential but leaves none in the mutation cache", async (_name, testCase) => {
    const queryClient = createQueryClient()
    const { api, bodies } = answering("success")
    const mounted = testCase.mount(api, queryClient)

    mounted.submit()
    await settled(queryClient, bodies, 1)

    expect(leaked(queryClient, mounted.observed(), testCase.secrets)).toEqual([])
    expectSent(bodies, testCase.secrets)
  })
})
