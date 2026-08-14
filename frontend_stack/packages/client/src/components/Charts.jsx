// Reusable chart helpers (inline SVG paths from {x,y} series).
// Pure geometry lives in ./chartMath.js (unit-tested); this file owns rendering.
import React from 'react';
import {
  lineChartGeometry,
  buildLinePath,
  computeDonutSlices,
  describeDonutSlice as describeDonutSliceMath,
} from './chartMath.js';

// Donut ring for allocations.
export function AllocationRing({ data, size = 92, stroke = 12, gap = 2 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + d.pct, 0) || 100;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {data.map((d, i) => {
          const len = (d.pct / total) * c - gap;
          const dasharray = `${Math.max(0, len)} ${c}`;
          const seg = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={stroke}
              strokeDasharray={dasharray}
              strokeDashoffset={-offset}
            />
          );
          offset += (d.pct / total) * c;
          return seg;
        })}
      </g>
    </svg>
  );
}

export function PieChart({ data, size = 200 }) {
  // data: [{ label, percentage, color }]
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = size / 3;
  const total = data.reduce((s, d) => s + (d.percentage || 0), 0) || 100;
  const gap = 1; // degrees
  let currentAngle = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {data.map((d, i) => {
        const sliceAngle = (d.percentage / total) * 360;
        const startAngle = currentAngle + gap / 2;
        const endAngle = currentAngle + sliceAngle - gap / 2;
        const path = describeDonutSliceMath(cx, cy, outerR, innerR, startAngle, endAngle);
        currentAngle += sliceAngle;
        return <path key={i} d={path} fill={d.color} stroke="none" />;
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Fund vs benchmark comparison line chart (two overlaid trend lines, no axes)
// ---------------------------------------------------------------------------

// series: [{ date, fund, nifty }]. Renders nothing below two points so the
// caller can show a "performance pending" state instead of a misleading line.
export function LineComparisonChart({
  series,
  width = 320,
  height = 96,
  padding = 6,
  fundColor = 'var(--be-green)',
  benchmarkColor = 'var(--be-slate)',
  strokeWidth = 2,
  showLegend = false,
  legendFundLabel = 'Fund',
  legendBenchmarkLabel = 'Nifty',
  className = '',
}) {
  const rows = Array.isArray(series) ? series : [];
  if (rows.length < 2) return null;

  const geo = lineChartGeometry(rows, { width, height, padding });
  const fundPath = buildLinePath(geo.fund);
  const benchmarkPath = buildLinePath(geo.nifty);

  return (
    <div className={`apk-line-chart ${className}`.trim()}>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Fund performance compared with benchmark"
      >
        <path d={benchmarkPath} fill="none" stroke={benchmarkColor} strokeWidth={strokeWidth}
          strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
        <path d={fundPath} fill="none" stroke={fundColor} strokeWidth={strokeWidth}
          strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {showLegend && (
        <div className="apk-line-chart-legend">
          <span className="apk-line-chart-legend-item">
            <span className="apk-line-chart-swatch" style={{ '--be-chart-swatch-color': fundColor }} />
            {legendFundLabel}
          </span>
          <span className="apk-line-chart-legend-item">
            <span className="apk-line-chart-swatch" style={{ '--be-chart-swatch-color': benchmarkColor }} />
            {legendBenchmarkLabel}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flat donut chart with an optional center label (asset split / sector mix)
// ---------------------------------------------------------------------------

// data: [{ label, percentage, color }]. Renders nothing when empty so the
// caller can hide the whole section.
export function DonutChart({
  data,
  size = 180,
  thickness = 26,
  gap = 1.2,
  centerLabel = '',
  centerSubLabel = '',
  className = '',
  ariaLabel = 'Allocation breakdown',
}) {
  const rows = Array.isArray(data) ? data : [];
  const outerR = size / 2 - 2;
  const innerR = outerR - thickness;
  const slices = computeDonutSlices(rows, { cx: size / 2, cy: size / 2, outerR, innerR, gap });
  if (slices.length === 0) return null;

  return (
    <svg
      className={`apk-donut ${className}`.trim()}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
    >
      {slices.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} stroke="none" />
      ))}
      {centerLabel && (
        <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
          className="apk-donut-center" fontSize={size * 0.11} fontWeight="600">
          {centerLabel}
        </text>
      )}
      {centerSubLabel && (
        <text x={size / 2} y={size / 2 + size * 0.11} textAnchor="middle" dominantBaseline="central"
          className="apk-donut-subcenter" fontSize={size * 0.06}>
          {centerSubLabel}
        </text>
      )}
    </svg>
  );
}
