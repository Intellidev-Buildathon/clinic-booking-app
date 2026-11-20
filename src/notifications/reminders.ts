import type { Booking } from "../bookings/types.ts";
import { findClinic } from "../clinics/data.ts";
import { formatIst } from "../time.ts";
import { ConsoleSmsSender, type SmsMessage, type SmsSender } from "./sms.ts";

/** Constructs the absolute cancellation URL for a booking. */
export function buildCancellationUrl(bookingId: string, baseUrl?: string): string {
  const base = (baseUrl ?? process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
  return `${base}/bookings/${encodeURIComponent(bookingId)}/cancel`;
}

/** Formats the SMS reminder message with clinic name, IST time, and cancellation link. */
export function buildReminderMessage(booking: Booking, baseUrl?: string): SmsMessage {
  const clinic = findClinic(booking.clinicId);
  const clinicName = clinic ? clinic.name : "CareFirst";
  const timeStr = formatIst(new Date(booking.slotStart));
  const cancelUrl = buildCancellationUrl(booking.id, baseUrl);
  return {
    to: booking.patientPhone,
    body: `Reminder: Your appointment at ${clinicName} is on ${timeStr}. To cancel, tap: ${cancelUrl}`,
  };
}

/** Returns the timestamp 24 hours prior to slot start when the reminder should be sent. */
export function reminderTimeFor(slotStart: string): Date {
  return new Date(new Date(slotStart).getTime() - 24 * 60 * 60 * 1000);
}

/** Sends an appointment reminder SMS. */
export async function sendReminder(
  booking: Booking,
  sender: SmsSender = new ConsoleSmsSender(),
  baseUrl?: string,
): Promise<SmsMessage> {
  const message = buildReminderMessage(booking, baseUrl);
  await sender.send(message);
  return message;
}

/**
 * Appointment reminders.
 *
 * Product requirement (CareFirst Clinics): send the patient an SMS 24 hours
 * before each appointment, showing the appointment time in Asia/Kolkata
 * and a cancellation link that frees the slot when tapped.
 */
export async function scheduleReminder(
  booking: Booking,
  sender: SmsSender = new ConsoleSmsSender(),
  baseUrl?: string,
): Promise<void> {
  await sendReminder(booking, sender, baseUrl);
}
