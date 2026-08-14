import React from 'react';
import { formatMoney } from '../format.js';
import DataFreshnessBadge from './DataFreshnessBadge.jsx';
import './MoneyValue.css';

export default function MoneyValue({
  amount,
  source,
  asOf,
  currency = 'INR',
  showBadge = true,
  decimals = 0,
  sign = false,
}) {
  const formatted = formatMoney(amount, { source, asOf, currency, decimals, sign });
  return (
    <span className="be-money-value">
      <span className="be-money">{formatted.display}</span>
      {showBadge && (
        <DataFreshnessBadge source={formatted.source} asOf={formatted.asOf} />
      )}
    </span>
  );
}
