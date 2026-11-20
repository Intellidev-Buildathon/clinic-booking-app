# clinic-booking-app

Appointment booking for **CareFirst Clinics** (India), built by Northbeam Studio.
Patients pick a 15-minute slot at a clinic and pay a small deposit through
Razorpay (UPI) to hold it.

Product owner: Neha Sharma (CareFirst Clinics).

## Stack

- Node.js 22.18+ (developed on Node 24), running TypeScript directly via Node's built-in type stripping
- TypeScript (strict), checked with `tsc --noEmit`, nothing is compiled
- `node:http` only, no web framework
- Vitest for tests
- pnpm

## Layout

```
src/
  time.ts                 IST <-> UTC helpers (Asia/Kolkata, UTC+05:30)
  clinics/
    types.ts              Clinic, OpeningHours, Slot
    data.ts               seeded CareFirst clinics
    slots.ts              slot generation from opening hours
  bookings/
    types.ts              Booking, Deposit, statuses
    store.ts              BookingStore interface + InMemoryBookingStore
    service.ts            bookSlot(): validation and booking creation
  notifications/
    sms.ts                SmsSender interface + ConsoleSmsSender
    reminders.ts          scheduleReminder() (not implemented yet)
  server.ts               HTTP routes and entry point
tests/                    vitest suites
```

## Domain

- **Clinic**: opening windows per weekday in Asia/Kolkata time, a slot length
  (15 minutes) and a deposit amount in paise.
- **Slot**: generated on the fly from opening hours; only slots that fit inside
  an opening window exist. Stored and returned as UTC ISO timestamps.
- **Booking**: patient name and Indian mobile number (`+91...`), status
  `pending_payment | confirmed | cancelled | completed | no_show`, and a
  **deposit** `{ amountPaise, status: pending | paid | refunded, razorpayOrderId | null }`.
- **Store**: `BookingStore` is async. `InMemoryBookingStore` yields to the event
  loop on every call to behave like a real database. Production data will live
  in GCP `asia-south1` (Mumbai); patient data must not leave India.

## Running locally

```sh
pnpm install
pnpm dev          # node --watch src/server.ts, http://localhost:3000
pnpm start        # node src/server.ts
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
```

### Environment variables

| Name           | Default                   | Purpose                                        |
| -------------- | ------------------------- | ---------------------------------------------- |
| `PORT`         | `3000`                    | HTTP port for the server                       |
| `APP_BASE_URL` | `http://localhost:${PORT}` | Base URL for patient links in reminder SMS    |

### API

```sh
curl localhost:3000/health
curl "localhost:3000/clinics/carefirst-indiranagar/slots?date=2026-11-23"
curl -X POST localhost:3000/bookings -H 'content-type: application/json' \
  -d '{"clinicId":"carefirst-indiranagar","slotStart":"2026-11-23T04:30:00.000Z","patientName":"Asha Rao","patientPhone":"+919812345678"}'
curl "localhost:3000/bookings/<booking-id>/reschedule?date=2026-11-23"
curl -X POST localhost:3000/bookings/<booking-id>/reschedule -H 'content-type: application/json' \
  -d '{"slotStart":"2026-11-23T05:00:00.000Z"}'
curl -X POST localhost:3000/bookings/<booking-id>/cancel
```

`GET /bookings/:id/cancel` is also supported for cancellation links tapped from SMS.

Errors are JSON `{ "error": code, "message" }` with status 400 (`invalid_input`),
404 (`clinic_not_found`, `booking_not_found`), 409 (`slot_taken`, `booking_not_reschedulable`)
or 422 (`outside_opening_hours`).

## Known issues

- **Double booking**: two patients who pick the same slot at the same moment can
  both get a booking. Sequential requests are rejected correctly, concurrent ones
  are not. Reproduced by the skipped test in `tests/bookings.test.ts`.

## Roadmap

- SMS reminders 24 hours before each appointment (`src/notifications/reminders.ts`)
- Razorpay order creation and payment webhooks for deposits
- Persistent store in `asia-south1`
