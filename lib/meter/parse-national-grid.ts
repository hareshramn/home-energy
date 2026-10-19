import { easternTimestamp } from './eastern-time';

export type ParsedReading = { timestamp: string; kwh: number };
export type ParsedMeterFile = {
  readings: ParsedReading[];
  rowsReceived: number;
  invalidRows: number;
  dstInvalidRows: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
};

type RecordRow = { fields: string[]; malformed: boolean };

// Records are consumed one at a time; pre-header fields are never retained in results.
function* csvRecords(text: string, mode: { meterRows: boolean }): Generator<RecordRow> {
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  let malformed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      // Meter values are single-line fields. Recover at the next row if a quote is broken.
      if (mode.meterRows && (char === '\r' || char === '\n')) {
        if (char === '\r' && text[index + 1] === '\n') index++;
        fields.push(field);
        yield { fields, malformed: true };
        fields = []; field = ''; quoted = false; closedQuote = false; malformed = false;
      } else if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
    } else if (char === ',') {
      fields.push(field); field = ''; closedQuote = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      fields.push(field);
      yield { fields, malformed };
      fields = []; field = ''; closedQuote = false; malformed = false;
    } else if (char === '"' && !closedQuote && !field.trim()) {
      field = ''; quoted = true;
    } else if (closedQuote && !/\s/.test(char)) {
      malformed = true; field += char;
    } else field += char;
  }
  if (field.length || fields.length || quoted || closedQuote) {
    fields.push(field);
    yield { fields, malformed: malformed || quoted };
  }
}

const normalize = (value: string) => value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');
const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseNationalGridCsv(text: string): ParsedMeterFile {
  if (!text.replace(/^\uFEFF/, '').trim()) throw new Error('The CSV file is empty.');
  let header: { length: number; date: number; time: number; usage: number; intervalEnd: boolean } | null = null;
  let unsupported = false;
  const result: ParsedMeterFile = { readings: [], rowsReceived: 0, invalidRows: 0, dstInvalidRows: 0, firstTimestamp: null, lastTimestamp: null };
  const mode = { meterRows: false };
  for (const row of csvRecords(text, mode)) {
    if (row.fields.every(field => !field.trim())) continue;
    if (!header) {
      if (row.malformed) continue;
      const columns = row.fields.map(normalize);
      const formatA = ['date', 'time', 'usage (kwh)'];
      const formatB = ['date', 'start time', 'end time', 'usage kwh', 'fuel type'];
      const matches = (required: string[]) => required.every(column => columns.filter(value => value === column).length === 1);
      const format = matches(formatA) ? 'A' : matches(formatB) ? 'B' : null;
      if (format) header = {
        length: columns.length, date: columns.indexOf('date'),
        time: columns.indexOf(format === 'A' ? 'time' : 'start time'),
        usage: columns.indexOf(format === 'A' ? 'usage (kwh)' : 'usage kwh'),
        intervalEnd: format === 'A',
      };
      else if (columns.includes('date')) unsupported = true;
      if (header) mode.meterRows = true;
      continue;
    }
    result.rowsReceived++;
    if (row.malformed || row.fields.length !== header.length) { result.invalidRows++; continue; }
    const value = row.fields[header.usage].trim();
    const kwh = Number(value);
    const instant = easternTimestamp(row.fields[header.date], row.fields[header.time]);
    if (!numeric.test(value) || !Number.isFinite(kwh) || kwh < 0 || instant.error) {
      result.invalidRows++;
      if (instant.error === 'ambiguous' || instant.error === 'nonexistent') result.dstInvalidRows++;
      continue;
    }
    // Time-only exports label interval ends; Start Time exports already label starts.
    // Resolve Eastern time first, then subtract elapsed minutes so midnight and
    // DST transitions cannot apply the wrong local offset to the canonical start.
    const timestamp = header.intervalEnd
      ? new Date(Date.parse(instant.timestamp) - 15 * 60 * 1000).toISOString()
      : instant.timestamp;
    result.readings.push({ timestamp, kwh });
    if (!result.firstTimestamp || timestamp < result.firstTimestamp) result.firstTimestamp = timestamp;
    if (!result.lastTimestamp || timestamp > result.lastTimestamp) result.lastTimestamp = timestamp;
  }
  if (!header) throw new Error(unsupported ? 'Unsupported CSV format. Choose a National Grid interval usage CSV.' : 'No recognizable National Grid CSV header was found.');
  if (!result.rowsReceived) throw new Error('The CSV file contains no meter rows.');
  return result;
}
