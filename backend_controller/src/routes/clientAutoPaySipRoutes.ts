import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope, UserId } from "../db/repositories.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import { deriveInvestingEligibility } from "../domain/client/investingEligibility.js"
import { checkoutSecondsRemaining } from "../domain/payments/checkoutExpiry.js"
import { newMerchantOrderId, newMerchantSubscriptionId } from "../domain/payments/merchantIds.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent, idempotencyKeySchema } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import { logGatewayFailure, logGatewayUnconfigured } from "../providers/phonepe/gatewayFailure.js"
import type { RecurringPaymentGateway } from "../providers/recurringPaymentGateway.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { MandatesRepository } from "../repositories/mandatesRepository.js"
import type { OrderWriteRepository } from "../repositories/orderRepository.js"
import type { PaymentsRepository } from "../repositories/paymentsRepository.js"
import type { SipPlanRepository } from "../repositories/sipPlanRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"

const ROUTE = "/v1/client/sip-autopay"
const DETAIL_ROUTE = "/v1/client/sip-autopay/:sipPlanId"
const CANCEL_ROUTE = "/v1/client/sip-autopay/:sipPlanId/cancel"
const RETRY_ROUTE = "/v1/client/sip-autopay/:sipPlanId/setup/retry"
const MAX_AMOUNT_PAISE = 1_500_000n

const bodySchema = z.object({
  fundId: z.string().uuid(),
  amountPaise: z.string().regex(/^[1-9][0-9]*$/u),
  debitDay: z.number().int().min(1).max(28),
  durationMonths: z.number().int().min(1).max(360),
}).strict()
const paramsSchema = z.object({ sipPlanId: z.string().uuid() }).strict()

interface PreparedAutoPay {
  readonly sipPlanId: string
  readonly mandateId: string
  readonly setupAttemptId: string
  readonly setupVersion: string
  readonly orderId: string
  readonly paymentId: string
  readonly paymentAttemptId: string
  readonly merchantOrderId: string
  readonly merchantSubscriptionId: string
  readonly amountPaise: string
  readonly setupExpiresAt: string
  readonly mandateExpiresAt: string
}

export interface ClientAutoPaySipDeps extends NativeRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly sipPlanRepository: SipPlanRepository
  readonly mandatesRepository: MandatesRepository
  readonly orderRepository: OrderWriteRepository
  readonly paymentsRepository: PaymentsRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly recurringPaymentGateway: RecurringPaymentGateway | null
  readonly config: Readonly<{
    enabled: boolean
    idempotencyTtlMs: number
    attemptTtlMs: number
    redirectUrl: string
  }>
}

const requireIdempotencyKey = (request: FastifyRequest): string => {
  const header = request.headers["idempotency-key"]
  const value = Array.isArray(header) ? header[0] : header
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { fields: { "idempotency-key": ["a valid Idempotency-Key header is required"] } })
  }
  return parsed.data
}

const scopeFor = (userId: string, key: string): IdempotencyScope => ({
  actorScope: `user:${userId}`,
  actorScopeKeyVersion: null,
  candidateActorScopes: [`user:${userId}`],
  method: "POST",
  routeTemplate: ROUTE,
  key,
})

const requestHash = (body: z.infer<typeof bodySchema>): Buffer =>
  createHash("sha256").update(JSON.stringify(body)).digest()

const firstOfMonth = (now: Date): string => `${now.toISOString().slice(0, 7)}-01`

const dateColumn = (value: Date | string): string => {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export const addUtcMonthsClamped = (now: Date, durationMonths: number): Date => {
  const targetMonth = now.getUTCMonth() + durationMonths
  const targetYear = now.getUTCFullYear() + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
    now.getUTCMilliseconds(),
  ))
}

export const buildMandateReturnUrl = (
  returnBaseUrl: string,
  identity: Readonly<{ paymentId: string; sipPlanId: string }>,
): string => {
  const url = new URL(returnBaseUrl)
  url.searchParams.set("paymentId", identity.paymentId)
  url.searchParams.set("sipPlanId", identity.sipPlanId)
  return url.toString()
}

const mapCheckout = (prepared: PreparedAutoPay, redirectUrl: string | null) => ({
  sipPlanId: prepared.sipPlanId,
  mandateId: prepared.mandateId,
  orderId: prepared.orderId,
  paymentId: prepared.paymentId,
  status: "mandate_setup_in_progress",
  checkout: redirectUrl === null ? null : { type: "redirect", url: redirectUrl },
})

const prepareAutoPay = async (
  deps: ClientAutoPaySipDeps,
  request: FastifyRequest,
  userId: string,
  body: z.infer<typeof bodySchema>,
  now: Date,
): Promise<PreparedAutoPay> => deps.unitOfWork.execute(async (tx) => {
  const idempotencyKey = requireIdempotencyKey(request)
  const outcome = await executeIdempotent<PreparedAutoPay>({
    repository: deps.idempotencyRepository,
    tx,
    scope: scopeFor(userId, idempotencyKey),
    requestHash: requestHash(body),
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
    execute: async () => {
      const user = await deps.userRepository.lockById(tx, userId as UserId)
      if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
      const compliance = await deps.orderRepository.latestCompliance(tx, userId)
      const { eligibility } = deriveInvestingEligibility({
        accountState: user.account_state,
        emailVerification: compliance.emailVerificationState === null ? null : { state: compliance.emailVerificationState },
      })
      if (eligibility === "suspended" || eligibility === "blocked") throw new AppError("ACCOUNT_NOT_ACTIVE")
      if (eligibility !== "eligible") throw new AppError("STATE_CONFLICT")
      const terms = await deps.orderRepository.findFundOrderTerms(tx, body.fundId)
      if (terms === null || terms.fundState !== "published" || terms.fundVersionId === null || terms.minimumSipPaise === null) {
        throw new AppError("STATE_CONFLICT")
      }
      const amount = BigInt(body.amountPaise)
      if (amount < BigInt(terms.minimumSipPaise) || amount > MAX_AMOUNT_PAISE) {
        throw new AppError("VALIDATION_FAILED", { fields: { amountPaise: ["amount is outside the supported SIP mandate range"] } })
      }
      const sip = await deps.sipPlanRepository.createAutoPay(tx, {
        userId,
        fundId: body.fundId,
        amountPaise: body.amountPaise,
        debitDay: body.debitDay,
        durationMonths: body.durationMonths,
        now,
      })
      const merchantSubscriptionId = newMerchantSubscriptionId()
      const mandate = await deps.mandatesRepository.createMandate(tx, {
        sipPlanId: sip.id,
        userId,
        fundId: body.fundId,
        merchantSubscriptionId,
        maxAmountPaise: body.amountPaise,
      })
      const duePeriod = firstOfMonth(now)
      const order = await deps.orderRepository.createSipInstallment(tx, {
        userId,
        fundId: body.fundId,
        fundVersionId: terms.fundVersionId,
        sipPlanId: sip.id,
        amountPaise: body.amountPaise,
        currency: terms.currency,
        duePeriod,
        now,
      })
      if (order === null || await deps.paymentsRepository.markOrderPaymentPending(tx, order.id, now) === null) {
        throw new AppError("STATE_CONFLICT")
      }
      const payment = await deps.paymentsRepository.createPayment(tx, {
        orderId: order.id,
        userId,
        amountPaise: body.amountPaise,
        currency: terms.currency,
      })
      const merchantOrderId = newMerchantOrderId()
      const setupExpiresAt = new Date(now.getTime() + deps.config.attemptTtlMs)
      const paymentAttempt = await deps.paymentsRepository.createAttempt(tx, {
        paymentId: payment.id,
        userId,
        attemptNumber: 1,
        merchantOrderId,
        checkoutExpiresAt: setupExpiresAt,
        checkoutChannel: "phonepe_mandate_setup",
      })
      const setup = await deps.mandatesRepository.createSetupAttempt(tx, {
        mandateId: mandate.id,
        sipPlanId: sip.id,
        userId,
        attemptNumber: 1,
        merchantOrderId,
        setupExpiresAt,
        canonicalPayment: {
          fundId: body.fundId,
          amountPaise: body.amountPaise,
          duePeriod,
          orderId: order.id,
          paymentId: payment.id,
          paymentAttemptId: paymentAttempt.id,
        },
      })
      return { status: 201, body: {
        sipPlanId: sip.id,
        mandateId: mandate.id,
        setupAttemptId: setup.id,
        setupVersion: setup.version,
        orderId: order.id,
        paymentId: payment.id,
        paymentAttemptId: paymentAttempt.id,
        merchantOrderId,
        merchantSubscriptionId,
        amountPaise: body.amountPaise,
        setupExpiresAt: setupExpiresAt.toISOString(),
        mandateExpiresAt: addUtcMonthsClamped(now, body.durationMonths).toISOString(),
      } }
    },
  })
  return outcome.body
})

const dispatchSetup = async (
  deps: ClientAutoPaySipDeps,
  request: FastifyRequest,
  userId: string,
  prepared: PreparedAutoPay,
) => {
  if (deps.recurringPaymentGateway === null) throw new AppError("DEPENDENCY_UNAVAILABLE")
  const existing = await deps.unitOfWork.execute((tx) => deps.mandatesRepository.findSetupAttemptForOwner(tx, {
    attemptId: prepared.setupAttemptId,
    userId,
  }))
  if (existing?.state === "provider_pending") {
    const redirectUrl = existing.setup_expires_at.getTime() > deps.clock().getTime()
      ? existing.checkout_redirect_url
      : null
    return { body: mapCheckout(prepared, redirectUrl), status: 200, replay: true }
  }
  if (existing?.state === "dispatching") {
    return { body: mapCheckout(prepared, null), status: 200, replay: true }
  }
  const claimed = await deps.unitOfWork.execute(async (tx) => {
    const setup = await deps.mandatesRepository.claimCanonicalSetupDispatch(tx, {
      attemptId: prepared.setupAttemptId,
      userId,
      expectedVersion: existing?.version ?? prepared.setupVersion,
      now: deps.clock(),
    })
    if (setup === null) return null
    const paymentAttempt = await deps.paymentsRepository.markMandateAttemptDispatchStarted(tx, prepared.paymentAttemptId, deps.clock())
    if (paymentAttempt === null) throw new AppError("STATE_CONFLICT")
    return setup
  })
  if (claimed === null) throw new AppError("STATE_CONFLICT")
  const seconds = checkoutSecondsRemaining(new Date(prepared.setupExpiresAt), deps.clock())
  if (seconds === null) throw new AppError("STATE_CONFLICT")
  let created
  try {
    created = await deps.recurringPaymentGateway.createMandateCheckout({
      merchantOrderId: prepared.merchantOrderId,
      merchantSubscriptionId: prepared.merchantSubscriptionId,
      amountPaise: prepared.amountPaise,
      expireAfterSeconds: seconds,
      mandateExpiresAt: new Date(prepared.mandateExpiresAt),
      redirectUrl: buildMandateReturnUrl(deps.config.redirectUrl, {
        paymentId: prepared.paymentId,
        sipPlanId: prepared.sipPlanId,
      }),
    })
  } catch (error) {
    logGatewayFailure(request.log, error, { requestId: request.requestId, operation: "create_mandate_checkout" })
    throw new AppError("DEPENDENCY_UNAVAILABLE", { cause: error })
  }
  const checkoutExpiresAt = created.expiresAt.getTime() < new Date(prepared.setupExpiresAt).getTime()
    ? created.expiresAt : new Date(prepared.setupExpiresAt)
  if (checkoutExpiresAt.getTime() <= deps.clock().getTime()) throw new AppError("DEPENDENCY_UNAVAILABLE")
  await deps.unitOfWork.execute(async (tx) => {
    const setup = await deps.mandatesRepository.persistSetupDispatch(tx, {
      merchantOrderId: prepared.merchantOrderId,
      expectedVersion: claimed.version,
      providerOrderId: created.providerOrderId,
      checkoutRedirectUrl: created.redirectUrl,
      checkoutExpiresAt,
      now: deps.clock(),
    })
    if (setup === null) throw new AppError("STATE_CONFLICT")
    if (await deps.paymentsRepository.markMandateAttemptDispatched(tx, {
      attemptId: prepared.paymentAttemptId,
      providerOrderId: created.providerOrderId,
      checkoutExpiresAt,
      now: deps.clock(),
    }) === null) throw new AppError("STATE_CONFLICT")
    if (await deps.paymentsRepository.markPaymentProviderPending(tx, prepared.paymentId, deps.clock()) === null) {
      throw new AppError("STATE_CONFLICT")
    }
    return setup
  })
  return { body: mapCheckout(prepared, created.redirectUrl), status: 201, replay: false }
}

const postAutoPay = async (deps: ClientAutoPaySipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  if (!deps.config.enabled) throw new AppError("DEPENDENCY_UNAVAILABLE")
  if (deps.recurringPaymentGateway === null) {
    logGatewayUnconfigured(request.log, { requestId: request.requestId, operation: "create_mandate_checkout" })
    throw new AppError("DEPENDENCY_UNAVAILABLE")
  }
  const body = parseOrThrow(bodySchema, request.body)
  const prepared = await prepareAutoPay(deps, request, principal.userId, body, deps.clock())
  const dispatched = await dispatchSetup(deps, request, principal.userId, prepared)
  return reply.sendData(dispatched.body, {
    status: dispatched.status,
    ...(dispatched.replay ? { idempotencyReplay: true } : {}),
  })
}

const getAutoPay = async (deps: ClientAutoPaySipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const params = parseOrThrow(paramsSchema, request.params)
  const result = await deps.unitOfWork.execute(async (tx) => {
    const sip = await deps.sipPlanRepository.lockById(tx, { sipPlanId: params.sipPlanId, userId: principal.userId })
    if (sip === null || sip.collection_mode !== "phonepe_autopay") throw new AppError("RESOURCE_NOT_FOUND")
    const mandate = await deps.mandatesRepository.findLatestMandateForOwner(tx, {
      sipPlanId: sip.id,
      userId: principal.userId,
    })
    if (mandate === null) throw new AppError("RESOURCE_NOT_FOUND")
    const setup = await deps.mandatesRepository.findLatestSetupForOwner(tx, {
      sipPlanId: sip.id,
      userId: principal.userId,
    })
    const payment = setup?.payment_id === null || setup?.payment_id === undefined
      ? null
      : await deps.paymentsRepository.lockPaymentById(tx, setup.payment_id)
    const cancellation = await deps.mandatesRepository.findCancelCommandForOwner(tx, {
      sipPlanId: sip.id,
      userId: principal.userId,
    })
    const canRetrySetup = sip.state === "pending_mandate" && mandate.state === "setup_pending" &&
      setup?.state === "failed" && payment?.state === "failed"
    return { sip, mandate, setup, cancellation, canRetrySetup }
  })
  return reply.sendData({
    sipPlanId: result.sip.id,
    fundId: result.sip.fund_id,
    amountPaise: result.sip.amount_paise,
    debitDay: result.sip.debit_day,
    durationMonths: result.sip.duration_months,
    status: result.sip.state,
    canRetrySetup: result.canRetrySetup,
    setup: result.setup === null ? null : {
      setupAttemptId: result.setup.id,
      status: result.setup.state,
      failureCode: result.setup.failure_code,
      expiresAt: new Date(result.setup.setup_expires_at).toISOString(),
    },
    cancellation: result.cancellation === null ? null : {
      status: result.cancellation.state,
      failureCode: result.cancellation.failure_code,
    },
    mandate: {
      mandateId: result.mandate.id,
      status: result.mandate.state,
      authorizedAt: result.mandate.authorized_at === null ? null : new Date(result.mandate.authorized_at).toISOString(),
      cancellationRequestedAt: result.mandate.cancellation_requested_at === null
        ? null : new Date(result.mandate.cancellation_requested_at).toISOString(),
    },
  }, { status: 200 })
}

const postCancel = async (deps: ClientAutoPaySipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  if (deps.recurringPaymentGateway === null) throw new AppError("DEPENDENCY_UNAVAILABLE")
  const params = parseOrThrow(paramsSchema, request.params)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()
  const prepared = await deps.unitOfWork.execute(async (tx) => executeIdempotent<Readonly<{
    mandateId: string
    status: string
  }>>({
    repository: deps.idempotencyRepository,
    tx,
    scope: {
      actorScope: `user:${principal.userId}`,
      actorScopeKeyVersion: null,
      candidateActorScopes: [`user:${principal.userId}`],
      method: "POST",
      routeTemplate: CANCEL_ROUTE,
      key,
    },
    requestHash: createHash("sha256").update(JSON.stringify({ sipPlanId: params.sipPlanId })).digest(),
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
    execute: async () => {
      const sip = await deps.sipPlanRepository.lockById(tx, { sipPlanId: params.sipPlanId, userId: principal.userId })
      if (sip === null || sip.collection_mode !== "phonepe_autopay") throw new AppError("RESOURCE_NOT_FOUND")
      const mandate = await deps.mandatesRepository.findCurrentMandateForOwner(tx, {
        sipPlanId: sip.id,
        userId: principal.userId,
      })
      if (mandate === null) {
        throw new AppError("STATE_CONFLICT")
      }
      if (mandate.state === "setup_pending") {
        const setup = await deps.mandatesRepository.findLatestSetupForOwner(tx, {
          sipPlanId: sip.id,
          userId: principal.userId,
        })
        if (setup === null) throw new AppError("STATE_CONFLICT")
        if (setup.state === "created") {
          const abandoned = await deps.mandatesRepository.abandonUndispatchedSetup(tx, {
            merchantOrderId: setup.merchant_order_id,
            expectedVersion: setup.version,
            now,
          })
          if (abandoned === null) throw new AppError("STATE_CONFLICT")
          if (setup.payment_attempt_id !== null) {
            await deps.paymentsRepository.markAttemptExpired(tx, {
              attemptId: setup.payment_attempt_id,
              providerState: "ABANDONED",
              now,
            })
          }
          if (setup.payment_id !== null) await deps.paymentsRepository.markPaymentExpired(tx, setup.payment_id, now)
          if (setup.order_id !== null) {
            await deps.paymentsRepository.markOrderPaymentFailed(tx, {
              orderId: setup.order_id,
              failureCode: "SETUP_ABANDONED",
              now,
            })
          }
          const cancelled = await deps.mandatesRepository.applyProviderMandateState(tx, {
            merchantSubscriptionId: mandate.merchant_subscription_id,
            providerSubscriptionId: mandate.provider_subscription_id,
            expectedVersion: mandate.version,
            expectedSipVersion: sip.version,
            fromState: "setup_pending",
            toState: "cancelled",
            now,
          })
          if (cancelled === null) throw new AppError("STATE_CONFLICT")
          return { status: 200, body: { mandateId: mandate.id, status: "cancelled" } }
        }
        if (!["dispatching", "provider_pending", "authorized"].includes(setup.state)) {
          throw new AppError("STATE_CONFLICT")
        }
        const abandoned = await deps.mandatesRepository.requestSetupAbandonment(tx, {
          mandateId: mandate.id,
          expectedVersion: mandate.version,
          now,
        })
        if (abandoned === null) throw new AppError("STATE_CONFLICT")
        await deps.mandatesRepository.createCancelCommand(tx, {
          mandateId: mandate.id,
          sipPlanId: sip.id,
          userId: principal.userId,
          merchantSubscriptionId: mandate.merchant_subscription_id,
          previousMandateState: "setup_pending",
        })
        return { status: 202, body: { mandateId: mandate.id, status: "cancel_pending" } }
      }
      if (mandate.state !== "active" && mandate.state !== "paused") throw new AppError("STATE_CONFLICT")
      const transitioned = await deps.mandatesRepository.applyProviderMandateState(tx, {
        merchantSubscriptionId: mandate.merchant_subscription_id,
        providerSubscriptionId: mandate.provider_subscription_id,
        expectedVersion: mandate.version,
        expectedSipVersion: sip.version,
        fromState: mandate.state,
        toState: "cancel_pending",
        now,
      })
      if (transitioned === null) throw new AppError("STATE_CONFLICT")
      await deps.mandatesRepository.createCancelCommand(tx, {
        mandateId: mandate.id,
        sipPlanId: sip.id,
        userId: principal.userId,
        merchantSubscriptionId: mandate.merchant_subscription_id,
        previousMandateState: mandate.state,
      })
      return { status: 202, body: {
        mandateId: mandate.id,
        status: "cancel_pending",
      } }
    },
  }))
  return reply.sendData({ mandateId: prepared.body.mandateId, status: prepared.body.status }, {
    status: prepared.status,
    ...(prepared.replay ? { idempotencyReplay: true } : {}),
  })
}

const postRetry = async (deps: ClientAutoPaySipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  if (!deps.config.enabled || deps.recurringPaymentGateway === null) throw new AppError("DEPENDENCY_UNAVAILABLE")
  const params = parseOrThrow(paramsSchema, request.params)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()
  const outcome = await deps.unitOfWork.execute((tx) => executeIdempotent<PreparedAutoPay>({
    repository: deps.idempotencyRepository,
    tx,
    scope: {
      actorScope: `user:${principal.userId}`,
      actorScopeKeyVersion: null,
      candidateActorScopes: [`user:${principal.userId}`],
      method: "POST",
      routeTemplate: RETRY_ROUTE,
      key,
    },
    requestHash: createHash("sha256").update(JSON.stringify({ sipPlanId: params.sipPlanId })).digest(),
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
    execute: async () => {
      const sip = await deps.sipPlanRepository.lockById(tx, { sipPlanId: params.sipPlanId, userId: principal.userId })
      if (sip === null || sip.collection_mode !== "phonepe_autopay" || sip.state !== "pending_mandate") {
        throw new AppError("STATE_CONFLICT")
      }
      const mandate = await deps.mandatesRepository.findCurrentMandateForOwner(tx, {
        sipPlanId: sip.id,
        userId: principal.userId,
      })
      const previous = await deps.mandatesRepository.findLatestSetupForOwner(tx, {
        sipPlanId: sip.id,
        userId: principal.userId,
      })
      if (
        mandate === null || mandate.state !== "setup_pending" || previous === null ||
        previous.state !== "failed" || previous.order_id === null ||
        previous.payment_id === null || previous.due_period === null
      ) throw new AppError("STATE_CONFLICT")
      const payment = await deps.paymentsRepository.lockPaymentById(tx, previous.payment_id)
      if (payment === null || payment.state !== "failed") throw new AppError("STATE_CONFLICT")
      if (await deps.paymentsRepository.markPaymentRetryCreated(tx, payment.id, now) === null) throw new AppError("STATE_CONFLICT")
      if (await deps.paymentsRepository.markOrderPaymentPending(tx, previous.order_id, now) === null) throw new AppError("STATE_CONFLICT")
      const latestAttempt = await deps.paymentsRepository.latestAttempt(tx, payment.id)
      const merchantOrderId = newMerchantOrderId()
      const setupExpiresAt = new Date(now.getTime() + deps.config.attemptTtlMs)
      const paymentAttempt = await deps.paymentsRepository.createAttempt(tx, {
        paymentId: payment.id,
        userId: principal.userId,
        attemptNumber: Number(latestAttempt?.attempt_number ?? 0) + 1,
        merchantOrderId,
        checkoutExpiresAt: setupExpiresAt,
        checkoutChannel: "phonepe_mandate_setup",
      })
      const setup = await deps.mandatesRepository.createSetupAttempt(tx, {
        mandateId: mandate.id,
        sipPlanId: sip.id,
        userId: principal.userId,
        attemptNumber: previous.attempt_number + 1,
        merchantOrderId,
        setupExpiresAt,
        canonicalPayment: {
          fundId: sip.fund_id,
          amountPaise: sip.amount_paise,
          duePeriod: dateColumn(previous.due_period),
          orderId: previous.order_id,
          paymentId: payment.id,
          paymentAttemptId: paymentAttempt.id,
        },
      })
      return { status: 201, body: {
        sipPlanId: sip.id,
        mandateId: mandate.id,
        setupAttemptId: setup.id,
        setupVersion: setup.version,
        orderId: previous.order_id,
        paymentId: payment.id,
        paymentAttemptId: paymentAttempt.id,
        merchantOrderId,
        merchantSubscriptionId: mandate.merchant_subscription_id,
        amountPaise: sip.amount_paise,
        setupExpiresAt: setupExpiresAt.toISOString(),
        mandateExpiresAt: addUtcMonthsClamped(new Date(String(sip.start_date)), sip.duration_months ?? 1).toISOString(),
      } }
    },
  }))
  const dispatched = await dispatchSetup(deps, request, principal.userId, outcome.body)
  return reply.sendData(dispatched.body, {
    status: dispatched.status,
    ...(outcome.replay || dispatched.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerClientAutoPaySipRoutes = (application: FastifyInstance, deps: ClientAutoPaySipDeps): void => {
  application.post(ROUTE, async (request, reply) => postAutoPay(deps, request, reply))
  application.get(DETAIL_ROUTE, async (request, reply) => getAutoPay(deps, request, reply))
  application.post(CANCEL_ROUTE, async (request, reply) => postCancel(deps, request, reply))
  application.post(RETRY_ROUTE, async (request, reply) => postRetry(deps, request, reply))
}
