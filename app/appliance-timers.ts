export const appliances = ['Washer', 'Dryer', 'Cooktop'] as const;
export type Appliance = typeof appliances[number];
export type EventType = {
  id: number | string;
  household_id: string;
  name: string;
  is_quick_action: boolean;
  quick_mode: 'auto_stop' | 'manual_stop' | null;
  default_duration_minutes: number | null;
};
export type EnergyEvent = {
  id: number | string;
  household_id: string;
  event_type_id: number | string;
  started_at: string;
  ended_at: string | null;
  recorded_via: string;
};
export const staleManualMs = 5 * 60 * 60 * 1000;

export function isStaleManual(event: EnergyEvent, type: EventType, now: number) {
  return type.quick_mode === 'manual_stop' && event.ended_at === null
    && now - Date.parse(event.started_at) >= staleManualMs;
}

export function isRunning(event: EnergyEvent, type: EventType, now: number) {
  if (type.quick_mode === 'manual_stop') return event.ended_at === null && !isStaleManual(event, type, now);
  return type.quick_mode === 'auto_stop' && event.ended_at !== null && now < Date.parse(event.ended_at);
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}
