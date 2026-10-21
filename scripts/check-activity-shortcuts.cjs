// Synthetic React/Supabase mocks only. Run: node scripts/check-activity-shortcuts.cjs
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), assert = require('node:assert/strict');
process.env.TZ = 'Asia/Tokyo';
const actualNow = Date.now;
let openingNow = Date.parse('2026-10-21T22:52:33Z');
Date.now = () => openingNow;
const jsx = (type, props) => ({ type, props });
function compile(file, requireMock, suffix = '') {
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8') + suffix, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('module', 'exports', 'require', code)(mod, mod.exports, requireMock); return mod.exports;
}
const shortcuts = compile('lib/events/activity-shortcuts.ts', () => { throw Error('Unexpected dependency'); });
function elements(v) { if (Array.isArray(v)) return v.flatMap(elements); if (!v || typeof v !== 'object') return []; return [v, ...elements(v.props?.children)]; }
function harness() {
  const states = [], refs = [], effects = []; let index = 0, first = true;
  return { states, effects,
    react: { useState(initial) { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => states[i] = typeof value === 'function' ? value(states[i]) : value]; }, useRef(initial) { const i = index++; return refs[i] ||= { current: initial }; }, useEffect(effect) { if (first) effects.push(effect); } },
    render(run) { index = 0; const result = run(); first = false; return result; },
  };
}
const expected = [['Washer', 'Washer', '40'], ['Dryer', 'Dryer', '60'], ['Cooktop', 'Cooktop', ''], ['Hot water', 'Tap hot water', ''], ['Microwave', 'MW', '2'], ['Dishwasher', 'Dishwasher', '60']];
assert.deepEqual(shortcuts.commonActivities.map(v => [v.label, v.eventType, v.duration]), expected);
assert.equal(shortcuts.eventDisplayName('Mw'), 'Microwave');
assert.equal(shortcuts.eventDisplayName('MW'), 'Microwave');
assert.equal(shortcuts.eventDisplayName('Washer'), 'Washer');
assert.equal(shortcuts.commonActivities.find(v => v.label === 'Microwave').eventType, 'MW');
const homeHooks = harness();
const home = compile('app/page.tsx', name => {
  if (name === 'react') return homeHooks.react;
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name.endsWith('activity-shortcuts')) return shortcuts;
  if (name.includes('supabase') || name.includes('quick-actions')) throw Error('Home must not use a database or timer hook');
  if (name === './manual-event') return { ManualEvent: 'ManualEvent' };
  return new Proxy({}, { get: (_, key) => String(key) });
}, '\nexport { Dashboard };');
const renderHome = () => homeHooks.render(() => home.Dashboard());
for (const [label, eventType, duration] of expected) {
  homeHooks.states[1] = 'home';
  const button = elements(renderHome()).find(v => v.props?.['aria-label'] === `Add ${label} event`);
  assert.ok(button); button.props.onClick();
  const form = elements(renderHome()).find(v => v.type === 'ManualEvent');
  assert.equal(form.props.initialEventType, eventType); assert.equal(form.props.initialDuration, duration);
}
homeHooks.states[1] = 'home';
elements(renderHome()).find(v => v.type === 'button' && v.props.children === '+ Manual Add').props.onClick();
assert.equal(elements(renderHome()).find(v => v.type === 'ManualEvent').props.initialEventType, undefined);
console.log('PASS all six Home shortcuts pass exact defaults to one form; direct Manual Add unprefilled; Home has no timer/database dependency.');
const base = ['Washer', 'Dryer', 'Cooktop', 'Tap hot water', 'MW', 'Bath', 'Custom fan'].map((name, i) => ({ id: i+1, household_id: '1', name }));
async function formHarness(initialEventType, initialDuration, extra = []) {
  const hooks = harness(), rows = structuredClone([...base, ...extra]), writes = [], history = [{ id: 99, event_type_id: 6, recorded_via: 'manual_entry' }];
  const client = { schema(name) { assert.equal(name, 'public'); return { from(table) {
    let payload, household;
    const query = { select() { return query; }, order() { return query; }, eq(key, value) { assert.equal(key, 'household_id'); household = value; return query; }, insert(value) { payload = value; return query; }, single() { return execute(true); }, then(resolve, reject) { return execute(false).then(resolve, reject); } };
    async function execute(single) {
      if (payload) {
        writes.push({ table, payload });
        if (table === 'event_types') { const row = { ...payload, id: 100 + rows.length }; rows.push(row); return { data: single ? row : [row], error: null }; }
        assert.equal(table, 'energy_events'); return { data: null, error: null };
      }
      assert.equal(table, 'event_types'); return { data: rows.filter(row => household === undefined || row.household_id === household).map(row => ({ ...row })), error: null };
    }
    return query;
  } }; } };
  const module = compile('app/manual-event.tsx', name => name === 'react' ? hooks.react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name.endsWith('activity-shortcuts') ? shortcuts : { supabase: client });
  const render = () => hooks.render(() => module.ManualEvent({ initialEventType, initialDuration, onCancel() {}, onSaved() {} }));
  render(); hooks.effects.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve));
  const field = id => elements(render()).find(v => v.props?.id === id);
  return { rows, writes, history, render, field, hooks };
}
(async () => {
  for (const [, eventType, duration] of expected) {
    const h = await formHarness(eventType, duration);
    assert.equal(h.field('manual-type').props.value, String(shortcuts.findEventType(h.rows, eventType).id));
    assert.equal(h.field('manual-duration').props.value, duration);
    assert.equal(h.field('manual-time').props.value, '18:52');
    assert.equal(h.field('manual-date').props.value, '2026-10-21');
    assert.equal(h.writes.filter(v => v.table === 'energy_events').length, 0);
    assert.equal(h.rows.filter(v => shortcuts.normalizeEventName(v.name) === 'dishwasher').length, 1);
    assert.ok(!elements(h.field('manual-type')).some(v => v.type === 'option' && v.props.children === 'Bath'));
    assert.deepEqual(h.rows.find(v => v.name === 'Bath'), base.find(v => v.name === 'Bath'));
    assert.deepEqual(h.history, [{ id: 99, event_type_id: 6, recorded_via: 'manual_entry' }]);
  }
  openingNow = Date.parse('2026-10-22T04:07:18Z');
  const h = await formHarness(undefined, undefined, [{ id: 80, household_id: '1', name: ' dishwasher ' }]);
  assert.equal(h.field('manual-time').props.value, '00:07');
  assert.equal(h.field('manual-date').props.value, '2026-10-22');
  assert.equal(h.writes.length, 0); assert.equal(h.field('manual-type').props.value, ''); assert.equal(h.field('manual-duration').props.value, '');
  assert.ok(elements(h.field('manual-type')).some(v => v.type === 'option' && v.props.children === 'Custom fan'));
  h.field('manual-type').props.onChange({ target: { value: 'new' } });
  h.field('manual-name').props.onChange({ target: { value: ' bath ' } });
  h.field('manual-date').props.onChange({ target: { value: '2026-01-01' } });
  h.field('manual-time').props.onChange({ target: { value: '12:00' } });
  h.field('manual-duration').props.onChange({ target: { value: '10' } });
  await h.render().props.onSubmit({ preventDefault() {} }); assert.equal(h.writes.length, 0);
  h.field('manual-name').props.onChange({ target: { value: 'Synthetic Iron' } });
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.writes.filter(v => v.table === 'event_types').length, 1);
  assert.equal(h.writes.filter(v => v.table === 'energy_events').length, 1);
  assert.equal(h.writes.find(v => v.table === 'energy_events').payload.recorded_via, 'manual_entry');
  assert.equal(h.writes.find(v => v.table === 'energy_events').payload.started_at, '2026-01-01T17:00:00.000Z');
  for (const [instant, expectedTime, expectedEnd] of [
    ['2026-11-01T06:37:22Z', '01:37', '2026-11-01T07:37:00.000Z'],
    ['2026-03-08T07:07:22Z', '03:07', '2026-03-08T08:07:00.000Z'],
  ]) {
    openingNow = Date.parse(instant);
    const dst = await formHarness('Dryer', '60');
    assert.equal(dst.field('manual-time').props.value, expectedTime);
    await dst.render().props.onSubmit({ preventDefault() {} });
    const saved = dst.writes.find(v => v.table === 'energy_events');
    assert.equal(saved.payload.started_at, new Date(Math.floor(openingNow / 60000) * 60000).toISOString());
    assert.equal(saved.payload.ended_at, expectedEnd);
  }
  console.log('PASS Eastern spring and repeated fall-hour defaults preserve the correct opening instant.');
  console.log('PASS fresh Eastern date/minute on every opening, midnight rollover, no quarter-hour rounding, editable fields and correct timestamps on a Tokyo device.');
  console.log('PASS loaded preselection/defaults; no event before Save; Dishwasher creation/reuse; Bath hidden and blocked without history writes; custom creation still saves.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = actualNow; });
