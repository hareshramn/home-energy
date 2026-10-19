import { analyzeMeterCoverage, type CoverageReading } from './coverage';
import { easternTimestamp } from './eastern-time';

const localDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function currentMeterDate(now = new Date()) {
  const parts = localDateFormatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Each civil midnight is resolved independently in Eastern time, including DST. */
export function meterDayBounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Choose a valid calendar date.');
  const start = easternTimestamp(date, '00:00');
  if (start.error) throw new RangeError('Choose a valid calendar date.');
  // Advance the civil date label; this is not an elapsed 24-hour Eastern day.
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = easternTimestamp(next.toISOString().slice(0, 10), '00:00');
  if (end.error) throw new RangeError('Choose a valid calendar date.');
  return { date, start: start.timestamp, end: end.timestamp };
}

export function validateMeterDate(date: string, now = new Date()) {
  const bounds = meterDayBounds(date);
  if (date > currentMeterDate(now)) throw new RangeError('Choose today or an earlier date.');
  return bounds;
}

/** Move between neighboring Eastern calendar dates, never the device/UTC date. */
export function adjacentMeterDate(date: string, direction: -1 | 1, now = new Date()) {
  validateMeterDate(date, now);
  const noon = easternTimestamp(date, '12:00');
  if (noon.error) throw new RangeError('Choose a valid calendar date.');
  // Noon stays within the neighboring local date across both 23- and 25-hour days.
  const next = currentMeterDate(new Date(Date.parse(noon.timestamp) + direction * 24 * 60 * 60 * 1000));
  validateMeterDate(next, now);
  return next;
}

export function todayMeterBounds(now = new Date()) {
  return meterDayBounds(currentMeterDate(now));
}

export function summarizeTodayMeter(readings: readonly CoverageReading[], now = new Date()) {
  return summarizeMeterDay(readings, currentMeterDate(now), now);
}

/** Shared daily preparation. The legacy todayKwh field also serves the Home card. */
export function summarizeMeterDay(readings: readonly CoverageReading[], selectedDate: string, now = new Date()) {
  const { date, start } = validateMeterDate(selectedDate, now);
  const coverage = analyzeMeterCoverage(readings, { now, startDate: date, endDate: date })[0];
  const cutoff = Date.parse(coverage.coverageEndAt);
  const dayStart = Date.parse(start);
  const seen = new Set<number>();
  // A stored observation is usable only after its entire interval has finished.
  // Use the engine's cutoff, not a separate clock/boundary calculation.
  const completed = readings.filter(reading => {
    const timestamp = Date.parse(reading.timestamp);
    if (timestamp < dayStart || timestamp + 15 * 60 * 1000 > cutoff || seen.has(timestamp)) return false;
    seen.add(timestamp);
    return true;
  });
  const firstReadingAt = coverage.firstReadingAt;
  const latestReadingAt = coverage.lastReadingAt;
  const through = latestReadingAt ? new Date(Date.parse(latestReadingAt) + 15 * 60 * 1000).toISOString() : null;
  // Missing intervals never create observations or zero-valued usage.
  const total = completed.reduce((sum, reading) => sum + reading.kwh, 0);
  if (!Number.isFinite(total)) throw new Error('Meter total is unavailable.');
  return {
    todayKwh: completed.length ? total : null,
    through, coverage, readingsUsed: completed.length, firstReadingAt, latestReadingAt,
    completedReadings: completed,
  };
}
