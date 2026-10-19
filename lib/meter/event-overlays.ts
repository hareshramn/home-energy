import { meterDayBounds } from './today';

export type NamedEnergyEvent = {
  id: string | number;
  name: string;
  started_at: string;
  ended_at: string | null;
};
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const datedClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

export function eventDayBounds(date: string) {
  const { start, end } = meterDayBounds(date);
  return { start, end };
}

export function prepareEventOverlays(events: readonly NamedEnergyEvent[], date: string, now = new Date()) {
  const bounds = eventDayBounds(date);
  const startMs = Date.parse(bounds.start);
  const dayEnd = Date.parse(bounds.end);
  const nowMs = Math.min(now.getTime(), dayEnd);
  const historical = now.getTime() >= dayEnd;
  const rows = events.flatMap(event => {
    const start = Date.parse(event.started_at);
    const end = event.ended_at === null ? historical ? dayEnd : now.getTime() : Date.parse(event.ended_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const visibleStart = Math.max(start, startMs);
    const visibleEnd = Math.min(end, nowMs);
    if (visibleEnd <= visibleStart) return [];
    const scheduled = event.ended_at !== null && end > now.getTime();
    const label = (instant: number) => (instant < startMs || instant >= dayEnd ? datedClock : clock).format(new Date(instant));
    return [{
      id: event.id, name: event.name, startMs: visibleStart, endMs: visibleEnd,
      timeLabel: `${label(start)} – ${event.ended_at === null ? historical ? 'stop not recorded' : `now (${label(end)})` : label(end)}`,
      durationMinutes: historical && event.ended_at === null ? null : Math.round((end - start) / 60000 * 10) / 10,
      open: event.ended_at === null, historical, scheduled,
    }];
  }).sort((a, b) => a.startMs - b.startMs);
  return { date, startMs, nowMs, rows };
}
export type EventOverlays = ReturnType<typeof prepareEventOverlays>;

/** Both layers use this one continuous real-instant domain, including DST. */
export function sharedUsageDomain(meter: { startMs: number; endMs: number } | null, events: EventOverlays) {
  const startMs = meter?.startMs ?? events.startMs;
  const extendsPastMeter = !!meter && events.rows.some(row => row.endMs > meter.endMs);
  const endMs = meter ? extendsPastMeter ? Math.max(meter.endMs, events.nowMs) : meter.endMs : Math.max(startMs + 1, events.nowMs);
  return { startMs, endMs, meterEndMs: meter?.endMs ?? null, extendsPastMeter };
}
