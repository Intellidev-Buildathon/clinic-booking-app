import { beforeEach, describe, expect, it } from "vitest";
import { BookingError, bookSlot } from "../src/bookings/service.ts";
import { InMemoryBookingStore, SlotTakenError } from "../src/bookings/store.ts";
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

  it("lets only one of two concurrent requests book the same slot", async () => {
    const results = await Promise.allSettled([
      bookSlot(store, input({ patientName: "Asha Rao" })),
      bookSlot(store, input({ patientName: "Vikram Shah", patientPhone: "+919876543210" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await store.listByClinic(clinicId)).toHaveLength(1);

    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BookingError);
    expect((rejected.reason as BookingError).code).toBe("slot_taken");
  });

  it("enforces slot uniqueness at the store level", async () => {
    const booking = await bookSlot(store, input());
    await expect(
      store.insert({
        ...booking,
        id: "another-uuid",
        patientName: "Vikram Shah",
      }),
    ).rejects.toBeInstanceOf(SlotTakenError);

    // Cancelled bookings do not block new bookings for the same slot
    const cancelledStore = new InMemoryBookingStore();
    await cancelledStore.insert({
      id: "cancelled-booking-id",
      clinicId,
      slotStart: monday10am,
      slotEnd: istToUtc("2026-11-23", "10:15").toISOString(),
      patientName: "Prior Patient",
      patientPhone: "+919812345678",
      status: "cancelled",
      deposit: { amountPaise: 20_000, status: "refunded", razorpayOrderId: null },
      createdAt: new Date().toISOString(),
    });
    const activeBooking = await bookSlot(cancelledStore, input());
    expect(activeBooking.status).toBe("pending_payment");
  });
});
