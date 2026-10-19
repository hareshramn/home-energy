'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';

type Observation = {
  id: string | number;
  household_id: string;
  event_type_id: string | number;
  started_at: string;
  ended_at: string;
};
type NamedObservation = Observation & { name: string };

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function message(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Please try again.';
}

export function EventHistory() {
  const [date, setDate] = useState(localDate);
  const [events, setEvents] = useState<NamedObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [deleting, setDeleting] = useState<string | number | null>(null);
  const deleteLock = useRef(false);

  function changeDay(offset: number) {
    const day = new Date(`${date}T12:00:00`);
    day.setDate(day.getDate() + offset);
    setDate(localDate(day));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const start = new Date(`${date}T00:00:00`);
        const end = new Date(start);
        // Calendar arithmetic preserves local day boundaries across DST changes.
        end.setDate(end.getDate() + 1);
        const [observations, types] = await Promise.all([
          supabase.schema('public').from('energy_events')
            .select('id, household_id, event_type_id, started_at, ended_at')
            .gte('started_at', start.toISOString()).lt('started_at', end.toISOString())
            .not('ended_at', 'is', null).lte('ended_at', new Date().toISOString())
            .order('started_at', { ascending: false }),
          supabase.schema('public').from('event_types').select('id, household_id, name'),
        ]);
        if (observations.error) throw observations.error;
        if (types.error) throw types.error;
        if (!cancelled) setEvents((observations.data as Observation[]).map(event => ({
          ...event,
          name: types.data.find(type => type.id === event.event_type_id && type.household_id === event.household_id)?.name ?? 'Event',
        })));
      } catch (error) {
        if (!cancelled) { setEvents([]); setError(`Unable to load history. ${message(error)}`); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [date, refresh]);

  async function remove(event: NamedObservation) {
    if (deleteLock.current || !window.confirm(`Delete this ${event.name} event? This cannot be undone.`)) return;
    deleteLock.current = true;
    setDeleting(event.id);
    setError('');
    try {
      const { error } = await supabase.schema('public').from('energy_events').delete()
        .eq('id', event.id).eq('household_id', event.household_id)
        .not('ended_at', 'is', null).lte('ended_at', new Date().toISOString())
        .select('id').single();
      if (error) throw error;
      setRefresh(value => value + 1);
    } catch (error) {
      setError(`Unable to delete event. ${message(error)}`);
    } finally {
      deleteLock.current = false;
      setDeleting(null);
    }
  }

  const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return <section className="history-view" aria-label="Completed events">
    <div className="history-date">
      <button type="button" aria-label="Previous day" onClick={() => changeDay(-1)} disabled={deleting !== null}>←</button>
      <label><span className="sr-only">Selected date</span><input type="date" value={date} max={localDate()} disabled={deleting !== null} onChange={event => { if (event.target.value) setDate(event.target.value); }}/></label>
      <button type="button" aria-label="Next day" onClick={() => changeDay(1)} disabled={date >= localDate() || deleting !== null}>→</button>
    </div>
    <p className="history-caption">Completed events · by start date</p>
    {error && <p className="auth-error" role="alert">{error} <button className="sign-out" type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button></p>}
    <div className="history-list" tabIndex={0} aria-label="Event list" aria-busy={loading}>
      {loading ? <p className="empty-state" role="status">Loading events…</p>
        : !events.length && !error ? <p className="empty-state">No completed events for this day.</p>
        : <ul>{events.map(event => <li key={event.id} className="history-event">
          <div><h2>{event.name}</h2><p>{time(event.started_at)} – {time(event.ended_at)}</p><span>{Math.round((Date.parse(event.ended_at) - Date.parse(event.started_at)) / 60000 * 10) / 10} min</span></div>
          <button className="delete-event" type="button" aria-label={`Delete ${event.name} event at ${time(event.started_at)}`} disabled={deleting !== null} onClick={() => void remove(event)}>{deleting === event.id ? 'Deleting…' : 'Delete'}</button>
        </li>)}</ul>}
    </div>
  </section>;
}
