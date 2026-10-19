export const durations = { Washer: 30 * 60, Dryer: 60 * 60, Cooktop: null } as const;
export type Appliance = keyof typeof durations;
type Run = { startedAt: number } & (
  | { endedAt: null; endReason: null }
  | { endedAt: number; endReason: 'automatic' | 'manual-early' | 'manual' }
);
export type TimerState = Record<Appliance, Run | null>;
export const initialTimers: TimerState = { Washer: null, Dryer: null, Cooktop: null };

export function advanceTimers(state: TimerState, now: number): TimerState {
  let next = state;
  for (const name of Object.keys(durations) as Appliance[]) {
    const run = state[name];
    const duration = durations[name];
    if (run && run.endedAt === null && duration !== null) {
      const end = run.startedAt + duration * 1000;
      if (now >= end) {
        next = { ...next, [name]: { ...run, endedAt: end, endReason: 'automatic' } };
      }
    }
  }
  return next;
}

export function toggleTimer(state: TimerState, name: Appliance, now: number): TimerState {
  const current = advanceTimers(state, now);
  const run = current[name];
  return {
    ...current,
    [name]: run && run.endedAt === null
      ? { ...run, endedAt: now, endReason: name === 'Cooktop' ? 'manual' : 'manual-early' }
      : { startedAt: now, endedAt: null, endReason: null },
  };
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')}`;
}
