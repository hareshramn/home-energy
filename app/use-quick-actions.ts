'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { isRunning, isStaleManual, staleManualMs, type Appliance, type EnergyEvent, type EventType } from './appliance-timers';

const columns = 'id, household_id, event_type_id, started_at, ended_at, recorded_via';
const eventsTable = () => supabase.schema('public').from('energy_events');

async function loadEvents(types: EventType[]) {
  if (!types.length) return [];
  const { data, error } = await eventsTable().select(columns)
    .in('event_type_id', types.map(type => type.id))
    .in('recorded_via', ['quick_timer', 'quick_manual_stop'])
    .or(`ended_at.is.null,ended_at.gt.${new Date().toISOString()}`)
    .order('started_at', { ascending: false });
  if (error) throw error;
  const now = Date.now();
  const events = data as EnergyEvent[];
  const relevant: EnergyEvent[] = [];
  for (const event of events) {
    const type = types.find(type => type.id === event.event_type_id && type.household_id === event.household_id);
    if (!type) continue;
    if (isStaleManual(event, type, now)) {
      const { error: deleteError, data: deleted } = await eventsTable().delete()
        .eq('id', event.id).eq('household_id', type.household_id).eq('event_type_id', type.id)
        .eq('recorded_via', 'quick_manual_stop').is('ended_at', null)
        .lte('started_at', new Date(now - staleManualMs).toISOString()).select('id');
      if (deleteError) throw deleteError;
      if (!deleted?.length) throw new Error('Unable to remove an expired Cooktop event. Please retry.');
    } else if (isRunning(event, type, now)) relevant.push(event);
  }
  return relevant;
}

function errorMessage(error: unknown) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message) : 'Please check your connection and retry.';
}

export function useQuickActions() {
  const [types, setTypes] = useState<EventType[]>([]);
  const [events, setEvents] = useState<EnergyEvent[]>([]);
  const [now, setNow] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Partial<Record<Appliance, boolean>>>({});
  const locks = useRef(new Set<Appliance>());
  const loading = useRef(false);
  const mounted = useRef(false);

  const restore = useCallback(async () => {
    if (loading.current || locks.current.size) return;
    loading.current = true;
    setReady(false);
    setError('');
    try {
      const { data, error } = await supabase.schema('public').from('event_types')
        .select('id, household_id, name, is_quick_action, quick_mode, default_duration_minutes')
        .eq('is_quick_action', true).order('id');
      if (error) throw error;
      const fetchedTypes = data as EventType[];
      const restored = await loadEvents(fetchedTypes);
      if (mounted.current) {
        setTypes(fetchedTypes);
        setEvents(restored);
        setNow(Date.now());
        setReady(true);
      }
    } catch (error) {
      if (mounted.current) setError(`Unable to load appliance activity. ${errorMessage(error)}`);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void restore();
    const update = () => setNow(Date.now());
    const refresh = () => { if (document.visibilityState === 'visible') void restore(); };
    const interval = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [restore]);

  const hasStaleManual = events.some(event => {
    const type = types.find(type => type.id === event.event_type_id);
    return type && isStaleManual(event, type, now);
  });
  useEffect(() => {
    if (hasStaleManual) void restore();
  }, [hasStaleManual, restore]);

  function typeFor(name: Appliance) {
    const matches = types.filter(type => type.name.toLowerCase() === name.toLowerCase());
    return matches.length === 1 ? matches[0] : undefined;
  }

  function runFor(type?: EventType) {
    return type ? events.find(event => event.event_type_id === type.id && event.household_id === type.household_id && isRunning(event, type, now)) : undefined;
  }

  async function toggle(name: Appliance) {
    const type = typeFor(name);
    if (!ready || !type || locks.current.has(name) || loading.current) return;
    const requestedStop = runFor(type);
    locks.current.add(name);
    setPending(current => ({ ...current, [name]: true }));
    setError('');
    try {
      // Re-read before writing, so a restored or externally started run isn't started twice.
      const current = await loadEvents([type]);
      let next = current;
      const timestamp = Date.now();
      if (requestedStop) {
        const active = current.find(event => event.id === requestedStop.id);
        if (active && isStaleManual(active, type, timestamp)) {
          next = await loadEvents([type]);
        } else if (active && isRunning(active, type, timestamp)) {
          let query = eventsTable().update({ ended_at: new Date(timestamp).toISOString() })
            .eq('id', active.id).eq('household_id', type.household_id).eq('event_type_id', type.id);
          query = active.ended_at === null ? query.is('ended_at', null) : query.eq('ended_at', active.ended_at);
          const { data, error } = await query.select(columns).single();
          if (error) throw error;
          if (!data) throw new Error('The event could not be stopped. Please retry.');
          next = current.filter(event => event.id !== active.id);
        }
      } else if (!current.length) {
        const automatic = type.quick_mode === 'auto_stop';
        if (!automatic && type.quick_mode !== 'manual_stop') throw new Error('This appliance is not configured for quick actions.');
        const minutes = type.default_duration_minutes;
        if (automatic && (minutes === null || !Number.isFinite(minutes) || minutes <= 0)) throw new Error('This appliance has no valid timer duration.');
        const { data, error } = await eventsTable().insert({
          household_id: type.household_id,
          event_type_id: type.id,
          started_at: new Date(timestamp).toISOString(),
          ended_at: automatic ? new Date(timestamp + minutes! * 60000).toISOString() : null,
          recorded_via: automatic ? 'quick_timer' : 'quick_manual_stop',
        }).select(columns).single();
        if (error) throw error;
        next = [data as EnergyEvent];
      }
      if (mounted.current) {
        setEvents(previous => [...previous.filter(event => event.event_type_id !== type.id), ...next]);
        setNow(Date.now());
      }
    } catch (error) {
      if (mounted.current) {
        // Require a fresh read before retrying an operation with an uncertain outcome.
        setReady(false);
        setError(`Unable to save ${name} activity. ${errorMessage(error)}`);
      }
    } finally {
      locks.current.delete(name);
      if (mounted.current) setPending(current => ({ ...current, [name]: false }));
    }
  }

  return { now, ready, error, pending, typeFor, runFor, toggle, restore };
}
