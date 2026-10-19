'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { UsageGraph } from '../lib/meter/usage-graph';
import { sharedUsageDomain } from '../lib/meter/event-overlays';
import type { TodayEventsState } from './use-today-events';

const width = 340;
const height = 190;
const left = 37;
const right = 10;
const top = 18;
const bottom = 30;
const plotWidth = width - left - right;
const plotHeight = height - top - bottom;
const easternClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const easternHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
const yNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

export function TodayUsageChart({ graph, events, isCurrentDay = true }: { graph: UsageGraph | null; events: TodayEventsState; isCurrentDay?: boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const lastTouched = useRef<number | null>(null);
  const dragging = useRef<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<string | number | null>(null);
  const active = graph?.bars.find(bar => bar.startMs === selected);
  const activeMissing = graph?.missing.find(interval => interval.startMs === selected);
  const selectable = graph ? Array.from({ length: Math.round((graph.endMs - graph.startMs) / 900000) }, (_, index) => ({ startMs: graph.startMs + index * 900000 })) : [];
  const overlays = events.status === 'ready' ? events.data : null;
  const domain = overlays ? sharedUsageDomain(graph, overlays) : graph;
  const event = overlays?.rows.find(row => row.id === selectedEvent);
  const eventTimeline = <div className="usage-events">
    <h3>Events</h3>
    {events.status === 'loading' ? <p className="usage-event-note">Loading events…</p>
      : events.status === 'error' ? <p className="auth-error" role="alert">Recorded events unavailable</p>
      : !overlays?.rows.length ? <p className="usage-event-note">No recorded events today</p>
      : <>
        <div className="usage-event-scroll"><div className="usage-event-tracks" style={{ marginLeft: `${left / width * 100}%`, marginRight: `${right / width * 100}%` }}>
          {overlays.rows.map(row => <button className={`usage-event-row ${row.id === selectedEvent ? 'selected' : ''}`} type="button" key={row.id} aria-label={`${row.name}, ${row.timeLabel}, ${row.durationMinutes === null ? 'duration unknown' : `${row.durationMinutes} min`}${row.scheduled ? ', scheduled duration' : ''}`} aria-pressed={row.id === selectedEvent} onClick={() => setSelectedEvent(row.id)}>
            <span className="usage-event-name">{row.name}{row.open ? row.historical ? ' · stop unknown' : ' · running' : ''}</span>
            <span className="usage-event-band" style={{ left: `${(row.startMs - domain!.startMs) / (domain!.endMs - domain!.startMs) * 100}%`, width: `${(row.endMs - row.startMs) / (domain!.endMs - domain!.startMs) * 100}%` }}/>
          </button>)}
        </div></div>
        {event && <p className="usage-event-detail" role="status"><strong>{event.name}</strong> · {event.timeLabel} · {event.durationMinutes === null ? 'Duration unknown' : `${event.durationMinutes} min`}{event.scheduled ? ' (scheduled duration)' : event.open && !event.historical ? ' elapsed' : ''}</p>}
        {overlays.rows.some(row => row.open && row.historical) && <p className="usage-event-note">Open historical events are shown only to day-end; their actual stop time is unknown.</p>}
        <p className="usage-event-note">Observations for correlation only; no energy use is attributed to events.</p>
      </>}
  </div>;
  if (!graph) return <div className="bill-panel usage-chart-panel"><h2>15-minute usage</h2><p className="bill-note">{isCurrentDay ? 'No completed meter data yet' : 'No meter data for this day'}</p>{eventTimeline}</div>;
  const x = (timestamp: number) => left + (timestamp - domain!.startMs) / (domain!.endMs - domain!.startMs) * plotWidth;
  const y = (kwh: number) => top + plotHeight * (1 - kwh / graph.yMax);
  const barWidth = plotWidth * 900000 / (domain!.endMs - domain!.startMs);
  const inset = Math.min(1, barWidth * 0.12);

  // Axis presentation only: retain the graph's real-instant Eastern day domain.
  const ticks = Array.from({ length: Math.round((graph.endMs - graph.startMs) / 3600000) + 1 }, (_, index) => {
    const timestamp = graph.startMs + index * 3600000;
    const hour = Number(easternHour.format(new Date(timestamp)));
    return { timestamp, major: hour % 3 === 0, label: `${hour % 12 || 12}${hour < 12 ? 'A' : 'P'}` };
  });
  const selection = selected !== null && selected >= graph.startMs && selected < graph.endMs ? selected : null;
  const selectionValue = active ? `${active.kwh} kWh` : activeMissing ? 'Missing' : 'Not available yet';
  const cursorX = selection === null ? null : x(selection) + barWidth / 2;
  const readoutWidth = 132;
  const readoutX = cursorX === null ? left : Math.max(left, Math.min(width - right - readoutWidth, cursorX - readoutWidth / 2));

  function point(event: PointerEvent<SVGSVGElement>, initial = false) {
    if (!initial && event.pointerType !== 'mouse' && dragging.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX - bounds.left) / bounds.width * width;
    const vertical = (event.clientY - bounds.top) / bounds.height * height;
    if (initial || dragging.current !== event.pointerId) {
      if (position < left || position > width - right || vertical < top || vertical > top + plotHeight) return;
    }
    const slot = Math.max(0, Math.min(selectable.length - 1, Math.floor((position - left) / plotWidth * selectable.length)));
    const timestamp = selectable[slot].startMs;
    if (event.pointerType === 'touch') {
      if (!initial && lastTouched.current !== null && lastTouched.current !== timestamp && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(8); } catch { /* Optional haptics must never interrupt interaction. */ }
      }
      lastTouched.current = timestamp;
    }
    setSelected(timestamp);
  }
  function startPointer(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - bounds.left) / bounds.width * width;
    const py = (event.clientY - bounds.top) / bounds.height * height;
    if (px < left || px > width - right || py < top || py > top + plotHeight) return;
    dragging.current = event.pointerId;
    lastTouched.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    point(event, true);
  }
  function endPointer(event: PointerEvent<SVGSVGElement>) {
    if (dragging.current !== event.pointerId) return;
    dragging.current = null;
    lastTouched.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyboard(event: KeyboardEvent<SVGSVGElement>) {
    const index = selectable.findIndex(interval => interval.startMs === selected);
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = Math.min(selectable.length - 1, index + 1); break;
      case 'ArrowLeft': next = index < 0 ? selectable.length - 1 : Math.max(0, index - 1); break;
      case 'Home': next = 0; break;
      case 'End': next = selectable.length - 1; break;
      case 'Escape': setSelected(null); event.preventDefault(); return;
      default: return;
    }
    event.preventDefault(); setSelected(selectable[next]?.startMs ?? null);
  }

  return <div className="bill-panel usage-chart-panel">
    <h2>15-minute usage</h2>
    {!graph.bars.length && <p className="bill-note">{isCurrentDay ? 'No completed meter data yet' : 'No meter data for this day'}</p>}
    {graph.incomplete && <p className="usage-chart-warning">⚠ Data incomplete</p>}
    <svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} role="group" aria-roledescription="bar chart" aria-label="Completed 15-minute meter usage in kWh. Times are Eastern. Touch or drag anywhere in the plot, hover with a mouse, or use arrow keys for interval details. Future intervals are blank." tabIndex={0}
      onPointerDown={startPointer} onPointerMove={event => point(event)} onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={() => { dragging.current = null; lastTouched.current = null; }} onKeyDown={keyboard}>
      {overlays && sharedUsageDomain(graph, overlays).extendsPastMeter && <rect x={x(graph.endMs)} y={top} width={x(domain!.endMs) - x(graph.endMs)} height={plotHeight} className="usage-after-meter"/>}
      <text x={left} y={10} className="usage-chart-unit">kWh</text>
      {[0, graph.yMax / 2, graph.yMax].map(value => <g key={value}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="usage-chart-grid"/>
        <text x={left - 6} y={y(value) + 3} textAnchor="end" className="usage-chart-label">{yNumber.format(value)}</text>
      </g>)}
      <g aria-label="Missing meter readings">{graph.missing.map(interval => <rect key={interval.startMs} x={x(interval.startMs) + inset} y={y(0) - 8} width={barWidth - inset * 2} height={8} rx={1} className={interval.startMs === selected ? 'usage-missing-marker selected' : 'usage-missing-marker'}><title>{interval.intervalLabel}: Missing meter reading</title></rect>)}</g>
      <g aria-label="Meter readings">{graph.bars.map(bar => <g key={bar.startMs}>
        <title>{bar.intervalLabel}: {bar.kwh} kWh</title>
        {bar.kwh === 0 ? <circle cx={x(bar.startMs) + barWidth / 2} cy={y(0)} r={1.4} className="usage-zero"/>
          : <rect x={x(bar.startMs) + inset} y={y(bar.kwh)} width={barWidth - inset * 2} height={y(0) - y(bar.kwh)} rx={Math.min(1.5, barWidth / 4)} className={bar.startMs === selected ? 'usage-bar selected' : 'usage-bar'}/>}
      </g>)}</g>
      {ticks.map(tick => <g key={tick.timestamp}>
        <line x1={x(tick.timestamp)} x2={x(tick.timestamp)} y1={y(0)} y2={y(0) + (tick.major ? 5 : 3)} className="usage-chart-grid"/>
        {tick.major && <text x={x(tick.timestamp)} y={height - 8} textAnchor={tick.timestamp === graph.startMs ? 'start' : tick.timestamp === graph.endMs ? 'end' : 'middle'} className="usage-chart-label">{tick.label}</text>}
      </g>)}
      <rect x={left} y={top} width={plotWidth} height={plotHeight} fill="transparent"/>
      {selection !== null && cursorX !== null && <g className="usage-scrub-selection" pointerEvents="none" aria-hidden="true">
        <rect x={x(selection)} y={top} width={barWidth} height={plotHeight} className="usage-scrub-slot"/>
        <line x1={cursorX} x2={cursorX} y1={top} y2={y(0)} className="usage-scrub-cursor"/>
        <g transform={`translate(${readoutX}, ${top + 4})`}>
          <rect width={readoutWidth} height={42} rx={7} className="usage-scrub-bubble"/>
          <text x={8} y={16} className="usage-scrub-time">{easternClock.format(new Date(selection))}</text>
          <text x={8} y={32} className="usage-scrub-value">{selectionValue}</text>
        </g>
      </g>}
    </svg>
    <div className="usage-chart-tooltip" role="status" aria-live="polite">
      {active ? <><span>{active.intervalLabel}</span><strong>{active.kwh} kWh</strong></> : activeMissing ? <><span>{activeMissing.intervalLabel}</span><strong className="usage-missing-text">Missing meter reading</strong></> : selection !== null ? <><span>{easternClock.format(new Date(selection))}</span><strong>Not available yet</strong></> : <span>Touch or drag for details</span>}
    </div>
    <p className="usage-chart-caption">Eastern time · Red: missing completed readings · Blank: unfinished/future intervals</p>
    {overlays && sharedUsageDomain(graph, overlays).extendsPastMeter && <p className="usage-event-note">Meter window ends {new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(graph.endMs))}; shaded area shows events through current time.</p>}
    {eventTimeline}
  </div>;
}
