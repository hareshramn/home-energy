import { supabase } from '../supabase/client';
import type { ParsedMeterFile } from './parse-national-grid';

export type ImportCounts = {
  rowsReceived: number;
  inserted: number;
  duplicate: number;
  conflict: number;
  invalid: number;
  processed: number;
  validRows: number;
};
type ImportStep = 'create' | 'ingest' | 'finish';

type RpcDiagnostics = {
  function: string;
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
};

export class MeterImportError extends Error {
  constructor(public readonly interrupted: boolean, step: ImportStep, denied: boolean,
    public readonly supabaseError: RpcDiagnostics | null = null) {
    const operation = { create: 'create the import', ingest: 'save a meter reading', finish: 'save the import summary' }[step];
    const friendly = denied
      ? `Your account does not have permission to ${operation}. Check the household access and RPC permissions.`
      : `Unable to ${operation}. Check your connection and database access.`;
    const technical = process.env.NODE_ENV === 'development' && supabaseError
      ? ` [${supabaseError.code ?? 'unknown'}] ${supabaseError.message ?? 'No error message returned.'}` : '';
    super(friendly + technical);
  }
}

function rpcDiagnostics(error: unknown, step: ImportStep, filename: string, parsed: ParsedMeterFile): RpcDiagnostics | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const fields = error as Record<string, unknown>;
  // Error text can echo input values or a failing database row. Keep diagnostics,
  // never the file contents, RPC arguments, or echoed meter values.
  const scrub = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    let safe = value.replace(/Failing row contains[^\n]*/gi, 'Failing row contains [redacted].');
    if (filename) safe = safe.split(filename).join('[redacted file]');
    safe = safe.replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?/g, '[redacted timestamp]');
    const usageValues = new Set(parsed.readings.map(reading => String(reading.kwh)));
    safe = safe.replace(/(?<![\w])[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?![\w])/gi,
      value => usageValues.has(value) ? '[redacted value]' : value);
    return safe;
  };
  return {
    function: { create: 'create_meter_import', ingest: 'ingest_meter_reading', finish: 'finish_meter_import' }[step],
    code: typeof fields.code === 'string' ? fields.code : null,
    message: scrub(fields.message), details: scrub(fields.details), hint: scrub(fields.hint),
  };
}

function accessDenied(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  return 'code' in error && ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(String(error.code));
}

// Meter writes go exclusively through the household-scoped RPC contract.
export async function importMeterFile(filename: string, parsed: ParsedMeterFile, onProgress: (counts: ImportCounts) => void) {
  let step: ImportStep = 'create';
  let created = false;
  const counts: ImportCounts = {
    rowsReceived: parsed.rowsReceived, inserted: 0, duplicate: 0, conflict: 0,
    invalid: parsed.invalidRows, processed: 0, validRows: parsed.readings.length,
  };
  onProgress({ ...counts });
  try {
    const { data: importId, error: createError } = await supabase.schema('public').rpc('create_meter_import', {
      p_household_id: 1, p_filename: filename,
    });
    if (createError) throw createError;
    created = true;
    if (!(typeof importId === 'number' && Number.isSafeInteger(importId) && importId > 0)
      && !(typeof importId === 'string' && /^[1-9]\d*$/.test(importId))) throw new Error('Invalid import ID');

    step = 'ingest';
    for (const reading of parsed.readings) {
      const { data, error } = await supabase.schema('public').rpc('ingest_meter_reading', {
        p_household_id: 1,
        p_timestamp: reading.timestamp,
        p_kwh: reading.kwh,
        p_import_id: importId,
      });
      if (error) throw error;
      const status: unknown = data;
      if (status !== 'inserted' && status !== 'duplicate' && status !== 'conflict' && status !== 'invalid') {
        throw new Error('Unexpected ingest status');
      }
      counts[status]++;
      counts.processed++;
      onProgress({ ...counts });
    }

    step = 'finish';
    const { error: finishError } = await supabase.schema('public').rpc('finish_meter_import', {
      p_household_id: 1,
      p_import_id: importId,
      p_first_timestamp: parsed.firstTimestamp,
      p_last_timestamp: parsed.lastTimestamp,
      p_rows_received: counts.rowsReceived,
      p_rows_inserted: counts.inserted,
      p_duplicate_rows: counts.duplicate,
      p_conflict_rows: counts.conflict,
      p_invalid_rows: counts.invalid,
    });
    if (finishError) throw finishError;
    return { ...counts };
  } catch (error) {
    const diagnostic = rpcDiagnostics(error, step, filename, parsed);
    if (process.env.NODE_ENV === 'development' && diagnostic) {
      console.error(diagnostic);
    }
    throw new MeterImportError(created, step, accessDenied(error), diagnostic);
  }
}

export async function latestMeterTimestamp(): Promise<string | null> {
  const { data, error } = await supabase.schema('public').from('meter_readings')
    .select('timestamp').eq('household_id', 1).order('timestamp', { ascending: false }).limit(1);
  if (error) throw new Error('Unable to read the latest meter timestamp. Check household read permissions and your connection.');
  const timestamp = data[0]?.timestamp;
  if (timestamp === undefined) return null;
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) throw new Error('The latest meter timestamp is unavailable.');
  return timestamp;
}
