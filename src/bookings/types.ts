export type DepositStatus = "pending" | "paid" | "refunded";

/** Booking deposit collected through Razorpay (UPI). Money is always integer paise. */
export interface Deposit {
  amountPaise: number;
  status: DepositStatus;
  /** Razorpay order id, set once an order has been created for this deposit. */
  razorpayOrderId: string | null;
}

export type BookingStatus = "pending_payment" | "confirmed" | "cancelled" | "completed" | "no_show";

export interface Booking {
  id: string;
  clinicId: string;
  /** Slot start/end as UTC ISO timestamps. */
  slotStart: string;
  slotEnd: string;
  patientName: string;
  /** E.164 Indian mobile number, e.g. +919812345678. */
  patientPhone: string;
  status: BookingStatus;
  deposit: Deposit;
  createdAt: string;
  /** Doctor assigned to the booking/slot, e.g. "Dr. Neha Sharma". */
  doctor?: string;
  /** ISO timestamp when the 24-hour reminder was dispatched, if sent. */
  reminderSentAt?: string | null;
}

export interface BookSlotInput {
  clinicId: string;
  slotStart: string;
  patientName: string;
  patientPhone: string;
}
