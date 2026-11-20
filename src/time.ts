// All instants are stored in UTC. Clinic-facing wall-clock times are in
// Asia/Kolkata (IST), which is a fixed UTC+05:30 offset with no DST.
export const CLINIC_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 5 * 60 + 30;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}

/** Weekday (0 = Sunday) of a calendar date written as YYYY-MM-DD. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Converts an IST wall-clock date + "HH:MM" to a UTC Date. */
export function istToUtc(date: string, time: string): Date {
  const t = TIME_RE.exec(time);
  if (!isValidDate(date) || !t) throw new Error(`invalid IST time: ${date} ${time}`);
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  const minutes = Number(t[1]) * 60 + Number(t[2]) - IST_OFFSET_MINUTES;
  return new Date(midnightUtc + minutes * 60_000);
}

/** Formats a UTC instant for display in clinic time, e.g. "21 Nov 2026, 10:30 am". */
export function formatIst(at: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: CLINIC_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);
}

/** The IST calendar date (YYYY-MM-DD) that a UTC instant falls on. */
export function istDateOf(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}
