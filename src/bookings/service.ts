import { randomUUID } from "node:crypto";
import { findClinic } from "../clinics/data.ts";
import { findSlot } from "../clinics/slots.ts";
import type { BookingStore } from "./store.ts";
import type { Booking, BookingStatus, BookSlotInput } from "./types.ts";

export type BookingErrorCode =
  | "invalid_input"
  | "clinic_not_found"
  | "outside_opening_hours"
  | "slot_taken"
  | "booking_not_found"
  | "booking_not_reschedulable";

export class BookingError extends Error {
  readonly code: BookingErrorCode;
  constructor(code: BookingErrorCode, message: string) {
    super(message);
    this.name = "BookingError";
    this.code = code;
  }
}

const PHONE_RE = /^\+91[6-9]\d{9}$/;

/**
 * Books a slot for a patient. The booking starts as `pending_payment` with a
 * pending deposit; it is confirmed once the Razorpay payment is captured.
 */
export async function bookSlot(store: BookingStore, input: BookSlotInput): Promise<Booking> {
  const patientName = input.patientName?.trim();
  if (!patientName) throw new BookingError("invalid_input", "patientName is required");
  if (!PHONE_RE.test(input.patientPhone ?? "")) {
    throw new BookingError("invalid_input", "patientPhone must be an Indian mobile number like +919812345678");
  }
  const start = new Date(input.slotStart);
  if (Number.isNaN(start.getTime())) throw new BookingError("invalid_input", "slotStart must be an ISO timestamp");

  const clinic = findClinic(input.clinicId);
  if (!clinic) throw new BookingError("clinic_not_found", `unknown clinic ${input.clinicId}`);

  const slot = findSlot(clinic, start);
  if (!slot) throw new BookingError("outside_opening_hours", "the clinic has no slot at that time");

  const existing = await store.findActiveBySlot(clinic.id, slot.start);
  if (existing) throw new BookingError("slot_taken", "that slot is already booked");

  const booking: Booking = {
    id: randomUUID(),
    clinicId: clinic.id,
    slotStart: slot.start,
    slotEnd: slot.end,
    patientName,
    patientPhone: input.patientPhone,
    status: "pending_payment",
    deposit: { amountPaise: clinic.depositPaise, status: "pending", razorpayOrderId: null },
    createdAt: new Date().toISOString(),
  };
  await store.insert(booking);
  return booking;
}

const RESCHEDULABLE_STATUSES: ReadonlySet<BookingStatus> = new Set(["pending_payment", "confirmed"]);

export function isReschedulable(status: BookingStatus): boolean {
  return RESCHEDULABLE_STATUSES.has(status);
}

/**
 * Moves an active booking to a different open slot at the same clinic,
 * freeing the old slot while preserving the existing deposit.
 */
export async function rescheduleBooking(
  store: BookingStore,
  bookingId: string,
  newSlotStart: string,
): Promise<Booking> {
  const id = bookingId?.trim();
  if (!id) throw new BookingError("invalid_input", "bookingId is required");

  const start = new Date(newSlotStart);
  if (Number.isNaN(start.getTime())) throw new BookingError("invalid_input", "slotStart must be an ISO timestamp");

  const booking = await store.get(id);
  if (!booking) throw new BookingError("booking_not_found", `unknown booking ${id}`);

  if (!isReschedulable(booking.status)) {
    throw new BookingError("booking_not_reschedulable", `booking with status ${booking.status} cannot be rescheduled`);
  }

  const clinic = findClinic(booking.clinicId);
  if (!clinic) throw new BookingError("clinic_not_found", `unknown clinic ${booking.clinicId}`);

  const slot = findSlot(clinic, start);
  if (!slot) throw new BookingError("outside_opening_hours", "the clinic has no slot at that time");

  if (slot.start === booking.slotStart) {
    return booking;
  }

  const existing = await store.findActiveBySlot(clinic.id, slot.start);
  if (existing && existing.id !== booking.id) {
    throw new BookingError("slot_taken", "that slot is already booked");
  }

  booking.slotStart = slot.start;
  booking.slotEnd = slot.end;
  await store.update(booking);
  return booking;
}

/**
 * Cancels an existing booking and releases its slot.
 * Idempotent: cancelling an already cancelled booking returns the booking without error.
 */
export async function cancelBooking(store: BookingStore, bookingId: string): Promise<Booking> {
  const id = bookingId?.trim();
  if (!id) throw new BookingError("invalid_input", "bookingId is required");

  const booking = await store.get(id);
  if (!booking) throw new BookingError("booking_not_found", `unknown booking ${id}`);

  if (booking.status === "cancelled") {
    return booking;
  }

  booking.status = "cancelled";
  await store.update(booking);
  return booking;
}
