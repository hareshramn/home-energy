'use client';

import { useEffect, useState } from 'react';
import { advanceTimers, durations, formatTime, initialTimers, toggleTimer, type Appliance } from './appliance-timers';

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
  const [timers, setTimers] = useState(initialTimers);
  const [now, setNow] = useState(0);
  const hasRunningTimer = Object.values(timers).some(run => run?.endedAt === null);

  useEffect(() => {
    if (!hasRunningTimer) return;
    const update = () => {
      const timestamp = Date.now();
      setNow(timestamp);
      setTimers(current => advanceTimers(current, timestamp));
    };
    update();
    const interval = window.setInterval(update, 1000);
    // Reconcile elapsed time immediately after returning to a backgrounded tab.
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [hasRunningTimer]);

  function toggle(name: Appliance) {
    const timestamp = Date.now();
    setNow(timestamp);
    setTimers(current => toggleTimer(current, name, timestamp));
  }
  return <div className="app-shell">
    <header><a className="brand" href="/" aria-label="Home Energy home"><span className="brand-icon"><Icon name="bolt"/></span><h1>Home Energy</h1></a></header>
    <main>
      <section className="summary" aria-label="Energy summary">
        <div className="metric"><h2>TODAY SO FAR</h2><div className="energy"><span>--</span><span className="unit">kWh</span></div><p>No meter data</p></div>
        <div className="metric"><h2>BILL CYCLE AVG</h2><div className="energy"><span>--</span><span className="unit">kWh/day</span></div></div>
      </section>
      <section className="appliances" aria-labelledby="appliances-title"><h2 id="appliances-title">Appliances</h2><div className="appliance-grid">
        {(Object.keys(durations) as Appliance[]).map(name => {
          const run = timers[name];
          const running = !!run && run.endedAt === null;
          const elapsed = running ? Math.max(0, Math.floor((now - run.startedAt) / 1000)) : 0;
          const duration = durations[name];
          return <button key={name} type="button" className={`appliance ${name === 'Cooktop' ? 'wide' : ''} ${running ? 'running' : ''}`} aria-pressed={running} aria-label={`${name}: ${running ? (name === 'Cooktop' ? 'running, tap to stop' : 'running, tap to stop early') : 'start'}`} onClick={() => toggle(name)}>
            <span className="appliance-symbol"><Icon name={name.toLowerCase() as IconName}/></span>
            <span className="appliance-details">
              <span className="appliance-name">{name}</span>
              {running && <span className="timer-readout"><span>{formatTime(elapsed)} elapsed</span>{duration !== null && <span>{formatTime(duration - elapsed)} remaining</span>}</span>}
              <span className="appliance-status"><span className="status-dot"/>{running ? 'RUNNING' : 'START'}</span>
              {running && <span className="stop-hint">{name === 'Cooktop' ? 'TAP TO STOP' : 'TAP TO STOP EARLY'}</span>}
            </span>
          </button>;
        })}
      </div></section>
      <button className="upload" type="button"><Icon name="upload"/>Upload Meter Data</button>
    </main>
    <nav aria-label="Main navigation"><a href="/" aria-current="page"><Icon name="home"/><span>Home</span></a><button type="button" disabled><Icon name="explore"/><span>Explore</span></button><button type="button" disabled><Icon name="ask"/><span>Ask</span></button></nav>
  </div>;
}
