import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

  it("rejects concurrent booking requests for the same slot with 409", async () => {
    const postBooking = (patientName: string, patientPhone: string) =>
      fetch(`${base}/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clinicId: "carefirst-indiranagar",
          slotStart: "2026-11-23T04:45:00.000Z",
          patientName,
          patientPhone,
        }),
      });

    const [res1, res2] = await Promise.all([
      postBooking("Rohan Mehra", "+919811111111"),
      postBooking("Pooja Nair", "+919822222222"),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    expect(await conflictRes.json()).toEqual({
      error: "slot_taken",
      message: "that slot is already booked",
    });
  });
});
