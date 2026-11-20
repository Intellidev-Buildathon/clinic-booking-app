# Notes for coding agents

Read `README.md` first for the domain and layout.

## Workflow

- Every change needs tests. Bug fixes start with a failing test.
- Run `pnpm typecheck && pnpm test` before every commit; both must pass.
- Keep changes small and focused; one concern per commit.

## Commits

- Conventional commits: `type(scope): description`, imperative, lower case, no trailing period.
  Example: `fix(bookings): reject a slot that is already taken`.
- Scope is the area touched (`clinics`, `bookings`, `notifications`, `server`, `repo`, `readme`), not a filename.
- Bodies are `- ` bullet points, not prose.

## Code conventions

- HTTP stays on `node:http`. Do not add Express, Fastify or any other framework.
- TypeScript is run directly by Node (type stripping): import local files with the `.ts`
  extension and only use erasable syntax (no `enum`, no parameter properties, no `namespace`).
- Money is always an integer number of **paise** (`amountPaise`), never rupees or floats.
- Times are stored in **UTC** (ISO strings) and shown to patients and clinic staff in
  **Asia/Kolkata**. Use the helpers in `src/time.ts`.
- Storage goes through the async `BookingStore` interface; do not reach into the in-memory store.
- Patient data (names, phone numbers) stays in India: any hosted service that stores or
  processes it must run in an Indian region (GCP `asia-south1`). Do not log patient data
  outside the local console sender.
- No new dependencies without a clear reason stated in the commit body. Pin exact versions.
