import { supabase } from '../supabase/client';
import { analyzeMeterCoverage, type CoverageReading } from './coverage';
import { easternTimestamp } from './eastern-time';
import { todayMeterBounds } from './today';
import { prepareDailyUsage } from './daily-usage';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
function readingDate(timestamp: string) {
  const parts = dateFormatter.formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function billingCycleSummary(readings: readonly CoverageReading[], startDate: string, now = new Date()) {
  const today = todayMeterBounds(now).date;
  // Explicit range includes completely missing days before/after available data.
  const coverage = analyzeMeterCoverage(readings, { now, startDate, endDate: today });
  const pastDays = coverage.filter(day => !day.isCurrentDay);
  const completeDates = new Set(pastDays.filter(day => day.status === 'complete').map(day => day.date));
  const dailyKwh = new Map<string, number>();
  const seen = new Set<number>();
  for (const reading of readings) {
    const timestamp = Date.parse(reading.timestamp);
    const date = readingDate(reading.timestamp);
    if (!completeDates.has(date) || seen.has(timestamp)) continue;
    seen.add(timestamp);
    dailyKwh.set(date, (dailyKwh.get(date) ?? 0) + reading.kwh);
  }
  const totalKwh = [...dailyKwh.values()].reduce((sum, kwh) => sum + kwh, 0);
  if (!Number.isFinite(totalKwh)) throw new Error('Cycle total is unavailable.');
  return {
    startDate,
    coverage,
    dailyUsage: prepareDailyUsage(readings, coverage),
    averageKwh: completeDates.size ? totalKwh / completeDates.size : null,
    completeDays: completeDates.size,
    excludedDays: pastDays.length - completeDates.size,
  };
}
export type BillingCycleSummary = ReturnType<typeof billingCycleSummary>;

export async function loadBillingCycle(now = new Date()): Promise<BillingCycleSummary | null> {
  const today = todayMeterBounds(now);
  const { data: cycles, error } = await supabase.schema('public').from('billing_cycles')
    .select('start_date').eq('household_id', 1).lte('start_date', today.date)
    .order('start_date', { ascending: false }).limit(1);
  if (error) throw new Error('Unable to load the billing cycle. Check your connection and household access.');
  if (!cycles.length) return null;
  const startDate: string = cycles[0].start_date;
  const start = easternTimestamp(startDate, '00:00');
  if (start.error) throw new Error('The billing cycle start date is invalid.');

  const readings: CoverageReading[] = [];
  let total = Infinity;
  // A billing cycle exceeds Supabase's default single-response row limit.
  while (readings.length < total) {
    const { data, error: readError, count } = await supabase.schema('public').from('meter_readings')
      .select('timestamp, kwh', { count: 'exact' }).eq('household_id', 1)
      .gte('timestamp', start.timestamp).lt('timestamp', today.end)
      .order('timestamp', { ascending: true }).range(readings.length, readings.length + 499);
    if (readError || count === null) throw new Error('Unable to load cycle meter data. Check your connection and household access.');
    total = count;
    if (!data.length && readings.length < total) throw new Error('Cycle meter data could not be fully loaded. Please retry.');
    readings.push(...data as CoverageReading[]);
  }
  return billingCycleSummary(readings, startDate, now);
}

export async function saveBillingCycle(startDate: string) {
  const today = todayMeterBounds().date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || easternTimestamp(startDate, '00:00').error || startDate > today) {
    throw new Error('Choose a valid cycle start date no later than today.');
  }
  const { data, error } = await supabase.schema('public').from('billing_cycles')
    .select('start_date').eq('household_id', 1).eq('start_date', startDate).limit(1);
  if (error) throw new Error('Unable to check existing cycle starts. Please try again.');
  if (data.length) throw new Error('That cycle start already exists.');
  const { error: insertError } = await supabase.schema('public').from('billing_cycles')
    .insert({ household_id: 1, start_date: startDate });
  if (insertError?.code === '23505') throw new Error('That cycle start already exists.');
  if (insertError) throw new Error('Unable to save the cycle start. Check your connection and household access.');
}
