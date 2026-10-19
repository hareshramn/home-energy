// Synthetic only: node scripts/check-backup.cjs. No network or live database access.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
let database, failTable, changedTable, calls;
const mock = { schema(name) {
  assert.equal(name, 'public');
  return { from(table) {
    const state = { table };
    const query = {
      select(columns, options) { assert.ok(!columns.includes('*')); state.columns = columns; state.head = options.head; return query; },
      eq(column, value) { assert.equal(column, 'household_id'); assert.equal(value, 1); state.household = value; return query; },
      order(column, options) { assert.equal(options.ascending, true); state.order = column; return query; },
      limit(value) { assert.equal(value, 500); state.limit = value; return query; },
      gt(column, value) { state.cursor = { column, value }; return query; },
      abortSignal() { return query; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        calls.push({ ...state });
        if (table === failTable) return { data: null, count: null, error: { message: 'SYNTHETIC_PRIVATE_ERROR' } };
        let rows = database[table].filter(row => row.household_id === state.household);
        if (state.cursor) rows = rows.filter(row => row[state.cursor.column] > state.cursor.value);
        if (state.order) rows.sort((a, b) => a[state.order] < b[state.order] ? -1 : a[state.order] > b[state.order] ? 1 : 0);
        return { data: state.head ? null : rows.slice(0, Math.min(state.limit, 137)), count: rows.length + (state.head && table === changedTable ? 1 : 0), error: null };
      }).then(resolve, reject); },
    };
    return query;
  } };
} };
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('module', 'exports', 'require', output)(module, module.exports, name => name.endsWith('supabase/client') ? { supabase: mock } : load(path.resolve(path.dirname(file), `${name}.ts`)));
  cache.set(file, module.exports);
  return module.exports;
}
const api = load(path.join(__dirname, '../lib/backup/export-home-energy.ts'));
const stamp = '2026-10-14T04:00:00.000Z';
function reset() {
  failTable = changedTable = null; calls = [];
  database = {
    meter_readings: Array.from({ length: 1203 }, (_, i) => ({ household_id: 1, timestamp: new Date(Date.parse(stamp) + i * 900000).toISOString(), kwh: i ? 0.42 : 0, import_id: 1, created_at: stamp })),
    meter_imports: [{ id: 1, filename: 'synthetic.csv', uploaded_at: stamp, first_timestamp: stamp, last_timestamp: stamp, rows_received: 1203, rows_inserted: 1203, duplicate_rows: 0, conflict_rows: 0, invalid_rows: 0, household_id: 1 }],
    meter_conflicts: [{ id: 1, timestamp: stamp, stored_kwh: 0.42, incoming_kwh: 0.5, import_id: 1, detected_at: stamp, resolved: false, household_id: 1 }],
    event_types: [{ id: 1, household_id: 1, name: 'Synthetic appliance', is_quick_action: false, quick_mode: null, default_duration_minutes: null, created_at: stamp }],
    energy_events: [{ id: 1, household_id: 1, event_type_id: 1, started_at: stamp, ended_at: null, recorded_via: 'quick_manual_stop', created_at: stamp, updated_at: stamp }],
    billing_cycles: [{ id: 1, household_id: 1, start_date: '2026-10-14', created_at: stamp }],
  };
  for (const table of api.backupTables) {
    database[table][0].raw_csv = 'SYNTHETIC_EXCLUDED_FIELD';
    database[table].push({ ...database[table][0], household_id: 2 });
  }
}
(async () => {
  reset();
  const backup = await api.exportHomeEnergy();
  api.validateHomeEnergyBackup(backup);
  assert.equal(backup.counts.meter_readings, 1203);
  assert.ok(calls.filter(call => call.table === 'meter_readings' && !call.head).length > 8);
  assert.equal(backup.data.meter_readings[0].kwh, 0);
  assert.equal(backup.data.energy_events[0].ended_at, null);
  assert.equal(backup.data.meter_imports[0].filename, 'synthetic.csv');
  for (const table of api.backupTables) {
    assert.equal(backup.counts[table], backup.data[table].length);
    assert.ok(backup.data[table].every(row => row.household_id === 1));
  }
  assert.ok(!api.serializeHomeEnergyBackup(backup).includes('SYNTHETIC_EXCLUDED_FIELD'));
  backup.exportedAt = '2026-10-19T01:00:00.000Z';
  assert.equal(api.backupFilename(backup), 'home-energy-backup-2026-10-18.json');
  console.log('PASS complete multi-page export despite server caps; household scope; explicit columns; IDs/timestamps/nulls/zero preserved; Eastern filename');
  for (const table of api.backupTables) {
    reset(); failTable = table;
    await assert.rejects(api.exportHomeEnergy(), error => error instanceof api.BackupError && error.table === table && !error.message.includes('SYNTHETIC_PRIVATE_ERROR'));
  }
  console.log('PASS each required-table failure aborts export with safe table-specific error');
  reset(); changedTable = 'meter_readings';
  await assert.rejects(api.exportHomeEnergy(), /changed during export/);
  console.log('PASS concurrent count changes prevent successful export');
  for (const mutate of [value => value.format = 'wrong', value => value.version = 2, value => value.household.id = 2, value => value.data.meter_readings = null, value => value.counts.meter_readings++, value => value.access_token = 'synthetic', value => value.data.energy_events[0].household_id = 2, value => value.data.energy_events[0].id = Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(backup); mutate(bad);
    assert.throws(() => api.serializeHomeEnergyBackup(bad), api.BackupError);
  }
  reset(); database.meter_readings = []; database.meter_imports = []; database.meter_conflicts = [];
  const empty = await api.exportHomeEnergy(); assert.equal(empty.counts.meter_readings, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.exportHomeEnergy({ signal: controller.signal }), api.BackupError);
  console.log('PASS format/count/household/secret-field/unsafe-ID validation; empty tables; cancelled export');
})().catch(error => { console.error(error); process.exitCode = 1; });
