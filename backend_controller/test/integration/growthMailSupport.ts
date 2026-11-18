import { createCryptoContext, parseCryptoKeys, type CryptoContext } from "../../src/crypto/context.js"
import { createClientGrowthMailRepository } from "../../src/repositories/clientGrowthMailRepository.js"
import { createEmailDeliveryRepository } from "../../src/repositories/emailDeliveryRepository.js"
import { createOutboxRepository } from "../../src/repositories/outboxRepository.js"
import type { InvestmentGrowthMailDeps } from "../../src/domain/email/investmentGrowthMail.js"
import { CRYPTO_ENV } from "./passwordMailSupport.js"

export const GROWTH_CONFIG = { idempotencyTtlMs: 86_400_000, sesConfigurationSet: "boe-transactional" } as const

export const growthMailDeps = (
  crypto: CryptoContext = createCryptoContext(parseCryptoKeys(CRYPTO_ENV)),
): Omit<InvestmentGrowthMailDeps, "config"> => ({
  outboxRepository: createOutboxRepository(),
  emailDeliveryRepository: createEmailDeliveryRepository(),
  crypto,
  clientGrowthMailRepository: createClientGrowthMailRepository(),
})
