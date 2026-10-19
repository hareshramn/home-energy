// Synthetic fixtures only. Run: node scripts/check-national-grid-parser.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('module', 'exports', 'require', output)(module, module.exports,
    name => load(path.resolve(path.dirname(file), `${name}.ts`)));
  cache.set(file, module.exports);
  return module.exports;
}
const { parseNationalGridCsv: parse } = load(path.join(__dirname, '../lib/meter/parse-national-grid.ts'));
const endFormat = (date, end, usage = '0.42') => `Synthetic pre-header note\nDate,Time,Usage (kWh)\n${date},${end},${usage}`;
const startFormat = (date, start, end, usage = '0.42') => `Date,Start Time,End Time,Usage kWh,Fuel Type\n${date},${start},${end},${usage},Electricity`;
let passed = 0;
function check(name, run) { run(); passed++; console.log(`PASS ${name}`); }
function equivalent(endDate, startDate, start, end, expected, usage = '0.42') {
  const a = parse(endFormat(endDate, end, usage));
  const b = parse(startFormat(startDate, start, end, usage));
  assert.deepEqual(a.readings, b.readings);
  assert.deepEqual(a.readings, [{ timestamp: expected, kwh: Number(usage) }]);
  assert.equal(a.firstTimestamp, expected); assert.equal(a.lastTimestamp, expected);
  assert.equal(a.invalidRows, 0); assert.equal(b.invalidRows, 0);
}
check('summer formats normalize to identical interval starts and raw kWh', () => equivalent('10/19/2026', '10/19/2026', '1:00 PM', '1:15 PM', '2026-10-19T17:00:00.000Z'));
check('winter formats use Eastern standard offset and preserve zero usage', () => equivalent('01/19/2026', '01/19/2026', '1:00 PM', '1:15 PM', '2026-01-19T18:00:00.000Z', '0'));
check('midnight interval end crosses into the previous local day', () => equivalent('10/20/2026', '10/19/2026', '11:45 PM', '12:00 AM', '2026-10-20T03:45:00.000Z'));
check('midnight at year boundary preserves the previous local year', () => equivalent('01/01/2027', '12/31/2026', '11:45 PM', '12:00 AM', '2027-01-01T04:45:00.000Z'));
check('spring-forward interval subtraction crosses the skipped hour correctly', () => equivalent('03/08/2026', '03/08/2026', '1:45 AM', '3:00 AM', '2026-03-08T06:45:00.000Z'));
check('fall-back unambiguous interval ends subtract elapsed minutes', () => {
  assert.equal(parse(endFormat('11/01/2026', '2:00 AM')).readings[0].timestamp, '2026-11-01T06:45:00.000Z');
  equivalent('11/01/2026', '11/01/2026', '2:00 AM', '2:15 AM', '2026-11-01T07:00:00.000Z');
});
check('ambiguous fall and nonexistent spring source times still reject safely', () => {
  for (const csv of [endFormat('11/01/2026', '1:15 AM'), startFormat('11/01/2026', '1:15 AM', '1:30 AM'), endFormat('03/08/2026', '2:15 AM'), startFormat('03/08/2026', '2:15 AM', '2:30 AM')]) {
    const result = parse(csv); assert.equal(result.invalidRows, 1); assert.equal(result.dstInvalidRows, 1); assert.deepEqual(result.readings, []);
  }
});
check('numeric, nonnegative and quarter-hour validation stays unchanged', () => {
  for (const usage of ['-1', 'NaN', '', 'Infinity', 'abc']) {
    assert.equal(parse(endFormat('10/19/2026', '1:15 PM', usage)).invalidRows, 1);
    assert.equal(parse(startFormat('10/19/2026', '1:00 PM', '1:15 PM', usage)).invalidRows, 1);
  }
  assert.equal(parse(endFormat('10/19/2026', '1:16 PM')).invalidRows, 1);
  assert.equal(parse(startFormat('10/19/2026', '1:01 PM', '1:16 PM')).invalidRows, 1);
});
console.log(`${passed} synthetic parser checks passed.`);
