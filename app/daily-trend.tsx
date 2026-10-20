'use client';

import { useRef, useState, type ReactNode } from 'react';
import { useTodayMeter } from './use-today-meter';
import { adjacentMeterDate, currentMeterDate } from '../lib/meter/today';
import { prepareDailyTrend, type DailyTrendGraph, type TypicalDay, type BaselineMode, typicalDifference, trendScale, baselineConfidence, trendPointLabel, scrubDifference } from '../lib/meter/daily-trend';
import { useTypicalDay } from './use-typical-day';
import { chartTimeTicks } from './chart-time-axis';
import { RecordedActivity } from './recorded-activity';

const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', dateStyle: 'full' });
const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const axisNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const signedDifference = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${number.format(Math.abs(value))}`;
const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function DailyTrend({ initialDate }: { initialDate?: string }) {
  const [date, setDate] = useState(() => initialDate ?? currentMeterDate());
  const [mode, setMode] = useState<BaselineMode>('bill');
  const state = useTodayMeter(date);
  const data = state.status === 'ready' ? state.data : null;
  const graph = data ? prepareDailyTrend(data.completedReadings, data.coverage) : null;
  const baseline = useTypicalDay(date, mode);
  const typical = baseline.status === 'ready' ? baseline.data : null;
  const difference = graph && data ? typicalDifference(graph, data.coverage, typical) : null;
  const today = currentMeterDate();
  const summary = <div className="trend-energy-header">
    <div className="energy"><span>{graph?.total != null ? number.format(graph.total) : '--'}</span><span className="unit">{date === today ? 'kWh so far' : data?.coverage.status === 'complete' ? 'kWh' : 'kWh recorded'}</span></div>
    <div className="trend-energy-meta">
      {difference !== null && <span>{signedDifference(difference)} kWh vs {typical && typical.count < 3 ? 'baseline' : 'typical'}{date === today ? ' at this time' : ''}</span>}
      {data && <span>{data.through ? date === today ? `Through ${clock.format(new Date(data.through))}` : data.coverage.status === 'complete' ? 'Complete day' : 'Recorded usage only' : 'No completed readings available.'}</span>}
    </div>
    {data && data.coverage.status !== 'complete' && <p className="bill-warning trend-coverage-warning">Data incomplete · {data.coverage.missingIntervals} missing intervals</p>}
    {state.status === 'loading' && <p className="bill-note" role="status">Loading meter data…</p>}
    {state.status === 'error' && <p className="auth-error" role="alert">Meter data unavailable</p>}
  </div>;
  return <section className="today-usage daily-trend" aria-label="Daily Trend" aria-busy={state.status === 'loading'}>
    <div className="daily-date-nav">
      <button type="button" aria-label="Previous day" disabled={date <= '1900-01-01'} onClick={() => setDate(adjacentMeterDate(date, -1))}>‹</button>
      <div className="daily-date-control"><span>{dateLabel.format(new Date(`${date}T12:00:00Z`))}</span>{date === today && <span className="daily-today-badge">Today</span>}</div>
      <button type="button" aria-label="Next day" disabled={date >= today} onClick={() => setDate(adjacentMeterDate(date, 1))}>›</button>
    </div>
    <fieldset className="trend-compare"><legend>Compare to:</legend><div>{([['bill', 'Bill cycle'], ['7', 'Last 7 days'], ['30', 'Last 30 days']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div></fieldset>
    {graph ? <TrendChart graph={graph} typical={typical} baselineStatus={baseline.status} summary={summary}/> : <div className="bill-panel trend-panel">{summary}</div>}
    <RecordedActivity date={date}/>
  </section>;
}

function TrendChart({ graph, typical, baselineStatus, summary }: { graph: DailyTrendGraph; typical: TypicalDay | null; baselineStatus: 'loading' | 'ready' | 'error'; summary: ReactNode }) {
  const [selection, setSelection] = useState<{ dayStart: number; index: number | null }>({ dayStart: graph.startMs, index: null });
  const selected = selection.dayStart === graph.startMs ? selection.index : null;
  if (selection.dayStart !== graph.startMs) setSelection({ dayStart: graph.startMs, index: null });
  const lastSelection = useRef<number | null>(null);
  const activePointer = useRef<number | null>(null);
  const scale = trendScale(Math.max(graph.total ?? 0, typical?.points?.at(-1)?.kwh ?? 0));
  const width = 360, height = 275, left = 32, right = 5, top = 16, bottom = 24;
  const x = (timestamp: number) => left + (timestamp - graph.startMs) / (graph.endMs - graph.startMs) * (width - left - right);
  const y = (kwh: number) => height - bottom - kwh / scale.max * (height - top - bottom);
  const point = selected === null ? graph.points[graph.points.length - 1] : graph.points[Math.min(selected, graph.points.length - 1)];
  const difference = scrubDifference(point, typical);
  const pointLabel = point ? trendPointLabel(point.timestamp, graph.endMs) : '';
  const comparisonName = typical && typical.count < 3 ? 'baseline' : 'typical';
  function choose(index: number, haptic = false) {
    if (haptic && lastSelection.current !== index && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(8); } catch { /* Haptics are optional. */ }
    }
    lastSelection.current = index;
    setSelection({ dayStart: graph.startMs, index });
  }
  function scrub(event: React.PointerEvent<SVGSVGElement>) {
    if (!graph.points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - bounds.left) / bounds.width * width;
    const index = graph.points.reduce((best, candidate, i) => Math.abs(x(candidate.timestamp) - position) < Math.abs(x(graph.points[best].timestamp) - position) ? i : best, 0);
    choose(index, event.pointerType !== 'mouse');
  }
  return <div className="bill-panel trend-panel">
    {summary}
    {selected !== null && <div className="trend-scrub-readout"><div className="trend-readout" aria-live="off">{point ? <><span>{pointLabel}</span><strong>{number.format(point.kwh)} kWh{point.afterGap ? ' recorded' : ''}</strong></> : <span>No completed readings</span>}</div>
    <p className="trend-scrub-difference">{difference !== null ? `${signedDifference(difference)} kWh vs ${comparisonName}` : point?.afterGap && typical?.points ? 'Comparison unavailable after missing data' : '\u00a0'}</p></div>}
    <svg className="usage-chart trend-energy-chart" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} role="slider" tabIndex={graph.points.length ? 0 : undefined} aria-label="Select completed interval on cumulative energy chart"
      aria-valuemin={0} aria-valuemax={Math.max(0, graph.points.length - 1)} aria-valuenow={selected ?? Math.max(0, graph.points.length - 1)}
      aria-valuetext={point ? `${pointLabel}, ${number.format(point.kwh)} kWh${point.afterGap ? ' recorded; earlier data missing' : ''}` : 'No completed readings'}
      onKeyDown={event => {
        if (!graph.points.length) return;
        const current = selected ?? graph.points.length - 1;
        const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - 1 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? graph.points.length - 1 : null;
        if (next !== null) { event.preventDefault(); choose(Math.max(0, Math.min(graph.points.length - 1, next))); }
      }}
      onPointerDown={event => { activePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); scrub(event); }}
      onPointerUp={() => { activePointer.current = null; }} onPointerCancel={() => { activePointer.current = null; }}
      onPointerMove={event => { if (event.pointerType === 'mouse' || activePointer.current === event.pointerId) scrub(event); }}>
      <text x={left} y={12} className="usage-chart-unit">kWh</text>
      {scale.ticks.map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="usage-chart-grid"/><line x1={left - 4} x2={left} y1={y(value)} y2={y(value)} className="energy-axis-tick"/><text x={left - 7} y={y(value) + 3} textAnchor="end" className="usage-chart-label">{axisNumber.format(value)}</text></g>)}
      {graph.missing.map(gap => <rect key={gap.startMs} x={x(gap.startMs)} y={top} width={x(gap.endMs) - x(gap.startMs)} height={height - top - bottom} className="trend-gap"/>)}
      {typical?.points && <polyline points={typical.points.map(p => `${x(p.timestamp)},${y(p.kwh)}`).join(' ')} className="trend-typical"/>}
      {graph.segments.map((segment, i) => <g key={i}><polyline points={segment.map(p => `${x(p.timestamp)},${y(p.kwh)}`).join(' ')} className="trend-line"/>{segment.length === 1 && <circle cx={x(segment[0].timestamp)} cy={y(segment[0].kwh)} r={2.5} className="trend-dot"/>}</g>)}
      {chartTimeTicks(graph.startMs, graph.endMs).filter(tick => tick.major).map(tick => <g key={tick.timestamp}><line x1={x(tick.timestamp)} x2={x(tick.timestamp)} y1={y(0)} y2={y(0) + 5} className="energy-axis-tick"/><text x={x(tick.timestamp)} y={height - 10} textAnchor={tick.timestamp === graph.startMs ? 'start' : tick.timestamp === graph.endMs ? 'end' : 'middle'} className="usage-chart-label energy-axis-label">{tick.label}</text></g>)}
      {point && <><line x1={x(point.timestamp)} x2={x(point.timestamp)} y1={top} y2={height - bottom} className="usage-scrub-cursor"/><circle cx={x(point.timestamp)} cy={y(point.kwh)} r={3.5} className="trend-dot"/></>}
    </svg>
    <div className="trend-legend"><span><i/>Selected day</span>{typical?.points && <span><i className="typical"/>{typical.count < 3 ? 'Limited baseline' : 'Typical'}</span>}</div>
    <div className="trend-footer-meta"><p className="usage-chart-caption">{baselineStatus === 'loading' ? 'Loading comparison…' : baselineStatus === 'error' ? 'Comparison unavailable.' : baselineConfidence(typical?.count ?? 0)}</p><p className="usage-chart-caption trend-interaction-hint">Drag to explore · Eastern Time</p></div>
    {!!typical?.excludedDstDays && <p className="usage-chart-caption">{typical.excludedDstDays} complete days excluded because their DST day length differs.</p>}
    {graph.incomplete && <p className="usage-chart-caption">{graph.missing.length} intervals missing · Missing usage not estimated</p>}
  </div>;
}
