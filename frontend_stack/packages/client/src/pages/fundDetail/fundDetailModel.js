// Shared vocabulary for the fund detail modules. Extracted from FundDetail.jsx,
// which was 700 lines.

export const RISK_LABELS = {
  low: 'Low', low_moderate: 'Low-Moderate', moderate: 'Moderate',
  moderate_high: 'Moderate-High', high: 'High',
};

export const LIFECYCLE_LABELS = {
  published: 'Preview',
  active: 'Active Fund',
  paused: 'Paused',
  closed: 'Closed',
};

const DONUT_PALETTE = [
  '#1F7A4D', '#B5894A', '#5C6470', '#A8741C', '#4AA9D8',
  '#7A9E3A', '#C0563E', '#8A929D', '#3E7C8C', '#9C7339',
];

export const ADVANCED_RATIO_ROWS = [
  { key: 'pe', label: 'P/E' },
  { key: 'pb', label: 'P/B' },
  { key: 'beta', label: 'Beta' },
  { key: 'alpha', label: 'Alpha' },
  { key: 'sharpe', label: 'Sharpe' },
  { key: 'sortino', label: 'Sortino' },
];

export function withPaletteColors(items) {
  return items.map((it, i) => ({ ...it, color: it.color || DONUT_PALETTE[i % DONUT_PALETTE.length] }));
}
