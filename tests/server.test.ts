import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("cancels a booking via GET link from reminder SMS and frees the slot", async () => {
    // 1. Create a booking
    const bookRes = await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: "2026-11-23T05:00:00.000Z",
        patientName: "Asha Rao",
        patientPhone: "+919812345678",
      }),
    });
    expect(bookRes.status).toBe(201);
    const booking = (await bookRes.json()) as { id: string; status: string; clinicId: string; slotStart: string };

    // 2. Verify slot is marked unavailable
    const slotsRes1 = await fetch(`${base}/clinics/carefirst-indiranagar/slots?date=2026-11-23`);
    const slotsBody1 = (await slotsRes1.json()) as { slots: { start: string; available: boolean }[] };
    expect(slotsBody1.slots.find((s) => s.start === "2026-11-23T05:00:00.000Z")?.available).toBe(false);

    // 3. Trying to book again fails with 409
    const conflictRes = await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: "2026-11-23T05:00:00.000Z",
        patientName: "Vikram Shah",
        patientPhone: "+919876543210",
      }),
    });
    expect(conflictRes.status).toBe(409);

    // 4. Build reminder SMS and extract the cancellation link
    const sms = buildReminderMessage(booking as any, base);
    const match = /(http:\/\/[^\s]+)/.exec(sms.body);
    expect(match).not.toBeNull();
    const cancelUrl = match![1]!;

    // 5. Patient taps the link (GET request from mobile browser)
    const cancelRes = await fetch(cancelUrl);
    expect(cancelRes.status).toBe(200);
    const cancelledBooking = (await cancelRes.json()) as { id: string; status: string };
    expect(cancelledBooking.id).toBe(booking.id);
    expect(cancelledBooking.status).toBe("cancelled");

    // 6. Verify slot is now freed and available again
    const slotsRes2 = await fetch(`${base}/clinics/carefirst-indiranagar/slots?date=2026-11-23`);
    const slotsBody2 = (await slotsRes2.json()) as { slots: { start: string; available: boolean }[] };
    expect(slotsBody2.slots.find((s) => s.start === "2026-11-23T05:00:00.000Z")?.available).toBe(true);

    // 7. Another patient can now book the freed slot
    const rebookRes = await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: "2026-11-23T05:00:00.000Z",
        patientName: "Vikram Shah",
        patientPhone: "+919876543210",
      }),
    });
    expect(rebookRes.status).toBe(201);
  });

  it("cancels a booking via POST and returns 404 for unknown bookings", async () => {
    // Book a slot
    const bookRes = await fetch(`${base}/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: "carefirst-indiranagar",
        slotStart: "2026-11-23T05:15:00.000Z",
        patientName: "Deepa Nair",
        patientPhone: "+919812345678",
      }),
    });
    const booking = (await bookRes.json()) as { id: string };

    // Cancel via POST
    const cancelRes = await fetch(`${base}/bookings/${booking.id}/cancel`, { method: "POST" });
    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as { status: string };
    expect(cancelled.status).toBe("cancelled");

    // Unknown booking returns 404 booking_not_found
    const notFoundRes = await fetch(`${base}/bookings/non-existent-uuid/cancel`);
    expect(notFoundRes.status).toBe(404);
    expect(await notFoundRes.json()).toMatchObject({ error: "booking_not_found" });
  });
});
