/**
 * Today's date (UTC). FIRE_AS_OF pins it for end-to-end tests whose fixtures
 * are dated; it only shifts date math, never access or data.
 */
export function todayISO(now: Date = new Date()): string {
  const pinned = process.env.FIRE_AS_OF;
  if (pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return now.toISOString().slice(0, 10);
}
