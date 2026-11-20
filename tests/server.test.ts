import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Booking } from "../src/bookings/types.ts";
import { buildReminderMessage } from "../src/notifications/reminders.ts";
import { createServer } from "../src/server.ts";

const server = createServer();
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("http server", () => {
  it("reports health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("books a slot and marks it unavailable", async () => {
    const res = await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: "2026-11-23T04:30:00.000Z",
        patientName: "Asha Rao",
        patientPhone: "+919812345678",
      }),
    });
    expect(res.status).toBe(201);

    const body = (await fetch(`${base}/clinics/carefirst-indiranagar/slots?date=2026-11-23`).then((r) => r.json())) as {
      slots: { start: string; available: boolean }[];
    };
    const slot = body.slots.find((s) => s.start === "2026-11-23T04:30:00.000Z");
    expect(slot?.available).toBe(false);
  });

  it("returns 400 for a bad date and 404 for unknown routes", async () => {
    expect((await fetch(`${base}/clinics/carefirst-indiranagar/slots?date=tomorrow`)).status).toBe(400);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("lets a patient reschedule via the reminder SMS link and frees the old slot", async () => {
    const initialSlot = "2026-11-23T05:00:00.000Z"; // 10:30 IST
    const targetSlot = "2026-11-23T05:30:00.000Z"; // 11:00 IST

    const bookRes = await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: initialSlot,
        patientName: "Meera Menon",
        patientPhone: "+919812345678",
      }),
    });
    expect(bookRes.status).toBe(201);
    const booking = (await bookRes.json()) as Booking;

    const sms = buildReminderMessage(booking, base);
    const rescheduleMatch = /Reschedule:\s+(http:\/\/\S+)/.exec(sms.body);
    expect(rescheduleMatch).not.toBeNull();
    const rescheduleUrl = rescheduleMatch![1]!;

    // GET reschedule link returns booking and slots for the booking's IST date without mutating state
    const getRes = await fetch(rescheduleUrl);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      booking: Booking;
      clinicId: string;
      date: string;
      timeZone: string;
      slots: { start: string; available: boolean }[];
    };
    expect(getBody.booking).toEqual(booking);
    expect(getBody.clinicId).toBe("carefirst-indiranagar");
    expect(getBody.date).toBe("2026-11-23");
    expect(getBody.timeZone).toBe("Asia/Kolkata");
    expect(getBody.slots.find((s) => s.start === initialSlot)?.available).toBe(false);
    expect(getBody.slots.find((s) => s.start === targetSlot)?.available).toBe(true);

    // GET reschedule link with an explicit date returns slots for that date
    const otherDateRes = await fetch(`${rescheduleUrl}?date=2026-11-24`);
    expect(otherDateRes.status).toBe(200);
    const otherDateBody = (await otherDateRes.json()) as {
      booking: Booking;
      date: string;
      slots: { start: string; available: boolean }[];
    };
    expect(otherDateBody.booking).toEqual(booking);
    expect(otherDateBody.date).toBe("2026-11-24");
    expect(otherDateBody.slots.length).toBeGreaterThan(0);

    // POST reschedule link moves the booking to the target slot
    const postRes = await fetch(rescheduleUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotStart: targetSlot }),
    });
    expect(postRes.status).toBe(200);
    const updated = (await postRes.json()) as Booking;
    expect(updated.id).toBe(booking.id);
    expect(updated.slotStart).toBe(targetSlot);
    expect(updated.slotEnd).toBe("2026-11-23T05:45:00.000Z");
    expect(updated.deposit).toEqual(booking.deposit);

    // Old slot is now available; new slot is taken
    const slotsBody = (await fetch(`${base}/clinics/carefirst-indiranagar/slots?date=2026-11-23`).then((r) =>
      r.json(),
    )) as { slots: { start: string; available: boolean }[] };
    expect(slotsBody.slots.find((s) => s.start === initialSlot)?.available).toBe(true);
    expect(slotsBody.slots.find((s) => s.start === targetSlot)?.available).toBe(false);

    // Another patient can now book the freed slot
    const rebookRes = await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: initialSlot,
        patientName: "Vikram Shah",
        patientPhone: "+919876543210",
      }),
    });
    expect(rebookRes.status).toBe(201);
  });

  it("returns appropriate errors for invalid reschedule requests", async () => {
    const slotA = "2026-11-24T04:30:00.000Z"; // 10:00 IST
    const slotB = "2026-11-24T04:45:00.000Z"; // 10:15 IST

    const bookingA = (await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: slotA,
        patientName: "Asha Rao",
        patientPhone: "+919812345678",
      }),
    }).then((r) => r.json())) as Booking;

    await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: slotB,
        patientName: "Vikram Shah",
        patientPhone: "+919876543210",
      }),
    });

    // 409 slot_taken
    const takenRes = await fetch(`${base}/bookings/${bookingA.id}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotStart: slotB }),
    });
    expect(takenRes.status).toBe(409);
    expect(await takenRes.json()).toMatchObject({ error: "slot_taken" });

    // 422 outside_opening_hours (lunch break)
    const closedRes = await fetch(`${base}/bookings/${bookingA.id}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotStart: "2026-11-24T08:00:00.000Z" }),
    });
    expect(closedRes.status).toBe(422);
    expect(await closedRes.json()).toMatchObject({ error: "outside_opening_hours" });

    // 400 invalid_input on bad date, bad JSON, and bad slotStart
    expect((await fetch(`${base}/bookings/${bookingA.id}/reschedule?date=tomorrow`)).status).toBe(400);
    expect((await fetch(`${base}/bookings/${bookingA.id}/reschedule?date=`)).status).toBe(400);
    expect(
      (
        await fetch(`${base}/bookings/${bookingA.id}/reschedule`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "not-json",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/bookings/${bookingA.id}/reschedule`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slotStart: "not-a-date" }),
        })
      ).status,
    ).toBe(400);

    // 404 booking_not_found
    const missingGet = await fetch(`${base}/bookings/non-existent-uuid/reschedule`);
    expect(missingGet.status).toBe(404);
    expect(await missingGet.json()).toMatchObject({ error: "booking_not_found" });

    const missingPost = await fetch(`${base}/bookings/non-existent-uuid/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotStart: "2026-11-24T05:00:00.000Z" }),
    });
    expect(missingPost.status).toBe(404);
    expect(await missingPost.json()).toMatchObject({ error: "booking_not_found" });

    // Cancel bookingA, then rescheduling it returns 409 booking_not_reschedulable
    expect((await fetch(`${base}/bookings/${bookingA.id}/cancel`, { method: "POST" })).status).toBe(200);

    const cancelledGet = await fetch(`${base}/bookings/${bookingA.id}/reschedule`);
    expect(cancelledGet.status).toBe(409);
    expect(await cancelledGet.json()).toMatchObject({ error: "booking_not_reschedulable" });

    const cancelledPost = await fetch(`${base}/bookings/${bookingA.id}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotStart: "2026-11-24T05:00:00.000Z" }),
    });
    expect(cancelledPost.status).toBe(409);
    expect(await cancelledPost.json()).toMatchObject({ error: "booking_not_reschedulable" });
  });

  it("lets a patient cancel via the cancellation link in the reminder SMS", async () => {
    const slotStart = "2026-11-25T04:30:00.000Z";
    const booking = (await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart,
        patientName: "Deepa Nair",
        patientPhone: "+919812345678",
      }),
    }).then((r) => r.json())) as Booking;

    const sms = buildReminderMessage(booking, base);
    const cancelMatch = /Cancel:\s+(http:\/\/\S+)/.exec(sms.body);
    expect(cancelMatch).not.toBeNull();
    const cancelUrl = cancelMatch![1]!;

    const cancelRes = await fetch(cancelUrl);
    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as Booking;
    expect(cancelled.id).toBe(booking.id);
    expect(cancelled.status).toBe("cancelled");

    const slotsBody = (await fetch(`${base}/clinics/carefirst-indiranagar/slots?date=2026-11-25`).then((r) =>
      r.json(),
    )) as { slots: { start: string; available: boolean }[] };
    expect(slotsBody.slots.find((s) => s.start === slotStart)?.available).toBe(true);

    const missingCancel = await fetch(`${base}/bookings/non-existent-uuid/cancel`);
    expect(missingCancel.status).toBe(404);
    expect(await missingCancel.json()).toMatchObject({ error: "booking_not_found" });
  });
});
