// Synthetic component/database mocks only. Run: node scripts/check-event-history.cjs
process.env.TZ = 'Asia/Tokyo';
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), assert = require('node:assert/strict');
const RealDate = Date;
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-21T10:48:00Z'])); } static now() { return RealDate.parse('2026-10-21T10:48:00Z'); } };
let confirmed = true;
global.window = { setInterval: () => 1, clearInterval() {}, confirm: () => confirmed };
const fixture = (id, start, end) => ({ id, household_id: '1', event_type_id: id, started_at: start, ended_at: end });
let observations = [
  fixture(1, '2026-10-21T09:00:00Z', '2026-10-21T09:10:00Z'),
  fixture(2, '2026-10-21T10:46:00Z', '2026-10-21T10:51:00Z'),
  fixture(3, '2026-10-21T10:40:00Z', null),
  fixture(4, '2026-10-21T03:59:00Z', '2026-10-21T04:10:00Z'),
  fixture(5, '2026-10-22T04:00:00Z', '2026-10-22T05:00:00Z'),
  fixture(6, '2026-10-22T03:30:00Z', '2026-10-22T04:30:00Z'),
];
const names = ['Completed event', 'Tap hot water', 'Open event', 'Previous date', 'Next date', 'Late Eastern evening'];
const types = observations.map((row, i) => ({ id: row.id, household_id: '1', name: names[i] }));
const originalTypes = structuredClone(types), deleted = [], calls = [];
const client = { schema(name) { assert.equal(name, 'public'); return { from(table) {
  const filters = []; let removing = false;
  const query = {
    select() { return query; }, order() { return query; },
    gte(key, value) { filters.push(row => row[key] >= value); calls.push({ key, value, op: 'gte' }); return query; },
    lt(key, value) { filters.push(row => row[key] < value); calls.push({ key, value, op: 'lt' }); return query; },
    eq(key, value) { filters.push(row => row[key] === value); return query; },
    delete() { assert.equal(table, 'energy_events'); removing = true; return query; },
    single() { return execute(); }, then(resolve, reject) { return execute().then(resolve, reject); },
  };
  async function execute() {
    const rows = (table === 'event_types' ? types : observations).filter(row => filters.every(filter => filter(row)));
    if (removing) {
      assert.equal(rows.length, 1); deleted.push(rows[0].id);
      observations = observations.filter(row => row !== rows[0]);
      return { data: { id: rows[0].id }, error: null };
    }
    return { data: structuredClone(rows), error: null };
  }
  return query;
} }; } };
const cache = new Map();
function load(file) {
  file = path.resolve(file); if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('module', 'exports', 'require', code)(mod, mod.exports, name => load(path.resolve(path.dirname(file), `${name}.ts`)));
  cache.set(file, mod.exports); return mod.exports;
}
let index = 0; const states = [], refs = [], dependencies = [], effects = [];
const react = {
  useState(initial) { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => states[i] = typeof value === 'function' ? value(states[i]) : value]; },
  useRef(initial) { return refs[index++] ||= { current: initial }; },
  useEffect(effect, deps) { const i = index++; if (JSON.stringify(dependencies[i]) !== JSON.stringify(deps)) { dependencies[i] = deps; effects.push(effect); } },
};
const jsx = (type, props) => ({ type, props });
const mod = { exports: {} };
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/event-history.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
new Function('module', 'exports', 'require', code)(mod, mod.exports, name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name.endsWith('supabase/client') ? { supabase: client } : load(path.resolve(__dirname, name.endsWith('activity-shortcuts') ? '../lib/events/activity-shortcuts.ts' : '../lib/meter/today.ts')));
function render() { index = 0; return mod.exports.EventHistory(); }
function elements(v) { if (Array.isArray(v)) return v.flatMap(elements); if (!v || typeof v !== 'object') return []; return [v, ...elements(v.props?.children)]; }
function text(v) { if (Array.isArray(v)) return v.map(text).join(''); if (v && typeof v === 'object') return text(v.props?.children); return v === undefined || v === null || typeof v === 'boolean' ? '' : String(v); }
async function settle() { render(); while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); return render(); }
(async () => {
  let tree = await settle();
  const visible = elements(tree).filter(v => v.type === 'h2').map(text);
  assert.deepEqual(visible, ['Completed event', 'Tap hot water', 'Open event', 'Late Eastern evening']);
  assert.ok(text(tree).includes('Events · by start date'));
  assert.ok(text(tree).includes('6:46 AM – 6:51 AM5 min · In progress (planned duration)'));
  assert.ok(text(tree).includes('OpenIn progress · no end recorded'));
  assert.ok(calls.some(call => call.op === 'gte' && call.value === '2026-10-21T04:00:00.000Z'));
  assert.ok(calls.some(call => call.op === 'lt' && call.value === '2026-10-22T04:00:00.000Z'));
  for (const [name, id] of [['Tap hot water', 2], ['Open event', 3], ['Completed event', 1]]) {
    const button = elements(tree).find(v => v.type === 'button' && v.props['aria-label']?.startsWith(`Delete ${name} event`));
    assert.ok(button); button.props.onClick(); await new Promise(resolve => setImmediate(resolve));
    tree = await settle(); assert.ok(deleted.includes(id));
    assert.ok(!elements(tree).some(v => v.type === 'h2' && text(v) === name));
  }
  assert.deepEqual(types, originalTypes);
  assert.ok(observations.some(row => row.id === 4)); assert.ok(observations.some(row => row.id === 5));
  confirmed = false;
  elements(tree).find(v => v.type === 'button' && v.props['aria-label']?.startsWith('Delete Late Eastern evening')).props.onClick();
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(deleted, [2, 3, 1]);
  console.log('PASS completed/future-ended/open visibility; planned-duration label; all event states deletable; confirmation; post-delete refresh; Eastern start-date grouping on a Tokyo device; other dates and event types preserved.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.Date = RealDate; });
