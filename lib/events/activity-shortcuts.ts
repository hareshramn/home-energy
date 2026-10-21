// Entry defaults only: no timer state or database IDs.
export const commonActivities = [
  { label: 'Washer', eventType: 'Washer', duration: '40', icon: 'washer' },
  { label: 'Dryer', eventType: 'Dryer', duration: '60', icon: 'dryer' },
  { label: 'Cooktop', eventType: 'Cooktop', duration: '', icon: 'cooktop' },
  { label: 'Hot water', eventType: 'Tap hot water', duration: '', icon: 'water' },
  { label: 'Microwave', eventType: 'MW', duration: '2', icon: 'microwave' },
  { label: 'Dishwasher', eventType: 'Dishwasher', duration: '60', icon: 'dishwasher' },
] as const;
export type ActivityShortcut = typeof commonActivities[number];
export const normalizeEventName = (name: string) => name.trim().toLowerCase();
export const availableForEntry = (name: string) => normalizeEventName(name) !== 'bath';
export function findEventType<T extends { name: string }>(types: readonly T[], name: string) {
  return types.find(type => normalizeEventName(type.name) === normalizeEventName(name));
}

// Presentation only; never use this label for database lookup or writes.
export const eventDisplayName = (name: string) => normalizeEventName(name) === 'mw' ? 'Microwave' : name;
