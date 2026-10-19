'use client';

import { useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import type { DailyUsage } from '../lib/meter/daily-usage';

const width = 340;
const height = 186;
const left = 38;
const right = 10;
const top = 17;
const bottom = 29;
const plotWidth = width - left - right;
const plotHeight = height - top - bottom;
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const label = (date: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));

export function BillDailyChart({ days, onOpenDay }: { days: DailyUsage; onOpenDay?: (date: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const dragging = useRef<number | null>(null);
  const lastTouched = useRef<string | null>(null);
  const active = days.find(day => day.date === selected);
  const peak = Math.max(1, ...days.map(day => day.kwh ?? 0));
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const units = peak / magnitude;
  const max = (units <= 1 ? 1 : units <= 2 ? 2 : units <= 5 ? 5 : 10) * magnitude;
  const slot = plotWidth / Math.max(1, days.length);
  const y = (kwh: number) => top + plotHeight * (1 - kwh / max);
  const center = (index: number) => left + (index + 0.5) * slot;
  const barWidth = Math.min(30, slot * 0.7);
  const labelStep = Math.max(1, Math.ceil(days.length / 6));

  const selectedIndex = days.findIndex(day => day.date === selected);
  const cursorX = selectedIndex < 0 ? null : center(selectedIndex);

  function point(event: PointerEvent<SVGSVGElement>, initial = false) {
    if (!days.length || !initial && event.pointerType !== 'mouse' && dragging.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * width;
    const y = (event.clientY - bounds.top) / bounds.height * height;
    if (initial || dragging.current !== event.pointerId) {
      if (x < left || x > width - right || y < top || y > top + plotHeight) return;
    }
    const index = Math.max(0, Math.min(days.length - 1, Math.floor((x - left) / slot)));
    const date = days[index].date;
    if (event.pointerType === 'touch') {
      if (!initial && lastTouched.current !== null && lastTouched.current !== date && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(8); } catch { /* Haptics are optional. */ }
      }
      lastTouched.current = date;
    }
    setSelected(date);
  }
  function startPointer(event: PointerEvent<SVGSVGElement>) {
    if (!days.length || !event.isPrimary || event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * width;
    const y = (event.clientY - bounds.top) / bounds.height * height;
    if (x < left || x > width - right || y < top || y > top + plotHeight) return;
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
    const index = days.findIndex(day => day.date === selected);
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = Math.min(days.length - 1, index + 1); break;
      case 'ArrowLeft': next = index < 0 ? days.length - 1 : Math.max(0, index - 1); break;
      case 'Home': next = 0; break;
      case 'End': next = days.length - 1; break;
      case 'Escape': setSelected(null); event.preventDefault(); return;
      default: return;
    }
    event.preventDefault(); setSelected(days[next]?.date ?? null);
  }

  return <div className="bill-panel daily-usage-panel">
    <h2>Daily usage</h2>
    <svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} tabIndex={0} role="group" aria-roledescription="bar chart" aria-label="Daily electricity usage in kWh per day. Touch or drag anywhere in the plot, hover with a mouse, or use arrow keys for details. Dashed markers represent incomplete or missing data. Light green is today so far."
      onPointerDown={startPointer} onPointerMove={event => point(event)} onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={() => { dragging.current = null; lastTouched.current = null; }} onKeyDown={keyboard}>
      <text x={left} y={10} className="usage-chart-unit">kWh/day</text>
      {[0, max / 2, max].map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="usage-chart-grid"/><text x={left - 6} y={y(value) + 3} textAnchor="end" className="usage-chart-label">{value}</text></g>)}
      {days.map((day, index) => <g key={day.date}>
        <title>{label(day.date)}: {day.kwh === null ? 'Incomplete data' : `${number.format(day.kwh)} kWh${day.coverage.isCurrentDay ? ' so far' : ''}`}</title>
        {day.kwh === null ? <g className="daily-missing"><rect x={center(index) - Math.min(7, slot * 0.3)} y={y(0) - 19} width={Math.min(14, slot * 0.6)} height={14} rx={3}/>{slot >= 14 && <text x={center(index)} y={y(0) - 8} textAnchor="middle">{day.coverage.status === 'missing' ? '×' : '?'}</text>}</g>
          : day.kwh === 0 ? <circle cx={center(index)} cy={y(0)} r={1.8} className={day.coverage.isCurrentDay ? 'daily-zero-today' : 'usage-zero'}/>
          : <rect x={center(index) - barWidth / 2} y={y(day.kwh)} width={barWidth} height={y(0) - y(day.kwh)} rx={Math.min(2, barWidth / 4)} className={`daily-bar ${day.coverage.isCurrentDay ? 'today' : ''} ${selected === day.date ? 'selected' : ''}`}/>}
        {(index % labelStep === 0 || index === days.length - 1 && index % labelStep >= labelStep / 2) && <text x={center(index)} y={height - 7} textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'} className="usage-chart-label">{index === 0 || day.date.slice(8) === '01' ? label(day.date) : String(Number(day.date.slice(8)))}</text>}
      </g>)}
      <rect x={left} y={top} width={plotWidth} height={plotHeight} fill="transparent"/>
      {active && cursorX !== null && <g pointerEvents="none" aria-hidden="true">
        <rect x={left + selectedIndex * slot} y={top} width={slot} height={plotHeight} className="usage-scrub-slot"/>
        <line x1={cursorX} x2={cursorX} y1={top} y2={y(0)} className="usage-scrub-cursor"/>

      </g>}
    </svg>
    <div className="daily-usage-detail" role="status" aria-live="polite">
      {!active ? <span>Touch or drag for details</span> : <>
        <strong>{label(active.date)}{active.coverage.isCurrentDay ? ' · Today so far' : ''}</strong>
        {active.coverage.isCurrentDay ? <>
          <span>{active.kwh === null ? 'No completed meter data yet' : `${number.format(active.kwh)} kWh so far`}</span>
          {active.through && <span>Through {time.format(new Date(active.through))}</span>}
          <span>{active.coverage.actualIntervals}/{active.coverage.expectedIntervals} completed intervals{active.coverage.missingIntervals ? ' · Data incomplete' : ''}</span>
        </> : active.coverage.status === 'complete' ? <><span>{number.format(active.kwh!)} kWh</span><span>Complete · {active.coverage.actualIntervals}/{active.coverage.expectedIntervals} readings</span></>
          : <><span className="bill-warning">{active.coverage.status === 'missing' ? 'Missing data' : 'Incomplete data'}</span><span>{active.coverage.actualIntervals}/{active.coverage.expectedIntervals} readings</span></>}
      </>}
    </div>
    {active && onOpenDay && <button className="sign-out daily-open-day" type="button" onClick={() => onOpenDay(active.date)}>Open daily usage →</button>}
    <p className="usage-chart-caption"><span className="daily-today-key"/> Today so far · Dashed markers: incomplete/missing days. No full-day total is plotted for them.</p>
  </div>;
}
