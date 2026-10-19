'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { loadBillingCycle, saveBillingCycle, type BillingCycleSummary } from '../lib/meter/billing-cycle';
import { todayMeterBounds } from '../lib/meter/today';
import { BillDailyChart } from './bill-daily-chart';

type State = { status: 'loading' | 'error'; data?: never } | { status: 'ready'; data: BillingCycleSummary | null };
const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function dateLabel(date: string, year = false) {
  // Noon UTC stays on the same Eastern calendar date; this is only a date label.
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' as const } : {}) }).format(new Date(`${date}T12:00:00Z`));
}
function useBillingCycle() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const mounted = useRef(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++version.current;
    setState({ status: 'loading' });
    try {
      const data = await loadBillingCycle();
      if (mounted.current && request === version.current) setState({ status: 'ready', data });
    } catch {
      if (mounted.current && request === version.current) setState({ status: 'error' });
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(visible, 60000);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => {
      mounted.current = false;
      version.current++;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [refresh]);
  return { state, refresh };
}

export function BillCycleCard({ onClick }: { onClick: () => void }) {
  const { state } = useBillingCycle();
  const data = state.status === 'ready' ? state.data : null;
  return <button type="button" className="metric bill-metric" onClick={onClick} aria-label="Bill Cycle" aria-busy={state.status === 'loading'}>
    <h2>BILL CYCLE AVG</h2>
    <div className="energy"><span>{data?.averageKwh != null ? number.format(data.averageKwh) : '--'}</span><span className="unit">kWh/day</span></div>
    <p className="bill-detail">{state.status === 'loading' ? 'Loading cycle…' : state.status === 'error' ? 'Cycle data unavailable' : !data ? 'Set cycle start' : <>
      <span>{data.excludedDays > 0 && <span className="bill-warning" aria-label="Incomplete days excluded">⚠ </span>}{dateLabel(data.startDate)} → now</span>
      {data.averageKwh === null && <span className="bill-insufficient">Not enough complete data</span>}
    </>}</p>
  </button>;
}

export function BillCycleView({ onOpenDay }: { onOpenDay?: (date: string) => void }) {
  const { state, refresh } = useBillingCycle();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedDate, setSavedDate] = useState('');
  const lock = useRef(false);
  const data = state.status === 'ready' ? state.data : null;
  const today = todayMeterBounds().date;
  function openPicker() { setDate(data?.startDate ?? today); setError(''); setSavedDate(''); setEditing(true); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try {
      await saveBillingCycle(date);
      setSavedDate(date); setEditing(false);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save the cycle start. Please try again.');
    } finally {
      lock.current = false; setSaving(false);
    }
  }
  return <section className="bill-view">
    <div className="bill-panel">
      <h2>Current cycle</h2>
      <p className="bill-date">{state.status === 'loading' ? 'Loading…' : state.status === 'error' ? 'Cycle data unavailable' : data ? `${dateLabel(data.startDate, true)} → Present` : 'Set cycle start'}</p>
      {state.status === 'error' && <button className="sign-out" type="button" onClick={() => void refresh()}>Retry</button>}
      <button className="home-action" type="button" onClick={openPicker} disabled={saving}>{data ? 'Change cycle start' : 'Set cycle start'}</button>
      {editing && <form className="bill-form" onSubmit={save}>
        <label htmlFor="cycle-start">Cycle start date</label>
        <input id="cycle-start" type="date" value={date} max={today} required disabled={saving} onChange={event => setDate(event.target.value)}/>
        <div className="bill-actions"><button className="sign-out" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button><button className="upload" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save cycle start'}</button></div>
      </form>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {savedDate && <p className="manual-success" role="status">Cycle start saved.{data && data.startDate !== savedDate ? ` Current cycle still starts ${dateLabel(data.startDate, true)}.` : ''}</p>}
    </div>
    <div className="bill-panel">
      <h2>Average</h2>
      <div className="energy"><span>{data?.averageKwh != null ? number.format(data.averageKwh) : '--'}</span><span className="unit">kWh/day</span></div>
      {state.status === 'ready' && <>
        {data?.averageKwh == null && <p className="bill-note">Not enough complete data</p>}
        <p className="bill-count">Complete days used: {data?.completeDays ?? 0}</p>
        <p className={`bill-count ${data?.excludedDays ? 'bill-warning' : ''}`}>Incomplete days excluded: {data?.excludedDays ?? 0}</p>
      </>}
      <p className="bill-note">Today is excluded. Only complete past days are used.</p>
    </div>
    {data && <BillDailyChart days={data.dailyUsage} onOpenDay={onOpenDay}/>}
    {data && <div className="bill-panel coverage-panel">
      <h2>Data Coverage</h2>
      <p className="bill-note">{dateLabel(data.startDate)} → today · America/New_York</p>
      <div className="coverage-days">{data.coverage.map(day => {
        const label = day.isCurrentDay
          ? day.status === 'complete' ? 'Complete so far' : 'Partial today'
          : day.status === 'complete' ? 'Complete' : day.status === 'missing' ? 'Missing' : 'Partial';
        const row = <><span>{dateLabel(day.date)}</span><span className={day.status === 'complete' ? '' : 'bill-warning'}>{day.status === 'complete' ? '✓' : '⚠'} {label}</span><span>{day.actualIntervals} / {day.expectedIntervals}</span></>;
        return day.missingRanges.length ? <details className="coverage-day" key={day.date}>
          <summary className="coverage-row">{row}</summary>
          <div className="coverage-ranges"><p>Missing interval starts:</p><ul>{day.missingRanges.map(range => <li key={range.startAt}>{range.startLabel} → {range.endLabel}</li>)}</ul></div>
        </details> : <div className="coverage-day coverage-row" key={day.date}>{row}</div>;
      })}</div>
      <p className="bill-note">Expand a day to see missing ranges. Today is never counted as a complete full day.</p>
    </div>}
  </section>;
}
