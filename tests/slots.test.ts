import { describe, expect, it } from "vitest";
import { findClinic } from "../src/clinics/data.ts";
import { findSlot, generateSlots } from "../src/clinics/slots.ts";
import { istToUtc } from "../src/time.ts";

const clinic = findClinic("carefirst-indiranagar")!;

describe("generateSlots", () => {
  it("creates 15-minute slots inside each opening window", () => {
    // 2026-11-23 is a Monday: 09:00-13:00 and 14:00-18:00 IST = 32 slots
    const slots = generateSlots(clinic, "2026-11-23");
    expect(slots).toHaveLength(32);
    expect(slots[0]).toEqual({
      clinicId: clinic.id,
      start: "2026-11-23T03:30:00.000Z",
      end: "2026-11-23T03:45:00.000Z",
    });
    expect(slots.at(-1)?.end).toBe("2026-11-23T12:30:00.000Z");
  });

  it("skips the lunch break", () => {
    const starts = generateSlots(clinic, "2026-11-23").map((s) => s.start);
    expect(starts).not.toContain(istToUtc("2026-11-23", "13:00").toISOString());
    expect(starts).toContain(istToUtc("2026-11-23", "14:00").toISOString());
  });

  it("returns no slots on a closed day", () => {
    expect(generateSlots(clinic, "2026-11-22")).toEqual([]); // Sunday
  });

  it("returns no slots on a closed date from the holiday calendar", () => {
    // 2026-12-25 is a Friday (normally 32 slots), but configured as a holiday
    expect(generateSlots(clinic, "2026-12-25")).toEqual([]);
    expect(generateSlots({ ...clinic, closedDates: ["2026-11-23"] }, "2026-11-23")).toEqual([]);
    expect(generateSlots({ ...clinic, holidayCalendar: ["2026-11-23"] }, "2026-11-23")).toEqual([]);
  });

  it("rejects malformed dates", () => {
    expect(() => generateSlots(clinic, "2026-02-30")).toThrow(/invalid date/);
  });
});

describe("findSlot", () => {
  it("finds a slot by its UTC start", () => {
    expect(findSlot(clinic, istToUtc("2026-11-23", "10:15"))?.start).toBe("2026-11-23T04:45:00.000Z");
  });

  it("returns undefined outside opening hours", () => {
    expect(findSlot(clinic, istToUtc("2026-11-23", "19:00"))).toBeUndefined();
    expect(findSlot(clinic, istToUtc("2026-11-23", "10:07"))).toBeUndefined();
  });

  it("returns undefined for a slot on a closed holiday date", () => {
    expect(findSlot(clinic, istToUtc("2026-12-25", "10:00"))).toBeUndefined();
    expect(findSlot({ ...clinic, closedDates: ["2026-11-23"] }, istToUtc("2026-11-23", "10:00"))).toBeUndefined();
  });
});
