// Run: node scripts/check-meter-coverage.cjs
// Uses the already installed TypeScript compiler; no runner/package installation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output)(module, module.exports,
    name => load(path.resolve(path.dirname(file), `${name}.ts`)));
  cache.set(file, module.exports);
  return module.exports;
}
const { analyzeMeterCoverage: analyze } = load(path.join(__dirname, '../lib/meter/coverage.ts'));
const quarter = 15 * 60 * 1000;
function readings(start, count) {
  return Array.from({ length: count }, (_, index) => ({ timestamp: new Date(Date.parse(start) + index * quarter).toISOString(), kwh: 0 }));
}
const now = '2026-12-01T17:00:00Z';
let passed = 0;
function check(name, run) { run(); passed++; console.log(`PASS ${name}`); }
const normal = readings('2026-10-17T04:00:00Z', 96);
check('complete normal day: 96 intervals, including zero kWh', () => {
  const [day] = analyze(normal, { now });
  assert.equal(day.date, '2026-10-17'); assert.equal(day.status, 'complete');
  assert.equal(day.expectedIntervals, 96); assert.equal(day.actualIntervals, 96); assert.equal(day.missingIntervals, 0);
  assert.equal(day.isCurrentDay, false); assert.deepEqual(day.missingRanges, []);
});
check('one missing interval: one compact range', () => {
  const [day] = analyze(normal.filter((_, i) => i !== 5), { now });
  assert.equal(day.status, 'partial'); assert.equal(day.missingIntervals, 1);
  assert.equal(day.missingRanges.length, 1); assert.equal(day.missingRanges[0].intervals, 1);
  assert.equal(day.missingRanges[0].startAt, day.missingRanges[0].endAt);
});
check('long gap: 82 missing slots grouped into one range', () => {
  const [day] = analyze(normal.filter((_, i) => i === 0 || i >= 83), { now });
  assert.equal(day.actualIntervals, 14); assert.equal(day.missingIntervals, 82);
  assert.equal(day.missingRanges.length, 1); assert.equal(day.missingRanges[0].intervals, 82);
  assert.equal(day.missingRanges[0].startAt, normal[1].timestamp);
  assert.equal(day.missingRanges[0].endAt, normal[82].timestamp);
});
check('completely missing day between covered days', () => {
  const days = analyze([...normal, ...readings('2026-10-19T04:00:00Z', 96)], { now });
  assert.equal(days.length, 3); assert.equal(days[1].date, '2026-10-18');
  assert.equal(days[1].status, 'missing'); assert.equal(days[1].missingIntervals, 96);
  assert.equal(days[1].firstReadingAt, null); assert.equal(days[1].lastReadingAt, null);
  assert.equal(days[1].missingRanges.length, 1);
});
check('spring DST day: 92 intervals, nonexistent hour is not a gap', () => {
  const [day] = analyze(readings('2026-03-08T05:00:00Z', 92), { now });
  assert.equal(day.expectedIntervals, 92); assert.equal(day.dayIntervals, 92); assert.equal(day.status, 'complete');
  assert.equal(day.coverageEndAt, '2026-03-09T04:00:00.000Z');
});
check('fall DST day: 100 intervals, repeated hours remain separate', () => {
  const all = readings('2026-11-01T04:00:00Z', 100);
  const [complete] = analyze(all, { now });
  assert.equal(complete.expectedIntervals, 100); assert.equal(complete.status, 'complete');
  const [gappy] = analyze(all.filter((_, i) => i !== 4 && i !== 8), { now });
  assert.equal(gappy.missingIntervals, 2); assert.equal(gappy.missingRanges.length, 2);
  assert(gappy.missingRanges[0].startLabel.includes('EDT'));
  assert(gappy.missingRanges[1].startLabel.includes('EST'));
});
check('current partial day: only completed intervals, future slots excluded', () => {
  const current = readings('2026-10-19T04:00:00Z', 96);
  const options = { now: '2026-10-19T16:37:00Z' };
  const [day] = analyze(current, options);
  assert.equal(day.isCurrentDay, true); assert.equal(day.dayIntervals, 96);
  assert.equal(day.expectedIntervals, 50); assert.equal(day.actualIntervals, 50);
  assert.equal(day.status, 'complete'); assert.equal(day.missingIntervals, 0);
  assert.equal(day.coverageEndAt, '2026-10-19T16:30:00.000Z');
  const [gap] = analyze(current.filter((_, i) => i !== 10), options);
  assert.equal(gap.missingIntervals, 1); assert.equal(gap.status, 'partial');
});
check('current DST boundary: elapsed intervals use real instants', () => {
  const [spring] = analyze(readings('2026-03-08T05:00:00Z', 92), { now: '2026-03-08T07:15:00Z' });
  assert.equal(spring.dayIntervals, 92); assert.equal(spring.expectedIntervals, 9);
  const [fall] = analyze(readings('2026-11-01T04:00:00Z', 100), { now: '2026-11-01T06:15:00Z' });
  assert.equal(fall.dayIntervals, 100); assert.equal(fall.expectedIntervals, 9);
});
check('explicit empty range and zero-elapsed current day', () => {
  assert.deepEqual(analyze([], { now }), []);
  const [missing] = analyze([], { now, startDate: '2026-10-17', endDate: '2026-10-17' });
  assert.equal(missing.status, 'missing'); assert.equal(missing.missingIntervals, 96);
  const [today] = analyze([], { now: '2026-10-19T04:05:00Z', startDate: '2026-10-19' });
  assert.equal(today.expectedIntervals, 0); assert.equal(today.missingIntervals, 0); assert.equal(today.status, 'partial');
});
check('duplicates, unsorted input, and validation', () => {
  assert.equal(analyze([...normal, normal[0]].reverse(), { now })[0].actualIntervals, 96);
  assert.throws(() => analyze([{ timestamp: '2026-10-17T04:01:00Z', kwh: 1 }], { now }), TypeError);
  assert.throws(() => analyze([{ timestamp: '2026-10-17T04:00:00', kwh: 1 }], { now }), TypeError);
  assert.throws(() => analyze([], { now, startDate: '2026-02-30' }), RangeError);
});
console.log(`${passed} synthetic coverage checks passed.`);
