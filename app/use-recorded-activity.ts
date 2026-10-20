'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { meterDayBounds } from '../lib/meter/today';
import { prepareRecordedActivity, type ActivityEvent } from '../lib/meter/recorded-activity';

type State = { date: string; status: 'loading' | 'error'; data?: never } | { date: string; status: 'ready'; data: ReturnType<typeof prepareRecordedActivity> };

export function useRecordedActivity(date: string) {
  const [state, setState] = useState<State>({ date, status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    let request = 0;
    async function load() {
      const current = ++request;
      const valid = () => !cancelled && current === request;
      async function pages<T>(query: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>) {
        const rows: T[] = [];
        let total: number | null = null;
        while (valid()) {
          const result = await query(rows.length);
          if (result.error || !result.data || result.count === null || (total !== null && total !== result.count)) throw new Error('Activity unavailable');
          total = result.count;
          if (!result.data.length && rows.length < total) throw new Error('Activity truncated');
          rows.push(...result.data);
          if (rows.length >= total) break;
        }
        return rows;
      }
      try {
        const bounds = meterDayBounds(date);
        const [events, types] = await Promise.all([
          pages<Omit<ActivityEvent, 'name'>>(offset => supabase.schema('public').from('energy_events')
            .select('id, event_type_id, started_at, ended_at', { count: 'exact' }).eq('household_id', 1)
            .lt('started_at', bounds.end).or(`ended_at.is.null,ended_at.gt.${bounds.start}`)
            .order('id', { ascending: true }).range(offset, offset + 499)),
          pages<{ id: string | number; name: string }>(offset => supabase.schema('public').from('event_types')
            .select('id, name', { count: 'exact' }).eq('household_id', 1)
            .order('id', { ascending: true }).range(offset, offset + 499)),
        ]);
        const names = new Map(types.map(type => [String(type.id), type.name]));
        const data = prepareRecordedActivity(events.map(event => ({ ...event, name: names.get(String(event.event_type_id)) ?? 'Unknown event type' })), date, new Date());
        if (valid()) setState({ date, status: 'ready', data });
      } catch {
        if (valid()) setState({ date, status: 'error' });
      }
    }
    setState({ date, status: 'loading' });
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [date]);
  return state.date === date ? state : { date, status: 'loading' } as const;
}
