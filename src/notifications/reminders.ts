import type { Booking } from "../bookings/types.ts";

/**
 * Appointment reminders.
 *
 * Product requirement (CareFirst Clinics): send the patient an SMS 24 hours
 * before each appointment, showing the appointment time in Asia/Kolkata.
 *
 * Not built yet: this is the planned entry point for the reminders feature.
 */
export async function scheduleReminder(_booking: Booking): Promise<void> {
  throw new Error("not implemented");
}
