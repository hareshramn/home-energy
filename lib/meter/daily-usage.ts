import type { CoverageReading, DayCoverage } from './coverage';

const easternDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Chart slots follow the exact coverage rows; incomplete past totals stay null. */
export function prepareDailyUsage(readings: readonly CoverageReading[], coverage: readonly DayCoverage[]) {
  const days = new Map(coverage.map(day => [day.date, day]));
  const totals = new Map<string, number>();
  const seen = new Set<number>();
  for (const reading of readings) {
    const timestamp = Date.parse(reading.timestamp);
    const parts = easternDate.formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    const day = days.get(date);
    if (!day || seen.has(timestamp)) continue;
    if (day.isCurrentDay && timestamp + 900000 > Date.parse(day.coverageEndAt)) continue;
    seen.add(timestamp);
    totals.set(date, (totals.get(date) ?? 0) + reading.kwh);
  }
  return coverage.map(day => {
    const total = totals.get(day.date);
    return {
      date: day.date,
      coverage: day,
      kwh: day.isCurrentDay || day.status === 'complete' ? total ?? null : null,
      through: day.isCurrentDay && day.lastReadingAt ? new Date(Date.parse(day.lastReadingAt) + 900000).toISOString() : null,
    };
  });
}
export type DailyUsage = ReturnType<typeof prepareDailyUsage>;
