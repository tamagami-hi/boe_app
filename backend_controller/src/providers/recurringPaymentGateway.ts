export interface CreateMandateCheckoutCommand {
  readonly merchantOrderId: string
  readonly merchantSubscriptionId: string
  readonly amountPaise: string
  readonly expireAfterSeconds: number
  readonly mandateExpiresAt: Date
  readonly redirectUrl: string
}

export interface MandateCheckoutCreated {
  readonly providerOrderId: string
  readonly providerState: "PENDING"
  readonly redirectUrl: string
  readonly expiresAt: Date
}

export interface ProviderPaymentDetail {
  readonly transactionId: string
  readonly state: string
  readonly amountPaise: string | null
  readonly instrumentType: string | null
}

export interface MandateSetupStatus {
  readonly state: "PENDING" | "FAILED" | "COMPLETED"
  readonly providerOrderId: string | null
  readonly merchantSubscriptionId: string
  readonly providerSubscriptionId: string | null
  readonly paymentDetails: readonly ProviderPaymentDetail[]
}

export type ProviderMandateState =
  | "ACTIVATION_IN_PROGRESS"
  | "ACTIVE"
  | "EXPIRED"
  | "FAILED"
  | "CANCEL_IN_PROGRESS"
  | "CANCELLED"
  | "REVOKE_IN_PROGRESS"
  | "REVOKED"
  | "PAUSE_IN_PROGRESS"
  | "PAUSED"
  | "UNPAUSE_IN_PROGRESS"

export interface MandateStatus {
  readonly state: ProviderMandateState
  readonly merchantSubscriptionId: string
  readonly providerSubscriptionId: string | null
}

export interface NotifyCollectionCommand {
  readonly merchantOrderId: string
  readonly merchantSubscriptionId: string
  readonly amountPaise: string
  readonly expireAt: Date
}

export interface CollectionNotificationResult {
  readonly providerOrderId: string
  readonly providerState: "NOTIFICATION_IN_PROGRESS"
  readonly expiresAt: Date
}

export interface CollectionStatus {
  readonly state: "NOTIFICATION_IN_PROGRESS" | "NOTIFIED" | "PENDING" | "COMPLETED" | "FAILED"
  readonly merchantOrderId: string
  readonly providerOrderId: string | null
  readonly merchantSubscriptionId: string
  readonly amountPaise: string
  readonly expiresAt: Date
  readonly paymentDetails: readonly ProviderPaymentDetail[]
}

export interface RecurringPaymentGateway {
  readonly createMandateCheckout: (command: CreateMandateCheckoutCommand) => Promise<MandateCheckoutCreated>
  readonly getSetupOrderStatus: (merchantOrderId: string) => Promise<MandateSetupStatus>
  readonly getMandateStatus: (merchantSubscriptionId: string) => Promise<MandateStatus>
  readonly notifyCollection: (command: NotifyCollectionCommand) => Promise<CollectionNotificationResult>
  readonly getCollectionStatus: (merchantOrderId: string) => Promise<CollectionStatus>
  readonly cancelMandate: (merchantSubscriptionId: string) => Promise<void>
}
