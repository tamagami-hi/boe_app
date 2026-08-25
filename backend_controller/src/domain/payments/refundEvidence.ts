export interface RefundEvidenceCorrelation {
  readonly expectedAmountPaise: string
  readonly expectedMerchantOrderId: string
  readonly expectedProviderRefundId: string | null
  readonly providerRefundId: string | null
  readonly amountPaise: string | null
  readonly originalMerchantOrderId: string | null
}

export const isRefundEvidenceCorrelated = (evidence: RefundEvidenceCorrelation): boolean =>
  evidence.amountPaise === evidence.expectedAmountPaise &&
  evidence.originalMerchantOrderId === evidence.expectedMerchantOrderId &&
  Boolean(evidence.providerRefundId) &&
  (evidence.expectedProviderRefundId === null || evidence.providerRefundId === evidence.expectedProviderRefundId)
