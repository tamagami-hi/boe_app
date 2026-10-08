import { createRelayPaymentGateway } from "../providers/relay/relayPaymentGateway.js"

export const selectPaymentGateway = (serverConfig: ServerConfigForGateway) => {
  const relay = serverConfig.payments.relay
  if (relay === null) return null
  return createRelayPaymentGateway({ config: relay })
}

export type ServerConfigForGateway = Readonly<{
  payments: Readonly<{
    relay: Readonly<{ baseUrl: string; service: string; secret: string }> | null
  }>
}>
