'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase/client';

type EventType = { id: string | number; household_id: string; name: string };
const eventTypes = () => supabase.schema('public').from('event_types');
const typeColumns = 'id, household_id, name';

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function eventTimes(date: string, time: string, duration: string) {
  const minutes = Number(duration);
  const start = new Date(`${date}T${time}:00`);
  // Reject invalid dates and local times skipped when daylight saving time begins.
  if (!date || !/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(start.getTime())
    || localDate(start) !== date || `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}` !== time
    || !Number.isFinite(minutes) || minutes <= 0) return null;
  const end = new Date(start.getTime() + minutes * 60000);
  return Number.isFinite(end.getTime()) ? { start, end } : null;
}

function message(error: unknown) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message) : 'Please check your connection and try again.';
}

export function ManualEvent({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [types, setTypes] = useState<EventType[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState(localDate);
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const savingRef = useRef(false);
  const times = eventTimes(date, time, duration);
  const households = [...new Set(types.map(type => type.household_id))];
  const householdId = households.length === 1 ? households[0] : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        // RLS limits these rows to the authenticated household; include non-quick types.
        const { data, error } = await eventTypes().select(typeColumns).order('name');
        if (error) throw error;
        if (!cancelled) {
          const rows = data as EventType[];
          setTypes(rows);
          setSelected('');
          if (new Set(rows.map(type => type.household_id)).size !== 1) {
            setError('Unable to identify your household from the available event types.');
          }
        }
      } catch (error) {
        if (!cancelled) setError(`Unable to load event types. ${message(error)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [attempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || loading) return;
    setError('');
    if (!householdId) { setError('Unable to identify your household. Please reload the event types.'); return; }
    const interval = eventTimes(date, time, duration);
    if (!interval) { setError('Choose a valid date, start time, and positive duration.'); return; }
    if (interval.end.getTime() > Date.now()) { setError('Manual events must have already finished. Check the start time and duration.'); return; }
    const trimmedName = name.trim();
    if (selected === 'new' && !trimmedName) { setError('Enter an event name.'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      let type = types.find(type => String(type.id) === selected);
      if (selected === 'new') {
        // Recheck immediately before creation, including types created since opening.
        const { data, error } = await eventTypes().select(typeColumns).eq('household_id', householdId);
        if (error) throw error;
        const current = data as EventType[];
        type = current.find(type => type.name.trim().toLowerCase() === trimmedName.toLowerCase());
        if (!type) {
          const { data: created, error: createError } = await eventTypes().insert({
            household_id: householdId,
            name: trimmedName,
            is_quick_action: false,
            quick_mode: null,
            default_duration_minutes: null,
          }).select(typeColumns).single();
          if (createError) throw createError;
          type = created as EventType;
        }
        // Keep this type selected if the subsequent event insert fails.
        const resolvedType = type;
        setTypes(current.some(existing => existing.id === resolvedType.id) ? current : [...current, resolvedType]);
        setSelected(String(resolvedType.id));
      }
      if (!type || type.household_id !== householdId) throw new Error('Choose an event from your household.');
      const { error } = await supabase.schema('public').from('energy_events').insert({
        household_id: type.household_id,
        event_type_id: type.id,
        started_at: interval.start.toISOString(),
        ended_at: interval.end.toISOString(),
        recorded_via: 'manual_entry',
      });
      if (error) throw error;
      onSaved();
    } catch (error) {
      setError(`Unable to save event. ${message(error)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <form id="manual-event-form" className="manual-form" onSubmit={save}>
    <fieldset disabled={loading || saving}>
      <label htmlFor="manual-type">Event</label>
      <select id="manual-type" value={selected} onChange={event => setSelected(event.target.value)} required>
        <option value="" disabled>{loading ? 'Loading…' : 'Select event...'}</option>
        {types.map(type => <option key={type.id} value={String(type.id)}>{type.name}</option>)}
        <option value="new">+ New event type</option>
      </select>
      {selected === 'new' && <><label htmlFor="manual-name">New event name</label><input id="manual-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Iron" required/></>}
      <div className="manual-fields">
        <div><label htmlFor="manual-date">Date</label><input id="manual-date" type="date" value={date} max={localDate()} onChange={event => setDate(event.target.value)} required/></div>
        <div><label htmlFor="manual-time">Start time</label><input id="manual-time" type="time" value={time} onChange={event => setTime(event.target.value)} required/></div>
      </div>
      <label htmlFor="manual-duration">Duration (minutes)</label>
      <input id="manual-duration" type="number" min="0" step="any" inputMode="decimal" value={duration} onChange={event => setDuration(event.target.value)} required/>
      <p className="manual-end">{times ? `Ends ${times.end.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Choose a start time and duration to see the end time.'}</p>
    </fieldset>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!loading && !householdId && <button className="sign-out" type="button" onClick={() => setAttempt(value => value + 1)}>Reload event types</button>}
    <div className="manual-actions"><button className="manual-cancel" type="button" disabled={saving} onClick={onCancel}>Cancel</button><button className="upload manual-save" type="submit" disabled={loading || saving || !householdId}>{saving ? 'SAVING…' : 'ADD EVENT'}</button></div>
  </form>;
}
