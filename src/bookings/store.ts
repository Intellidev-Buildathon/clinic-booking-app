import type { Booking } from "./types.ts";

/**
 * Persistence boundary for bookings. The production store will be a database
 * hosted in asia-south1 (patient data must stay in India); every call is async.
 */
export interface BookingStore {
  findActiveBySlot(clinicId: string, slotStart: string): Promise<Booking | undefined>;
  insert(booking: Booking): Promise<void>;
  get(id: string): Promise<Booking | undefined>;
  listByClinic(clinicId: string): Promise<Booking[]>;
}

/** Yields to the event loop to simulate a round trip to the database. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

const INACTIVE: ReadonlySet<Booking["status"]> = new Set(["cancelled"]);

export class InMemoryBookingStore implements BookingStore {
  private readonly bookings = new Map<string, Booking>();

  async findActiveBySlot(clinicId: string, slotStart: string): Promise<Booking | undefined> {
    await tick();
    for (const b of this.bookings.values()) {
      if (b.clinicId === clinicId && b.slotStart === slotStart && !INACTIVE.has(b.status)) {
        return structuredClone(b);
      }
    }
    return undefined;
  }

  async insert(booking: Booking): Promise<void> {
    await tick();
    if (this.bookings.has(booking.id)) throw new Error(`duplicate booking id ${booking.id}`);
    this.bookings.set(booking.id, structuredClone(booking));
  }

  async get(id: string): Promise<Booking | undefined> {
    await tick();
    const b = this.bookings.get(id);
    return b && structuredClone(b);
  }

  async listByClinic(clinicId: string): Promise<Booking[]> {
    await tick();
    return [...this.bookings.values()].filter((b) => b.clinicId === clinicId).map((b) => structuredClone(b));
  }
}
