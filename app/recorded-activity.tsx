'use client';

import { eventDisplayName } from '../lib/events/activity-shortcuts';

import { useState } from 'react';
import { useRecordedActivity } from './use-recorded-activity';

const minutes = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function RecordedActivity({ date }: { date: string }) {
  const state = useRecordedActivity(date);
  const [expansion, setExpansion] = useState({ date, expanded: false });
  const showAll = expansion.date === date && expansion.expanded;
  if (expansion.date !== date) setExpansion({ date, expanded: false });
  const activities = state.status === 'ready' ? state.data.activities : [];
  const longest = Math.max(0, ...activities.map(activity => activity.minutes));
  return <section className="bill-panel recorded-activity" aria-label="Recorded activity" aria-busy={state.status === 'loading'}>
    <h2 title="Bars show recorded duration relative to the longest activity">Recorded activity · minutes</h2>
    {state.status === 'loading' ? <p className="bill-note" role="status">Loading recorded activity…</p>
      : state.status === 'error' ? <p className="auth-error" role="alert">Recorded activity unavailable.</p>
      : !activities.length ? <p className="bill-note">No activities recorded for this day.</p>
      : <ul>{(showAll ? activities : activities.slice(0, 5)).map(activity => <li key={activity.id}>
        <div className="recorded-activity-row"><strong>{eventDisplayName(activity.name)}</strong><span>{activity.unknownUses === activity.uses ? 'Duration unknown' : `${minutes.format(activity.minutes)} min${activity.unknownUses ? ' known' : ''}`} · {activity.uses} {activity.uses === 1 ? 'use' : 'uses'}</span></div>
        {activity.minutes > 0 && <div className="recorded-activity-track" aria-hidden="true"><div style={{ width: `${longest ? activity.minutes / longest * 100 : 0}%` }}/></div>}
        {activity.unknownUses > 0 && <p className="usage-chart-caption">{activity.unknownUses} {activity.unknownUses === 1 ? 'use has' : 'uses have'} no recorded stop; duration incomplete.</p>}
        {activity.activeUses > 0 && <p className="usage-chart-caption">Includes elapsed time for {activity.activeUses} active {activity.activeUses === 1 ? 'use' : 'uses'}.</p>}
      </li>)}</ul>}
    {activities.length > 5 && <button type="button" className="sign-out" aria-expanded={showAll} onClick={() => setExpansion({ date, expanded: !showAll })}>{showAll ? 'Show less' : 'Show all'}</button>}
  </section>;
}
