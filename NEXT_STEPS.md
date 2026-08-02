# Where to pick up

Work is tracked in [GitHub issues](https://github.com/sheetstone/nail-salon/issues). Start with
**#1** — everything else is either blocked on it or easier to verify once there's a deployed URL.

| # | What | Why it's ordered here |
|---|---|---|
| [#1](https://github.com/sheetstone/nail-salon/issues/1) | Finish Firebase setup + first deploy | Blocks #3 and #4 |
| [#2](https://github.com/sheetstone/nail-salon/issues/2) | Gate `/owner` behind an owner claim | Do before anyone real touches it |
| [#3](https://github.com/sheetstone/nail-salon/issues/3) | Verify Gemini quick-book | Never executed against the real API |
| [#4](https://github.com/sheetstone/nail-salon/issues/4) | Verify the flows on a real device | Phone auth can't be tested on the emulator |
| [#5](https://github.com/sheetstone/nail-salon/issues/5) | Customer "my visits" + cancel | Server side already exists; do after #2 |
| [#6](https://github.com/sheetstone/nail-salon/issues/6) | Rate-limit `quickBookAction` | The one action that costs money per call |
| [#7](https://github.com/sheetstone/nail-salon/issues/7) | PWA service worker + raster icons | Lowest priority; app works without it |

## Restart local dev (three terminals)

```bash
npm run emulators   # Auth + Firestore, UI at http://127.0.0.1:4000
npm run seed        # idempotent — safe to re-run
npm run dev         # http://localhost:3000
```

Emulator data is not persisted between runs, so re-seed each time. `.env.local` already points the
Admin SDK and the browser SDK at the emulators.

## Guard rail

After touching `lib/server/booking.ts` or `lib/server/availability.ts`, re-run:

```bash
curl -s localhost:3000/api/dev/smoke | jq
```

6/6 currently pass. It covers the identical-slot race, the overlapping-slot case (the one only the
`slotLocks` cells catch), slot removal from availability, and buffer enforcement. This is the most
valuable test in the repo — the double-booking invariant is the part that is genuinely easy to get
wrong.
