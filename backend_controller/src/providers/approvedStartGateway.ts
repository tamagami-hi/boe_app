import { approvedStartUrl } from "../domain/payments/approvedCheckoutStart.js"
import type { ApprovedStartConfig } from "../domain/payments/approvedCheckoutStart.js"

import type { CreateCheckoutCommand, PaymentGateway } from "./phonepe/paymentGateway.js"

export const withApprovedStart = (
  gateway: PaymentGateway,
  config: ApprovedStartConfig,
  now: () => Date = () => new Date(),
): PaymentGateway =>
  Object.freeze({
    ...gateway,
    createCheckout: async (command: CreateCheckoutCommand) => {
      const created = await gateway.createCheckout(command)
      return {
        ...created,
        redirectUrl: approvedStartUrl(config, created.redirectUrl, now()),
      }
    },
  })
