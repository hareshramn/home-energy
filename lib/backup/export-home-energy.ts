import { supabase } from '../supabase/client';
import { currentMeterDate } from '../meter/today';

export const backupTables = ['meter_readings', 'meter_imports', 'meter_conflicts', 'event_types', 'energy_events', 'billing_cycles'] as const;
export type BackupTable = typeof backupTables[number];
type BackupValue = string | number | boolean | null;
type BackupRow = Record<string, BackupValue>;
export type HomeEnergyBackup = {
  format: 'home-energy-backup';
  version: 1;
  exportedAt: string;
  timezone: 'America/New_York';
  household: { id: 1; name: 'Our Home' };
  data: Record<BackupTable, BackupRow[]>;
  counts: Record<BackupTable, number>;
};

// Audited against the supplied schema. Never SELECT * or export arbitrary fields.
const columns: Record<BackupTable, readonly string[]> = {
  meter_readings: ['household_id', 'timestamp', 'kwh', 'import_id', 'created_at'],
  meter_imports: ['id', 'filename', 'uploaded_at', 'first_timestamp', 'last_timestamp', 'rows_received', 'rows_inserted', 'duplicate_rows', 'conflict_rows', 'invalid_rows', 'household_id'],
  meter_conflicts: ['id', 'timestamp', 'stored_kwh', 'incoming_kwh', 'import_id', 'detected_at', 'resolved', 'household_id'],
  event_types: ['id', 'household_id', 'name', 'is_quick_action', 'quick_mode', 'default_duration_minutes', 'created_at'],
  energy_events: ['id', 'household_id', 'event_type_id', 'started_at', 'ended_at', 'recorded_via', 'created_at', 'updated_at'],
  billing_cycles: ['id', 'household_id', 'start_date', 'created_at'],
};
export const backupLabels: Record<BackupTable, string> = {
  meter_readings: 'Meter readings', meter_imports: 'Meter imports', meter_conflicts: 'Meter conflicts',
  event_types: 'Event types', energy_events: 'Energy events', billing_cycles: 'Billing cycles',
};
const pageSize = 500;
const cursorColumn = (table: BackupTable) => table === 'meter_readings' ? 'timestamp' : 'id';

export class BackupError extends Error {
  constructor(public readonly table: BackupTable | null, reason: 'read' | 'changed' | 'invalid' = 'read') {
    const subject = table ? backupLabels[table] : 'Backup';
    super(reason === 'changed'
      ? `Backup failed. ${subject} changed during export. Please try again.`
      : reason === 'invalid' ? `Backup failed. ${subject} did not pass validation.`
        : `Backup failed. Unable to read ${subject.toLowerCase()}. Check your connection and household access.`);
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function validateRow(value: unknown, table: BackupTable): asserts value is BackupRow {
  if (!object(value) || value.household_id !== 1) throw new BackupError(table, 'invalid');
  const keys = Object.keys(value);
  if (keys.length !== columns[table].length || !columns[table].every(key => keys.includes(key))) throw new BackupError(table, 'invalid');
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') throw new BackupError(table, 'invalid');
    if (typeof item === 'number' && !Number.isFinite(item)) throw new BackupError(table, 'invalid');
    // Never serialize an already-rounded BIGINT and silently lose its identity.
    if ((key === 'id' || key.endsWith('_id')) && item !== null
      && !(typeof item === 'number' && Number.isSafeInteger(item) && item > 0)
      && !(typeof item === 'string' && /^[1-9]\d*$/.test(item))) throw new BackupError(table, 'invalid');
  }
  const cursor = value[cursorColumn(table)];
  if (table === 'meter_readings' && (typeof cursor !== 'string' || !Number.isFinite(Date.parse(cursor)))) throw new BackupError(table, 'invalid');
  if (cursor === null || cursor === undefined) throw new BackupError(table, 'invalid');
}
function projectRow(value: unknown, table: BackupTable): BackupRow {
  if (!object(value)) throw new BackupError(table, 'invalid');
  const row = Object.fromEntries(columns[table].map(column => [column, value[column]]));
  validateRow(row, table);
  return row;
}

export function validateHomeEnergyBackup(value: unknown): asserts value is HomeEnergyBackup {
  if (!object(value) || value.format !== 'home-energy-backup' || value.version !== 1 || value.timezone !== 'America/New_York'
    || typeof value.exportedAt !== 'string' || !value.exportedAt.endsWith('Z') || !Number.isFinite(Date.parse(value.exportedAt))
    || !object(value.household) || value.household.id !== 1 || value.household.name !== 'Our Home'
    || !object(value.data) || !object(value.counts)
    || Object.keys(value).sort().join(',') !== 'counts,data,exportedAt,format,household,timezone,version'
    || Object.keys(value.household).sort().join(',') !== 'id,name'
    || Object.keys(value.data).length !== backupTables.length || Object.keys(value.counts).length !== backupTables.length) throw new BackupError(null, 'invalid');
  for (const table of backupTables) {
    const rows = value.data[table];
    if (!Array.isArray(rows) || value.counts[table] !== rows.length) throw new BackupError(table, 'invalid');
    const seen = new Set<string>();
    for (const row of rows) {
      validateRow(row, table);
      const key = String(row[cursorColumn(table)]);
      if (seen.has(key)) throw new BackupError(table, 'invalid');
      seen.add(key);
    }
  }
}

/** Read-only, sequential keyset pages; errors never contain database row values. */
export async function exportHomeEnergy(options: { signal?: AbortSignal } = {}): Promise<HomeEnergyBackup> {
  const data = {} as HomeEnergyBackup['data'];
  const counts = {} as HomeEnergyBackup['counts'];
  for (const table of backupTables) {
    const rows: BackupRow[] = [];
    const seen = new Set<string>();
    let cursor: string | number | null = null;
    let expected: number | null = null;
    try {
      while (true) {
        if (options.signal?.aborted) throw new BackupError(table);
        let query = supabase.schema('public').from(table).select(columns[table].join(', '), { count: 'exact' })
          .eq('household_id', 1).order(cursorColumn(table), { ascending: true }).limit(pageSize);
        if (cursor !== null) query = query.gt(cursorColumn(table), cursor);
        if (options.signal) query = query.abortSignal(options.signal);
        const { data: page, error, count } = await query;
        if (error || !Array.isArray(page) || count === null || !Number.isSafeInteger(count) || count < 0) throw new BackupError(table);
        if (expected === null) expected = count;
        if (count !== expected - rows.length) throw new BackupError(table, 'changed');
        if (!page.length) {
          if (rows.length !== expected) throw new BackupError(table, 'changed');
          break;
        }
        for (const value of page) {
          const row = projectRow(value, table);
          const key = String(row[cursorColumn(table)]);
          if (seen.has(key)) throw new BackupError(table, 'invalid');
          seen.add(key);
          rows.push(row);
        }
        const next = rows[rows.length - 1][cursorColumn(table)];
        if (typeof next !== 'string' && typeof next !== 'number') throw new BackupError(table, 'invalid');
        cursor = next;
        // Do not stop on a short page: server row caps may be below pageSize.
      }
    } catch (error) {
      throw error instanceof BackupError ? error : new BackupError(table);
    }
    data[table] = rows;
    counts[table] = rows.length;
  }
  // Detect additions/deletions while the other tables were being collected.
  // This is a checked read export, not a database-wide transactional snapshot.
  for (const table of backupTables) {
    try {
      if (options.signal?.aborted) throw new BackupError(table);
      let query = supabase.schema('public').from(table).select(cursorColumn(table), { head: true, count: 'exact' }).eq('household_id', 1);
      if (options.signal) query = query.abortSignal(options.signal);
      const { error, count } = await query;
      if (error || count === null) throw new BackupError(table);
      if (count !== counts[table]) throw new BackupError(table, 'changed');
    } catch (error) {
      throw error instanceof BackupError ? error : new BackupError(table);
    }
  }
  const backup: HomeEnergyBackup = {
    format: 'home-energy-backup', version: 1, exportedAt: new Date().toISOString(),
    timezone: 'America/New_York', household: { id: 1, name: 'Our Home' }, data, counts,
  };
  validateHomeEnergyBackup(backup);
  return backup;
}

export function serializeHomeEnergyBackup(backup: HomeEnergyBackup) {
  validateHomeEnergyBackup(backup);
  return JSON.stringify(backup, null, 2);
}
export function backupFilename(backup: HomeEnergyBackup) {
  validateHomeEnergyBackup(backup);
  return `home-energy-backup-${currentMeterDate(new Date(backup.exportedAt))}.json`;
}
