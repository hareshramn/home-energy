'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { summarizeMeterDay, todayMeterBounds, validateMeterDate } from '../lib/meter/today';
import type { CoverageReading } from '../lib/meter/coverage';

type TodayData = ReturnType<typeof summarizeMeterDay> & {
  latest: string | null;
  readingsReceived: number;
  latestStoredReadingAt: string | null;
};
type State = { status: 'loading' | 'error'; data?: never } | { status: 'ready'; data: TodayData };

export function useTodayMeter(selectedDate?: string) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    async function load() {
      const current = ++request;
      const now = new Date();
      const sameRequest = () => !cancelled && current === request;
      setState({ status: 'loading' });
      try {
        const bounds = selectedDate ? validateMeterDate(selectedDate, now) : todayMeterBounds(now);
        const { data, error } = await supabase.schema('public').from('meter_readings')
          .select('timestamp, kwh').eq('household_id', 1)
          .gte('timestamp', bounds.start).lt('timestamp', bounds.end)
          .order('timestamp', { ascending: true });
        if (error) throw error;
        if (!sameRequest()) return;
        const readings = data as CoverageReading[];
        const summary = summarizeMeterDay(readings, bounds.date, now);
        let latest: string | null = readings[readings.length - 1]?.timestamp ?? null;
        if (!readings.length && bounds.date === todayMeterBounds(now).date) {
          const result = await supabase.schema('public').from('meter_readings')
            .select('timestamp').eq('household_id', 1)
            .order('timestamp', { ascending: false }).limit(1);
          if (result.error) throw result.error;
          latest = result.data[0]?.timestamp ?? null;
          if (latest && !Number.isFinite(Date.parse(latest))) throw new Error('Invalid latest meter timestamp.');
        }
        if (sameRequest()) setState({ status: 'ready', data: { ...summary, latest, readingsReceived: readings.length, latestStoredReadingAt: readings[readings.length - 1]?.timestamp ?? null } });
      } catch {
        if (sameRequest()) setState({ status: 'error' });
      }
    }
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [selectedDate]);

  // Never display the previous selection while the next request starts.
  if (selectedDate && state.status === 'ready' && state.data.coverage.date !== selectedDate) return { status: 'loading' } as const;
  return state;
}
