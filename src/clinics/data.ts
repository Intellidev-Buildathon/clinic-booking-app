import type { Clinic } from "./types.ts";

const weekday = [
  { open: "09:00", close: "13:00" },
  { open: "14:00", close: "18:00" },
];

export const clinics: Clinic[] = [
  {
    id: "carefirst-indiranagar",
    name: "CareFirst Clinic, Indiranagar",
    city: "Bengaluru",
    timeZone: "Asia/Kolkata",
    slotMinutes: 15,
    depositPaise: 20_000,
    openingHours: { 1: weekday, 2: weekday, 3: weekday, 4: weekday, 5: weekday, 6: [{ open: "09:00", close: "13:00" }] },
    closedDates: ["2026-12-25"],
    holidayCalendar: ["2026-12-25"],
  },
  {
    id: "carefirst-koramangala",
    name: "CareFirst Clinic, Koramangala",
    city: "Bengaluru",
    timeZone: "Asia/Kolkata",
    slotMinutes: 15,
    depositPaise: 15_000,
    openingHours: { 1: weekday, 3: weekday, 5: weekday },
    closedDates: ["2026-12-25"],
    holidayCalendar: ["2026-12-25"],
  },
];

export function findClinic(id: string): Clinic | undefined {
  return clinics.find((c) => c.id === id);
}
