'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import type { CoverageReading } from '../lib/meter/coverage';
import { prepareTypicalDay, typicalWindow, type BaselineMode, type TypicalDay } from '../lib/meter/daily-trend';

type State = { key: string; status: 'ready'; data: TypicalDay } | { key: string; status: 'loading' | 'error' };

export function useTypicalDay(date: string, mode: BaselineMode) {
  const key = `${date}:${mode}`;
  const [state, setState] = useState<State>({ key, status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState({ key, status: 'loading' });
      try {
        const now = new Date();
        const starts: string[] = [];
        if (mode === 'bill') {
          const { data, error } = await supabase.schema('public').from('billing_cycles')
            .select('start_date').eq('household_id', 1).lte('start_date', date)
            .order('start_date', { ascending: false }).limit(1);
          if (error) throw error;
          starts.push(...data.map(row => row.start_date as string));
        }
        const window = typicalWindow(date, mode, starts, now);
        const rows: CoverageReading[] = [];
        let offset = 0;
        let total: number | null = null;
        while (window.start && !cancelled) {
          const { data, error, count } = await supabase.schema('public').from('meter_readings')
            .select('timestamp, kwh', { count: 'exact' }).eq('household_id', 1)
            .gte('timestamp', window.start).lt('timestamp', window.end)
            .order('timestamp', { ascending: true }).range(offset, offset + 499);
          if (error || count === null || (total !== null && count !== total)) throw new Error('Typical day unavailable');
          total = count;
          if (cancelled) return;
          if (!data.length && offset < count) throw new Error('History could not be fully loaded');
          rows.push(...data as CoverageReading[]);
          offset += data.length;
          if (offset >= count) break;
        }
        if (!cancelled) setState({ key, status: 'ready', data: prepareTypicalDay(rows, date, now, window) });
      } catch {
        if (!cancelled) setState({ key, status: 'error' });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [date, mode, key]);
  return state.key === key ? state : { key, status: 'loading' } as const;
}
