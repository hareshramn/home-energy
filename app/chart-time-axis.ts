const easternHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23',
});

/** Presentation only: actual Eastern clock positions on the existing instant domain. */
export function chartTimeTicks(startMs: number, endMs: number) {
  return Array.from({ length: Math.round((endMs - startMs) / 3600000) + 1 }, (_, index) => {
    const timestamp = startMs + index * 3600000;
    const hour = Number(easternHour.format(new Date(timestamp)));
    return { timestamp, major: hour % 3 === 0, label: `${hour % 12 || 12}${hour < 12 ? 'A' : 'P'}` };
  });
}
