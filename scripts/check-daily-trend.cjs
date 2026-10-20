// Run: node scripts/check-daily-trend.cjs
// Synthetic data only; no Supabase requests or real CSVs.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('module', 'exports', 'require', compiled)(module, module.exports,
    name => load(path.resolve(path.dirname(file), `${name}.ts`)));
  cache.set(file, module.exports);
  return module.exports;
}
const { summarizeMeterDay, meterDayBounds } = load(path.join(__dirname, '../lib/meter/today.ts'));
const { prepareDailyTrend } = load(path.join(__dirname, '../lib/meter/daily-trend.ts'));
const now = new Date('2026-10-19T05:07:00Z');
const rows = (date, count) => Array.from({ length: count }, (_, i) => ({ timestamp: new Date(Date.parse(meterDayBounds(date).start) + i * 900000).toISOString(), kwh: 0.5 }));
function graph(readings, date, clock = now) {
  const summary = summarizeMeterDay(readings, date, clock);
  return prepareDailyTrend(readings, summary.coverage);
}
const full = graph(rows('2026-10-18', 96), '2026-10-18');
assert.equal(full.total, 48);
assert.equal(full.points.length, 96);
assert.equal(full.segments.length, 1);
assert.equal(full.segments[0][0].kwh, 0);
assert.equal(full.points[0].timestamp, full.startMs + 900000);
assert.equal(full.points.at(-1).timestamp, full.endMs);
const today = graph(rows('2026-10-19', 96), '2026-10-19');
assert.equal(today.total, 2);
assert.equal(today.points.at(-1).timestamp, Date.parse('2026-10-19T05:00:00Z'));
assert.equal(today.missing.length, 0); // Unfinished/future intervals are not missing.
const source = rows('2026-10-18', 96);
const gap = graph(source.filter((_, i) => i !== 2), '2026-10-18');
assert.equal(gap.total, 47.5);
assert.equal(gap.segments.length, 2);
assert.equal(gap.missing.length, 1);
assert.equal(gap.segments[0].at(-1).timestamp, gap.startMs + 2 * 900000);
assert.equal(gap.segments[1][0].timestamp, gap.startMs + 4 * 900000);
assert.equal(gap.segments[1][0].kwh, 1.5);
assert.equal(gap.segments[1][0].afterGap, true);
const leading = graph(source.slice(2, 3), '2026-10-18');
assert.equal(leading.segments[0].length, 1); // No invented zero baseline after a gap.
assert.equal(leading.points[0].afterGap, true);
assert.equal(graph([], '2026-10-18').total, null);
assert.equal(graph([...source, source[0]], '2026-10-18').total, 48);
assert.equal(graph([...source].reverse(), '2026-10-18').total, 48);
assert.equal(graph(source.map(r => ({ ...r, kwh: 0 })), '2026-10-18').total, 0);
const early = graph(rows('2026-10-19', 1), '2026-10-19', new Date('2026-10-19T04:07:00Z'));
assert.equal(early.points.length, 0);
assert.equal(early.missing.length, 0);
for (const [date, count] of [['2026-03-08', 92], ['2026-11-01', 100]]) {
  const dst = graph(rows(date, count), date, new Date('2026-11-03T12:00:00Z'));
  assert.equal(dst.total, count / 2);
  assert.equal(dst.points.at(-1).timestamp, dst.endMs);
  assert.equal(dst.ticks.length, 5);
}
console.log('Daily trend synthetic checks passed.');

const { prepareTypicalDay, trendScale, typicalWindow, typicalDifference } = load(path.join(__dirname, '../lib/meter/daily-trend.ts'));
const baselineNow = new Date('2026-10-20T12:00:00Z');
const history = [];
for (let day = 1; day <= 19; day++) {
  const date = `2026-10-${String(day).padStart(2, '0')}`;
  history.push(...rows(date, day === 17 ? 95 : 96).map(row => ({ ...row, kwh: day })));
}
const get = (mode, starts = []) => {
  const window = typicalWindow('2026-10-19', mode, starts, baselineNow);
  return prepareTypicalDay(history, '2026-10-19', baselineNow, window);
};
const bill = get('bill', ['2026-09-01', '2026-10-05', '2026-10-20']);
assert.equal(bill.count, 13);
assert.equal(bill.dates.at(-1), '2026-10-05');
assert.equal(bill.dates[0], '2026-10-18');
assert.ok(!bill.dates.includes('2026-10-17'));
assert.ok(!bill.dates.includes('2026-10-19'));
assert.equal(bill.points[1].kwh, 11);
assert.equal(bill.points.at(-1).kwh, 11 * 96);
assert.equal(get('bill').points, null);
assert.equal(get('bill', ['2026-10-19']).points, null); // First day of cycle.
const seven = get('7');
assert.equal(seven.count, 6);
assert.equal(seven.dates.at(-1), '2026-10-12');
assert.equal(seven.points[1].kwh, 14.5);
assert.equal(get('30').count, 17); // No obsolete 14-day cap.
assert.equal(typicalWindow('2026-10-19', '30', [], baselineNow).startDate, '2026-09-19');
assert.equal(prepareTypicalDay(rows('2026-10-18', 96), '2026-10-19', baselineNow).count, 1);
assert.ok(prepareTypicalDay(rows('2026-10-18', 96), '2026-10-19', baselineNow).points);
assert.equal(prepareTypicalDay([], '2026-10-19', baselineNow).points, null);
const zeros = rows('2026-10-18', 96).map(row => ({ ...row, kwh: 0 }));
assert.equal(prepareTypicalDay(zeros, '2026-10-19', baselineNow).points.at(-1).kwh, 0);
// Independently calculate the median at each cumulative endpoint.
const shapes = ['2026-10-15', '2026-10-16', '2026-10-18'].flatMap((date, day) => rows(date, 96).map((row, i) => ({ ...row, kwh: i === 0 ? [1, 5, 3][day] : i === 1 ? [8, 0, 1][day] : 0 })));
const shape = prepareTypicalDay(shapes, '2026-10-19', baselineNow);
assert.equal(shape.points[1].kwh, 3);
assert.equal(shape.points[2].kwh, 5);
const selectedNow = new Date('2026-10-19T05:07:00Z');
const summary = summarizeMeterDay(rows('2026-10-19', 96), '2026-10-19', selectedNow);
const selectedGraph = prepareDailyTrend(summary.completedReadings, summary.coverage);
const reference = prepareTypicalDay(rows('2026-10-18', 96), '2026-10-19', selectedNow);
assert.equal(typicalDifference(selectedGraph, summary.coverage, reference), 0); // 2 vs 2 at 1 AM, not 2 vs 48.
assert.equal(typicalDifference(selectedGraph, summary.coverage, null), null);
const partialSummary = summarizeMeterDay(rows('2026-10-19', 4).slice(1), '2026-10-19', selectedNow);
assert.equal(typicalDifference(prepareDailyTrend(partialSummary.completedReadings, partialSummary.coverage), partialSummary.coverage, reference), null);
const historical = summarizeMeterDay(rows('2026-10-18', 96), '2026-10-18', baselineNow);
const historicalReference = prepareTypicalDay(rows('2026-10-16', 96).map(row => ({ ...row, kwh: 1 })), '2026-10-18', baselineNow);
assert.equal(typicalDifference(prepareDailyTrend(historical.completedReadings, historical.coverage), historical.coverage, historicalReference), -48);
assert.equal(typicalWindow('2026-03-10', '7', [], baselineNow).startDate, '2026-03-03');
assert.equal(typicalWindow('2026-03-10', '7', [], baselineNow).end, '2026-03-10T04:00:00.000Z');
assert.equal(typicalWindow('2026-03-10', '7', [], baselineNow).start, '2026-03-03T05:00:00.000Z');
assert.equal(prepareTypicalDay(rows('2026-03-07', 96), '2026-03-08', baselineNow).count, 0);
assert.deepEqual(trendScale(47), { max: 50, ticks: [0, 10, 20, 30, 40, 50] });
assert.deepEqual(trendScale(0), { max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] });
assert.ok(trendScale(101).max >= 101);
console.log('PASS bill-cycle/7/30-day windows, complete-day filtering, cumulative medians, exact-endpoint differences, gaps, DST boundaries, and rounded ticks.');

const { baselineConfidence, trendPointLabel, scrubDifference } = load(path.join(__dirname, '../lib/meter/daily-trend.ts'));
assert.equal(baselineConfidence(0), 'No complete comparison days available.');
assert.equal(baselineConfidence(1), 'Limited baseline · 1 complete day');
assert.equal(baselineConfidence(2), 'Limited baseline · 2 complete days');
assert.equal(baselineConfidence(3), 'Typical · median of 3 complete days');
assert.equal(baselineConfidence(7), 'Typical · median of 7 complete days');
assert.equal(trendPointLabel(full.endMs, full.endMs), 'End of day');
assert.equal(trendPointLabel(full.startMs, full.endMs), '12:00 AM');
assert.equal(trendPointLabel(full.startMs + 18 * 3600000, full.endMs), '6:00 PM');
assert.equal(scrubDifference(selectedGraph.points.at(-1), reference), 0);
assert.equal(scrubDifference({ ...selectedGraph.points.at(-1), kwh: 3.6 }, reference), 1.6);
assert.ok(Math.abs(scrubDifference({ ...selectedGraph.points.at(-1), kwh: 1.1 }, reference) + 0.9) < 1e-12);
assert.equal(scrubDifference({ ...selectedGraph.points.at(-1), afterGap: true }, reference), null);
assert.equal(scrubDifference(selectedGraph.points.at(-1), null), null);
assert.equal(scrubDifference({ timestamp: selectedGraph.startMs + 60000, kwh: 1, afterGap: false }, reference), null);
for (const [date, count] of [['2026-03-08', 92], ['2026-11-01', 100]]) {
  const dst = graph(rows(date, count), date, new Date('2026-11-03T12:00:00Z'));
  assert.equal(trendPointLabel(dst.points.at(-1).timestamp, dst.endMs), 'End of day');
}
console.log('PASS confidence wording, same-endpoint scrub differences, missing-data guards, and end-of-day labels including DST.');
