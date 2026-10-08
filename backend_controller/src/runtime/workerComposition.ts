import type { Kysely } from "kysely"
import { createCryptoContext, parseCryptoKeys } from "../crypto/context.js"
import {
  dispatchDueDeliveries,
  type DispatchSummary,
} from "../domain/email/dispatchDueDeliveries.js"
import { createTransactionalEmailSender } from "../email/transactionalEmailSender.js"
import { createDatabase, createUnitOfWork } from "../db/database.js"
import type { Database } from "../db/types.js"
import { parseDatabaseConfig } from "../db/config.js"
import { createPool } from "../db/pool.js"
import {
  createSmtpEmailSender,
  createUnconfiguredEmailSender,
  type EmailSender,
} from "../email/emailSender.js"
import { createNotificationRepository } from "../repositories/notificationRepository.js"
import { createOrderRepository } from "../repositories/orderRepository.js"
import { createPaymentsRepository } from "../repositories/paymentsRepository.js"
import { createRefundRepository } from "../repositories/refundRepository.js"
import {
  createInvestmentSettlementRepository,
} from "../repositories/investmentSettlementRepository.js"
import { createRelayRecurringGateway } from "../providers/relay/relayRecurringGateway.js"
import type { GatewayFailureLogger } from "../providers/gatewayFailure.js"
import {
  runReconciliationPass,
  type ReconciliationSummary,
} from "../paymentReconciliationWorker.js"
import { resolveWakeDelayMs } from "../domain/payments/reconciliationCadence.js"
import {
  runMandateReconciliationPass,
  type MandateReconciliationSummary,
} from "../mandateReconciliationWorker.js"
import {
  runMandateCollectionPass,
  type MandateCollectionSummary,
} from "../mandateCollectionWorker.js"
import { runSipSchedulePass, type SipScheduleSummary } from "../sipScheduleWorker.js"
import { createAuditRepository } from "../repositories/auditRepository.js"
import { createEmailDeliveryRepository } from "../repositories/emailDeliveryRepository.js"
import { createEmailSuppressionRepository } from "../repositories/emailSuppressionRepository.js"
import { createMandatesRepository } from "../repositories/mandatesRepository.js"
import { createOutboxRepository } from "../repositories/outboxRepository.js"
import { createUserRepository } from "../repositories/userRepository.js"
import { createSipPlanRepository } from "../repositories/sipPlanRepository.js"
import { parseServerConfig } from "./environment.js"
import { selectPaymentGateway } from "./paymentGatewaySelection.js"

export interface EmailDispatchWorker {
  readonly runOnce: () => Promise<DispatchSummary>
  readonly transportConfigured: boolean
  readonly dispose: () => Promise<void>
  readonly database: Kysely<Database>
}

export const composeEmailDispatchWorker = (
  source: Readonly<Record<string, string | undefined>>,
): EmailDispatchWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const serverConfig = parseServerConfig(source)
  const crypto = createCryptoContext(parseCryptoKeys(source))

  const fromAddress = serverConfig.email.fromAddress ?? serverConfig.email.smtp?.user ?? "no-reply@localhost"
  const transport: EmailSender =
    serverConfig.email.smtp !== null
      ? createSmtpEmailSender({ ...serverConfig.email.smtp, fromAddress })
      : createUnconfiguredEmailSender()

  const deps = {
    unitOfWork,
    outboxRepository: createOutboxRepository(),
    emailDeliveryRepository: createEmailDeliveryRepository(),
    emailSuppressionRepository: createEmailSuppressionRepository(),
    sender: createTransactionalEmailSender({ sender: transport, templates: serverConfig.email.links }),
    crypto,
    clock: (): Date => new Date(),
    config: {
      topic: "email",
      workerId: source.WORKER_ID ?? "email-worker",
      leaseMs: serverConfig.email.worker.leaseMs,
      claimLimit: serverConfig.email.worker.claimLimit,
    },
  }

  return {
    runOnce: () => dispatchDueDeliveries(deps),
    transportConfigured: serverConfig.email.smtp !== null,
    dispose: async () => {
      await pool.end()
    },
    database,
  }
}

export interface PaymentReconciliationPassSummary extends ReconciliationSummary {
  readonly mandateReconciliation: MandateReconciliationSummary | null
}

export interface PaymentReconciliationWorker {
  readonly runOnce: () => Promise<PaymentReconciliationPassSummary>
  readonly gatewayConfigured: boolean
  readonly dispose: () => Promise<void>
  readonly database: Kysely<Database>
  readonly intervalMs: number
  readonly nextWakeDelayMs: () => Promise<number>
}

export const composePaymentReconciliationWorker = (
  source: Readonly<Record<string, string | undefined>>,
  logger: GatewayFailureLogger | null = null,
): PaymentReconciliationWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const serverConfig = parseServerConfig(source)

  const gateway = selectPaymentGateway(serverConfig)
  const recurringGateway =
    serverConfig.payments.relay === null
      ? null
      : createRelayRecurringGateway({ config: serverConfig.payments.relay })

  return {
    runOnce: async () => {
      if (gateway === null) {
        return {
          attemptsChecked: 0,
          attemptsResolved: 0,
          refundsChecked: 0,
          refundsResolved: 0,
          mandateReconciliation: null,
        }
      }
      const summary = await runReconciliationPass({
        unitOfWork,
        clock: (): Date => new Date(),
        paymentGateway: gateway,
        logger,
        paymentsRepository: createPaymentsRepository(),
        settlementRepository: createInvestmentSettlementRepository(),
        refundRepository: createRefundRepository(),
        config: {
          claimLimit: serverConfig.payments.reconciliation.claimLimit,
          notFoundGraceMs: serverConfig.payments.reconciliation.expiryGraceMs,
          leaseMs: serverConfig.payments.reconciliation.leaseMs,
          pendingIntervalMs: serverConfig.payments.reconciliation.intervalMs,
          maxBackoffMs: serverConfig.payments.reconciliation.maxBackoffMs,
          fastIntervalMs: serverConfig.payments.reconciliation.fastIntervalMs,
          fastWindowMs: serverConfig.payments.reconciliation.fastWindowMs,
          quarantineFailureThreshold:
            serverConfig.payments.reconciliation.quarantineFailureThreshold,
        },
      })
      if (recurringGateway === null) return { ...summary, mandateReconciliation: null }
      const mandateReconciliation = await runMandateReconciliationPass({
        unitOfWork,
        clock: (): Date => new Date(),
        recurringPaymentGateway: recurringGateway,
        mandatesRepository: createMandatesRepository(),
        paymentsRepository: createPaymentsRepository(),
        settlementRepository: createInvestmentSettlementRepository(),
        logger,
        config: {
          claimLimit: serverConfig.payments.reconciliation.claimLimit,
          notFoundGraceMs: serverConfig.payments.reconciliation.expiryGraceMs,
          cancelDispatchGraceMs: serverConfig.payments.reconciliation.expiryGraceMs,
          cancelDispatchInFlightTimeoutMs: serverConfig.payments.recurring.requestTimeoutMs,
        },
      })
      return { ...summary, mandateReconciliation }
    },
    gatewayConfigured: gateway !== null,
    dispose: async () => {
      await pool.end()
    },
    database,
    intervalMs: serverConfig.payments.reconciliation.intervalMs,
    nextWakeDelayMs: async () => {
      const now = new Date()
      const earliestDueAt = await unitOfWork.execute((tx) =>
        createPaymentsRepository().earliestReconciliationDueAt(tx, {
          now,
          createdDueBefore: new Date(
            now.getTime() - serverConfig.payments.reconciliation.expiryGraceMs,
          ),
        }),
      )
      return resolveWakeDelayMs({
        now,
        earliestDueAt,
        idleIntervalMs: serverConfig.payments.reconciliation.idleIntervalMs,
      })
    },
  }
}

export interface SipScheduleWorker {
  readonly runOnce: () => Promise<SipScheduleSummary>
  readonly dispose: () => Promise<void>
  readonly database: Kysely<Database>
}

export interface MandateCollectionWorker {
  readonly runOnce: () => Promise<MandateCollectionSummary>
  readonly gatewayConfigured: boolean
  readonly dispose: () => Promise<void>
  readonly database: Kysely<Database>
}

export const composeMandateCollectionWorker = (
  source: Readonly<Record<string, string | undefined>>,
  logger: GatewayFailureLogger | null = null,
): MandateCollectionWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)
  const serverConfig = parseServerConfig(source)
  const gateway = serverConfig.payments.relay === null
    ? null
    : createRelayRecurringGateway({ config: serverConfig.payments.relay })
  return {
    runOnce: () => gateway === null
      ? Promise.resolve({
          plansChecked: 0,
          collectionsCreated: 0,
          notificationsDispatched: 0,
          collectionsResolved: 0,
          collectionsExpired: 0,
        })
      : runMandateCollectionPass({
          unitOfWork,
          clock: (): Date => new Date(),
          recurringPaymentGateway: gateway,
          sipPlanRepository: createSipPlanRepository(),
          mandatesRepository: createMandatesRepository(),
          orderRepository: createOrderRepository(),
          paymentsRepository: createPaymentsRepository(),
          settlementRepository: createInvestmentSettlementRepository(),
          userRepository: createUserRepository(),
          auditRepository: createAuditRepository(),
          notificationRepository: createNotificationRepository(),
          logger,
          config: {
            claimLimit: 100,
            commandEnabled: serverConfig.payments.autoPay.collectionEnabled,
            merchantService: serverConfig.payments.relay?.service ?? null,
            expiryGraceMs: serverConfig.payments.reconciliation.expiryGraceMs,
          },
        }),
    gatewayConfigured: gateway !== null,
    dispose: async () => pool.end(),
    database,
  }
}

export const composeSipScheduleWorker = (
  source: Readonly<Record<string, string | undefined>>,
): SipScheduleWorker => {
  const pool = createPool(parseDatabaseConfig(source))
  const database = createDatabase(pool)
  const unitOfWork = createUnitOfWork(database)

  return {
    runOnce: () =>
      runSipSchedulePass({
        unitOfWork,
        clock: (): Date => new Date(),
        sipPlanRepository: createSipPlanRepository(),
        orderRepository: createOrderRepository(),
        userRepository: createUserRepository(),
        auditRepository: createAuditRepository(),
        notificationRepository: createNotificationRepository(),
        config: {
          claimLimit: 200,
          maxPeriodsPerPlan: 24,
        },
      }),
    dispose: async () => {
      await pool.end()
    },
    database,
  }
}
