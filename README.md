# Polish Bar — Nail Salon Booking (POC)

A single Next.js app: customers book on their phones, the owner watches the day on a tablet, and
check-in is a QR code. No dedicated hardware. See `DESIGN.md` for the design and `CLAUDE.md` for
working conventions.

## Prerequisites

- Node 22+ and npm
- `firebase-tools` (`npm i -g firebase-tools`)
- A Firebase project on the **Blaze** plan (needed for App Hosting and for the Gemini API call)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) (only for quick-book)

## Run it locally

```bash
npm install
cp .env.example .env.local          # defaults already point at the emulators
```

Then in three terminals:

```bash
npm run emulators   # 1) Auth + Firestore emulators, UI at http://127.0.0.1:4000
npm run seed        # 2) seed services, stylists, shifts (idempotent)
npm run dev         # 3) app at http://localhost:3000
```

Sign in with **any** phone number — the Auth emulator prints the OTP in its terminal and in the
Emulator UI, so no real SMS is sent.

| Route | What it is |
|---|---|
| `/` | Customer app — Book and Quick book tabs |
| `/checkin` | Where the QR code points; checks the customer in |
| `/owner` | Today's schedule, live via `onSnapshot`, plus the QR code to print |

For quick-book, add a real key to `.env.local`:

```
GEMINI_API_KEY=AIza...
```

Without it, quick-book returns a clean "not configured yet" message rather than failing hard.

## Verify the booking invariants

The one genuinely tricky part of this system is that Firestore has no range constraint, so
overlapping bookings must be prevented by hand. There's a dev-only endpoint that proves it:

```bash
curl -s localhost:3000/api/dev/smoke | jq
```

It checks that two simultaneous bookings of the same slot produce exactly one winner, that a booking
overlapping an existing one is rejected, that a booked slot leaves availability, and that the cleanup
buffer is respected. It returns 404 in production builds. Run it after touching
`lib/server/booking.ts` or `lib/server/availability.ts`.

## Deploy

```bash
# 1) Rules and indexes
firebase deploy --only firestore:rules,firestore:indexes

# 2) The Gemini API key, as a Secret Manager secret
firebase apphosting:secrets:set GEMINI_API_KEY

# 3) Create the App Hosting backend and connect it to your Git repo (once)
firebase apphosting:backends:create --project <your-project-id>

# 4) Grant the backend access to the secret
firebase apphosting:secrets:grantaccess GEMINI_API_KEY --backend <backend-id>
```

After that, pushing to the connected branch builds and deploys. Fill in the
`NEXT_PUBLIC_FIREBASE_*` values in `apphosting.yaml` (or link the backend to a Firebase Web App and
let App Hosting inject `FIREBASE_WEBAPP_CONFIG`).

**Before real customers:** `/owner` is not access-controlled yet, and any signed-in user can read
every appointment. See the end of `DESIGN.md` §13.
