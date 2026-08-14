import React from 'react';

export default function AllocationLegend({ items }) {
  return (
    <div className="apk-ha-legend">
      {items.map((it, i) => (
        <span key={i} className="apk-ha-legend-item">
          <span className="apk-ha-dot" style={{ '--sector-color': it.color }} />
          <span className="apk-ha-legend-label">{it.label}</span>
          <span className="apk-ha-legend-pct be-num">{Number(it.percentage).toFixed(2)}%</span>
        </span>
      ))}
    </div>
  );
}
