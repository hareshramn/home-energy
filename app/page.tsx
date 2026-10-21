'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EventHistory } from './event-history';
import { AuthGate, SignOutControl } from './auth-gate';
import { commonActivities, type ActivityShortcut } from '../lib/events/activity-shortcuts';
import { ManualEvent } from './manual-event';
import { MeterUpload } from './meter-upload';
import { TodayMeterCard } from './today-meter-card';
import { BillCycleCard, BillCycleView } from './billing-cycle';
import { DailyUsage } from './today-usage';
import { DailyTrend } from './daily-trend';
import { Settings } from './settings';

type IconName = 'home' | 'washer' | 'dryer' | 'cooktop' | 'upload' | 'explore' | 'ask' | 'bolt' | 'water' | 'microwave' | 'dishwasher';
function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'home' && <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>}
    {(name === 'washer' || name === 'dryer') && <><rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M4 7h16M7 4.5h.01M10 4.5h.01"/><circle cx="12" cy="14" r="4.5"/>{name === 'washer' ? <path d="M8 14c2-2 4 2 8 0"/> : <path d="M11 11.5c-2 2 4 3 1 5"/>}</>}
    {name === 'cooktop' && <><rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="8" cy="9" r="2.5"/><circle cx="16" cy="15" r="2.5"/><circle cx="16" cy="8" r="1.5"/><circle cx="8" cy="16" r="1.5"/></>}
    {name === 'water' && <><path d="M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/><path d="M8 15c0 2 1 3 3 3"/></>}
    {name === 'microwave' && <><rect x="2" y="5" width="20" height="14" rx="2"/><rect x="5" y="8" width="11" height="8" rx="1"/><path d="M19 9h.01M19 13h.01M5 21v-2m14 2v-2"/></>}
    {name === 'dishwasher' && <><rect x="3" y="2" width="18" height="20" rx="2"/><path d="M3 7h18M7 4.5h.01M10 4.5h.01M8 11v7m4-7v7m4-7v7M6 18h12"/></>}
    {name === 'upload'  && <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>}
    {name === 'explore' && <><circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5z"/></>}
    {name === 'ask' && <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5a9 9 0 1 1 18 0Z"/>}
    {name === 'bolt' && <path d="m13 2-8 12h6l-1 8 9-13h-6z"/>}
  </svg>;
}

export default function Home() {
  return <AuthGate><Dashboard/></AuthGate>;
}

function Dashboard() {
  const [shortcut, setShortcut] = useState<ActivityShortcut | null>(null);
  const [view, setView] = useState<'home' | 'manual' | 'history' | 'today' | 'trend' | 'bill' | 'meter' | 'settings'>('home');
  const [saved, setSaved] = useState(false);
  const [usageDate, setUsageDate] = useState<string | undefined>();
  const [importBusy, setImportBusy] = useState(false);
  const goHome = () => setView('home');

  if (view !== 'home') {
    const title = { manual: 'Manual Add', history: 'History / Edit', today: 'Daily Usage', trend: 'Daily Trend', bill: 'Bill Cycle', meter: 'Meter Data', settings: 'Settings' }[view];
    return <div className="app-shell secondary-shell">
      <header className="secondary-header"><button type="button" className="back-home" disabled={importBusy} onClick={goHome}>← Home</button><h1>{title}</h1></header>
      <main className="secondary-main">
        {view === 'manual' ? <ManualEvent initialEventType={shortcut?.eventType} initialDuration={shortcut?.duration} onCancel={goHome} onSaved={() => { setSaved(true); goHome(); }}/>
          : view === 'history' ? <EventHistory/>
          : view === 'settings' ? <Settings/>
          : view === 'meter' ? <MeterUpload onBusyChange={setImportBusy}/>
          : view === 'bill' ? <BillCycleView onOpenDay={date => { setUsageDate(date); setView('today'); }}/>
          : view === 'trend' ? <DailyTrend initialDate={usageDate}/>
          : <DailyUsage initialDate={usageDate} onOpenTrend={date => { setUsageDate(date); setView('trend'); }}/>}
      </main>
    </div>;
  }
  return <div className="app-shell home-shell">
    <header><a className="brand" href="/" aria-label="Home Energy home"><span className="brand-icon"><Icon name="bolt"/></span><h1>Home Energy</h1></a><div className="header-controls"><button type="button" className="settings-control" aria-label="Settings" title="Settings" onClick={() => setView('settings')}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3z"/><circle cx="12" cy="12" r="3"/></svg></button><SignOutControl/></div></header>
    <main className="home-main">
      <section className="summary" aria-label="Energy summary">
        <TodayMeterCard onClick={() => { setUsageDate(undefined); setView('today'); }}/>
        <BillCycleCard onClick={() => setView('bill')}/>
      </section>
      <button className="upload" type="button" onClick={() => setView('meter')}><Icon name="upload"/>Upload Meter Data</button>
      <div className="home-explore-actions">
        <button type="button" onClick={() => { setUsageDate(undefined); setView('trend'); }}><strong>Daily Trend</strong><span>Usage vs usual</span></button>
        <Link href="/analysis"><strong>Analysis</strong><span>Find drivers</span></Link>
      </div>
      <section className="appliances" aria-label="Common activities"><div className="appliance-grid">
        {commonActivities.map(activity => <button key={activity.label} type="button" className="appliance activity-shortcut" aria-label={`Add ${activity.label} event`} onClick={() => { setShortcut(activity); setSaved(false); setView('manual'); }}>
          <span className="appliance-symbol"><Icon name={activity.icon}/></span>
          <span className="appliance-name">{activity.label}</span>
        </button>)}
      </div></section>
      <div className="home-actions">
        <button className="home-action" type="button" onClick={() => { setShortcut(null); setSaved(false); setView('manual'); }}>+ Manual Add</button>
        <button className="home-action" type="button" onClick={() => setView('history')}>History / Edit</button>
      </div>
      {saved && <p className="manual-success" role="status">Event saved.</p>}
    </main>
  </div>;
}
