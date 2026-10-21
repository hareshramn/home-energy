'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase/client';
import { availableForEntry, findEventType, eventDisplayName } from '../lib/events/activity-shortcuts';

type EventType = { id: string | number; household_id: string; name: string };
const eventTypes = () => supabase.schema('public').from('event_types');
const typeColumns = 'id, household_id, name';

const eastern = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function easternFields(date: Date) {
  const parts = eastern.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}
function localDate(date = new Date()) { return easternFields(date).date; }

function eventTimes(date: string, time: string, duration: string, openedAt: Date) {
  const minutes = Number(duration);
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)
    || !Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== `${date}T${time}`
    || !Number.isFinite(minutes) || minutes <= 0) return null;
  const offset = (instant: number) => {
    const fields = easternFields(new Date(instant));
    return Date.parse(`${fields.date}T${fields.time}:00Z`) - Math.floor(instant / 60000) * 60000;
  };
  // Resolve arbitrary Eastern minutes, including DST, independently of device timezone.
  const offsets = new Set([-36, 0, 36].map(hours => offset(wall + hours * 3600000)));
  const candidates = [...offsets].map(value => wall - value).filter(value => {
    const fields = easternFields(new Date(value));
    return fields.date === date && fields.time === time;
  }).sort((a, b) => a - b);
  if (!candidates.length) return null;
  // In a repeated fall hour, retain the opening instant's offset when possible.
  const chosen = candidates.find(value => offset(value) === offset(openedAt.getTime())) ?? candidates[0];
  const start = new Date(chosen);
  const end = new Date(chosen + minutes * 60000);
  return Number.isFinite(end.getTime()) && end.getTime() > chosen ? { start, end } : null;
}

function message(error: unknown) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message) : 'Please check your connection and try again.';
}

export function ManualEvent({ onCancel, onSaved, initialEventType, initialDuration = '' }: { onCancel: () => void; onSaved: () => void; initialEventType?: string; initialDuration?: string }) {
  const openedAt = useRef<Date | null>(null);
  if (openedAt.current === null) openedAt.current = new Date(Date.now());
  const opening = easternFields(openedAt.current);
  const [types, setTypes] = useState<EventType[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [date, setDate] = useState(opening.date);
  const [time, setTime] = useState(opening.time);
  const [duration, setDuration] = useState(initialDuration);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const savingRef = useRef(false);
  const times = eventTimes(date, time, duration, openedAt.current!);
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
        let rows = data as EventType[];
        const households = [...new Set(rows.map(type => type.household_id))];
        if (households.length !== 1) throw new Error('Unable to identify your household from the available event types.');
        // Only ensure this supporting type; never create an observation on opening.
        if (!findEventType(rows, 'Dishwasher')) {
          if (cancelled) return;
          const { data: created, error: createError } = await eventTypes().insert({
            household_id: households[0], name: 'Dishwasher', is_quick_action: false,
            quick_mode: null, default_duration_minutes: null,
          }).select(typeColumns).single();
          if (createError && createError.code !== '23505') throw createError;
          if (createError) {
            // Another client may have created it since the read; reuse that row.
            const reloaded = await eventTypes().select(typeColumns).eq('household_id', households[0]).order('name');
            if (reloaded.error) throw reloaded.error;
            rows = reloaded.data as EventType[];
            if (!findEventType(rows, 'Dishwasher')) throw createError;
          } else rows = [...rows, created as EventType];
        }
        if (!cancelled) {
          setTypes(rows);
          const preselected = initialEventType ? findEventType(rows, initialEventType) : undefined;
          setSelected(preselected && availableForEntry(preselected.name) ? String(preselected.id) : '');
          if (initialEventType && !preselected) setError(`The ${eventDisplayName(initialEventType)} event type is unavailable. Choose an event below.`);
        }
      } catch (error) {
        if (!cancelled) setError(`Unable to load event types. ${message(error)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [attempt, initialEventType]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || loading) return;
    setError('');
    if (!householdId) { setError('Unable to identify your household. Please reload the event types.'); return; }
    const interval = eventTimes(date, time, duration, openedAt.current!);
    if (!interval) { setError('Choose a valid date, start time, and positive duration.'); return; }
    if (interval.start.getTime() > Date.now()) { setError('Choose a start time that is not in the future.'); return; }
    const trimmedName = name.trim();
    if (selected === 'new' && !trimmedName) { setError('Enter an event name.'); return; }
    if (selected === 'new' && !availableForEntry(trimmedName)) { setError('Bath is unavailable for new entries. Choose another event.'); return; }
    savingRef.current = true;
    setSaving(true);
    try {
      let type = types.find(type => String(type.id) === selected);
      if (selected === 'new') {
        // Recheck immediately before creation, including types created since opening.
        const { data, error } = await eventTypes().select(typeColumns).eq('household_id', householdId);
        if (error) throw error;
        const current = data as EventType[];
        type = findEventType(current, trimmedName);
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
      if (!type || !availableForEntry(type.name) || type.household_id !== householdId) throw new Error('Choose an event from your household.');
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
        {types.filter(type => availableForEntry(type.name)).map(type => <option key={type.id} value={String(type.id)}>{eventDisplayName(type.name)}</option>)}
        <option value="new">+ New event type</option>
      </select>
      {selected === 'new' && <><label htmlFor="manual-name">New event name</label><input id="manual-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Iron" required/></>}
      <div className="manual-fields">
        <div><label htmlFor="manual-date">Date</label><input id="manual-date" type="date" value={date} max={localDate()} onChange={event => setDate(event.target.value)} required/></div>
        <div><label htmlFor="manual-time">Start time</label><input id="manual-time" type="time" value={time} onChange={event => setTime(event.target.value)} required/></div>
      </div>
      <label htmlFor="manual-duration">Duration (minutes)</label>
      <input id="manual-duration" type="number" min="0" step="any" inputMode="decimal" value={duration} onChange={event => setDuration(event.target.value)} required/>
      <p className="manual-end">{times ? `Ends ${times.end.toLocaleString(undefined, { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Choose a start time and duration to see the end time.'}</p>
    </fieldset>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!loading && !householdId && <button className="sign-out" type="button" onClick={() => setAttempt(value => value + 1)}>Reload event types</button>}
    <div className="manual-actions"><button className="manual-cancel" type="button" disabled={saving} onClick={onCancel}>Cancel</button><button className="upload manual-save" type="submit" disabled={loading || saving || !householdId}>{saving ? 'SAVING…' : 'ADD EVENT'}</button></div>
  </form>;
}
