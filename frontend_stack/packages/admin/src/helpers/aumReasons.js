export const AUM_ADJUSTMENT_REASONS = [
  { value: 'monthly_valuation', label: 'Monthly valuation' },
  { value: 'quarterly_valuation', label: 'Quarterly valuation' },
  { value: 'market_movement', label: 'Market movement' },
  { value: 'inflow_adjustment', label: 'Inflow adjustment' },
  { value: 'outflow_adjustment', label: 'Outflow adjustment' },
  { value: 'audit_alignment', label: 'Audit alignment' },
  { value: 'rebalance', label: 'Rebalance' },
];

export const AUM_OPENING_REASONS = [
  { value: 'initial_publication', label: 'Initial publication' },
  { value: 'fund_launch', label: 'Fund launch' },
  { value: 'migration_opening_balance', label: 'Migration opening balance' },
];

export const AUM_CORRECTION_REASONS = [
  { value: 'valuation_error', label: 'Valuation error' },
  { value: 'data_entry_error', label: 'Data entry error' },
  { value: 'restated_valuation', label: 'Restated valuation' },
  { value: 'audit_correction', label: 'Audit correction' },
];

const INDIA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayInIndia() {
  return INDIA_DATE_FORMATTER.format(new Date());
}

export function isReasonCode(options, value) {
  return options.some((option) => option.value === value);
}
