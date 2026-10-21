// Synthetic data and mocked saves only; no network/database access.
// Run: node scripts/check-manual-planned-end.cjs
process.env.TZ = 'America/New_York';
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), assert = require('node:assert/strict');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('module', 'exports', 'require', code)(module, module.exports, name => load(path.resolve(path.dirname(file), `${name}.ts`)));
  cache.set(file, module.exports); return module.exports;
}
const { prepareRecordedActivity: activity } = load(path.join(__dirname, '../lib/meter/recorded-activity.ts'));
const { prepareEventOverlays: overlays } = load(path.join(__dirname, '../lib/meter/event-overlays.ts'));
const observation = { id: 1, event_type_id: 1, name: 'Synthetic Iron', started_at: '2026-10-21T23:00:00Z', ended_at: '2026-10-22T00:00:00Z' };
const now = new Date('2026-10-21T23:30:00Z');
assert.equal(activity([observation], '2026-10-21', now).activities[0].minutes, 30);
assert.equal(overlays([observation], '2026-10-21', now).rows[0].durationMinutes, 30);
assert.equal(overlays([observation], '2026-10-21', now).rows[0].endMs, now.getTime());
assert.equal(overlays([observation], '2026-10-21', now).rows[0].scheduled, true);
const after = new Date('2026-10-22T01:00:00Z');
assert.equal(activity([observation], '2026-10-21', after).activities[0].minutes, 60);
assert.equal(overlays([observation], '2026-10-21', after).rows[0].durationMinutes, 60);
assert.equal(overlays([observation], '2026-10-21', after).rows[0].scheduled, false);
const crossing = { ...observation, started_at: '2026-10-22T03:30:00Z', ended_at: '2026-10-22T04:30:00Z' };
const midnightNow = new Date('2026-10-22T04:15:00Z');
assert.equal(activity([crossing], '2026-10-21', midnightNow).activities[0].minutes, 30);
assert.equal(activity([crossing], '2026-10-22', midnightNow).activities[0].minutes, 15);
assert.equal(overlays([crossing], '2026-10-22', midnightNow).rows[0].startMs, Date.parse('2026-10-22T04:00:00Z'));
assert.equal(overlays([crossing], '2026-10-22', midnightNow).rows[0].endMs, midnightNow.getTime());
assert.equal(activity([crossing], '2026-10-22', new Date('2026-10-22T05:00:00Z')).activities[0].minutes, 30);
assert.deepEqual(activity([crossing], '2026-10-22', now).activities, []);
const historical = { ...observation, started_at: '2026-10-20T23:00:00Z', ended_at: '2026-10-21T00:00:00Z' };
assert.equal(activity([historical], '2026-10-20', now).activities[0].minutes, 60);
assert.equal(overlays([historical], '2026-10-20', now).rows[0].durationMinutes, 60);
console.log('PASS effective duration capped at now, full planned duration after end, Eastern midnight split, no future activity, historical events unchanged.');

// Exercise the real form submit handler with mocked React state and Supabase.
let states, hook = 0, inserted = [], errors = [], saved = 0;
const react = { useState(initial) { const index = hook++; return [states[index] ?? (typeof initial === 'function' ? initial() : initial), value => { if (index === 8) errors.push(value); }]; }, useRef: value => ({ current: value }), useEffect() {} };
const jsx = (type, props) => ({ type, props });
const client = { schema: () => ({ from: table => ({ insert: async row => { assert.equal(table, 'energy_events'); inserted.push(row); return { error: null }; } }) }) };
const moduleObject = { exports: {} };
const formCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/manual-event.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
new Function('module', 'exports', 'require', formCode)(moduleObject, moduleObject.exports, name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name.endsWith('activity-shortcuts') ? load(path.join(__dirname, '../lib/events/activity-shortcuts.ts')) : { supabase: client });
const actualNow = Date.now;
Date.now = () => now.getTime();
async function submit(date, time, duration) {
  hook = 0; errors = [];
  states = [[{ id: 1, household_id: '1', name: 'Synthetic Iron' }], '1', '', date, time, duration, false, false, '', 0];
  const form = moduleObject.exports.ManualEvent({ onCancel() {}, onSaved() { saved++; } });
  await form.props.onSubmit({ preventDefault() {} });
}
(async () => {
  await submit('2026-10-21', '19:00', '60');
  assert.equal(saved, 1); assert.equal(inserted.length, 1);
  assert.equal(inserted[0].ended_at, '2026-10-22T00:00:00.000Z');
  assert.equal(inserted[0].recorded_via, 'manual_entry');
  for (const [date, time, duration] of [['2026-10-21', '19:00', '0'], ['2026-10-21', '19:00', '-10'], ['2026-02-30', '19:00', '60'], ['2026-10-21', '25:00', '60'], ['2026-10-21', '20:00', '60'], ['2026-10-21', '19:00', '0.000000000001']]) {
    await submit(date, time, duration); assert.equal(inserted.length, 1); assert.ok(errors.some(Boolean));
  }
  console.log('PASS real manual form accepts future end, preserves planned timestamp, rejects invalid/zero/negative/non-increasing durations and future starts.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = actualNow; });
