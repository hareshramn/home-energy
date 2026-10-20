import { supabase } from '../supabase/client';
import { todayMeterBounds } from '../meter/today';
import type { CoverageReading } from '../meter/coverage';
import { deriveDailyObservations } from './daily-observations';

/** Every input is household scoped, explicitly selected and paginated. */
export async function loadDailyObservations(now = new Date()) {
  const cutoff = todayMeterBounds(now).start;
  async function pages<T>(query: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>) {
    const rows: T[] = [];
    let expected: number | null = null;
    while (true) {
      const result = await query(rows.length);
      if (result.error || result.count === null || !result.data || (expected !== null && expected !== result.count)) throw new Error('Unable to load a complete analysis snapshot. Please retry.');
      expected = result.count;
      if (!result.data.length && rows.length < expected) throw new Error('Analysis data was truncated. Please retry.');
      rows.push(...result.data);
      if (rows.length >= expected) return rows;
    }
  }
  const [readings, events, types] = await Promise.all([
    pages<CoverageReading>(offset => supabase.schema('public').from('meter_readings')
      .select('timestamp, kwh', { count: 'exact' }).eq('household_id', 1).lt('timestamp', cutoff)
      .order('timestamp', { ascending: true }).range(offset, offset + 499)),
    pages<{ id: string | number; event_type_id: string | number; started_at: string; ended_at: string | null }>(offset => supabase.schema('public').from('energy_events')
      .select('id, event_type_id, started_at, ended_at', { count: 'exact' }).eq('household_id', 1)
      .lt('started_at', cutoff).not('ended_at', 'is', null).lte('ended_at', now.toISOString())
      .order('id', { ascending: true }).range(offset, offset + 499)),
    pages<{ id: string | number; name: string }>(offset => supabase.schema('public').from('event_types')
      .select('id, name', { count: 'exact' }).eq('household_id', 1)
      .order('id', { ascending: true }).range(offset, offset + 499)),
  ]);
  const names = new Map(types.map(type => [String(type.id), type.name]));
  return deriveDailyObservations(readings, events.map(event => ({ ...event, name: names.get(String(event.event_type_id)) ?? 'Unknown event' })), now);
}
