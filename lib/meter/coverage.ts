import { easternTimestamp } from './eastern-time';

const intervalMs = 15 * 60 * 1000;
const timezone = 'America/New_York';
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

export type CoverageReading = { timestamp: string; kwh: number };
export type MissingRange = {
  /** First and last missing interval STARTS, both inclusive, as UTC ISO strings. */
  startAt: string;
  endAt: string;
  intervals: number;
  startLabel: string;
  endLabel: string;
};
export type DayCoverage = {
  date: string;
  timezone: 'America/New_York';
  isCurrentDay: boolean;
  /** Full local day, including intervals that have not yet elapsed today. */
  dayIntervals: number;
  /** Only completed intervals are expected today; past days use the whole day. */
  expectedIntervals: number;
  actualIntervals: number;
  missingIntervals: number;
  status: 'complete' | 'partial' | 'missing';
  /** Exclusive end of the window being judged. */
  coverageEndAt: string;
  firstReadingAt: string | null;
  lastReadingAt: string | null;
  missingRanges: MissingRange[];
};
export type CoverageOptions = {
  now?: string | Date;
  /** Inclusive local YYYY-MM-DD dates; defaults to the readings' date range. */
  startDate?: string;
  endDate?: string;
};

function localDate(instant: number): string {
  const parts = dateFormatter.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function midnight(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Coverage dates must use YYYY-MM-DD.');
  const converted = easternTimestamp(date, '00:00');
  if (converted.error) throw new RangeError('Invalid local coverage date.');
  return Date.parse(converted.timestamp);
}

function nextDate(date: string): string {
  // Calendar arithmetic on a UTC date label, not a fixed 24-hour Eastern day.
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function instant(value: string | Date): number {
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    throw new TypeError('Coverage timestamps must include a UTC offset.');
  }
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new TypeError('Invalid coverage timestamp.');
  return timestamp;
}

/**
 * Readings describe intervals [timestamp, timestamp + 15 minutes). No kWh values
 * are filled in or summed. Duplicate instants count once; off-grid/invalid inputs
 * throw instead of silently affecting coverage. Future readings are ignored.
 *
 * Today excludes the interval starting at the current quarter-hour boundary,
 * because it is still in progress. `complete` today means complete SO FAR.
 * Before the first interval finishes, status is `partial` with zero expected and
 * zero missing. Explicit bounds allow empty days outside the readings' range.
 */
export function analyzeMeterCoverage(readings: readonly CoverageReading[], options: CoverageOptions = {}): DayCoverage[] {
  const now = instant(options.now ?? new Date());
  const today = localDate(now);
  const byDay = new Map<string, Set<number>>();
  let earliest: string | undefined;
  let latest: string | undefined;
  for (const reading of readings) {
    const timestamp = instant(reading.timestamp);
    if (timestamp % intervalMs !== 0 || !Number.isFinite(reading.kwh) || reading.kwh < 0) {
      throw new TypeError('Coverage requires valid readings on 15-minute boundaries.');
    }
    if (timestamp > now) continue;
    const date = localDate(timestamp);
    const day = byDay.get(date) ?? new Set<number>();
    day.add(timestamp);
    byDay.set(date, day);
    if (!earliest || date < earliest) earliest = date;
    if (!latest || date > latest) latest = date;
  }
  const startDate = options.startDate ?? earliest ?? options.endDate;
  const endDate = options.endDate ?? latest ?? options.startDate;
  if (!startDate || !endDate) return [];
  midnight(startDate);
  midnight(endDate);
  if (startDate > endDate || endDate > today) throw new RangeError('Coverage requires an ordered date range ending no later than today.');

  const result: DayCoverage[] = [];
  for (let date = startDate; date <= endDate; date = nextDate(date)) {
    const start = midnight(date);
    const end = midnight(nextDate(date));
    const isCurrentDay = date === today;
    const cutoff = isCurrentDay ? Math.min(end, Math.floor(now / intervalMs) * intervalMs) : end;
    const expectedIntervals = (cutoff - start) / intervalMs;
    const found = byDay.get(date) ?? new Set<number>();
    const missingRanges: MissingRange[] = [];
    let rangeStart: number | null = null;
    let actualIntervals = 0;
    let first: number | null = null;
    let last: number | null = null;
    function closeRange(exclusiveEnd: number) {
      if (rangeStart === null) return;
      const lastMissing = exclusiveEnd - intervalMs;
      missingRanges.push({
        startAt: new Date(rangeStart).toISOString(), endAt: new Date(lastMissing).toISOString(),
        intervals: (exclusiveEnd - rangeStart) / intervalMs,
        startLabel: timeFormatter.format(new Date(rangeStart)), endLabel: timeFormatter.format(new Date(lastMissing)),
      });
      rangeStart = null;
    }
    for (let timestamp = start; timestamp < cutoff; timestamp += intervalMs) {
      if (found.has(timestamp)) {
        actualIntervals++;
        first ??= timestamp;
        last = timestamp;
        closeRange(timestamp);
      } else rangeStart ??= timestamp;
    }
    closeRange(cutoff);
    result.push({
      date, timezone, isCurrentDay, dayIntervals: (end - start) / intervalMs,
      expectedIntervals, actualIntervals, missingIntervals: expectedIntervals - actualIntervals,
      status: expectedIntervals === 0 ? 'partial' : actualIntervals === expectedIntervals ? 'complete' : actualIntervals === 0 ? 'missing' : 'partial',
      coverageEndAt: new Date(cutoff).toISOString(),
      firstReadingAt: first === null ? null : new Date(first).toISOString(),
      lastReadingAt: last === null ? null : new Date(last).toISOString(), missingRanges,
    });
  }
  return result;
}
