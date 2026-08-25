import type { FastifyInstance } from "fastify"
import { z } from "zod"

import { verifyPaymentReturnToken } from "../domain/payments/paymentReturnToken.js"

export interface PaymentReturnRouteDeps {
  readonly clock: () => Date
  readonly signingKey: Buffer
}

const querySchema = z.object({ token: z.string().max(256) }).strict()

const page = (isValid: boolean): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Return to BeOnEdge</title>
</head>
<body>
<main>
<h1>${isValid ? "Payment status is being confirmed" : "This payment return link is unavailable"}</h1>
<p>${isValid ? "Reopen BeOnEdge and check Transactions for the latest status." : "Reopen BeOnEdge and check Transactions. Contact support if you need help."}</p>
<p>No payment result is confirmed by this page.</p>
</main>
</body>
</html>`

export const registerPaymentReturnRoutes = (
  application: FastifyInstance,
  deps: PaymentReturnRouteDeps,
): void => {
  application.get("/payment-return", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query)
    const isValid = parsed.success && verifyPaymentReturnToken(deps.signingKey, parsed.data.token, deps.clock())
    return reply
      .code(isValid ? 200 : 400)
      .headers({
        "cache-control": "no-store, max-age=0",
        "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      })
      .type("text/html; charset=utf-8")
      .send(page(isValid))
  })
}
