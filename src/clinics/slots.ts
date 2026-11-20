import { istDateOf, istToUtc, isValidDate, weekdayOf } from "../time.ts";
import type { Clinic, OpeningHours, Slot } from "./types.ts";

/**
 * Generates every bookable slot for a clinic on a calendar date (IST).
 * A slot is only produced if it fits entirely inside an opening window.
 */
export function generateSlots(clinic: Clinic, date: string): Slot[] {
  if (!isValidDate(date)) throw new Error(`invalid date: ${date}`);
  const windows = clinic.openingHours[weekdayOf(date) as keyof OpeningHours] ?? [];
  const stepMs = clinic.slotMinutes * 60_000;
  const slots: Slot[] = [];
  for (const w of windows) {
    const close = istToUtc(date, w.close).getTime();
    for (let t = istToUtc(date, w.open).getTime(); t + stepMs <= close; t += stepMs) {
      slots.push({
        clinicId: clinic.id,
        start: new Date(t).toISOString(),
        end: new Date(t + stepMs).toISOString(),
      });
    }
  }
  return slots;
}

/** Returns the slot that starts exactly at `start` (UTC ISO), if the clinic is open then. */
export function findSlot(clinic: Clinic, start: Date): Slot | undefined {
  return generateSlots(clinic, istDateOf(start)).find((s) => Date.parse(s.start) === start.getTime());
}
