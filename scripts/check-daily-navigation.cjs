// Run: node scripts/check-daily-navigation.cjs
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
const { currentMeterDate, meterDayBounds, validateMeterDate, adjacentMeterDate, summarizeMeterDay, summarizeTodayMeter } = load(path.join(__dirname, '../lib/meter/today.ts'));
const { prepareTodayUsageGraph } = load(path.join(__dirname, '../lib/meter/usage-graph.ts'));
const { eventDayBounds, prepareEventOverlays, sharedUsageDomain } = load(path.join(__dirname, '../lib/meter/event-overlays.ts'));
const now = new Date('2026-10-19T17:20:00Z');
const rows = (start, count) => Array.from({ length: count }, (_, index) => ({ timestamp: new Date(Date.parse(start) + index * 900000).toISOString(), kwh: 0.5 }));
const todayRows = rows('2026-10-19T04:00:00Z', 54);
const today = summarizeMeterDay(todayRows, '2026-10-19', now);
assert.equal(today.readingsUsed, 53); assert.equal(today.todayKwh, 26.5);
assert.equal(today.coverage.expectedIntervals, 53); assert.equal(today.through, '2026-10-19T17:15:00.000Z');
const yesterdayRows = rows('2026-10-18T04:00:00Z', 96);
const complete = summarizeMeterDay(yesterdayRows, '2026-10-18', now);
assert.equal(complete.coverage.isCurrentDay, false); assert.equal(complete.coverage.status, 'complete');
assert.equal(complete.todayKwh, 48); assert.equal(complete.readingsUsed, 96);
assert.equal(complete.coverage.expectedIntervals, 96);
const fullGraph = prepareTodayUsageGraph(complete.completedReadings, complete.coverage);
assert.equal(fullGraph.endMs - fullGraph.startMs, 24 * 3600000);
const partial = summarizeMeterDay(yesterdayRows.slice(20, 60), '2026-10-18', now);
assert.equal(partial.coverage.status, 'partial'); assert.equal(partial.todayKwh, 20);
assert.equal(partial.coverage.actualIntervals, 40); assert.equal(partial.coverage.missingIntervals, 56);
const partialGraph = prepareTodayUsageGraph(partial.completedReadings, partial.coverage);
assert.equal(partialGraph.startMs, fullGraph.startMs); assert.equal(partialGraph.endMs, fullGraph.endMs);
assert.equal(partialGraph.bars.length, 40);
const missing = summarizeMeterDay([], '2026-10-18', now);
assert.equal(missing.todayKwh, null); assert.equal(missing.coverage.status, 'missing');
assert.equal(missing.coverage.expectedIntervals, 96); assert.equal(missing.coverage.missingIntervals, 96);
const missingGraph = prepareTodayUsageGraph(missing.completedReadings, missing.coverage);
assert.equal(missingGraph.bars.length, 0); assert.equal(missingGraph.missing.length, 96);
assert.equal(missingGraph.endMs, fullGraph.endMs);
for (const [date, start, count] of [['2026-03-08', '2026-03-08T05:00:00Z', 92], ['2026-11-01', '2026-11-01T04:00:00Z', 100]]) {
  const later = new Date('2026-12-01T17:00:00Z');
  const day = summarizeMeterDay(rows(start, count), date, later);
  assert.equal(day.coverage.expectedIntervals, count); assert.equal(day.coverage.status, 'complete');
  assert.equal(day.todayKwh, count * 0.5);
  const graph = prepareTodayUsageGraph(day.completedReadings, day.coverage);
  assert.equal((graph.endMs - graph.startMs) / 900000, count);
  assert.equal(adjacentMeterDate(adjacentMeterDate(date, -1, later), 1, later), date);
  assert.equal(adjacentMeterDate(adjacentMeterDate(date, 1, later), -1, later), date);
  assert.deepEqual(eventDayBounds(date), { start: meterDayBounds(date).start, end: meterDayBounds(date).end });
}
assert.equal(currentMeterDate(new Date('2026-10-19T01:00:00Z')), '2026-10-18');
assert.equal(adjacentMeterDate('2026-10-19', -1, now), '2026-10-18');
assert.equal(adjacentMeterDate('2026-10-18', 1, now), '2026-10-19');
assert.equal(adjacentMeterDate('2024-02-28', 1, now), '2024-02-29');
assert.equal(adjacentMeterDate('2025-12-31', 1, now), '2026-01-01');
assert.throws(() => adjacentMeterDate('2026-10-19', 1, now), /earlier date/);
assert.throws(() => validateMeterDate('2026-10-20', now), /earlier date/);
assert.throws(() => summarizeMeterDay([], '2026-10-20', now), /earlier date/);
assert.throws(() => validateMeterDate('2026-02-30', now), /valid calendar date/);
// Browsing a past date never changes the Today wrapper used by Home.
assert.deepEqual(summarizeTodayMeter(todayRows, now), today);
const event = { id: 1, name: 'Synthetic observation', started_at: '2026-10-18T13:02:00Z', ended_at: null };
const snapshot = JSON.stringify(event);
const history = prepareEventOverlays([event], '2026-10-18', now);
assert.equal(history.rows[0].endMs, Date.parse(meterDayBounds('2026-10-18').end));
assert.equal(history.rows[0].durationMinutes, null); assert.equal(history.rows[0].historical, true);
assert(history.rows[0].timeLabel.includes('stop not recorded')); assert(!history.rows[0].timeLabel.includes('now'));
assert.equal(sharedUsageDomain(fullGraph, history).extendsPastMeter, false);
assert.equal(JSON.stringify(event), snapshot);
const openToday = prepareEventOverlays([{ ...event, started_at: '2026-10-19T13:02:00Z' }], '2026-10-19', now);
assert.equal(openToday.rows[0].endMs, now.getTime()); assert.equal(openToday.rows[0].historical, false);
assert.notEqual(openToday.rows[0].durationMinutes, null);
console.log('PASS selected-day usage: today, complete/partial/missing past days, full-day graph domain, 92/100-interval DST days, future rejection, previous/next/leap/year navigation, Eastern rather than UTC today, Home isolation, and historical open-event bounds without fabricated stop times.');
