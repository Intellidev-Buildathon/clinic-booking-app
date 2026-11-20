import { randomUUID } from "node:crypto";
import { findClinic } from "../clinics/data.ts";
import { findSlot } from "../clinics/slots.ts";
import { SlotTakenError, type BookingStore } from "./store.ts";
import type { Booking, BookSlotInput } from "./types.ts";

export type BookingErrorCode = "invalid_input" | "clinic_not_found" | "outside_opening_hours" | "slot_taken";

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

  try {
    await store.insert(booking);
  } catch (err) {
    if (err instanceof SlotTakenError) {
      throw new BookingError("slot_taken", err.message);
    }
    throw err;
  }
  return booking;
}
