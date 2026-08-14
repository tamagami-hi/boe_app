// Run: npm test (vitest) from frontend_stack/
// Pure chart geometry math, tested with the project's node:assert style.
import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import {
  lineChartGeometry,
  buildLinePath,
  polarToCartesian,
  describeDonutSlice,
  computeDonutSlices,
} from './chartMath.js';

const round = (n) => Math.round(n * 100) / 100;

/* -------------------- lineChartGeometry -------------------- */

const series = [
  { date: '2023-01-01', fund: 100, nifty: 100 },
  { date: '2024-01-01', fund: 120, nifty: 110 },
];

test('first and last x sit on the padded edges', () => {
  const g = lineChartGeometry(series, { width: 300, height: 80, padding: 10 });
  assert.equal(round(g.fund[0].x), 10);
  assert.equal(round(g.fund[1].x), 290);
});

test('max value maps to top padding, min to bottom', () => {
  const g = lineChartGeometry(series, { width: 300, height: 80, padding: 10 });
  // fund 120 is the global max -> y = padding (top)
  assert.equal(round(g.fund[1].y), 10);
  // fund 100 is the global min -> y = height - padding (bottom)
  assert.equal(round(g.fund[0].y), 70);
});

test('a midrange value lands between top and bottom', () => {
  const g = lineChartGeometry(series, { width: 300, height: 80, padding: 10 });
  // nifty 110 is halfway between 100 and 120 -> mid of [10,70] = 40
  assert.equal(round(g.nifty[1].y), 40);
});

test('flat series does not divide by zero (lands mid-height)', () => {
  const flat = [
    { date: '2023-01-01', fund: 100, nifty: 100 },
    { date: '2024-01-01', fund: 100, nifty: 100 },
  ];
  const g = lineChartGeometry(flat, { width: 300, height: 80, padding: 10 });
  assert.ok(Number.isFinite(g.fund[0].y));
  assert.equal(g.fund[0].y, 40); // height / 2
});

test('empty series yields empty point arrays', () => {
  const g = lineChartGeometry([], { width: 300, height: 80, padding: 10 });
  assert.deepEqual(g.fund, []);
  assert.deepEqual(g.nifty, []);
});

/* -------------------- buildLinePath -------------------- */

test('buildLinePath emits an SVG move+line path', () => {
  const path = buildLinePath([{ x: 0, y: 0 }, { x: 10, y: 5 }]);
  assert.equal(path, 'M 0 0 L 10 5');
});

test('buildLinePath returns empty string for no points', () => {
  assert.equal(buildLinePath([]), '');
});

/* -------------------- polarToCartesian -------------------- */

test('polarToCartesian maps angle 0 to the top of the circle', () => {
  const p = polarToCartesian(50, 50, 40, 0);
  assert.equal(round(p.x), 50);
  assert.equal(round(p.y), 10);
});

/* -------------------- computeDonutSlices -------------------- */

test('two equal slices produce two paths covering the ring', () => {
  const slices = computeDonutSlices(
    [{ percentage: 50, color: '#a', label: 'A' }, { percentage: 50, color: '#b', label: 'B' }],
    { cx: 50, cy: 50, outerR: 40, innerR: 24, gap: 0 },
  );
  assert.equal(slices.length, 2);
  assert.ok(slices[0].path.startsWith('M'));
  assert.equal(slices[0].color, '#a');
  assert.equal(round(slices[1].startAngle), 180);
});

test('a single 100% slice is rendered', () => {
  const slices = computeDonutSlices(
    [{ percentage: 100, color: '#a', label: 'A' }],
    { cx: 50, cy: 50, outerR: 40, innerR: 24, gap: 0 },
  );
  assert.equal(slices.length, 1);
});

test('zero-percentage slices are skipped', () => {
  const slices = computeDonutSlices(
    [{ percentage: 100, color: '#a' }, { percentage: 0, color: '#b' }],
    { cx: 50, cy: 50, outerR: 40, innerR: 24, gap: 0 },
  );
  assert.equal(slices.length, 1);
});

test('empty data yields no slices', () => {
  assert.deepEqual(computeDonutSlices([], { cx: 50, cy: 50, outerR: 40, innerR: 24 }), []);
});

test('describeDonutSlice returns a closed path', () => {
  const d = describeDonutSlice(50, 50, 40, 24, 0, 90);
  assert.ok(d.startsWith('M'));
  assert.ok(d.trim().endsWith('Z'));
});
