import { describe, expect, it } from "vitest";
import type { Booking } from "../src/bookings/types.ts";
import {
  buildCancellationUrl,
  buildReminderMessage,
  reminderTimeFor,
  scheduleReminder,
  sendReminder,
} from "../src/notifications/reminders.ts";
import { ConsoleSmsSender } from "../src/notifications/sms.ts";

const sampleBooking: Booking = {
  id: "test-booking-uuid-1234",
  clinicId: "carefirst-indiranagar",
  slotStart: "2026-11-23T04:30:00.000Z", // 10:00 am IST
  slotEnd: "2026-11-23T04:45:00.000Z",
  patientName: "Asha Rao",
  patientPhone: "+919812345678",
  status: "pending_payment",
  deposit: { amountPaise: 20_000, status: "pending", razorpayOrderId: null },
  createdAt: "2026-11-20T10:00:00.000Z",
};

describe("buildCancellationUrl", () => {
  it("builds a cancellation URL with explicit base url", () => {
    const url = buildCancellationUrl("test-id", "https://carefirst.example.com/");
    expect(url).toBe("https://carefirst.example.com/bookings/test-id/cancel");
  });

  it("defaults to localhost and PORT when no baseUrl is provided", () => {
    const url = buildCancellationUrl("test-id");
    expect(url).toBe("http://localhost:3000/bookings/test-id/cancel");
  });
});

describe("buildReminderMessage", () => {
  it("builds an SMS reminder with clinic name, Asia/Kolkata time, and cancellation link", () => {
    const msg = buildReminderMessage(sampleBooking, "http://127.0.0.1:3000");
    expect(msg.to).toBe("+919812345678");
    expect(msg.body).toContain("CareFirst Clinic, Indiranagar");
    expect(msg.body).toContain("23 Nov 2026, 10:00 am");
    expect(msg.body).toContain("http://127.0.0.1:3000/bookings/test-booking-uuid-1234/cancel");
  });
});

describe("reminderTimeFor", () => {
  it("computes the timestamp 24 hours prior to slot start", () => {
    const slotStart = "2026-11-23T04:30:00.000Z";
    const reminderTime = reminderTimeFor(slotStart);
    expect(reminderTime.toISOString()).toBe("2026-11-22T04:30:00.000Z");
  });
});

describe("sendReminder and scheduleReminder", () => {
  it("sends reminder via SmsSender", async () => {
    const sender = new ConsoleSmsSender();
    const msg = await sendReminder(sampleBooking, sender, "http://localhost:3000");
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toEqual(msg);
  });

  it("schedules reminder and sends to the given sender", async () => {
    const sender = new ConsoleSmsSender();
    await scheduleReminder(sampleBooking, sender, "http://localhost:3000");
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe(sampleBooking.patientPhone);
    expect(sender.sent[0]?.body).toContain("cancel");
  });
});
