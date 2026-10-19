'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { eventDayBounds, prepareEventOverlays, type EventOverlays, type NamedEnergyEvent } from '../lib/meter/event-overlays';

type State = { status: 'loading' | 'error'; data?: never } | { status: 'ready'; data: EventOverlays };

export function useTodayEvents(date: string | undefined) {
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    let request = 0;
    async function load() {
      const current = ++request;
      try {
        const bounds = eventDayBounds(date!);
        const [events, types] = await Promise.all([
          supabase.schema('public').from('energy_events')
            .select('id, event_type_id, started_at, ended_at').eq('household_id', 1)
            .lt('started_at', bounds.end)
            .or(`ended_at.is.null,ended_at.gt.${bounds.start}`)
            .order('started_at', { ascending: true }),
          supabase.schema('public').from('event_types').select('id, name').eq('household_id', 1),
        ]);
        if (events.error) throw events.error;
        if (types.error) throw types.error;
        const names = new Map(types.data.map(type => [String(type.id), String(type.name)]));
        const named: NamedEnergyEvent[] = events.data.map(event => ({
          id: event.id, started_at: event.started_at, ended_at: event.ended_at,
          name: names.get(String(event.event_type_id)) ?? 'Event',
        }));
        const overlays = prepareEventOverlays(named, date!, new Date());
        if (!cancelled && current === request) setState({ status: 'ready', data: overlays });
      } catch {
        if (!cancelled && current === request) setState({ status: 'error' });
      }
    }
    setState({ status: 'loading' });
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [date]);
  if (date && state.status === 'ready' && state.data.date !== date) return { status: 'loading' } as const;
  return state;
}
export type TodayEventsState = ReturnType<typeof useTodayEvents>;
