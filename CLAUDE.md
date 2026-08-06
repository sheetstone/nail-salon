# CLAUDE.md

Project context for Claude Code. Read this before making changes. Full rationale lives in `DESIGN.md`.

## What this is

A **proof-of-concept nail salon booking system**. Customers sign in with a phone number (SMS verified), see stylists on duty today/this week, book a slot, use an AI quick-book ("book me a gel manicure Friday afternoon"), and check in by scanning a QR code on their own phone. The owner uses their own tablet. **No dedicated hardware anywhere** — it's all one browser-based PWA.

Single salon. Not multi-tenant. POC quality: prefer a working end-to-end flow over scale hardening.

## Stack

- **Framework:** **Next.js (App Router) + TypeScript** — one fullstack app, UI and server logic together.
- **Hosting:** **Firebase App Hosting** (builds the Next.js app, serves it from Cloud Run + CDN). One deploy target.
- **Auth + SMS:** Firebase Authentication — Phone provider (Firebase sends the OTP; do NOT add Twilio).
- **Database:** Cloud Firestore.
- **Server logic:** **Next.js Server Actions** (`'use server'`) using the Firebase **Admin SDK**. Availability + AI quick-book + all appointment writes live here. There is no `functions/` directory and no Cloud Functions codebase.
- **AI quick-book:** Gemini Developer API via `@google/genai`, model `gemini-2.5-flash`, function calling. Called **only from a Server Action**.

## Repo layout

```
app/
  layout.tsx                  root layout, wraps <AuthProvider>
  page.tsx                    customer app (Book / Quick book tabs)
  checkin/page.tsx            QR landing page
  owner/page.tsx              owner tablet dashboard
  globals.css
  actions/booking.ts          ALL Server Actions ('use server')
  api/dev/smoke/route.ts      dev-only booking-invariant test (404s in production)
components/                   client components
lib/
  config.ts                   salon constants (TZ, slot grid, buffer, model)
  time.ts                     ALL timezone conversion — shared client + server
  types.ts                    Firestore document + payload shapes
  result.ts                   ActionResult / AppError contract
  firebase-client.ts          browser Firebase SDK
  server/
    firebase-admin.ts         Admin SDK singleton ('server-only')
    auth.ts                   requireCaller() — verifyIdToken
    availability.ts           availability computation
    booking.ts                the double-booking transaction
    quick-book.ts             Claude tool-use loop
scripts/seed.mjs              seeds services / stylists / shifts
public/                       manifest + icon
apphosting.yaml               App Hosting build/runtime config + secrets
firestore.rules
firestore.indexes.json
firebase.json                 firestore + emulators only (no hosting/functions)
DESIGN.md                     full design doc
CLAUDE.md                     this file
```

## Design & theming

Read **`DESIGN-SYSTEM.md`** before writing any component. The rule in one line:

> **A salon's entire visual identity is six CSS tokens** (`--brand`, `--page`, `--card`, `--ink`, `--line`, `--card-radius`). No component may write a literal colour; every shade is derived from those six with `color-mix()` in `app/globals.css`.

We build direction **2a** ("Day timeline, daylight") from the [Booking system redesign](https://claude.ai/design/p/0e234cf1-5453-41ec-b4af-7245846e97e1) project. It sits on the **Nocturne** design system — Nocturne's 0.70× spacing scale (`--space-1…8`), Inter at weight 500, 8px radii, Phosphor icons, and themed focus rings all carry over unchanged.

Check your work at **`/theme`**, which renders the same components under five salon themes. Anything that stays purple in the other four is hard-coded.

## Core conventions — follow these

- **Phone numbers** are stored E.164 (`+15551234567`). The Firebase Auth `uid` is the real primary key; phone is the verified login credential on `customers/{uid}`.
- **Firestore is denormalized.** No JOINs. Copy `stylistName`, `serviceName`, `durationMin` onto each appointment.
- **Timestamps** stored in UTC. Shifts stored in salon-local wall-clock time. One hard-coded salon timezone constant (`SALON_TZ` in `lib/config.ts`). **All conversion goes through `lib/time.ts`** — do not call luxon with a zone anywhere else.
- **All writes to `appointments` go through a Server Action** (Admin SDK). Clients never write appointments directly — security rules forbid it.
- **Availability is computed server-side** and returned as a compact payload. Never make the client read slot documents one by one (Firestore bills per read).
- **The LLM never writes to the database.** In quick-book, Claude only calls read-only tools (`list_services`, `find_availability`) and proposes a slot via `propose_slot`. The actual booking goes through the same `bookSlotAction` after the customer confirms, and the proposal is re-validated against live availability first.

## Server Action rules (read before adding one)

- **A `'use server'` export is a public HTTP endpoint.** Anyone who can reach the app can call it with any arguments. Validate everything.
- **Verify the caller in every action** that touches user data: the client passes its Firebase ID token, and `requireCaller(idToken)` returns `{ uid, phone }` decoded from the *verified* token.
- **Never trust identity from the request body.** `bookSlotAction` takes no `customerUid` — it uses the one from the token. Same for `phone`.
- **Return failures, don't throw them.** Use `ActionResult` from `lib/result.ts` (`run()` + `AppError`). Next.js redacts thrown error messages in production builds, so a thrown "That slot was just taken" reaches the customer as an opaque server error.
- **Keep the Admin SDK server-side.** `lib/server/*` imports `server-only`; if a Client Component imports one, the build fails instead of leaking credentials. Don't remove those imports.

## Double-booking prevention (do not skip)

Firestore has no range constraint. Enforce uniqueness with a **deterministic appointment doc ID** and a transaction, in `lib/server/booking.ts`:

- Appointment doc ID = `${stylistId}_${startISO}` (e.g. `amy_2026-07-31T14:00:00Z`).
- The transaction `tx.get`s that doc; if it exists, reject with `already-exists`; else `tx.set`.
- **A service spanning multiple slot-grid cells must claim a `slotLocks/{stylistId}_{cellISO}` doc for every cell it covers**, spanning duration + cleanup buffer. This is not optional: two bookings 15 minutes apart have *different* appointment IDs, so only the shared lock docs catch the overlap.
- Read every lock **before** writing anything.
- Availability checks the *same* `[start, start + duration + buffer)` window the transaction locks. If you change one, change the other or they will disagree.
- Security rules back this up: `allow create, update, delete: if false` on `appointments`, and `allow read, write: if false` on `slotLocks`.

Verify any change here with `curl -s localhost:3000/api/dev/smoke | jq` — it exercises the identical-slot race, the overlapping-slot case, and buffer enforcement.

## Environment / secrets

- `GEMINI_API_KEY` — a Secret Manager secret referenced from `apphosting.yaml` with `availability: [RUNTIME]` **only**. NEVER expose to the client, never commit, never give it `BUILD` availability. Get one at https://aistudio.google.com/apikey.
- `NEXT_PUBLIC_FIREBASE_*` — client-side config, safe to ship (they are inlined into the browser bundle at build time, so they must exist at build time).
- Locally: copy `.env.example` → `.env.local`. `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` point the Admin SDK at the emulators; `NEXT_PUBLIC_USE_EMULATORS=true` points the browser SDK at them.
- In production App Hosting supplies Application Default Credentials on Cloud Run, so `initializeApp()` needs no credentials.
- **Blaze plan required** for App Hosting and for the outbound Gemini API call. Free tier still applies once on Blaze.

## Commands

```bash
# install
npm install

# local dev — three terminals
npm run emulators      # Auth + Firestore emulators (UI on :4000)
npm run seed           # seed services / stylists / shifts into the emulator
npm run dev            # Next.js on :3000

# checks
npm run typecheck
npm run build
curl -s localhost:3000/api/dev/smoke | jq    # booking-invariant smoke test

# deploy
firebase deploy --only firestore:rules,firestore:indexes
git push                                      # App Hosting builds from the connected branch
# or: firebase apphosting:backends:create / firebase deploy for the first setup
```

## Gotchas

- **Phone Auth on web needs a reCAPTCHA verifier** (use the invisible one). **Test OTP on a real device** — the Auth emulator skips reCAPTCHA entirely, so a broken verifier only shows up in production.
- **Composite indexes:** multi-field queries fail until an index exists. Firestore's error contains a link to create it — add it to `firestore.indexes.json`. Currently needed: `(stylistId, start)` and `(customerUid, start)` on `appointments`.
- **Per-read billing:** keep availability reads compact (computed summaries, not raw slots).
- **Timezone bugs:** store UTC, compute/display in salon-local. Don't mix. `salonToday()` is the salon's date, not the viewer's.
- **The owner dashboard is unguarded.** `firestore.rules` currently allows any signed-in user to read every appointment (including other customers' phone numbers), matching `DESIGN.md` §7. Gate `/owner` on a custom claim before real use.
- **`app/api/dev/smoke` bypasses auth on purpose** and returns 404 when `NODE_ENV === 'production'`. Don't remove that guard.

## Definition of done (POC)

Phone sign-in → see on-duty stylists this week → book a slot (no double-booking possible) → quick-book via natural language with a confirm step → QR check-in that updates the owner's dashboard live. See `DESIGN.md` §13 for the build order and what's left.
