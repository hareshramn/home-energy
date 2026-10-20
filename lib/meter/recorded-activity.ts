import { currentMeterDate, meterDayBounds } from './today';

export type ActivityEvent = {
  id: string | number;
  event_type_id: string | number;
  name: string;
  started_at: string;
  ended_at: string | null;
};

/** Aggregate time only. Historical open events have no knowable end/overlap;
 * report them on their recorded start day without inventing later daily usage.
 */
export function prepareRecordedActivity(events: readonly ActivityEvent[], date: string, now = new Date()) {
  const bounds = meterDayBounds(date);
  const start = Date.parse(bounds.start), end = Date.parse(bounds.end);
  const today = currentMeterDate(now);
  const groups = new Map<string, { id: string; name: string; minutes: number; uses: number; unknownUses: number; activeUses: number }>();
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(String(event.id))) continue;
    seen.add(String(event.id));
    const eventStart = Date.parse(event.started_at);
    if (!Number.isFinite(eventStart) || eventStart >= end || eventStart > now.getTime() || date > today) continue;
    const unknown = event.ended_at === null && date < today;
    if (unknown && currentMeterDate(new Date(eventStart)) !== date) continue;
    const eventEnd = event.ended_at === null ? now.getTime() : Date.parse(event.ended_at);
    if (!unknown && (!Number.isFinite(eventEnd) || eventEnd <= eventStart)) continue;
    const overlap = Math.min(end, eventEnd, now.getTime()) - Math.max(start, eventStart);
    if (!unknown && overlap <= 0) continue;
    const id = String(event.event_type_id);
    const group = groups.get(id) ?? { id, name: event.name, minutes: 0, uses: 0, unknownUses: 0, activeUses: 0 };
    group.uses++;
    if (unknown) group.unknownUses++;
    else {
      group.minutes += overlap / 60000;
      if (event.ended_at === null) group.activeUses++;
    }
    groups.set(id, group);
  }
  return { date, activities: [...groups.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
}
