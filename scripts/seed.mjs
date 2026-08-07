/**
 * Seeds services, stylists, and shifts (DESIGN.md §11 step 3).
 *
 * Against the emulator (default):
 *   npm run emulators          # in one terminal
 *   npm run seed               # in another
 *
 * Against a real project:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *   FIRESTORE_EMULATOR_HOST= \
 *   FIREBASE_PROJECT_ID=your-project-id npm run seed
 *
 * Idempotent: uses fixed document IDs and merges, so re-running is safe.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { DateTime } from 'luxon';

const SALON_TZ = 'America/Los_Angeles';
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  'nail-salon-poc-2026';

// Default to the emulator so a stray run cannot touch production data.
if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}
const target = process.env.FIRESTORE_EMULATOR_HOST
  ? `emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`
  : `LIVE project ${PROJECT_ID}`;

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const SERVICES = [
  { id: 'polish-change', name: 'Polish change', durationMin: 15, price: 18 },
  { id: 'classic-manicure', name: 'Classic manicure', durationMin: 30, price: 32 },
  { id: 'gel-manicure', name: 'Gel manicure', durationMin: 45, price: 55 },
  { id: 'classic-pedicure', name: 'Classic pedicure', durationMin: 45, price: 48 },
  { id: 'spa-pedicure', name: 'Spa pedicure', durationMin: 60, price: 68 },
  { id: 'full-set', name: 'Full set (acrylic)', durationMin: 90, price: 85 },
];

const ALL = SERVICES.map((s) => s.id);

const STYLISTS = [
  {
    id: 'amy',
    specialty: 'Gel & acrylic',
    name: 'Amy',
    active: true,
    serviceIds: ALL,
    // Tue–Sat, full days.
    schedule: { days: [2, 3, 4, 5, 6], start: '09:00', end: '17:00' },
  },
  {
    id: 'bao',
    specialty: 'Pedicures & nail art',
    name: 'Bao',
    active: true,
    serviceIds: ALL.filter((id) => id !== 'full-set'),
    // Wed–Sun, later start.
    schedule: { days: [3, 4, 5, 6, 7], start: '11:00', end: '19:00' },
  },
  {
    id: 'chi',
    specialty: 'Gel specialist',
    name: 'Chi',
    active: true,
    serviceIds: ['gel-manicure', 'full-set', 'classic-manicure'],
    // Thu–Sat half days.
    schedule: { days: [4, 5, 6], start: '10:00', end: '14:00' },
  },
  {
    id: 'dana',
    specialty: 'All services',
    name: 'Dana',
    active: false, // on leave — must never appear in availability
    serviceIds: ALL,
    schedule: { days: [], start: '09:00', end: '17:00' },
  },
];

/** Shifts are stored in SALON-LOCAL wall clock, not UTC. */
const SHIFT_DAYS = 21;

async function seed() {
  console.log(`Seeding ${target}\n`);

  const batch = db.batch();

  for (const service of SERVICES) {
    const { id, ...data } = service;
    batch.set(db.collection('services').doc(id), data, { merge: true });
  }
  console.log(`  services: ${SERVICES.length}`);

  for (const stylist of STYLISTS) {
    const { id, schedule, ...data } = stylist;
    batch.set(
      db.collection('stylists').doc(id),
      { ...data, createdAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  console.log(`  stylists: ${STYLISTS.length} (1 inactive)`);

  await batch.commit();

  // Shifts in a second pass — subcollection writes, one batch per stylist.
  const today = DateTime.now().setZone(SALON_TZ).startOf('day');
  let shiftCount = 0;

  for (const stylist of STYLISTS) {
    const shiftBatch = db.batch();
    const shiftsRef = db.collection('stylists').doc(stylist.id).collection('shifts');

    for (let offset = 0; offset < SHIFT_DAYS; offset++) {
      const day = today.plus({ days: offset });
      if (!stylist.schedule.days.includes(day.weekday)) continue;
      const date = day.toFormat('yyyy-MM-dd');
      shiftBatch.set(
        shiftsRef.doc(date),
        { date, start: stylist.schedule.start, end: stylist.schedule.end },
        { merge: true }
      );
      shiftCount++;
    }
    await shiftBatch.commit();
  }
  console.log(`  shifts:   ${shiftCount} across the next ${SHIFT_DAYS} days`);

  console.log('\nDone. Sign in with any phone number in the Auth emulator.');
  console.log('Emulator UI: http://127.0.0.1:4000');
}

seed().catch((error) => {
  console.error('\nSeed failed:', error);
  process.exit(1);
});
