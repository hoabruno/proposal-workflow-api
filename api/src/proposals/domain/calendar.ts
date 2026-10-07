/** Every "day" in the product is a calendar day in Geneva. */
export const TIME_ZONE = 'Europe/Zurich';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar day in Geneva for an instant, as YYYY-MM-DD. */
export function dayInGeneva(instant: Date): string {
  return formatter.format(instant);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a YYYY-MM-DD string and returns it as a UTC-midnight Date (what Postgres DATE maps to). */
export function parseDay(day: string): Date | null {
  if (!ISO_DAY.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day
    ? null
    : date;
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
