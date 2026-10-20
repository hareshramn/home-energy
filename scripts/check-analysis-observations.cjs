// Run: node scripts/check-analysis-observations.cjs
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
const { deriveDailyObservations } = load(path.join(__dirname, '../lib/analysis/daily-observations.ts'));
const { meterDayBounds } = load(path.join(__dirname, '../lib/meter/today.ts'));
const now = new Date('2026-10-20T16:00:00Z');
const rows = (date, count = 96, kwh = 0.5) => Array.from({ length: count }, (_, i) => ({ timestamp: new Date(Date.parse(meterDayBounds(date).start) + i * 900000).toISOString(), kwh }));
const event = (id, name, started_at, ended_at) => ({ id, name, started_at, ended_at });
const readings = [...rows('2026-10-17'), ...rows('2026-10-18', 95), ...rows('2026-10-19'), ...rows('2026-10-20', 48)];
const events = [
  event(1, 'Washer', '2026-10-19T14:00:00Z', '2026-10-19T14:40:00Z'),
  event(2, 'Washer', '2026-10-19T17:00:00Z', '2026-10-19T17:25:30Z'),
  event(3, 'Dryer', '2026-10-19T03:30:00Z', '2026-10-19T04:30:00Z'),
  event(4, 'Cooktop', '2026-10-20T03:40:00Z', '2026-10-20T04:10:00Z'),
  event(5, 'Other appliance', '2026-10-19T14:00:00Z', '2026-10-19T15:00:00Z'),
  event(6, 'Washer', '2026-10-19T18:00:00Z', null),
  event(7, 'Dryer', '2026-10-19T18:00:00Z', '2026-10-21T18:00:00Z'),
];
const result = deriveDailyObservations(readings, events, now);
assert.deepEqual(result.map(day => day.date), ['2026-10-19', '2026-10-17']);
assert.equal(result[0].total_kwh, 48);
assert.equal(result[0].washer_minutes, 65.5);
assert.equal(result[0].washer_count, 2);
assert.equal(result[0].dryer_minutes, 30);
assert.equal(result[0].dryer_count, 1);
assert.equal(result[0].cooktop_minutes, 20);
assert.equal(result[0].cooktop_count, 1);
assert.equal(result[1].washer_minutes, 0);
assert.equal(result[1].washer_count, 0); // Zero RECORDED events, no inference about actual use.
assert.deepEqual(deriveDailyObservations([], events, now), []);
assert.deepEqual(deriveDailyObservations(rows('2026-10-18', 95), events, now), []);
const midnightRows = [...rows('2026-10-18'), ...rows('2026-10-19')];
const midnight = deriveDailyObservations(midnightRows, [events[2]], now);
assert.deepEqual(midnight.map(day => [day.dryer_minutes, day.dryer_count]), [[30, 1], [30, 1]]);
const endsAtMidnight = deriveDailyObservations(midnightRows, [event(8, 'Washer', '2026-10-19T03:00:00Z', '2026-10-19T04:00:00Z')], now);
assert.equal(endsAtMidnight[0].washer_count, 0);
assert.equal(endsAtMidnight[1].washer_minutes, 60);
assert.deepEqual(deriveDailyObservations([...rows('2026-10-19'), ...rows('2026-10-19')], [events[0], events[0]], now), deriveDailyObservations(rows('2026-10-19'), [events[0]], now));
const zero = deriveDailyObservations(rows('2026-10-19', 96, 0), [], now);
assert.equal(zero[0].total_kwh, 0);
// DST uses actual elapsed duration and 92/100 interval coverage, not fixed 24h days.
for (const [date, count, elapsedMinutes] of [['2026-03-08', 92, 1380], ['2026-11-01', 100, 1500]]) {
  const bounds = meterDayBounds(date);
  const dstNow = new Date('2026-11-03T16:00:00Z');
  const observations = deriveDailyObservations(rows(date, count), [event(9, 'Cooktop', bounds.start, bounds.end)], dstNow);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].cooktop_minutes, elapsedMinutes);
  assert.equal(observations[0].total_kwh, count / 2);
  assert.equal(deriveDailyObservations(rows(date, count - 1), [], dstNow).length, 0);
}
const invalid = [event(10, 'Washer', 'bad', 'bad'), event(11, 'Washer', '2026-10-19T10:00:00Z', '2026-10-19T09:00:00Z')];
assert.equal(deriveDailyObservations(rows('2026-10-19'), invalid, now)[0].washer_count, 0);
console.log('PASS analysis: complete/full-day filtering, totals, event aggregation/counts, fractional minutes, Eastern midnight splitting, exclusive boundaries, DST, duplicate protection, missing/open/future/invalid events, and zero recorded events.');
