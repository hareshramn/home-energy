'use client';

import { useState } from 'react';
import { useTodayMeter } from './use-today-meter';
import { TodayUsageChart } from './today-usage-chart';
import { prepareTodayUsageGraph } from '../lib/meter/usage-graph';
import { useTodayEvents } from './use-today-events';
import { adjacentMeterDate, currentMeterDate, validateMeterDate } from '../lib/meter/today';

const time = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
});
const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' });
const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const showTime = (value: string | null | undefined) => value ? dateTime.format(new Date(value)) : '--';
const dateLabel = (date: string, year = true) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' as const } : {}),
}).format(new Date(`${date}T12:00:00Z`));

export function DailyUsage({ initialDate, onOpenTrend }: { initialDate?: string; onOpenTrend: (date: string) => void }) {
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? currentMeterDate());
  const [dateError, setDateError] = useState('');
  const state = useTodayMeter(selectedDate);
  const data = state.status === 'ready' ? state.data : null;
  const events = useTodayEvents(data?.coverage.date);
  const graph = data ? prepareTodayUsageGraph(data.completedReadings, data.coverage) : null;
  const today = currentMeterDate();
  const isToday = selectedDate === today;
  function select(date: string) {
    if (!date) return;
    try {
      validateMeterDate(date); setSelectedDate(date); setDateError('');
    } catch { setDateError('Choose a valid date no later than today.'); }
  }
  function move(direction: -1 | 1) {
    try { select(adjacentMeterDate(selectedDate, direction)); }
    catch { setDateError('Choose a valid date no later than today.'); }
  }
  return <section className="today-usage" aria-label="Daily Usage" aria-busy={state.status === 'loading'}>
    <div className="daily-date-nav">
      <button type="button" aria-label="Previous day" disabled={selectedDate <= '1900-01-01'} onClick={() => move(-1)}>‹</button>
      <label className="daily-date-control"><span>{dateLabel(selectedDate)}</span><span className="daily-today-badge">{weekday.format(new Date(`${selectedDate}T12:00:00Z`))}</span>{isToday && <span className="daily-today-badge">Today</span>}<input aria-label="Choose usage date" type="date" value={selectedDate} min="1900-01-01" max={today} onClick={event => { try { event.currentTarget.showPicker?.(); } catch { /* Native focus remains available when showPicker is unsupported. */ } }} onChange={event => select(event.target.value)}/></label>
      <button type="button" aria-label="Next day" disabled={selectedDate >= today} onClick={() => move(1)}>›</button>
    </div>
    <button type="button" className="home-action" onClick={() => onOpenTrend(selectedDate)}>Daily Trend →</button>
    {dateError && <p className="auth-error" role="alert">{dateError}</p>}
    <div className="bill-panel">
      {!isToday && <h2>{dateLabel(selectedDate, false)} Usage</h2>}
      <div className="energy"><span>{data?.todayKwh != null ? number.format(data.todayKwh) : '--'}</span><span className="unit">{!isToday && data?.todayKwh != null && data.coverage.status !== 'complete' ? 'kWh recorded' : 'kWh'}</span></div>
      {state.status === 'loading' ? <p className="bill-note" role="status">Loading meter data…</p>
        : state.status === 'error' ? <p className="auth-error" role="alert">Meter data unavailable</p>
        : data?.todayKwh === null ? <><p className="bill-note">{isToday ? data.readingsReceived ? 'No completed readings yet' : 'No meter data today' : 'No meter data for this day'}</p>{isToday && <p className="bill-note">Latest: {data.latest ? showTime(data.latest) : 'No readings yet'}</p>}</>
        : <>
          {data?.coverage.status !== 'complete' && <p className="bill-warning">⚠ Data incomplete</p>}
          {isToday ? <p className="today-through">Through {data?.through ? time.format(new Date(data.through)) : '--'}</p>
            : data?.coverage.status === 'complete' && <p className="today-through">Complete day</p>}
        </>}
    </div>
    {state.status === 'ready' && <TodayUsageChart key={selectedDate} graph={graph} events={events} isCurrentDay={isToday}/>}
    <div className="bill-panel">
      <h2>Readings</h2>
      <dl className="today-reading-summary">
        <div><dt>Readings stored</dt><dd>{data?.readingsReceived ?? '--'}</dd></div>
        <div><dt>{isToday ? 'Completed readings used' : 'Readings recorded'}</dt><dd>{data?.readingsUsed ?? '--'}</dd></div>
        <div><dt>{isToday ? 'Expected readings so far' : 'Expected readings for full day'}</dt><dd>{data?.coverage.expectedIntervals ?? '--'}</dd></div>
        <div><dt>Missing intervals</dt><dd>{data?.coverage.missingIntervals ?? '--'}</dd></div>
        <div><dt>{isToday ? 'First completed reading' : 'First reading'}</dt><dd>{showTime(data?.firstReadingAt)}</dd></div>
        <div><dt>{isToday ? 'Latest completed reading (start)' : 'Latest reading (start)'}</dt><dd>{showTime(data?.latestReadingAt)}</dd></div>
        {isToday ? <>
          <div><dt>Completed coverage through</dt><dd>{showTime(data?.through)}</dd></div>
          <div><dt>Latest stored reading (start)</dt><dd>{showTime(data?.latestStoredReadingAt)}</dd></div>
        </> : <div><dt>Day coverage status</dt><dd>{!data ? '--' : data.coverage.status === 'complete' ? 'Complete' : data.coverage.status === 'missing' ? 'Missing' : 'Partial'}</dd></div>}
      </dl>
      {data && data.coverage.missingRanges.length > 0 && <details className="daily-missing-ranges"><summary>Missing ranges</summary><ul>{data.coverage.missingRanges.map(range => <li key={range.startAt}>{range.startLabel} → {range.endLabel}</li>)}</ul></details>}
      <p className="bill-note">{isToday ? 'Only completed readings are summed. Stored unfinished intervals are excluded until complete.' : 'A recorded total on an incomplete day is not its full daily consumption.'} Missing intervals are not estimated.</p>
    </div>
  </section>;
}
