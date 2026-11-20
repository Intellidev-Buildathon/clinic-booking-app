import { afterEach, describe, expect, it } from "vitest";
import type { Booking } from "../src/bookings/types.ts";
import {
  buildCancellationUrl,
  buildReminderMessage,
  buildRescheduleUrl,
  reminderTimeFor,
  scheduleReminder,
  sendReminder,
} from "../src/notifications/reminders.ts";
import { ConsoleSmsSender } from "../src/notifications/sms.ts";
import { formatIst } from "../src/time.ts";

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

const originalBaseUrl = process.env.APP_BASE_URL;
const originalPort = process.env.PORT;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBaseUrl;

  if (originalPort === undefined) delete process.env.PORT;
  else process.env.PORT = originalPort;
});

describe("buildRescheduleUrl and buildCancellationUrl", () => {
  it("uses explicit baseUrl and strips trailing slashes", () => {
    expect(buildRescheduleUrl("abc-123", "https://book.carefirst.in///")).toBe(
      "https://book.carefirst.in/bookings/abc-123/reschedule",
    );
    expect(buildCancellationUrl("abc-123", "https://book.carefirst.in/")).toBe(
      "https://book.carefirst.in/bookings/abc-123/cancel",
    );
  });

  it("uses APP_BASE_URL when baseUrl is omitted", () => {
    process.env.APP_BASE_URL = "https://clinics.carefirst.in/";
    expect(buildRescheduleUrl("abc-123")).toBe("https://clinics.carefirst.in/bookings/abc-123/reschedule");
    expect(buildCancellationUrl("abc-123")).toBe("https://clinics.carefirst.in/bookings/abc-123/cancel");
  });

  it("falls back to localhost with PORT or 3000 by default", () => {
    delete process.env.APP_BASE_URL;
    delete process.env.PORT;
    expect(buildRescheduleUrl("abc-123")).toBe("http://localhost:3000/bookings/abc-123/reschedule");
    expect(buildCancellationUrl("abc-123")).toBe("http://localhost:3000/bookings/abc-123/cancel");

    process.env.PORT = "4100";
    expect(buildRescheduleUrl("abc-123")).toBe("http://localhost:4100/bookings/abc-123/reschedule");
    expect(buildCancellationUrl("abc-123")).toBe("http://localhost:4100/bookings/abc-123/cancel");
  });

  it("percent-encodes special characters in bookingId", () => {
    expect(buildRescheduleUrl("id with/slash", "https://book.carefirst.in")).toBe(
      "https://book.carefirst.in/bookings/id%20with%2Fslash/reschedule",
    );
  });
});

describe("buildReminderMessage", () => {
  it("includes clinic name, IST time, reschedule link, and cancellation link", () => {
    const baseUrl = "https://book.carefirst.in";
    const msg = buildReminderMessage(sampleBooking, baseUrl);

    const expectedTime = formatIst(new Date(sampleBooking.slotStart));
    const expectedRescheduleUrl = buildRescheduleUrl(sampleBooking.id, baseUrl);
    const expectedCancelUrl = buildCancellationUrl(sampleBooking.id, baseUrl);

    expect(msg.to).toBe(sampleBooking.patientPhone);
    expect(msg.body).toBe(
      `Reminder: Your appointment at CareFirst Clinic, Indiranagar is on ${expectedTime}. Reschedule: ${expectedRescheduleUrl} Cancel: ${expectedCancelUrl}`,
    );
  });

  it("falls back to CareFirst for an unknown clinic id", () => {
    const msg = buildReminderMessage({ ...sampleBooking, clinicId: "unknown-clinic" }, "https://book.carefirst.in");
    expect(msg.body).toContain("Reminder: Your appointment at CareFirst is on ");
  });
});

describe("reminderTimeFor", () => {
  it("returns 24 hours before the appointment start", () => {
    expect(reminderTimeFor("2026-11-23T04:30:00.000Z").toISOString()).toBe("2026-11-22T04:30:00.000Z");
  });
});

describe("sendReminder and scheduleReminder", () => {
  it("sends the reminder SMS containing reschedule and cancellation links", async () => {
    const sender = new ConsoleSmsSender();
    const sent = await sendReminder(sampleBooking, sender, "https://book.carefirst.in");

    expect(sender.sent).toEqual([sent]);
    expect(sent.to).toBe(sampleBooking.patientPhone);
    expect(sent.body).toContain("https://book.carefirst.in/bookings/test-booking-uuid-1234/reschedule");
    expect(sent.body).toContain("https://book.carefirst.in/bookings/test-booking-uuid-1234/cancel");
  });

  it("schedules a reminder via the provided sender", async () => {
    const sender = new ConsoleSmsSender();
    await scheduleReminder(sampleBooking, sender, "https://book.carefirst.in");

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe(sampleBooking.patientPhone);
    expect(sender.sent[0]?.body).toContain("/bookings/test-booking-uuid-1234/reschedule");
    expect(sender.sent[0]?.body).toContain("/bookings/test-booking-uuid-1234/cancel");
  });
});
