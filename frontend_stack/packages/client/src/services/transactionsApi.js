import { apiRequest, listFromPayload } from './_util.js';
import { paiseToRupees } from '@beonedge/shared/money.js';

function transactionType(transaction) {
  const type = String(transaction?.type || transaction?.rawType || transaction?.planType || '').toLowerCase();
  if (type === 'sip' || type === 'sip_installment' || type === 'installment') return 'sip';
  if (type === 'lumpsum' || type === 'one_time' || type === 'one-time') return 'lumpsum';
  return type;
}

function applyFilter(items, filter) {
  if (filter === 'sip') return items.filter((transaction) => transactionType(transaction) === 'sip');
  if (filter === 'lumpsum') return items.filter((transaction) => transactionType(transaction) === 'lumpsum');
  if (filter === 'pending') {
    return items.filter((transaction) => transaction.status === 'payment_pending' || transaction.status === 'pending');
  }
  if (filter === 'failed') {
    return items.filter((transaction) => (
      transaction.status === 'payment_failed' ||
      transaction.status === 'approval_rejected' ||
      transaction.status === 'failed'
    ));
  }
  if (filter === 'approval') return items.filter((transaction) => transaction.status === 'awaiting_approval');
  return items;
}

// Option B ledger row -> the transaction list shape. Each row is a dated event:
// a SIP installment, a lump sum, an administrator-allocated gain, or a redemption.
function mapLedgerRow(row) {
  const label = {
    sip_installment: 'SIP installment',
    lump_sum: 'Lump sum',
    gain_allocation: 'Returns allocated',
    redemption: 'Redemption',
    adjustment: 'Adjustment',
  };
  return {
    id: row.id,
    fundId: row.fundId,
    rawType: row.type,
    type: row.type === 'sip_installment' ? 'sip' : row.type === 'lump_sum' ? 'lumpsum' : row.type,
    label: label[row.type] ?? row.type,
    amount: paiseToRupees(row.amountPaise),
    // Signed deltas explain which headline figure the row moved.
    investmentDelta: paiseToRupees(row.principalDeltaPaise),
    valueDelta: paiseToRupees(row.valueDeltaPaise),
    date: row.date,
    createdAt: row.createdAt,
    // Ledger entries are settled facts; the list has no pending state.
    status: 'completed',
    // No `note`: ledger notes are admin-private (spec §5.7). The client label
    // above comes from a strict public allowlist instead.
  };
}

export async function listTransactions({ filter = 'all' } = {}) {
  const items = listFromPayload(await apiRequest('/v1/client/transactions?limit=100')).map(mapLedgerRow);
  return applyFilter(items, filter);
}
