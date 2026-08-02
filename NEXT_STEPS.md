# Where to pick up

Last worked: 2026-07-29. Stack settled on Next.js (App Router) + Server Actions on Firebase
App Hosting. `npm run build` and `npx tsc --noEmit` are clean.

## Restart local dev (three terminals)

```bash
npm run emulators   # Auth + Firestore, UI at http://127.0.0.1:4000
npm run seed        # idempotent — safe to re-run
npm run dev         # http://localhost:3000
```

Emulator data is not persisted between runs, so re-seed each time.

## 1. Verify quick-book — NEVER BEEN EXECUTED

This is the highest-value unknown. The Gemini function-calling loop typechecks and builds but has
never made a real API call, because there was no `GEMINI_API_KEY` on this machine.

```bash
echo 'GEMINI_API_KEY=AIza...' >> .env.local
npm run dev
# then: sign in → Quick book tab → "gel manicure Friday afternoon"
```

Expect the first bug in **relative date resolution** ("Friday afternoon", "tomorrow morning") — that
is the part leaning hardest on the model. The system prompt in `lib/server/quick-book.ts` injects the
current salon-local date/time for exactly this reason; check that first if dates come back wrong.

Also worth confirming on the first real run:
- the model calls `list_services` before `find_availability` (it should; if not, tighten the prompt)
- `propose_slot` returns a `startISO` copied verbatim, not invented — `validateProposal()` rejects
  invented ones, so the symptom is "That time just filled up" on a slot that is actually free
- the loop finishes well inside `QUICK_BOOK_MAX_TURNS` (6)

## 2. Verify the browser flow on a real device — ALSO UNVERIFIED

Nothing in the UI has been clicked. Phone auth specifically **cannot** be validated on the emulator:
the Auth emulator skips reCAPTCHA entirely, so a broken invisible verifier only appears in
production. Deploy to App Hosting (or use a tunnel) and test on an actual phone.

Path to walk: sign in → name gate → pick service → tap slot → confirm → open `/owner` on a second
device → scan the QR with the phone camera → watch the row flip to `checked-in` live.

## 3. Gate `/owner` before anyone real uses this

Currently any signed-in customer can open `/owner` and read every appointment, including other
customers' phone numbers. This matches `DESIGN.md` §7 as written, but it is not shippable.

- Set a custom claim (`owner: true`) on the owner's account via the Admin SDK.
- Tighten the `appointments` read rule in `firestore.rules` to require it.
- Redirect non-owners away from `app/owner/page.tsx`.

Note the tradeoff: the dashboard reads Firestore directly so `onSnapshot` gives live updates. Moving
that read into a Server Action would cost you the realtime behaviour — keep the client read and gate
it with a claim instead.

## 4. Smaller remaining work

- **Customer-facing "my bookings" + cancel.** `cancelAppointment()` and `cancelAppointmentAction`
  already exist and release the slot locks; there is no UI calling them.
- **Rate-limit `quickBookAction` per uid.** It is the only action that costs money per call.
- **PWA polish.** Manifest and SVG icon are in; no service worker yet, and some install surfaces want
  raster PNG icons.

## Before the first deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase apphosting:secrets:set GEMINI_API_KEY
firebase apphosting:backends:create --project <your-project-id>
firebase apphosting:secrets:grantaccess GEMINI_API_KEY --backend <backend-id>
```

Also fill in the empty `NEXT_PUBLIC_FIREBASE_*` values in `apphosting.yaml`, or link the backend to a
Firebase Web App and let App Hosting inject `FIREBASE_WEBAPP_CONFIG` (`lib/firebase-client.ts`
already prefers it when present).

## Guard rail

After touching `lib/server/booking.ts` or `lib/server/availability.ts`, re-run:

```bash
curl -s localhost:3000/api/dev/smoke | jq
```

6/6 currently pass. It covers the identical-slot race, the overlapping-slot case (the one only the
`slotLocks` cells catch), slot removal from availability, and buffer enforcement.
