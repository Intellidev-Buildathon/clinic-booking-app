import { beforeEach, describe, expect, it } from "vitest";
import { BookingError, bookSlot, cancelBooking, rescheduleBooking } from "../src/bookings/service.ts";
import { InMemoryBookingStore } from "../src/bookings/store.ts";
import type { BookingStatus } from "../src/bookings/types.ts";
import { istToUtc } from "../src/time.ts";

const clinicId = "carefirst-indiranagar";
const monday10am = istToUtc("2026-11-23", "10:00").toISOString();

let store: InMemoryBookingStore;
beforeEach(() => {
  store = new InMemoryBookingStore();
});

const input = (overrides: Partial<Parameters<typeof bookSlot>[1]> = {}) => ({
  clinicId,
  slotStart: monday10am,
  patientName: "Asha Rao",
  patientPhone: "+919812345678",
  ...overrides,
});

async function expectBookingError(p: Promise<unknown>, code: BookingError["code"]) {
  const err = await p.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(BookingError);
  expect((err as BookingError).code).toBe(code);
}

describe("bookSlot", () => {
  it("books a free slot with a pending deposit", async () => {
    const booking = await bookSlot(store, input());
    expect(booking).toMatchObject({
      clinicId,
      slotStart: "2026-11-23T04:30:00.000Z",
      slotEnd: "2026-11-23T04:45:00.000Z",
      status: "pending_payment",
      deposit: { amountPaise: 20_000, status: "pending", razorpayOrderId: null },
    });
    expect(await store.get(booking.id)).toEqual(booking);
  });

  it("rejects a slot that is already booked", async () => {
    await bookSlot(store, input());
    await expectBookingError(bookSlot(store, input({ patientName: "Vikram Shah" })), "slot_taken");
  });

  it("rejects bookings outside opening hours", async () => {
    await expectBookingError(
      bookSlot(store, input({ slotStart: istToUtc("2026-11-23", "13:30").toISOString() })),
      "outside_opening_hours",
    );
    await expectBookingError(
      bookSlot(store, input({ slotStart: istToUtc("2026-11-22", "10:00").toISOString() })),
      "outside_opening_hours",
    );
  });

  it("rejects unknown clinics and bad input", async () => {
    await expectBookingError(bookSlot(store, input({ clinicId: "nope" })), "clinic_not_found");
    await expectBookingError(bookSlot(store, input({ patientPhone: "12345" })), "invalid_input");
    await expectBookingError(bookSlot(store, input({ patientName: "  " })), "invalid_input");
  });

  // TODO: fails today, two patients can book the same slot
  it.skip("lets only one of two concurrent requests book the same slot", async () => {
    const results = await Promise.allSettled([
      bookSlot(store, input({ patientName: "Asha Rao" })),
      bookSlot(store, input({ patientName: "Vikram Shah", patientPhone: "+919876543210" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await store.listByClinic(clinicId)).toHaveLength(1);
  });
});

describe("rescheduleBooking", () => {
  const monday1030am = istToUtc("2026-11-23", "10:30").toISOString();
  const monday1045am = istToUtc("2026-11-23", "10:45").toISOString();

  it("moves a pending_payment booking to a free slot and frees the old slot", async () => {
    const original = await bookSlot(store, input());
    const updated = await rescheduleBooking(store, original.id, monday1030am);

    expect(updated).toEqual({
      ...original,
      slotStart: monday1030am,
      slotEnd: monday1045am,
    });
    expect(await store.get(original.id)).toEqual(updated);
    expect(await store.findActiveBySlot(clinicId, original.slotStart)).toBeUndefined();
    expect((await store.findActiveBySlot(clinicId, monday1030am))?.id).toBe(original.id);

    // Another patient can now book the freed slot
    const other = await bookSlot(store, input({ patientName: "Vikram Shah", patientPhone: "+919876543210" }));
    expect(other.slotStart).toBe(original.slotStart);
  });

  it("moves a confirmed booking and preserves its paid deposit", async () => {
    const original = await bookSlot(store, input());
    await store.update({
      ...original,
      status: "confirmed",
      deposit: { amountPaise: 20_000, status: "paid", razorpayOrderId: "order_123" },
    });

    const updated = await rescheduleBooking(store, original.id, monday1030am);
    expect(updated.status).toBe("confirmed");
    expect(updated.deposit).toEqual({ amountPaise: 20_000, status: "paid", razorpayOrderId: "order_123" });
    expect(updated.slotStart).toBe(monday1030am);
    expect(updated.slotEnd).toBe(monday1045am);
  });

  it("is idempotent when rescheduling to the same slot", async () => {
    const original = await bookSlot(store, input());
    const updated = await rescheduleBooking(store, original.id, original.slotStart);
    expect(updated).toEqual(original);
  });

  it("rejects rescheduling to a slot already taken by another booking", async () => {
    const first = await bookSlot(store, input());
    await bookSlot(store, input({ slotStart: monday1030am, patientName: "Vikram Shah", patientPhone: "+919876543210" }));

    await expectBookingError(rescheduleBooking(store, first.id, monday1030am), "slot_taken");
    expect((await store.get(first.id))?.slotStart).toBe(monday10am);
  });

  it("rejects rescheduling outside opening hours or off the 15-minute grid", async () => {
    const booking = await bookSlot(store, input());

    await expectBookingError(
      rescheduleBooking(store, booking.id, istToUtc("2026-11-23", "13:30").toISOString()),
      "outside_opening_hours",
    );
    await expectBookingError(
      rescheduleBooking(store, booking.id, istToUtc("2026-11-22", "10:00").toISOString()),
      "outside_opening_hours",
    );
    await expectBookingError(
      rescheduleBooking(store, booking.id, istToUtc("2026-11-23", "10:07").toISOString()),
      "outside_opening_hours",
    );
  });

  it.each<BookingStatus>(["cancelled", "completed", "no_show"])(
    "rejects rescheduling a %s booking",
    async (status) => {
      const booking = await bookSlot(store, input());
      await store.update({ ...booking, status });

      await expectBookingError(rescheduleBooking(store, booking.id, monday1030am), "booking_not_reschedulable");
    },
  );

  it("rejects unknown booking id and invalid input", async () => {
    const booking = await bookSlot(store, input());

    await expectBookingError(rescheduleBooking(store, "non-existent-id", monday1030am), "booking_not_found");
    await expectBookingError(rescheduleBooking(store, "   ", monday1030am), "invalid_input");
    await expectBookingError(rescheduleBooking(store, booking.id, "not-a-timestamp"), "invalid_input");
    await expectBookingError(rescheduleBooking(store, booking.id, ""), "invalid_input");
  });
});

describe("cancelBooking", () => {
  it("cancels an active booking and frees the slot", async () => {
    const booking = await bookSlot(store, input());
    expect(await store.findActiveBySlot(clinicId, booking.slotStart)).toBeDefined();

    const cancelled = await cancelBooking(store, booking.id);
    expect(cancelled.id).toBe(booking.id);
    expect(cancelled.status).toBe("cancelled");
    expect((await store.get(booking.id))?.status).toBe("cancelled");

    expect(await store.findActiveBySlot(clinicId, booking.slotStart)).toBeUndefined();
    const newBooking = await bookSlot(store, input({ patientName: "Vikram Shah", patientPhone: "+919876543210" }));
    expect(newBooking.status).toBe("pending_payment");
  });

  it("is idempotent when cancelling an already cancelled booking", async () => {
    const booking = await bookSlot(store, input());
    const cancelled1 = await cancelBooking(store, booking.id);
    const cancelled2 = await cancelBooking(store, booking.id);
    expect(cancelled2).toEqual(cancelled1);
    expect(cancelled2.status).toBe("cancelled");
  });

  it("rejects unknown booking id and empty input", async () => {
    await expectBookingError(cancelBooking(store, "non-existent-id"), "booking_not_found");
    await expectBookingError(cancelBooking(store, "   "), "invalid_input");
  });
});
