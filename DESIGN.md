# Nail Salon Booking System — Design Document (POC)

## 1. Goal

A booking system for a nail salon where:

- Customers identify themselves by **phone number** (verified via SMS), with no password.
- Customers can see which stylists are **on duty today and this week**, and book a slot themselves.
- A **quick-book** feature lets a customer describe what they want in plain language ("book me a gel manicure with anyone Friday afternoon") and the system proposes and books a slot.
- Customers **check in with a QR code** using their own phone.
- **No dedicated hardware.** The owner uses their own iPad/Samsung tablet; customers use their own phones. Everything runs in a browser.

This is a proof of concept. Favor speed of build and a working end-to-end flow over scale hardening.

## 2. Constraints & non-goals (for the POC)

- No native app store apps — a single Progressive Web App (PWA).
- No physical POS, kiosk, or scanner hardware.
- Single salon (not multi-tenant). If we productize later, we add a `salonId` to every document; do **not** build multi-tenancy now.
- Payments are out of scope for the POC.

## 3. Tech stack

One Next.js app, one Firebase project, one deploy target:

| Concern | Choice |
|---|---|
| Front end | Next.js (App Router) PWA, responsive for phone + tablet |
| Hosting | **Firebase App Hosting** (builds the Next.js app, serves it from Cloud Run + CDN) |
| Auth / SMS | Firebase Authentication — Phone (sends the OTP itself; no Twilio) |
| Database | Cloud Firestore |
| Server logic | **Next.js Server Actions** (`'use server'`) using the Firebase **Admin SDK** |
| Realtime | Firestore `onSnapshot` listeners from the browser (owner check-in dashboard) |
| AI quick-book | Gemini Developer API (`gemini-2.5-flash`) with function calling, called **only from a Server Action** |

**Why Next.js instead of a static PWA + Cloud Functions.** Server Actions give us a trusted
server context in the same codebase and the same deploy as the UI. That removes the callable-Function
plumbing (a second `package.json`, a second deploy target, client SDK wiring for `httpsCallable`)
without giving up any of the guarantees — Server Actions run on the server with the Admin SDK, which
is exactly the trust boundary the old design used Cloud Functions for.

> **Firebase plan note:** App Hosting requires the **Blaze (pay-as-you-go)** plan, and so does the
> outbound call to the Gemini API. Blaze still includes the free tier, so POC cost is near $0, but a
> card must be attached.

### What runs where

| Runs in the browser | Runs on the server (Cloud Run) |
|---|---|
| Phone sign-in + invisible reCAPTCHA | ID-token verification (`verifyIdToken`) |
| Reading `services`, `stylists`, `shifts` | Availability computation |
| `onSnapshot` on `appointments` (owner dashboard) | All `appointments` writes (transactional) |
| Rendering the QR code | The Gemini function-calling loop |
| Writing nothing else | Anything holding a secret |

## 4. Architecture summary

```
Customer phone (browser) ─┐
                          │   ┌──────────────── Next.js on App Hosting ────────────────┐
                          ├──►│  React Client Components   Server Actions ('use server')│
Owner tablet (browser)  ──┘   │            │                        │ Admin SDK         │
                              └────────────┼────────────────────────┼───────────────────┘
                                           │                        │
                    Firebase Auth (Phone/OTP)                       ▼
                                           │                   Firestore
                    client SDK reads ──────┴──────────────────►  (rules-guarded)
                    + onSnapshot → owner dashboard updates live
                                                                    │
                            Gemini API (2.5 Flash, functions) ◄────┘
                              called only from a Server Action
```

The browser talks to Firestore directly for reads it is allowed to see (governed by security rules)
and for the realtime dashboard. Anything that must be trusted — computing availability, writing a
booking safely, calling the LLM — goes through a Server Action.

## 5. Data model (Firestore)

Firestore is document-based, so we denormalize (no JOINs). Copy small, read-often fields (stylist
name, service duration) onto the appointment.

```
customers/{uid}
  phone: "+15551234567"        // E.164; also the Firebase Auth phone
  name: string
  createdAt: timestamp
  lastVisitAt: timestamp | null

stylists/{stylistId}
  name: string
  active: boolean
  serviceIds: string[]          // services this stylist offers
  stylists/{stylistId}/shifts/{shiftId}
     date: "2026-07-31"         // salon-local date
     start: "09:00"             // salon-local time
     end:   "17:00"

services/{serviceId}
  name: string                  // "Gel manicure"
  durationMin: number           // 45
  price: number

appointments/{stylistId_startISO}         // deterministic ID — see §7
  stylistId: string
  stylistName: string           // denormalized
  customerUid: string
  customerPhone: string         // denormalized
  serviceId: string
  serviceName: string           // denormalized
  durationMin: number           // denormalized
  start: timestamp              // UTC
  end: timestamp                // UTC
  status: "booked" | "checked-in" | "completed" | "cancelled"
  source: "manual" | "quick-book"
  createdAt: timestamp
  checkedInAt: timestamp | null

slotLocks/{stylistId_cellISO}             // one per 15-min grid cell — see §7
  appointmentId: string                   // the appointment holding this cell
  stylistId: string
  start: timestamp                        // UTC start of the owning appointment
```

All timestamps stored as UTC. Shifts are stored in **salon-local** wall-clock time; convert using a
single hard-coded salon timezone constant for the POC (`lib/config.ts`).

`slotLocks` is pure bookkeeping for the booking transaction — no client ever reads it. It exists so
that overlapping bookings collide on a shared document even when their appointment IDs differ (§7).

## 6. Key flows

### 6.1 Identify / sign in (phone + SMS)
1. Customer enters phone number.
2. Firebase Phone Auth shows an (invisible) reCAPTCHA, then texts a 6-digit code.
3. Customer enters the code → authenticated. Firebase returns a stable `uid`.
4. On first sign-in, create `customers/{uid}` with the phone and ask for a name.

The Firebase `uid` is the real primary key; the phone number is just the verified login credential
stored on the customer doc.

### 6.2 Browse availability ("on duty today / this week")
- Customer picks a service (needed because slot length depends on `durationMin`).
- The client calls the `getAvailabilityAction(serviceId, dateRange)` Server Action, which returns,
  per stylist, the free start times. See §8.
- UI shows stylists on duty in the range with their open slots.

### 6.3 Manual booking
- Customer taps a slot → client calls `bookSlotAction(stylistId, serviceId, startISO)`.
- The action runs the deterministic-slot transaction in §7 and returns success or a typed conflict.

### 6.4 Quick-book (AI)
See §9. The LLM only reads availability and proposes; the actual write goes through the same
`bookSlotAction` path after the customer confirms.

### 6.5 QR check-in
- The salon has one QR code (printed, or shown on the owner's tablet) linking to `/checkin`.
- Customer scans it with their phone camera, lands on the check-in page (already signed in, or signs
  in with phone). **There is no camera code in this app** — the phone's native camera resolves the
  link, so no scanner hardware and no getUserMedia permission prompt.
- `checkInAction` finds the customer's appointment for today and sets `status: "checked-in"` and
  `checkedInAt`.
- The owner dashboard subscribes with `onSnapshot` and updates live — no polling.

## 7. Preventing double-booking (important)

Firestore has no range-exclusion constraint, so we enforce uniqueness with a **deterministic document
ID** + a transaction. Each bookable slot maps to exactly one document ID, so two racing customers
collide on the same doc and only one wins.

```ts
// lib/server/booking.ts
const appointmentId = `${stylistId}_${startISO}`;   // e.g. "amy_2026-07-31T14:00:00Z"
const appointmentRef = adminDb.collection('appointments').doc(appointmentId);

// A service longer than one grid cell also claims a lock for EVERY cell it covers,
// spanning the service duration PLUS the cleanup buffer.
const lockRefs = slotCellsBetween(start, end.plus({ minutes: BUFFER_MINUTES }))
  .map((cell) => adminDb.collection('slotLocks').doc(`${stylistId}_${toSlotIso(cell)}`));

await adminDb.runTransaction(async (tx) => {
  const [appointmentSnap, ...lockSnaps] = await Promise.all([
    tx.get(appointmentRef),
    ...lockRefs.map((ref) => tx.get(ref)),   // read every cell BEFORE writing
  ]);
  if (appointmentSnap.exists) throw new AppError('already-exists', 'That slot was just taken.');
  for (const lock of lockSnaps) {
    if (lock.exists) throw new AppError('already-exists', 'That time overlaps another booking.');
  }
  tx.set(appointmentRef, { /* appointment fields */ });
  for (const ref of lockRefs) tx.set(ref, { appointmentId, stylistId, start });
});
```

**Why the locks are not optional.** The deterministic appointment ID only catches two customers
racing for the *identical* start time. Two bookings that start 15 minutes apart on the same stylist
have *different* appointment IDs, so without the per-cell locks both transactions would commit and
the stylist would be double-booked. The locks give overlapping bookings a shared document to collide
on. This is verified by `app/api/dev/smoke/route.ts`.

Add a security rule as a second layer so a client can never write an appointment at all:

```
match /appointments/{id} {
  allow read: if request.auth != null;
  allow create, update, delete: if false;   // writes only via Admin SDK in Server Actions
}
match /slotLocks/{id} {
  allow read, write: if false;              // internal bookkeeping
}
```

> Slot granularity: a 15-minute grid, so `startISO` values are predictable. A service longer than one
> grid cell occupies multiple cells, and the booking transaction claims every one of them.

## 8. Availability computation

Runs server-side in a Server Action. For each stylist in range:

1. Gather their `shifts` in the date range.
2. Gather their existing `appointments` in the range.
3. Free time = shift intervals − appointment intervals − a fixed cleanup buffer between clients.
4. Within each free interval, emit start times on the slot grid where a block of `service.durationMin`
   fits before the interval ends and before the shift ends.

The candidate window checked here is `[start, start + durationMin + buffer)` — **the same window the
booking transaction locks in §7**. Keeping them identical is what stops availability from offering a
slot that booking would then reject.

Cost per request: 1 service read + 1 stylist-list read, then 2 queries per candidate stylist. **Do
not** have the client read every slot document individually — Firestore bills per document read, so
return one compact computed payload instead:

```ts
{ serviceId, serviceName, durationMin, price, timezone, slotMinutes, bufferMinutes,
  days: [{ date: "2026-07-31", stylists: [{ stylistId, stylistName, starts: ["…T14:00:00Z", …] }] }] }
```

## 9. AI quick-book

A Server Action `quickBookAction(text)` that uses Claude with tool use. The model interprets the
request and calls read-only tools; it never writes.

- Model: `gemini-2.5-flash` (fast, cheap, good at extraction/intent — right for a latency-sensitive,
  high-volume feature). Thinking is disabled (`thinkingBudget: 0`): this is mechanical slot-matching,
  not reasoning, so thinking would add latency and cost for no benefit.
- Called with the official `@google/genai` SDK from `lib/server/quick-book.ts`.
- API key: a Secret Manager secret referenced from `apphosting.yaml`, **never** shipped to the client.
- If tool-calling reliability disappoints, `gemini-3.6-flash` is the step up (stronger on agentic
  work, ~5x the token price). Swap `QUICK_BOOK_MODEL` in `lib/config.ts`.

Tools exposed to the model (all read-only):
- `list_services()` → services with durations and prices.
- `find_availability(serviceId, startDate, endDate, stylistId?)` → candidate slots. The requested
  range is **clamped server-side** to today…+14 days so a hallucinated date cannot fan out into a
  huge number of Firestore reads.
- `propose_slot(serviceId, stylistId, startISO, message)` → records the model's pick and ends the
  loop. A structured tool input is far more reliable to validate than parsing prose, and it keeps the
  model out of the write path just the same.

Flow:
1. Client sends the customer's free-text request to `quickBookAction`.
2. The action runs the Claude tool-use loop: the model asks for services/availability, the action
   answers from Firestore, the model calls `propose_slot`.
3. The action **re-validates the proposal against live availability** before returning it — the model
   is not trusted to have copied a real slot.
4. The action returns the proposal. Customer taps **Confirm**.
5. Client calls the normal `bookSlotAction` — so the AI path respects the same availability rules and
   double-booking guarantee as manual booking.

The loop is capped at `QUICK_BOOK_MAX_TURNS` round trips so a confused model cannot spin forever.
Keep the model out of the write path entirely; it proposes, the deterministic-slot transaction disposes.

## 10. Authenticating a Server Action

Server Actions do **not** inherit a Firebase session — they are POSTs to the server, and the Admin
SDK bypasses Firestore security rules. So every action re-establishes who is calling:

1. The client holds a Firebase ID token already (`user.getIdToken()`).
2. It passes that token as an argument to the action.
3. `requireCaller(idToken)` calls `adminAuth.verifyIdToken(token, /* checkRevoked */ true)` and
   returns `{ uid, phone }` **decoded from the verified token**.

The rule that follows from this: **never trust a uid, phone number, or price sent in the request
body.** `bookSlotAction` takes no `customerUid` from the client; it uses the one from the token.

Actions **return** failures as a typed `ActionResult` rather than throwing, because Next.js redacts
thrown error messages in production builds — a thrown "That slot was just taken" would reach the
customer as an opaque server error.

## 11. Known gotchas to plan around

- **Blaze plan required** for App Hosting and for the outbound Gemini API call. Free tier still applies.
- **Phone Auth needs a reCAPTCHA verifier** on web — budget time to wire the invisible verifier and
  **test on a real device**. The Auth emulator skips reCAPTCHA entirely, so a broken verifier only
  shows up in production.
- **`'use server'` files are a public HTTP surface.** Every exported async function in one is callable
  by anyone who can reach the app. Validate arguments and verify the caller in every single one.
- **Keep the Admin SDK out of client bundles.** `lib/server/*` imports `server-only`, so a Client
  Component that pulls one in fails at build time instead of leaking credentials.
- **Secrets vs. public config.** `NEXT_PUBLIC_*` values are inlined into the browser bundle at build
  time. `GEMINI_API_KEY` must have `availability: [RUNTIME]` only in `apphosting.yaml` — giving it
  `BUILD` would bake it into the client.
- **Per-document read billing** — design availability to return computed summaries, not raw per-slot reads.
- **Composite indexes** — any query filtering/sorting on multiple fields needs an index in
  `firestore.indexes.json`; Firestore's error message gives you the link to create it. We need
  `(stylistId, start)` and `(customerUid, start)` on `appointments`.
- **Timezone** — one salon TZ constant for the POC; store UTC, display/compute in salon-local. All
  conversion lives in `lib/time.ts` and nowhere else.
- **App Hosting supplies ADC automatically** on Cloud Run, so `initializeApp()` needs no credentials
  in production. Locally you need either the emulators or `GOOGLE_APPLICATION_CREDENTIALS`.

## 12. Visual design & per-salon theming

The interface follows direction **2a** of the
[Booking system redesign](https://claude.ai/design/p/0e234cf1-5453-41ec-b4af-7245846e97e1)
project, on top of the **Nocturne** design system. The full treatment lives in
**`DESIGN-SYSTEM.md`**; the governing principle is:

> **A salon's entire visual identity is six CSS tokens** — `--brand`, `--page`, `--card`,
> `--ink`, `--line`, `--card-radius`. Every other colour in the app is derived from those six
> with `color-mix()`. No component writes a literal colour.

This is deliberate room to tweak. A salon rebrands by supplying six values; it does not get a
fork, a stylesheet, or a branch in a component. Themes live in `lib/theme.ts` as plain records,
applied once in `app/layout.tsx` as CSS custom properties — so when this stops being single-salon,
`ACTIVE_THEME` becomes `salons/{salonId}.theme` and **no component changes**, because components
read CSS variables and never import the theme object.

`/theme` renders the same components under every preset side by side. It is the regression test
for the principle: anything that stays purple across five themes is hard-coded.

## 13. Suggested build order (POC milestones)

1. ✅ Firebase project + App Hosting backend + Auth (Phone) + empty Firestore; deploy a "hello" PWA.
2. ✅ Phone sign-in flow end to end; create/read `customers/{uid}`.
3. ✅ Seed `stylists`, `shifts`, `services` (`npm run seed`).
4. ✅ `getAvailabilityAction` + a screen listing on-duty stylists and open slots.
5. ✅ `bookSlotAction` with the deterministic-slot transaction + security rules.
6. ✅ QR check-in page + owner realtime dashboard (`onSnapshot`).
7. ✅ `quickBookAction` with Gemini 2.5 Flash function calling, wired to confirm → `bookSlotAction`.
8. ⬜ Polish PWA install/offline basics (manifest + icon are in; no service worker yet).

Remaining before this is fit for real customers, in priority order:

- **Gate `/owner`** on a custom claim (`owner: true`) and tighten the `appointments` read rule. Today
  any signed-in customer can read every appointment, including other customers' phone numbers.
- **Add a service worker** for offline shell + install prompt, and real PNG icons (the SVG icon works
  in the manifest but some install surfaces want raster).
- **Let customers see and cancel their own bookings** (`cancelAppointment` exists server-side; there
  is no UI for it).
- **Rate-limit `quickBookAction`** per uid. It is the only action that costs money per call.
