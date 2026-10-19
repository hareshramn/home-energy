'use client';

import { useState, type PointerEvent, type KeyboardEvent } from 'react';
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

  function point(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * width;
    const index = Math.floor((x - left) / slot);
    setSelected(x >= left && x < width - right ? days[index]?.date ?? null : null);
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
    <svg className="usage-chart" viewBox={`0 0 ${width} ${height}`} tabIndex={0} role="group" aria-roledescription="bar chart" aria-label="Daily electricity usage in kWh per day. Tap a day or use arrow keys for details. Dashed markers represent incomplete or missing data. Light green is today so far."
      onPointerDown={point} onPointerMove={point} onPointerLeave={event => { if (event.pointerType === 'mouse') setSelected(null); }} onKeyDown={keyboard}>
      <text x={left} y={10} className="usage-chart-unit">kWh/day</text>
      {[0, max / 2, max].map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="usage-chart-grid"/><text x={left - 6} y={y(value) + 3} textAnchor="end" className="usage-chart-label">{value}</text></g>)}
      {days.map((day, index) => <g key={day.date}>
        <title>{label(day.date)}: {day.kwh === null ? 'Incomplete data' : `${number.format(day.kwh)} kWh${day.coverage.isCurrentDay ? ' so far' : ''}`}</title>
        {day.kwh === null ? <g className="daily-missing"><rect x={center(index) - Math.min(7, slot * 0.3)} y={y(0) - 19} width={Math.min(14, slot * 0.6)} height={14} rx={3}/>{slot >= 14 && <text x={center(index)} y={y(0) - 8} textAnchor="middle">{day.coverage.status === 'missing' ? '×' : '?'}</text>}</g>
          : day.kwh === 0 ? <circle cx={center(index)} cy={y(0)} r={1.8} className={day.coverage.isCurrentDay ? 'daily-zero-today' : 'usage-zero'}/>
          : <rect x={center(index) - barWidth / 2} y={y(day.kwh)} width={barWidth} height={y(0) - y(day.kwh)} rx={Math.min(2, barWidth / 4)} className={`daily-bar ${day.coverage.isCurrentDay ? 'today' : ''} ${selected === day.date ? 'selected' : ''}`}/>}
        {(index % labelStep === 0 || index === days.length - 1 && index % labelStep >= labelStep / 2) && <text x={center(index)} y={height - 7} textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'} className="usage-chart-label">{index === 0 || day.date.slice(8) === '01' ? label(day.date) : String(Number(day.date.slice(8)))}</text>}
      </g>)}
    </svg>
    <div className="daily-usage-detail" role="status" aria-live="polite">
      {!active ? <span>Tap a day for details</span> : <>
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
