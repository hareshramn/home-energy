import type { CoverageReading, DayCoverage } from './coverage';
import { easternTimestamp } from './eastern-time';

const quarter = 15 * 60 * 1000;
const timezone = 'America/New_York';
const intervalTime = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const localClock = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function axisLabel(instant: number) {
  const minutes = new Date(instant).getUTCMinutes();
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', ...(minutes ? { minute: '2-digit' as const } : {}),
  }).format(new Date(instant));
}

/** A real-instant time domain is shared by bars and future overlay renderers. */
export function prepareTodayUsageGraph(readings: readonly CoverageReading[], coverage: Pick<DayCoverage, 'date' | 'coverageEndAt' | 'missingIntervals'>) {
  const midnight = easternTimestamp(coverage.date, '00:00');
  if (midnight.error) throw new Error('Invalid graph date.');
  const startMs = Date.parse(midnight.timestamp);
  const cutoff = Date.parse(coverage.coverageEndAt);
  if (!Number.isFinite(cutoff) || cutoff < startMs) throw new Error('Invalid graph coverage cutoff.');
  const seen = new Set<number>();
  const bars = readings.flatMap(reading => {
    const start = Date.parse(reading.timestamp);
    if (!Number.isFinite(start) || start % quarter !== 0 || !Number.isFinite(reading.kwh) || reading.kwh < 0) throw new Error('Invalid graph reading.');
    // Defensive cutoff uses the same coverage snapshot as the headline, never a new clock.
    if (start < startMs || start + quarter > cutoff || seen.has(start)) return [];
    seen.add(start);
    return [{ startMs: start, endMs: start + quarter, kwh: reading.kwh,
      intervalLabel: `${intervalTime.format(new Date(start))} – ${intervalTime.format(new Date(start + quarter))}`,
    }];
  }).sort((a, b) => a.startMs - b.startMs);
  if (!bars.length) return null;
  // Retain trailing missing slots too, through the latest finished interval.
  const endMs = cutoff;
  const ticks: { timestamp: number; label: string }[] = [];
  for (let timestamp = startMs; timestamp <= endMs; timestamp += quarter) {
    const parts = localClock.formatToParts(new Date(timestamp));
    const hour = Number(parts.find(part => part.type === 'hour')!.value);
    const minute = Number(parts.find(part => part.type === 'minute')!.value);
    if (minute === 0 && hour % 6 === 0) ticks.push({ timestamp, label: axisLabel(timestamp) });
  }
  // Label the right edge too, unless it would collide with the last major tick.
  if ((endMs - ticks[ticks.length - 1].timestamp) / (endMs - startMs) >= 0.18) {
    ticks.push({ timestamp: endMs, label: axisLabel(endMs) });
  }
  const peak = Math.max(...bars.map(bar => bar.kwh));
  const scale = peak > 0 ? 10 ** Math.floor(Math.log10(peak)) : 1;
  const ceiling = peak / scale;
  const yMax = (ceiling <= 1 ? 1 : ceiling <= 2 ? 2 : ceiling <= 5 ? 5 : 10) * scale;
  return { startMs, endMs, bars, ticks, yMax, incomplete: coverage.missingIntervals > 0 };
}
export type UsageGraph = NonNullable<ReturnType<typeof prepareTodayUsageGraph>>;
