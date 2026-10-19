// Run: node scripts/check-meter-graph.cjs
// Synthetic readings only; no database or browser required.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const assert = require('node:assert/strict');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(module, module.exports, name => load(path.resolve(path.dirname(file), `${name}.ts`)));
  cache.set(file, module.exports);
  return module.exports;
}
const { prepareTodayUsageGraph: prepare } = load(path.join(__dirname, '../lib/meter/usage-graph.ts'));
const { summarizeTodayMeter: summarize } = load(path.join(__dirname, '../lib/meter/today.ts'));
const { analyzeMeterCoverage: coverage } = load(path.join(__dirname, '../lib/meter/coverage.ts'));
const quarter = 900000;
const rows = (start, count) => Array.from({ length: count }, (_, index) => ({ timestamp: new Date(Date.parse(start) + index * quarter).toISOString(), kwh: index === 0 ? 0 : 0.42 }));
const stored = rows('2026-10-19T04:00:00Z', 54);
const now = new Date('2026-10-19T17:20:00Z');
const summary = summarize(stored, now);
const graph = prepare(summary.completedReadings, summary.coverage);
assert.equal(graph.bars.length, 53);
assert.equal(graph.startMs, Date.parse('2026-10-19T04:00:00Z'));
assert.equal(graph.endMs, Date.parse(summary.coverage.coverageEndAt));
assert.equal(graph.bars[52].endMs, Date.parse('2026-10-19T17:15:00Z'));
assert.equal(graph.bars[1].kwh, 0.42); // Raw interval kWh, not kW.
assert.equal(graph.bars[0].kwh, 0); // A real zero is retained, not a gap.
assert(graph.bars[1].intervalLabel.includes('12:15 AM'));
assert(graph.bars[1].intervalLabel.includes('12:30 AM'));
assert(graph.ticks.some(tick => tick.label === '6 AM'));
assert(graph.ticks.length < 6);
assert.equal(prepare(stored, summary.coverage).bars.length, 53); // Defensive unfinished cutoff.
const missing = stored.filter((_, index) => index !== 5 && index !== 52);
const gappy = summarize(missing, now);
const gapGraph = prepare(gappy.completedReadings, gappy.coverage);
assert.equal(gapGraph.incomplete, true);
assert.equal(gapGraph.bars.length, 51);
assert.equal(gapGraph.bars[5].startMs - gapGraph.bars[4].startMs, 2 * quarter);
assert.equal(gapGraph.endMs - gapGraph.bars.at(-1).endMs, quarter); // Trailing gap is visible.
assert.equal(prepare([], summary.coverage), null);
assert.equal(prepare([stored[53]], summary.coverage), null);
assert.equal(graph.bars.reduce((sum, bar) => sum + bar.kwh, 0), summary.todayKwh);
for (const [start, count, hours] of [['2026-03-08T05:00:00Z', 92, 23], ['2026-11-01T04:00:00Z', 100, 25]]) {
  const readings = rows(start, count);
  const day = coverage(readings, { now: '2026-12-01T17:00:00Z' })[0];
  const model = prepare(readings, day);
  assert.equal(model.bars.length, count);
  assert.equal((model.endMs - model.startMs) / 3600000, hours);
  assert.equal(model.bars[8].startMs - model.bars[7].startMs, quarter);
  if (hours === 25) {
    assert(model.bars[4].intervalLabel.includes('EDT'));
    assert(model.bars[8].intervalLabel.includes('EST'));
  }
}
console.log('PASS graph preparation: raw kWh, genuine zero, midnight domain, sparse Eastern labels, internal/trailing gaps, shared completed cutoff, no-data state, headline sum consistency, and 23/25-hour DST days.');

const { eventDayBounds, prepareEventOverlays, sharedUsageDomain } = load(path.join(__dirname, '../lib/meter/event-overlays.ts'));
const observations = [
  { id: 1, name: 'Washer', started_at: '2026-10-19T13:02:00Z', ended_at: '2026-10-19T13:20:00Z' },
  { id: 2, name: 'Iron', started_at: '2026-10-19T17:17:00Z', ended_at: null },
  { id: 3, name: 'Previous-day observation', started_at: '2026-10-19T03:30:00Z', ended_at: '2026-10-19T04:30:00Z' },
  { id: 4, name: 'Ended at midnight', started_at: '2026-10-19T03:00:00Z', ended_at: '2026-10-19T04:00:00Z' },
  { id: 5, name: 'Tomorrow', started_at: '2026-10-20T04:00:00Z', ended_at: null },
];
const before = JSON.stringify(observations);
const overlay = prepareEventOverlays(observations, '2026-10-19', now);
assert.equal(overlay.rows.length, 3);
assert.equal(overlay.rows.find(row => row.id === 1).durationMinutes, 18);
assert.equal(overlay.rows.find(row => row.id === 2).endMs, now.getTime());
assert.equal(overlay.rows.find(row => row.id === 2).open, true);
assert.equal(overlay.rows.find(row => row.id === 2).name, 'Iron');
assert.equal(overlay.rows.find(row => row.id === 3).startMs, graph.startMs);
assert.equal(JSON.stringify(observations), before);
const domain = sharedUsageDomain(graph, overlay);
assert.equal(domain.startMs, graph.startMs);
assert.equal(domain.endMs, now.getTime());
assert.equal(domain.meterEndMs, graph.endMs);
assert.equal(domain.extendsPastMeter, true);
const x = instant => (instant - domain.startMs) / (domain.endMs - domain.startMs);
assert.equal(x(overlay.rows.find(row => row.id === 3).endMs), x(graph.bars[1].endMs));
assert.equal(sharedUsageDomain(graph, prepareEventOverlays([], '2026-10-19', now)).endMs, graph.endMs);
const scheduled = prepareEventOverlays([{ id: 6, name: 'Dryer', started_at: '2026-10-19T17:00:00Z', ended_at: '2026-10-19T18:00:00Z' }], '2026-10-19', now).rows[0];
assert.equal(scheduled.endMs, now.getTime()); assert.equal(scheduled.scheduled, true); assert.equal(scheduled.durationMinutes, 60);
for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
  const bounds = eventDayBounds(date);
  assert.equal((Date.parse(bounds.end) - Date.parse(bounds.start)) / 3600000, hours);
}
console.log('PASS event overlays: local-day overlap, midnight clipping, arbitrary names, open/scheduled display without mutation, shared real-time scale, meter cutoff distinction, empty events, and DST boundaries.');
