'use client';

import { useTodayMeter } from './use-today-meter';

const time = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
});
const latestTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function TodayMeterCard({ onClick }: { onClick: () => void }) {
  const state = useTodayMeter();
  const data = state.status === 'ready' ? state.data : null;
  const hasData = data?.todayKwh !== null && data?.todayKwh !== undefined;
  const incomplete = hasData && data?.coverage.status !== 'complete';
  return <button type="button" className="metric today-metric" onClick={onClick} aria-label="Today Usage" aria-busy={state.status === 'loading'}>
    <h2>TODAY SO FAR</h2>
    <div className="energy"><span>{hasData ? number.format(data!.todayKwh!) : '--'}</span><span className="unit">kWh</span></div>
    <p className="today-detail">
      {state.status === 'loading' ? <span>Loading meter data…</span>
        : state.status === 'error' ? <span>Meter data unavailable</span>
        : !hasData ? <><span>{data?.readingsReceived ? 'No completed readings yet' : 'No meter data today'}</span><span className="today-meta">{data?.latest ? `Latest: ${latestTime.format(new Date(data.latest))}` : 'Latest: No readings yet'}</span></>
        : <>{incomplete && <span className="today-warning"><span aria-hidden="true">⚠ </span>Data incomplete</span>}<span>{incomplete ? 'through' : 'Through'} {time.format(new Date(data!.through!))}<span className="today-arrow" aria-hidden="true">↗</span></span></>}
    </p>
  </button>;
}
