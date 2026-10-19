'use client';

import { useState } from 'react';
import { EventHistory } from './event-history';
import { AuthGate, SignOutControl } from './auth-gate';
import { appliances, formatTime } from './appliance-timers';
import { useQuickActions } from './use-quick-actions';
import { ManualEvent } from './manual-event';

type IconName = 'home' | 'washer' | 'dryer' | 'cooktop' | 'upload' | 'explore' | 'ask' | 'bolt';
function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'home' && <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>}
    {(name === 'washer' || name === 'dryer') && <><rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M4 7h16M7 4.5h.01M10 4.5h.01"/><circle cx="12" cy="14" r="4.5"/>{name === 'washer' ? <path d="M8 14c2-2 4 2 8 0"/> : <path d="M11 11.5c-2 2 4 3 1 5"/>}</>}
    {name === 'cooktop' && <><rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="8" cy="9" r="2.5"/><circle cx="16" cy="15" r="2.5"/><circle cx="16" cy="8" r="1.5"/><circle cx="8" cy="16" r="1.5"/></>}
    {name === 'upload' && <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>}
    {name === 'explore' && <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5z"/></>}
    {name === 'ask' && <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5a9 9 0 1 1 18 0Z"/>}
    {name === 'bolt' && <path d="m13 2-8 12h6l-1 8 9-13h-6z"/>}
  </svg>;
}

export default function Home() {
  return <AuthGate><Dashboard/></AuthGate>;
}

function Dashboard() {
  const { now, ready, error, pending, typeFor, runFor, toggle, restore } = useQuickActions();
  const [view, setView] = useState<'home' | 'manual' | 'history' | 'today' | 'bill'>('home');
  const [saved, setSaved] = useState(false);
  const goHome = () => setView('home');

  if (view !== 'home') {
    const title = { manual: 'Manual Add', history: 'History / Edit', today: 'Today Usage', bill: 'Bill Cycle Usage' }[view];
    return <div className="app-shell secondary-shell">
      <header className="secondary-header"><button type="button" className="back-home" onClick={goHome}>← Home</button><h1>{title}</h1></header>
      <main className="secondary-main">
        {view === 'manual' ? <ManualEvent onCancel={goHome} onSaved={() => { setSaved(true); goHome(); }}/>
          : view === 'history' ? <EventHistory/>
          : <section className="usage-placeholder"><p>No meter data</p><p>Usage details will appear here.</p></section>}
      </main>
    </div>;
  }
  return <div className="app-shell home-shell">
    <header><a className="brand" href="/" aria-label="Home Energy home"><span className="brand-icon"><Icon name="bolt"/></span><h1>Home Energy</h1></a><SignOutControl/></header>
    <main className="home-main">
      <section className="summary" aria-label="Energy summary">
        <button type="button" className="metric" onClick={() => setView('today')} aria-label="Today Usage"><h2>TODAY SO FAR</h2><div className="energy"><span>--</span><span className="unit">kWh</span></div><p>No meter data <span aria-hidden="true">↗</span></p></button>
        <button type="button" className="metric" onClick={() => setView('bill')} aria-label="Bill Cycle Usage"><h2>BILL CYCLE AVG</h2><div className="energy"><span>--</span><span className="unit">kWh/day</span></div><p>View cycle <span aria-hidden="true">↗</span></p></button>
      </section>
      <button className="upload" type="button"><Icon name="upload"/>Upload Meter Data</button>
      <section className="appliances" aria-label="Quick actions"><div className="appliance-grid">
        {appliances.map(name => {
          const type = typeFor(name);
          const run = runFor(type);
          const running = !!run;
          const elapsed = run ? Math.max(0, Math.floor((now - Date.parse(run.started_at)) / 1000)) : 0;
          const remaining = run?.ended_at ? Math.max(0, Math.ceil((Date.parse(run.ended_at) - now) / 1000)) : null;
          const automatic = type?.quick_mode === 'auto_stop';
          return <button key={name} type="button" className={`appliance ${running ? 'running' : ''}`} disabled={!ready || !type || !!pending[name]} aria-busy={!!pending[name]} aria-pressed={running} aria-label={`${name}: ${running ? (automatic ? 'running, tap to stop early' : 'running, tap to stop') : 'start'}`} onClick={() => void toggle(name)}>
            <span className="appliance-symbol"><Icon name={name.toLowerCase() as IconName}/></span>
            <span className="appliance-details">
              <span className="appliance-name">{name}</span>
              {running && <span className="timer-readout"><span>{formatTime(elapsed)} elapsed</span>{remaining !== null && <span>{formatTime(remaining)} remaining</span>}</span>}
              <span className="appliance-status"><span className="status-dot"/>{pending[name] ? 'SAVING…' : running ? (automatic ? 'STOP EARLY' : 'STOP') : !ready ? 'LOADING…' : 'START'}</span>
            </span>
          </button>;
        })}
      </div></section>
      <div className="home-actions">
        <button className="home-action" type="button" onClick={() => { setSaved(false); setView('manual'); }}>+ Manual Add</button>
        <button className="home-action" type="button" onClick={() => setView('history')}>History / Edit</button>
      </div>
      {saved && <p className="manual-success" role="status">Event saved.</p>}
      {error && <p className="auth-error" role="alert">{error} <button type="button" className="sign-out" onClick={() => void restore()}>Retry</button></p>}
      {ready && appliances.some(name => !typeFor(name)) && <p className="auth-error" role="alert">Some appliances are unavailable. Check their quick-action setup.</p>}
    </main>
    <nav aria-label="Main navigation"><a href="/" aria-current="page" onClick={event => { event.preventDefault(); goHome(); }}><Icon name="home"/><span>Home</span></a><button type="button" disabled><Icon name="explore"/><span>Explore</span></button><button type="button" disabled><Icon name="ask"/><span>Ask</span></button></nav>
  </div>;
}
