import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { BookingError, bookSlot } from "./bookings/service.ts";
import { InMemoryBookingStore, type BookingStore } from "./bookings/store.ts";
import type { BookSlotInput } from "./bookings/types.ts";
import { findClinic } from "./clinics/data.ts";
import { generateSlots } from "./clinics/slots.ts";
import { isValidDate } from "./time.ts";

const MAX_BODY_BYTES = 16 * 1024;

const ERROR_STATUS: Record<BookingError["code"], number> = {
  invalid_input: 400,
  clinic_not_found: 404,
  outside_opening_hours: 422,
  slot_taken: 409,
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BookingError("invalid_input", "request body too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BookingError("invalid_input", "request body must be JSON");
  }
}

async function handle(store: BookingStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const slotsMatch = /^\/clinics\/([^/]+)\/slots$/.exec(url.pathname);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (req.method === "GET" && slotsMatch) {
    const clinic = findClinic(decodeURIComponent(slotsMatch[1]!));
    if (!clinic) return sendJson(res, 404, { error: "clinic_not_found" });
    const date = url.searchParams.get("date") ?? "";
    if (!isValidDate(date)) return sendJson(res, 400, { error: "invalid_input", message: "date must be YYYY-MM-DD" });
    const taken = new Set(
      (await store.listByClinic(clinic.id)).filter((b) => b.status !== "cancelled").map((b) => b.slotStart),
    );
    const slots = generateSlots(clinic, date).map((s) => ({ ...s, available: !taken.has(s.start) }));
    return sendJson(res, 200, { clinicId: clinic.id, date, timeZone: clinic.timeZone, slots });
  }

  if (req.method === "POST" && url.pathname === "/bookings") {
    const body = (await readJson(req)) as Partial<BookSlotInput> | null;
    const booking = await bookSlot(store, {
      clinicId: String(body?.clinicId ?? ""),
      slotStart: String(body?.slotStart ?? ""),
      patientName: String(body?.patientName ?? ""),
      patientPhone: String(body?.patientPhone ?? ""),
    });
    return sendJson(res, 201, booking);
  }

  sendJson(res, 404, { error: "not_found" });
}

export function createServer(store: BookingStore = new InMemoryBookingStore()): Server {
  return createHttpServer((req, res) => {
    handle(store, req, res).catch((err: unknown) => {
      if (err instanceof BookingError) return sendJson(res, ERROR_STATUS[err.code], { error: err.code, message: err.message });
      console.error(err);
      sendJson(res, 500, { error: "internal_error" });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, () => console.log(`clinic-booking-app listening on http://localhost:${port}`));
}
