export interface CreateSdkOrderCommand {
  readonly merchantOrderId: string
  readonly amountPaise: string
  readonly expireAfterSeconds: number
}

export interface SdkOrderCreated {
  readonly providerOrderId: string
  readonly providerState: string
  readonly sdkToken: string
  readonly expiresAt: Date
}

export interface MobilePaymentGateway {
  readonly createSdkOrder: (command: CreateSdkOrderCommand) => Promise<SdkOrderCreated>
}

export const paymentSdkTokenAad = (attemptId: string, providerOrderId: string): Buffer =>
  Buffer.from(`phonepe\u0000phonepe_mobile_sdk\u0000${attemptId}\u0000${providerOrderId}`, "utf8")
