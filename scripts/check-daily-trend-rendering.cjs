// Synthetic React element-tree checks; no database, browser, or new dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
let active;
function renderer(component) {
  const slots = [];
  return props => {
    let result;
    for (let pass = 0; pass < 5; pass++) {
      active = { slots, cursor: 0, changed: false };
      result = component(props);
      if (!active.changed) return result;
    }
    throw new Error('Render did not settle');
  };
}
const hooks = {
  useState(initial) {
    const context = active, index = context.cursor++;
    if (!(index in context.slots)) context.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [context.slots[index], next => {
      context.slots[index] = typeof next === 'function' ? next(context.slots[index]) : next;
      context.changed = true;
    }];
  },
  useRef(initial) {
    const [ref] = hooks.useState(() => ({ current: initial }));
    return ref;
  },
};
let meterLoading = false;
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const req = name => {
    if (name === 'react') return hooks;
    if (!name.startsWith('.')) return require(name);
    if (name === './use-today-meter') return { useTodayMeter: date => {
      if (meterLoading) return { status: 'loading' };
      const helpers = load('../lib/meter/today.ts');
      const start = Date.parse(helpers.meterDayBounds(date).start);
      const rows = Array.from({ length: 4 }, (_, i) => ({ timestamp: new Date(start + i * 900000).toISOString(), kwh: 1 }));
      return { status: 'ready', data: helpers.summarizeMeterDay(rows, date) };
    } };
    if (name === './use-typical-day') return { useTypicalDay: () => ({ status: 'ready', data: null }) };
    if (name === './use-recorded-activity') return { useRecordedActivity: date => ({ status: 'ready', data: { activities: Array.from({ length: 7 }, (_, i) => ({ id: `type-${i}`, name: 'Same display name', minutes: i === 0 ? 20.1 : i === 1 ? 8.5 : 70 - i, uses: 1, unknownUses: 0, activeUses: 0 })) } }) };
    const base = path.resolve(path.dirname(file), name);
    return load(fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`);
  };
  new Function('module', 'exports', 'require', output)(module, module.exports, req);
  cache.set(file, module.exports);
  return module.exports;
}
// Resolve test imports consistently from the scripts directory.
process.chdir(__dirname);
function nodes(element) {
  if (!React.isValidElement(element)) return [];
  const children = React.Children.toArray(element.props.children);
  return [element, ...children.flatMap(nodes)];
}
function find(element, predicate) { return nodes(element).find(predicate); }
const { DailyTrend } = load('../app/daily-trend.tsx');
const render = renderer(DailyTrend);
let tree = render({ initialDate: '2026-10-18' });
function checkTree(expectedDate) {
  const children = React.Children.toArray(tree.props.children);
  const charts = children.filter(node => node.type?.name === 'TrendChart');
  const activity = children.filter(node => node.type?.name === 'RecordedActivity');
  assert.equal(charts.length, meterLoading ? 0 : 1);
  assert.equal(activity.length, 1);
  // Inspect original elements: these are fixed siblings, not keyed list members.
  assert.equal(tree.props.children.at(-1).key, null);
  if (!meterLoading) {
    assert.equal(tree.props.children.at(-2).key, null);
    assert.equal(charts[0].props.graph.startMs, Date.parse(load('../lib/meter/today.ts').meterDayBounds(expectedDate).start));
    assert.ok(children.indexOf(charts[0]) < children.indexOf(activity[0]));
  }
  assert.equal(activity[0].props.date, expectedDate);
}
checkTree('2026-10-18');
find(tree, node => node.type === 'button' && node.props.children === 'Last 7 days').props.onClick();
tree = render({});
for (const direction of ['Next day', 'Previous day', 'Next day', 'Previous day']) {
  find(tree, node => node.props['aria-label'] === direction).props.onClick();
  tree = render({});
  checkTree(direction === 'Next day' ? '2026-10-19' : '2026-10-18');
  assert.equal(find(tree, node => node.type === 'button' && node.props.children === 'Last 7 days').props['aria-pressed'], true);
}
meterLoading = true;
tree = render({}); checkTree('2026-10-18');
meterLoading = false;
tree = render({}); checkTree('2026-10-18');
const chart = find(tree, node => node.type?.name === 'TrendChart');
const renderChart = renderer(chart.type);
let chartTree = renderChart(chart.props);
assert.equal(find(tree, node => node.props.className === 'bill-panel trend-summary'), undefined);
assert.equal(nodes(chartTree).filter(node => node.props.className === 'trend-energy-header').length, 1);
assert.equal(find(chartTree, node => node.type === 'h2' && node.props.children === 'Cumulative energy'), undefined);
assert.equal(find(chartTree, node => node.type === 'svg').props.viewBox, '0 0 360 275');
assert.ok(find(chartTree, node => node.type === 'p' && node.props.children === 'Drag to explore · Eastern Time'));
assert.equal(find(chartTree, node => node.props.className === 'trend-scrub-readout'), undefined);
assert.ok(find(chartTree, node => node.type === 'p' && String(node.props.children).includes('Missing usage not estimated')));
const cleanChart = renderer(chart.type)({ ...chart.props, graph: { ...chart.props.graph, incomplete: false } });
assert.equal(find(cleanChart, node => node.type === 'p' && String(node.props.children).includes('Missing usage not estimated')), undefined);
find(chartTree, node => node.type === 'svg').props.onKeyDown({ key: 'Home', preventDefault() {} });
chartTree = renderChart(chart.props);
assert.equal(find(chartTree, node => node.type === 'svg').props['aria-valuenow'], 0);
assert.ok(find(chartTree, node => node.props.className === 'trend-scrub-readout'));
chartTree = renderChart({ ...chart.props, graph: { ...chart.props.graph, startMs: chart.props.graph.startMs + 86400000 } });
assert.equal(find(chartTree, node => node.type === 'svg').props['aria-valuenow'], 3);
const { RecordedActivity } = load('../app/recorded-activity.tsx');
const renderActivity = renderer(RecordedActivity);
let activityTree = renderActivity({ date: '2026-10-18' });
assert.equal(nodes(activityTree).filter(node => node.type === 'li').length, 5);
assert.ok(find(activityTree, node => node.type === 'span' && Array.isArray(node.props.children) && node.props.children.join('').includes('20 min · 1 use')));
assert.ok(find(activityTree, node => node.type === 'span' && Array.isArray(node.props.children) && node.props.children.join('').includes('9 min · 1 use')));
find(activityTree, node => node.type === 'button').props.onClick();
activityTree = renderActivity({ date: '2026-10-18' });
assert.equal(nodes(activityTree).filter(node => node.type === 'li').length, 7);
const list = find(activityTree, node => node.type === 'ul');
assert.equal(new Set(list.props.children.map(node => node.key)).size, 7);
assert.deepEqual(list.props.children.map(node => node.key), Array.from({ length: 7 }, (_, i) => `type-${i}`));
activityTree = renderActivity({ date: '2026-10-19' });
assert.equal(nodes(activityTree).filter(node => node.type === 'li').length, 5);
console.log('PASS exactly one unkeyed chart and activity sibling, repeated date navigation/loading, same-date props, retained comparison mode, date-scoped expansion, and unique activity type keys.');

const { chartTimeTicks } = load('../app/chart-time-axis.ts');
const expectedLabels = ['12A', '3A', '6A', '9A', '12P', '3P', '6P', '9P', '12A'];
for (const date of ['2026-10-18', '2026-03-08', '2026-11-01']) {
  const bounds = load('../lib/meter/today.ts').meterDayBounds(date);
  const start = Date.parse(bounds.start), end = Date.parse(bounds.end);
  const ticks = chartTimeTicks(start, end).filter(tick => tick.major);
  assert.deepEqual(ticks.map(tick => tick.label), expectedLabels);
  assert.equal(ticks[0].timestamp, start);
  assert.equal(ticks.at(-1).timestamp, end);
  assert.ok(ticks.every((tick, i) => i === 0 || tick.timestamp > ticks[i - 1].timestamp));
  assert.equal(ticks[1].timestamp - start, (date === '2026-03-08' ? 2 : date === '2026-11-01' ? 4 : 3) * 3600000);
}
function checkAxis(rendered) {
  const labels = nodes(rendered).filter(node => node.type === 'text' && node.props.className?.includes('energy-axis-label'));
  assert.deepEqual(labels.map(node => node.props.children), expectedLabels);
  const ticks = nodes(rendered).filter(node => node.type === 'line' && node.props.className === 'energy-axis-tick');
  assert.ok(ticks.filter(node => node.props.x1 === node.props.x2 && node.props.y2 - node.props.y1 === 5).length === 9);
  assert.ok(ticks.filter(node => node.props.y1 === node.props.y2 && node.props.x2 - node.props.x1 === 4).length >= 3);
}
checkAxis(renderer(chart.type)(chart.props));
const { TodayUsageChart } = load('../app/today-usage-chart.tsx');
checkAxis(renderer(TodayUsageChart)({ graph: chart.props.graph, events: { status: 'loading' } }));
console.log('PASS shared compact 3-hour labels, actual Eastern/DST positions, endpoint alignment, and visible x/y ticks on both charts.');
