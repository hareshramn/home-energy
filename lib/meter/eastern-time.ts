// National Grid exports wall-clock times in Eastern time, regardless of the device zone.
const eastern = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function wallTime(instant: number) {
  const parts = eastern.formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(value => value.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

export type EasternTimestamp = { timestamp: string; error?: never }
  | { timestamp?: never; error: 'invalid' | 'ambiguous' | 'nonexistent' };

export function easternTimestamp(date: string, time: string): EasternTimestamp {
  const american = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const named = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(date.trim());
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const namedMonth = named ? months.findIndex(value => value === named[1].toLowerCase() || value.slice(0, 3) === named[1].toLowerCase()) + 1 : 0;
  if (!american && !iso && (!named || !namedMonth)) return { error: 'invalid' };
  const year = Number(american?.[3] ?? iso?.[1] ?? named?.[3]);
  const month = Number(american?.[1] ?? iso?.[2] ?? namedMonth);
  const day = Number(american?.[2] ?? iso?.[3] ?? named?.[2]);
  const normalizedTime = time.trim().replace(/([ap])\.m\.$/i, '$1M');
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(normalizedTime);
  if (!clock || year < 1900 || year > 9999) return { error: 'invalid' };
  let hour = Number(clock[1]);
  const minute = Number(clock[2]);
  const second = Number(clock[3] ?? 0);
  if (clock[4]) {
    if (hour < 1 || hour > 12) return { error: 'invalid' };
    hour = hour % 12 + (clock[4].toUpperCase() === 'PM' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || minute % 15 !== 0 || second !== 0) return { error: 'invalid' };
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const valid = new Date(wall);
  if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return { error: 'invalid' };

  // Obtain both neighboring offsets instead of assuming a fixed UTC offset.
  const offsets = new Set<number>();
  for (const hours of [-36, 0, 36]) {
    const probe = wall + hours * 3600000;
    offsets.add(wallTime(probe) - probe);
  }
  const candidates = [...offsets].map(offset => wall - offset).filter(instant => wallTime(instant) === wall);
  if (!candidates.length) return { error: 'nonexistent' };
  // A fall-back hour without an offset cannot identify one instant safely.
  if (candidates.length !== 1) return { error: 'ambiguous' };
  return { timestamp: new Date(candidates[0]).toISOString() };
}
