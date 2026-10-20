// Run: node scripts/check-recorded-activity.cjs
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
const { prepareRecordedActivity } = load(path.join(__dirname, '../lib/meter/recorded-activity.ts'));
const now = new Date('2026-10-20T16:00:00Z');
const event = (id, type, name, start, end) => ({ id, event_type_id: type, name, started_at: start, ended_at: end });
const one = event(1, 10, 'Custom hot water tap', '2026-10-19T14:00:00Z', '2026-10-19T14:10:00Z');
const get = (events, date = '2026-10-19', clock = now) => prepareRecordedActivity(events, date, clock).activities;
assert.deepEqual(get([one]), [{ id: '10', name: 'Custom hot water tap', minutes: 10, uses: 1, unknownUses: 0, activeUses: 0 }]);
const another = event(2, 10, one.name, '2026-10-19T15:00:00Z', '2026-10-19T15:20:00Z');
assert.equal(get([one, another])[0].minutes, 30);
assert.equal(get([one, another])[0].uses, 2);
assert.equal(get([one, one])[0].uses, 1);
const midnight = event(3, 11, 'Custom device', '2026-10-19T03:30:00Z', '2026-10-19T04:20:00Z');
assert.equal(get([midnight], '2026-10-18')[0].minutes, 30);
assert.equal(get([midnight])[0].minutes, 20);
assert.equal(get([event(4, 11, 'Custom device', '2026-10-19T03:30:00Z', '2026-10-19T04:00:00Z')]).length, 0);
const active = event(5, 12, 'Active custom device', '2026-10-20T15:30:00Z', null);
assert.equal(get([active], '2026-10-20')[0].minutes, 30);
assert.equal(get([active], '2026-10-20')[0].activeUses, 1);
const overnightActive = event(6, 13, 'Overnight', '2026-10-20T03:30:00Z', null);
assert.equal(get([overnightActive], '2026-10-20')[0].minutes, 720);
const historicalOpen = get([overnightActive])[0];
assert.equal(historicalOpen.minutes, 0);
assert.equal(historicalOpen.unknownUses, 1);
assert.equal(historicalOpen.uses, 1);
assert.equal(get([event(7, 12, 'Old unknown', '2026-10-18T10:00:00Z', null)]).length, 0);
const mixed = get([one, event(8, 10, one.name, '2026-10-19T15:00:00Z', null)])[0];
assert.equal(mixed.minutes, 10);
assert.equal(mixed.unknownUses, 1);
assert.equal(mixed.uses, 2);
const longer = event(9, 14, 'Long activity', '2026-10-19T15:00:00Z', '2026-10-19T17:00:00Z');
assert.deepEqual(get([one, another, longer]).map(a => a.id), ['14', '10']);
assert.equal(get([one, event(10, 99, one.name, '2026-10-19T15:00:00Z', '2026-10-19T15:05:00Z')]).length, 2); // Type IDs, not names, define grouping.
assert.deepEqual(get([]), []);
assert.deepEqual(get([event(11, 11, 'Future', '2026-10-21T10:00:00Z', null)], '2026-10-20'), []);
for (const [date, start, end, expected] of [
  ['2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 1380],
  ['2026-11-01', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 1500],
]) assert.equal(get([event(12, 15, 'DST activity', start, end)], date, new Date('2026-11-03T12:00:00Z'))[0].minutes, expected);
console.log('PASS recorded activity: dynamic type IDs/names, single/multiple events, sorting, Eastern midnight/DST overlap, today elapsed time, historical unknown duration, mixed known/unknown totals, boundaries, duplicates and empty days.');
