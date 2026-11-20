import type { Booking } from "../bookings/types.ts";
import { findClinic } from "../clinics/data.ts";
import { formatIst } from "../time.ts";
import { ConsoleSmsSender, type SmsMessage, type SmsSender } from "./sms.ts";

/** Time window in which a scheduler run looks for due reminders. */
export interface RunWindow {
  /** Start instant of the run window (inclusive). */
  start: Date;
  /** End instant of the run window (exclusive). */
  end: Date;
}

/** A reminder ready to be sent to a patient. Extends SmsMessage. */
export interface DueReminder extends SmsMessage {
  bookingId: string;
  booking: Booking;
  /** The instant at which the reminder became due (slotStart - 24 hours). */
  dueAt: Date;
}

export interface ReminderSchedulerOptions {
  /** Default window duration in minutes if a single `now: Date` is passed (default: 15). */
  windowMinutes?: number;
  /** Optional set of booking IDs that have already received reminders. */
  sentBookingIds?: Set<string>;
  /** Default doctor name fallback if booking.doctor is omitted (default: "Dr. Neha Sharma"). */
  doctorFallback?: string;
}

const INACTIVE_STATUSES: ReadonlySet<Booking["status"]> = new Set(["cancelled", "completed", "no_show"]);

/**
 * Formats the patient SMS reminder text in clinic timezone (Asia/Kolkata).
 * Includes clinic name, doctor, and formatted appointment time.
 */
export function formatReminderMessage(booking: Booking, doctorFallback = "Dr. Neha Sharma"): SmsMessage {
  const clinic = findClinic(booking.clinicId);
  const clinicName = clinic ? clinic.name : booking.clinicId;
  const doctor = booking.doctor?.trim() || doctorFallback;
  const time = formatIst(new Date(booking.slotStart));

  return {
    to: booking.patientPhone,
    body: `Reminder: Your appointment at ${clinicName} with ${doctor} is scheduled for ${time}.`,
  };
}

/**
 * Given a collection of bookings, returns the reminders due in the next run window
 * (24 hours before start, once per booking, clinic timezone Asia/Kolkata).
 */
export function getDueReminders(
  bookings: Iterable<Booking>,
  windowOrNow: RunWindow | Date,
  options: ReminderSchedulerOptions = {},
): DueReminder[] {
  const windowMinutes = options.windowMinutes ?? 15;
  const window: RunWindow =
    windowOrNow instanceof Date
      ? { start: windowOrNow, end: new Date(windowOrNow.getTime() + windowMinutes * 60_000) }
      : windowOrNow;

  const windowStartMs = window.start.getTime();
  const windowEndMs = window.end.getTime();
  const sentIds = options.sentBookingIds ?? new Set<string>();
  const doctorFallback = options.doctorFallback ?? "Dr. Neha Sharma";

  const seenInBatch = new Set<string>();
  const dueReminders: DueReminder[] = [];

  for (const booking of bookings) {
    // 1. Exclude inactive or cancelled bookings
    if (INACTIVE_STATUSES.has(booking.status)) {
      continue;
    }

    // 2. Enforce once per booking: skip if already sent or already seen in this batch
    if (booking.reminderSentAt || sentIds.has(booking.id) || seenInBatch.has(booking.id)) {
      continue;
    }

    // 3. Validate slotStart timestamp
    const startMs = Date.parse(booking.slotStart);
    if (Number.isNaN(startMs)) {
      continue;
    }

    // 4. Calculate 24-hour reminder instant
    const dueAtMs = startMs - 24 * 60 * 60 * 1000;

    // 5. Check if dueAt falls in [window.start, window.end)
    if (dueAtMs >= windowStartMs && dueAtMs < windowEndMs) {
      seenInBatch.add(booking.id);
      sentIds.add(booking.id);

      const sms = formatReminderMessage(booking, doctorFallback);
      dueReminders.push({
        ...sms,
        bookingId: booking.id,
        booking,
        dueAt: new Date(dueAtMs),
      });
    }
  }

  return dueReminders;
}

/**
 * Dispatches due reminders in the given run window using an SmsSender (defaults to ConsoleSmsSender).
 */
export async function sendDueReminders(
  bookings: Iterable<Booking>,
  windowOrNow: RunWindow | Date,
  sender: SmsSender = new ConsoleSmsSender(),
  options: ReminderSchedulerOptions = {},
): Promise<DueReminder[]> {
  const due = getDueReminders(bookings, windowOrNow, options);
  for (const reminder of due) {
    await sender.send({ to: reminder.to, body: reminder.body });
    if (!reminder.booking.reminderSentAt) {
      reminder.booking.reminderSentAt = new Date().toISOString();
    }
  }
  return due;
}

/**
 * Appointment reminders entry point for a single booking.
 * Dispatches an SMS reminder if the booking is due.
 */
export async function scheduleReminder(
  booking: Booking,
  sender: SmsSender = new ConsoleSmsSender(),
  options: ReminderSchedulerOptions = {},
): Promise<DueReminder | undefined> {
  const startMs = Date.parse(booking.slotStart);
  if (Number.isNaN(startMs)) return undefined;

  const dueAtMs = startMs - 24 * 60 * 60 * 1000;
  const due = getDueReminders(
    [booking],
    {
      start: new Date(dueAtMs),
      end: new Date(dueAtMs + 1_000),
    },
    options,
  );

  if (due.length > 0 && due[0]) {
    await sender.send({ to: due[0].to, body: due[0].body });
    booking.reminderSentAt = new Date().toISOString();
    return due[0];
  }

  return undefined;
}
