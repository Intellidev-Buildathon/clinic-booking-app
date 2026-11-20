import { beforeEach, describe, expect, it } from "vitest";
import type { Booking } from "../src/bookings/types.ts";
import {
  formatReminderMessage,
  getDueReminders,
  scheduleReminder,
  sendDueReminders,
} from "../src/notifications/reminders.ts";
import { ConsoleSmsSender } from "../src/notifications/sms.ts";
import { istToUtc } from "../src/time.ts";

function createBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "booking-1",
    clinicId: "carefirst-indiranagar",
    // 23 Nov 2026, 10:00 am IST -> 2026-11-23T04:30:00.000Z
    slotStart: istToUtc("2026-11-23", "10:00").toISOString(),
    slotEnd: istToUtc("2026-11-23", "10:15").toISOString(),
    patientName: "Asha Rao",
    patientPhone: "+919812345678",
    status: "confirmed",
    deposit: { amountPaise: 20_000, status: "paid", razorpayOrderId: "order_123" },
    createdAt: "2026-11-20T10:00:00.000Z",
    doctor: "Dr. Kavita Rao",
    ...overrides,
  };
}

describe("reminders", () => {
  describe("formatReminderMessage", () => {
    it("formats message with clinic name, doctor and IST time", () => {
      const booking = createBooking();
      const message = formatReminderMessage(booking);

      expect(message.to).toBe("+919812345678");
      expect(message.body).toBe(
        "Reminder: Your appointment at CareFirst Clinic, Indiranagar with Dr. Kavita Rao is scheduled for 23 Nov 2026, 10:00 am.",
      );
    });

    it("uses default doctor fallback when booking has no doctor specified", () => {
      const booking = createBooking({ doctor: undefined });
      const message = formatReminderMessage(booking);

      expect(message.body).toContain("with Dr. Neha Sharma");
      expect(message.body).toContain("CareFirst Clinic, Indiranagar");
      expect(message.body).toContain("23 Nov 2026, 10:00 am");
    });

    it("falls back to clinicId if clinic is not in seed data", () => {
      const booking = createBooking({ clinicId: "unknown-clinic" });
      const message = formatReminderMessage(booking);

      expect(message.body).toContain("at unknown-clinic");
    });
  });

  describe("getDueReminders", () => {
    it("returns reminders due in the next run window (24 hours before appointment start)", () => {
      const booking = createBooking(); // slotStart: 2026-11-23T04:30:00.000Z
      // 24 hours prior is 2026-11-22T04:30:00.000Z
      const runWindow = {
        start: new Date("2026-11-22T04:00:00.000Z"),
        end: new Date("2026-11-22T05:00:00.000Z"),
      };

      const due = getDueReminders([booking], runWindow);
      expect(due).toHaveLength(1);
      expect(due[0]?.bookingId).toBe(booking.id);
      expect(due[0]?.to).toBe("+919812345678");
      expect(due[0]?.dueAt).toEqual(new Date("2026-11-22T04:30:00.000Z"));
      expect(due[0]?.body).toContain("Dr. Kavita Rao");
      expect(due[0]?.body).toContain("23 Nov 2026, 10:00 am");
    });

    it("accepts a Date for now with default 15-minute window", () => {
      const booking = createBooking(); // 24h prior: 2026-11-22T04:30:00.000Z
      const now = new Date("2026-11-22T04:20:00.000Z"); // window: 04:20 to 04:35

      const due = getDueReminders([booking], now);
      expect(due).toHaveLength(1);
      expect(due[0]?.bookingId).toBe(booking.id);
    });

    it("excludes reminders when 24h before start falls outside the run window", () => {
      const booking = createBooking(); // 24h prior: 2026-11-22T04:30:00.000Z

      // Window is earlier than due time
      const earlyWindow = {
        start: new Date("2026-11-22T03:00:00.000Z"),
        end: new Date("2026-11-22T04:00:00.000Z"),
      };
      expect(getDueReminders([booking], earlyWindow)).toHaveLength(0);

      // Window is later than due time
      const lateWindow = {
        start: new Date("2026-11-22T05:00:00.000Z"),
        end: new Date("2026-11-22T06:00:00.000Z"),
      };
      expect(getDueReminders([booking], lateWindow)).toHaveLength(0);
    });

    it("respects half-open interval boundaries [start, end)", () => {
      const booking = createBooking(); // 24h prior: 2026-11-22T04:30:00.000Z

      // Start is inclusive
      const inclusiveStart = {
        start: new Date("2026-11-22T04:30:00.000Z"),
        end: new Date("2026-11-22T04:45:00.000Z"),
      };
      expect(getDueReminders([booking], inclusiveStart)).toHaveLength(1);

      // End is exclusive
      const exclusiveEnd = {
        start: new Date("2026-11-22T04:15:00.000Z"),
        end: new Date("2026-11-22T04:30:00.000Z"),
      };
      expect(getDueReminders([booking], exclusiveEnd)).toHaveLength(0);
    });

    it("enforces once per booking: deduplicates duplicate booking objects in the same run", () => {
      const booking = createBooking();
      const duplicateBooking = { ...booking };
      const runWindow = {
        start: new Date("2026-11-22T04:00:00.000Z"),
        end: new Date("2026-11-22T05:00:00.000Z"),
      };

      const due = getDueReminders([booking, duplicateBooking], runWindow);
      expect(due).toHaveLength(1);
    });

    it("enforces once per booking: skips bookings that already received reminders", () => {
      const bookingWithSent = createBooking({
        reminderSentAt: "2026-11-22T04:30:00.000Z",
      });
      const runWindow = {
        start: new Date("2026-11-22T04:00:00.000Z"),
        end: new Date("2026-11-22T05:00:00.000Z"),
      };

      expect(getDueReminders([bookingWithSent], runWindow)).toHaveLength(0);

      // Also checks sentBookingIds option
      const booking = createBooking({ id: "booking-99" });
      const sentIds = new Set(["booking-99"]);
      expect(getDueReminders([booking], runWindow, { sentBookingIds: sentIds })).toHaveLength(0);
    });

    it("excludes cancelled, completed, and no-show bookings", () => {
      const runWindow = {
        start: new Date("2026-11-22T04:00:00.000Z"),
        end: new Date("2026-11-22T05:00:00.000Z"),
      };

      const cancelled = createBooking({ id: "b-cancelled", status: "cancelled" });
      const completed = createBooking({ id: "b-completed", status: "completed" });
      const noShow = createBooking({ id: "b-noshow", status: "no_show" });
      const pending = createBooking({ id: "b-pending", status: "pending_payment" });
      const confirmed = createBooking({ id: "b-confirmed", status: "confirmed" });

      const due = getDueReminders([cancelled, completed, noShow, pending, confirmed], runWindow);
      expect(due.map((d) => d.bookingId)).toEqual(["b-pending", "b-confirmed"]);
    });
  });

  describe("sendDueReminders", () => {
    let sender: ConsoleSmsSender;

    beforeEach(() => {
      sender = new ConsoleSmsSender();
    });

    it("sends SMS reminders via SmsSender stub and marks reminderSentAt", async () => {
      const booking = createBooking();
      const runWindow = {
        start: new Date("2026-11-22T04:00:00.000Z"),
        end: new Date("2026-11-22T05:00:00.000Z"),
      };

      const sent = await sendDueReminders([booking], runWindow, sender);
      expect(sent).toHaveLength(1);
      expect(sender.sent).toHaveLength(1);
      expect(sender.sent[0]?.to).toBe("+919812345678");
      expect(sender.sent[0]?.body).toContain("CareFirst Clinic, Indiranagar");
      expect(sender.sent[0]?.body).toContain("Dr. Kavita Rao");
      expect(sender.sent[0]?.body).toContain("23 Nov 2026, 10:00 am");
      expect(booking.reminderSentAt).toBeDefined();

      // Subsequent call does not send again
      const sentAgain = await sendDueReminders([booking], runWindow, sender);
      expect(sentAgain).toHaveLength(0);
      expect(sender.sent).toHaveLength(1);
    });
  });

  describe("scheduleReminder", () => {
    it("dispatches SMS reminder for a single booking when due", async () => {
      const booking = createBooking();
      const sender = new ConsoleSmsSender();

      const reminder = await scheduleReminder(booking, sender);
      expect(reminder).toBeDefined();
      expect(reminder?.bookingId).toBe(booking.id);
      expect(sender.sent).toHaveLength(1);
      expect(booking.reminderSentAt).toBeDefined();
    });
  });
});
