// Run: node scripts/check-meter-details.cjs
// Synthetic fixtures only. No Supabase requests are made.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (file.endsWith(path.join('supabase', 'client.ts'))) return { supabase: {} };
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('module', 'exports', 'require', code)(module, module.exports,
    name => load(path.resolve(path.dirname(file), `${name}.ts`)));
  cache.set(file, module.exports);
  return module.exports;
}
const { billingCycleSummary } = load(path.join(__dirname, '../lib/meter/billing-cycle.ts'));
const { summarizeTodayMeter } = load(path.join(__dirname, '../lib/meter/today.ts'));
const now = new Date('2026-10-19T17:30:00Z');
const day = (date, count, kwh = 1) => Array.from({ length: count }, (_, index) => ({
  timestamp: new Date(Date.parse(`${date}T04:00:00Z`) + index * 900000).toISOString(), kwh,
}));
const fixture = [
  ...day('2026-10-14', 96), ...day('2026-10-15', 96), ...day('2026-10-16', 96),
  ...day('2026-10-17', 40), ...day('2026-10-18', 83), ...day('2026-10-19', 54, 100),
];
const summary = billingCycleSummary(fixture, '2026-10-14', now);
assert.deepEqual(summary.coverage.map(value => [value.date, value.status, value.actualIntervals, value.expectedIntervals]), [
  ['2026-10-14', 'complete', 96, 96], ['2026-10-15', 'complete', 96, 96],
  ['2026-10-16', 'complete', 96, 96], ['2026-10-17', 'partial', 40, 96],
  ['2026-10-18', 'partial', 83, 96], ['2026-10-19', 'complete', 54, 54],
]);
assert.equal(summary.completeDays, 3);
assert.equal(summary.excludedDays, 2);
assert.equal(summary.averageKwh, 96); // Today's large usage and partial-day usage are excluded.
assert.equal(summary.completeDays, summary.coverage.filter(value => !value.isCurrentDay && value.status === 'complete').length);
assert.equal(summary.excludedDays, summary.coverage.filter(value => !value.isCurrentDay && value.status !== 'complete').length);
assert(summary.coverage[3].missingRanges.length > 0);
const missing = billingCycleSummary(fixture.filter(reading => reading.timestamp < '2026-10-17T04:00:00.000Z' || reading.timestamp >= '2026-10-18T04:00:00.000Z'), '2026-10-14', now);
const missingDay = missing.coverage.find(value => value.date === '2026-10-17');
assert.equal(missingDay.status, 'missing'); assert.equal(missingDay.actualIntervals, 0); assert.equal(missingDay.expectedIntervals, 96);
assert.equal(missing.excludedDays, 2);
const empty = billingCycleSummary([], '2026-10-14', now);
assert.equal(empty.coverage.length, 6); assert.equal(empty.completeDays, 0); assert.equal(empty.excludedDays, 5); assert.equal(empty.averageKwh, null);
const edgeGaps = billingCycleSummary(day('2026-10-16', 96), '2026-10-14', now);
assert.equal(edgeGaps.coverage.length, 6); assert.equal(edgeGaps.excludedDays, 4);
assert.equal(edgeGaps.coverage[0].status, 'missing'); assert.equal(edgeGaps.coverage[4].status, 'missing');
const fullyCovered = billingCycleSummary([
  ...day('2026-10-14', 96), ...day('2026-10-15', 96), ...day('2026-10-16', 96),
  ...day('2026-10-17', 96), ...day('2026-10-18', 96),
], '2026-10-14', now);
assert.equal(fullyCovered.completeDays, 5); assert.equal(fullyCovered.excludedDays, 0);
const todayReadings = day('2026-10-19', 54, 0.5);
const today = summarizeTodayMeter(todayReadings, now);
assert.equal(today.todayKwh, 27); assert.equal(today.through, '2026-10-19T17:30:00.000Z');
assert.equal(today.coverage.expectedIntervals, 54); assert.equal(today.coverage.missingIntervals, 0);
const gappy = summarizeTodayMeter(todayReadings.filter((_, index) => index !== 5), now);
assert.equal(gappy.todayKwh, 26.5); assert.equal(gappy.coverage.missingIntervals, 1);
assert.equal(gappy.through, today.through); assert.equal(gappy.coverage.status, 'partial');
assert.equal(summarizeTodayMeter([], now).todayKwh, null);
// Regression: 54 stored readings at 1:20 PM, but only 53 intervals finished.
const earlyNow = new Date('2026-10-19T17:20:00Z');
const stored = day('2026-10-19', 54, 0.5);
const beforeCompletion = summarizeTodayMeter(stored, earlyNow);
assert.equal(stored.length, 54);
assert.equal(beforeCompletion.coverage.expectedIntervals, 53);
assert.equal(beforeCompletion.coverage.actualIntervals, 53);
assert.equal(beforeCompletion.readingsUsed, 53);
assert.equal(beforeCompletion.todayKwh, 26.5);
assert.equal(beforeCompletion.latestReadingAt, '2026-10-19T17:00:00.000Z');
assert.equal(beforeCompletion.through, '2026-10-19T17:15:00.000Z');
assert.equal(beforeCompletion.coverage.missingIntervals, 0);
assert.equal(stored[53].timestamp, '2026-10-19T17:15:00.000Z'); // No mutation.
const atCompletion = summarizeTodayMeter(stored, now);
assert.equal(atCompletion.readingsUsed, 54);
assert.equal(atCompletion.todayKwh, 27);
assert.equal(atCompletion.through, '2026-10-19T17:30:00.000Z');
const unfinishedOnly = summarizeTodayMeter([stored[53]], earlyNow);
assert.equal(unfinishedOnly.todayKwh, null);
assert.equal(unfinishedOnly.readingsUsed, 0);
assert.equal(unfinishedOnly.through, null);
const beforeFirstQuarter = summarizeTodayMeter(day('2026-10-19', 1), new Date('2026-10-19T04:05:00Z'));
assert.equal(beforeFirstQuarter.readingsUsed, 0);
assert.equal(beforeFirstQuarter.coverage.expectedIntervals, 0);
const withGap = summarizeTodayMeter(stored.filter((_, index) => index !== 5), earlyNow);
assert.equal(withGap.readingsUsed, 52);
assert.equal(withGap.todayKwh, 26);
assert.equal(withGap.coverage.missingIntervals, 1);
assert.equal(withGap.through, beforeCompletion.through);
for (const [start, count, instant] of [
  ['2026-03-08T05:00:00Z', 10, '2026-03-08T07:20:00Z'],
  ['2026-11-01T04:00:00Z', 10, '2026-11-01T06:20:00Z'],
]) {
  const dst = summarizeTodayMeter(dayReadings(start, count), new Date(instant));
  assert.equal(dst.readingsUsed, 9);
  assert.equal(dst.coverage.actualIntervals, 9);
  assert.equal(dst.coverage.expectedIntervals, 9);
  assert.equal(dst.todayKwh, 9);
}
function dayReadings(start, count) {
  return Array.from({ length: count }, (_, index) => ({ timestamp: new Date(Date.parse(start) + index * 900000).toISOString(), kwh: 1 }));
}
console.log('PASS Today totals, interval-end coverage time, gaps, and no-data handling.');
console.log('PASS Bill Cycle rows/count agreement, missing edge/interior days, full date range, and today excluded.');
console.log('Synthetic Oct 14–19 coverage (not live database values):');
for (const value of summary.coverage) console.log(`${value.date}: ${value.isCurrentDay ? 'complete so far' : value.status}, ${value.actualIntervals}/${value.expectedIntervals}`);
console.log(`Synthetic average counts: ${summary.completeDays} complete, ${summary.excludedDays} excluded.`);
// Daily usage chart reuses this cycle snapshot and its exact coverage rows.
assert.deepEqual(summary.dailyUsage.map(day => day.date), summary.coverage.map(day => day.date));
summary.dailyUsage.forEach((day, index) => assert.equal(day.coverage, summary.coverage[index]));
assert.deepEqual(summary.dailyUsage.map(day => day.kwh), [96, 96, 96, null, null, 5400]);
assert.equal(summary.dailyUsage.at(-1).through, '2026-10-19T17:30:00.000Z');
assert.equal(missing.dailyUsage.find(day => day.date === '2026-10-17').kwh, null);
assert.equal(empty.dailyUsage.length, 6);
assert(empty.dailyUsage.every(day => day.kwh === null));
const earlyDaily = billingCycleSummary(stored, '2026-10-19', earlyNow).dailyUsage[0];
assert.equal(earlyDaily.kwh, beforeCompletion.todayKwh);
assert.equal(earlyDaily.through, beforeCompletion.through);
assert.equal(earlyDaily.coverage.actualIntervals, beforeCompletion.readingsUsed);
const zeroDay = billingCycleSummary(day('2026-10-18', 96, 0), '2026-10-18', now).dailyUsage[0];
assert.equal(zeroDay.kwh, 0); assert.equal(zeroDay.coverage.status, 'complete');
for (const [start, count, date, followingDay] of [
  ['2026-03-08T05:00:00Z', 92, '2026-03-08', '2026-03-09T16:00:00Z'],
  ['2026-11-01T04:00:00Z', 100, '2026-11-01', '2026-11-02T16:00:00Z'],
]) {
  const cycle = billingCycleSummary(dayReadings(start, count), date, new Date(followingDay));
  assert.equal(cycle.dailyUsage[0].kwh, count);
  assert.equal(cycle.dailyUsage[0].coverage.expectedIntervals, count);
  assert.equal(cycle.dailyUsage[0].coverage.status, 'complete');
}
console.log('PASS daily usage: Eastern date grouping, same coverage rows, full-day totals, incomplete/missing slots stay null, real zero retained, today cutoff matches headline, and DST daily totals.');
