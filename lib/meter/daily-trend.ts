import { analyzeMeterCoverage, type CoverageReading, type DayCoverage } from './coverage';
import { adjacentMeterDate, currentMeterDate, meterDayBounds, validateMeterDate } from './today';
import { prepareTodayUsageGraph } from './usage-graph';

/** Points sit at interval ENDS, when that reading's energy is fully known. */
export function prepareDailyTrend(readings: readonly CoverageReading[], coverage: DayCoverage) {
  const graph = prepareTodayUsageGraph(readings, coverage);
  const points: { timestamp: number; kwh: number; afterGap: boolean }[] = [];
  const segments: typeof points[] = [];
  let total = 0;
  let previousEnd = graph.startMs;
  let afterGap = false;
  let segment: typeof points = [];
  for (const bar of graph.bars) {
    if (bar.startMs !== previousEnd) {
      afterGap = true;
      segment = [];
    }
    if (!segment.length) {
      segments.push(segment);
      // Only midnight has a known zero baseline. Never invent a point in a gap.
      if (bar.startMs === graph.startMs) segment.push({ timestamp: graph.startMs, kwh: 0, afterGap: false });
    }
    total += bar.kwh;
    const point = { timestamp: bar.endMs, kwh: total, afterGap };
    points.push(point);
    segment.push(point);
    previousEnd = bar.endMs;
  }
  return { ...graph, points, segments, total: points.length ? total : null, yMax: Math.max(1, Math.ceil(total * 1.05)) };
}
export type DailyTrendGraph = ReturnType<typeof prepareDailyTrend>;

/** Rounded ticks with about five bands, shared by both curves. */
export function trendScale(peak: number) {
  const rough = Math.max(peak, 1) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].find(value => value * magnitude >= rough)! * magnitude;
  const max = Math.ceil(Math.max(peak, 1) / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => Number((i * step).toPrecision(12))) };
}

export type BaselineMode = 'bill' | '7' | '30' | 'weekdays' | 'weekends' | 'yesterday';

/** Calendar window [start, selected date); a cycle begins at its latest saved start. */
export function typicalWindow(selectedDate: string, mode: BaselineMode, cycleStarts: readonly string[] = [], now = new Date()) {
  validateMeterDate(selectedDate, now);
  let startDate: string | null = null;
  if (mode === 'bill') {
    startDate = cycleStarts.filter(date => date <= selectedDate).sort().at(-1) ?? null;
  } else {
    startDate = selectedDate;
    for (let i = 0; i < (mode === 'yesterday' ? 1 : mode === 'weekdays' || mode === 'weekends' ? 30 : Number(mode)); i++) startDate = adjacentMeterDate(startDate, -1, now);
  }
  return { mode, startDate, endDate: selectedDate, start: startDate ? meterDayBounds(startDate).start : null, end: meterDayBounds(selectedDate).start };
}

type ComparisonPoint = { timestamp: number; kwh: number; afterGap?: boolean };
export type TypicalDay = { excludedDstDays: number; count: number; dates: string[]; points: ComparisonPoint[] | null; segments?: ComparisonPoint[][]; incomplete?: boolean };

/** Require matching civil-day duration so DST intervals are never invented or folded. */
export function prepareTypicalDay(readings: readonly CoverageReading[], selectedDate: string, now = new Date(), window = typicalWindow(selectedDate, '30', [], now)): TypicalDay {
  const bounds = meterDayBounds(selectedDate);
  const duration = Date.parse(bounds.end) - Date.parse(bounds.start);
  const groups = new Map<string, CoverageReading[]>();
  for (const reading of readings) {
    const date = currentMeterDate(new Date(reading.timestamp));
    if (!window.startDate || date < window.startDate || date >= selectedDate) continue;
    const group = groups.get(date) ?? [];
    group.push(reading);
    groups.set(date, group);
  }
  if (window.mode === 'yesterday') {
    const date = window.startDate!;
    const rows = groups.get(date) ?? [];
    const coverage = analyzeMeterCoverage(rows, { startDate: date, endDate: date, now })[0];
    if (coverage.dayIntervals * 900000 !== duration) return { excludedDstDays: 1, count: 0, dates: [], points: null };
    const graph = prepareDailyTrend(rows, coverage);
    const align = (point: ComparisonPoint) => ({ ...point, timestamp: Date.parse(bounds.start) + point.timestamp - graph.startMs });
    const segments = graph.segments.map(segment => segment.map(align));
    return { excludedDstDays: 0, count: graph.points.length ? 1 : 0, dates: graph.points.length ? [date] : [],
      points: graph.points.length ? segments.flat() : null, segments, incomplete: graph.incomplete };
  }
  let excludedDstDays = 0;
  const days = [...groups].sort(([a], [b]) => b.localeCompare(a)).flatMap(([date, rows]) => {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    if (window.mode === 'weekdays' && weekend || window.mode === 'weekends' && !weekend) return [];
    const coverage = analyzeMeterCoverage(rows, { startDate: date, endDate: date, now })[0];
    if (coverage.status !== 'complete' || coverage.isCurrentDay) return [];
    if (coverage.dayIntervals * 900000 !== duration) { excludedDstDays++; return []; }
    return [{ date, graph: prepareDailyTrend(rows, coverage) }];
  });
  if (!days.length) return { excludedDstDays, count: days.length, dates: days.map(day => day.date), points: null };
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };
  return { excludedDstDays, count: days.length, dates: days.map(day => day.date), points: [
    { timestamp: Date.parse(bounds.start), kwh: 0 },
    ...days[0].graph.points.map((_, index) => ({
      timestamp: Date.parse(bounds.start) + (index + 1) * 900000,
      kwh: median(days.map(day => day.graph.points[index].kwh)),
    })),
  ] };
}
export function comparisonLabel(mode: BaselineMode, count: number, selectedDate: string) {
  if (mode === 'yesterday') {
    const previous = new Date(`${selectedDate}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return `Yesterday · ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(previous)}`;
  }
  const unit = mode === 'weekdays' ? count === 1 ? 'weekday' : 'weekdays'
    : mode === 'weekends' ? count === 1 ? 'weekend day' : 'weekend days' : count === 1 ? 'complete day' : 'complete days';
  return `Typical · median of ${count} ${unit}`;
}

/** Only compare measured totals with a baseline at the exact completed endpoint. */
export function typicalDifference(graph: DailyTrendGraph, coverage: DayCoverage, typical: TypicalDay | null) {
  if (coverage.status !== 'complete' || graph.total === null) return null;
  const latest = graph.points.at(-1);
  const reference = latest ? typical?.points?.find(point => point.timestamp === latest.timestamp) : null;
  return reference && !reference.afterGap ? graph.total - reference.kwh : null;
}

export function baselineConfidence(count: number) {
  if (count === 0) return 'No complete comparison days available.';
  if (count < 3) return `Limited baseline · ${count} complete ${count === 1 ? 'day' : 'days'}`;
  return `Typical · median of ${count} complete days`;
}

const trendClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
});
export function trendPointLabel(timestamp: number, endMs: number) {
  return timestamp === endMs ? 'End of day' : trendClock.format(new Date(timestamp));
}

/** Unknown earlier usage prevents a meaningful difference after a gap. */
export function scrubDifference(point: DailyTrendGraph['points'][number] | undefined, typical: TypicalDay | null) {
  if (!point || point.afterGap) return null;
  const reference = typical?.points?.find(candidate => candidate.timestamp === point.timestamp);
  return reference && !reference.afterGap ? point.kwh - reference.kwh : null;
}
