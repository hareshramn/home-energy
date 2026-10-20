import { analyzeMeterCoverage, type CoverageReading } from '../meter/coverage';
import { currentMeterDate, meterDayBounds, summarizeMeterDay } from '../meter/today';
import type { NamedEnergyEvent } from '../meter/event-overlays';

export type DailyObservation = {
  date: string;
  total_kwh: number;
  washer_minutes: number;
  washer_count: number;
  dryer_minutes: number;
  dryer_count: number;
  cooktop_minutes: number;
  cooktop_count: number;
};
const appliances = ['washer', 'dryer', 'cooktop'] as const;

/** Recomputable observations, not energy attribution. Counts are overlapping
 * completed recorded events; a midnight-spanning event counts on each day touched.
 * Open/future-ended events have no known completed duration and are excluded.
 */
export function deriveDailyObservations(readings: readonly CoverageReading[], events: readonly NamedEnergyEvent[], now = new Date()): DailyObservation[] {
  const today = currentMeterDate(now);
  const groups = new Map<string, CoverageReading[]>();
  // Validate the meter snapshot with the authoritative coverage engine first.
  const coverage = analyzeMeterCoverage(readings, { now });
  for (const reading of readings) {
    const date = currentMeterDate(new Date(reading.timestamp));
    const rows = groups.get(date) ?? [];
    rows.push(reading);
    groups.set(date, rows);
  }
  const seen = new Set<string>();
  const completedEvents = events.flatMap(event => {
    const id = String(event.id);
    if (seen.has(id)) return [];
    seen.add(id);
    const appliance = event.name.trim().toLowerCase();
    if (!appliances.includes(appliance as typeof appliances[number]) || event.ended_at === null) return [];
    const start = Date.parse(event.started_at), end = Date.parse(event.ended_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now.getTime()) return [];
    return [{ appliance: appliance as typeof appliances[number], start, end }];
  });
  return coverage.filter(day => day.date < today && day.status === 'complete').map(day => {
    const summary = summarizeMeterDay(groups.get(day.date) ?? [], day.date, now);
    const bounds = meterDayBounds(day.date);
    const start = Date.parse(bounds.start), end = Date.parse(bounds.end);
    const observation: DailyObservation = { date: day.date, total_kwh: summary.todayKwh!, washer_minutes: 0, washer_count: 0, dryer_minutes: 0, dryer_count: 0, cooktop_minutes: 0, cooktop_count: 0 };
    for (const event of completedEvents) {
      const overlap = Math.min(end, event.end) - Math.max(start, event.start);
      if (overlap <= 0) continue;
      observation[`${event.appliance}_minutes`] += overlap / 60000;
      observation[`${event.appliance}_count`]++;
    }
    return observation;
  }).sort((a, b) => b.date.localeCompare(a.date));
}
