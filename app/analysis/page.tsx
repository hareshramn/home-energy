'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthGate } from '../auth-gate';
import { loadDailyObservations } from '../../lib/analysis/load-observations';
import type { DailyObservation } from '../../lib/analysis/daily-observations';

const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
const energy = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const minutes = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export default function AnalysisPage() {
  return <AuthGate><Analysis/></AuthGate>;
}

function Analysis() {
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; rows: DailyObservation[] }>({ status: 'loading', rows: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', rows: [] });
    void loadDailyObservations().then(rows => { if (!cancelled) setState({ status: 'ready', rows }); })
      .catch(() => { if (!cancelled) setState({ status: 'error', rows: [] }); });
    return () => { cancelled = true; };
  }, [attempt]);
  return <div className="app-shell secondary-shell">
    <header className="secondary-header"><Link href="/" className="back-home">← Home</Link><h1>Analysis</h1></header>
    <main className="secondary-main"><section className="analysis-view" aria-label="Daily observations" aria-busy={state.status === 'loading'}>
      <div className="bill-panel"><h2>What makes a high-usage day?</h2>
        {state.status === 'loading' ? <p className="bill-note" role="status">Loading daily observations…</p>
          : state.status === 'error' ? <p className="auth-error" role="alert">Analysis data unavailable. <button className="sign-out" onClick={() => setAttempt(value => value + 1)}>Retry</button></p>
          : <p className="analysis-count">{state.rows.length} complete days analyzed</p>}
        <p className="bill-note">Complete historical meter days in Eastern Time. Appliance totals describe completed recorded events only; no recorded event does not mean no use. Events without a recorded stop are excluded.</p>
      </div>
      {state.status === 'ready' && (state.rows.length ? <ul className="analysis-days">{state.rows.map(day => <li className="bill-panel analysis-day" key={day.date}>
        <div className="analysis-day-heading"><h3>{dateLabel.format(new Date(`${day.date}T12:00:00Z`))}</h3><strong>{energy.format(day.total_kwh)} kWh</strong></div>
        <dl>{(['washer', 'dryer', 'cooktop'] as const).map(appliance => <div key={appliance}><dt>{appliance[0].toUpperCase() + appliance.slice(1)}</dt><dd>{day[`${appliance}_count`] ? <>{minutes.format(day[`${appliance}_minutes`])}m <span>· {day[`${appliance}_count`]} recorded {day[`${appliance}_count`] === 1 ? 'event' : 'events'}</span></> : <span>No recorded event</span>}</dd></div>)}</dl>
      </li>)}</ul> : <p className="empty-state">No complete historical meter days available yet.</p>)}
      <div className="bill-panel"><h2>Collecting data</h2><p className="bill-note">More complete days and recorded appliance events are needed before drawing reliable conclusions.</p></div>
    </section></main>
  </div>;
}
