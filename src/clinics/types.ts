/** An opening window in clinic local time (Asia/Kolkata), "HH:MM" 24h. */
export interface OpeningWindow {
  open: string;
  close: string;
}

/** Opening windows per weekday, 0 = Sunday ... 6 = Saturday. Missing = closed. */
export type OpeningHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, OpeningWindow[]>>;

export interface Clinic {
  id: string;
  name: string;
  city: string;
  timeZone: "Asia/Kolkata";
  slotMinutes: number;
  /** Booking deposit in paise (100 paise = 1 rupee). */
  depositPaise: number;
  openingHours: OpeningHours;
  /** Closed dates in clinic local time (YYYY-MM-DD). */
  closedDates?: string[];
  /** Holiday calendar (alias for closedDates). */
  holidayCalendar?: string[];
}

export interface Slot {
  clinicId: string;
  /** UTC ISO timestamps. */
  start: string;
  end: string;
}
