import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, COL } from './firebase-admin';
import { loadService } from './availability';
import { AppError } from '../result';
import { BUFFER_MINUTES, MIN_LEAD_MINUTES } from '../config';
import {
  DateTime,
  isOnSlotGrid,
  localWallClockToUtc,
  parseSlotIso,
  slotCellsBetween,
  toSlotIso,
  utcToLocalDate,
} from '../time';
import type { BookingConfirmation, BookingSource, Shift } from '../types';

/**
 * Double-booking prevention (DESIGN.md §7). Read this before touching it.
 *
 * Firestore has no range-exclusion constraint, so uniqueness is enforced with
 * deterministic document IDs plus a transaction:
 *
 *   1. The appointment lives at `appointments/{stylistId}_{startISO}`. Two
 *      customers racing for the same start time collide on the same doc ID and
 *      exactly one wins.
 *   2. A service longer than one grid cell ALSO claims a `slotLocks` doc for
 *      every cell it covers (service duration + cleanup buffer). This is what
 *      stops a race between two *overlapping but differently-started* bookings
 *      — distinct appointment IDs alone would let both through.
 *
 * The transaction reads every cell before writing anything. Security rules deny
 * client writes to both collections as the second layer; the Admin SDK used
 * here bypasses rules by design, which is why this is the only write path.
 */

export function slotDocId(stylistId: string, startIso: string): string {
  return `${stylistId}_${startIso}`;
}

function assertShiftCovers(shifts: Shift[], start: DateTime, end: DateTime): void {
  const fits = shifts.some((shift) => {
    const shiftStart = localWallClockToUtc(shift.date, shift.start);
    const shiftEnd = localWallClockToUtc(shift.date, shift.end);
    return start >= shiftStart && end <= shiftEnd;
  });
  if (!fits) {
    throw new AppError(
      'failed-precondition',
      'That time is outside the stylist’s shift.'
    );
  }
}

export async function bookSlot(args: {
  stylistId: string;
  serviceId: string;
  /** Canonical UTC slot ISO, e.g. "2026-07-31T14:00:00Z". */
  startISO: string;
  /** From the verified ID token — never from the request body. */
  customerUid: string;
  /** From the verified ID token — never from the request body. */
  customerPhone: string;
  source?: BookingSource;
}): Promise<BookingConfirmation> {
  const { stylistId, serviceId, startISO, customerUid, customerPhone } = args;
  const source: BookingSource = args.source ?? 'manual';

  if (typeof stylistId !== 'string' || stylistId.length === 0) {
    throw new AppError('invalid-argument', 'Pick a stylist first.');
  }

  const start = parseSlotIso(startISO);
  if (!start) {
    throw new AppError('invalid-argument', 'That start time is not a valid instant.');
  }
  if (!isOnSlotGrid(start)) {
    throw new AppError('invalid-argument', 'That start time is not on the slot grid.');
  }
  if (start < DateTime.utc().plus({ minutes: MIN_LEAD_MINUTES })) {
    throw new AppError(
      'failed-precondition',
      'That slot is in the past or too soon to book.'
    );
  }

  const service = await loadService(serviceId);
  const end = start.plus({ minutes: service.durationMin });
  // The claim runs past the appointment by the cleanup buffer, so nobody can be
  // booked back-to-back with no turnover time. Availability uses the same window.
  const claimEnd = end.plus({ minutes: BUFFER_MINUTES });

  const stylistRef = adminDb.collection(COL.stylists).doc(stylistId);
  const stylistSnap = await stylistRef.get();
  if (!stylistSnap.exists) {
    throw new AppError('not-found', 'That stylist no longer exists.');
  }
  const stylist = stylistSnap.data()!;
  const stylistName = String(stylist.name ?? stylistId);
  if (stylist.active !== true) {
    throw new AppError('failed-precondition', `${stylistName} is not taking bookings.`);
  }
  if (
    !Array.isArray(stylist.serviceIds) ||
    !stylist.serviceIds.includes(service.id)
  ) {
    throw new AppError(
      'failed-precondition',
      `${stylistName} does not offer ${service.name}.`
    );
  }

  // Only the shift day(s) the appointment could touch.
  const dates = [...new Set([utcToLocalDate(start), utcToLocalDate(end)])];
  const shiftSnaps = await Promise.all(
    dates.map((date) => stylistRef.collection('shifts').where('date', '==', date).get())
  );
  const shifts: Shift[] = shiftSnaps.flatMap((snap) =>
    snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        date: String(data.date),
        start: String(data.start),
        end: String(data.end),
      };
    })
  );
  assertShiftCovers(shifts, start, end);

  const canonicalStartIso = toSlotIso(start);
  const appointmentId = slotDocId(stylistId, canonicalStartIso);
  const appointmentRef = adminDb.collection(COL.appointments).doc(appointmentId);
  const lockRefs = slotCellsBetween(start, claimEnd).map((cell) =>
    adminDb.collection(COL.slotLocks).doc(slotDocId(stylistId, toSlotIso(cell)))
  );

  await adminDb.runTransaction(async (tx) => {
    // Read EVERY cell this service covers before writing anything.
    const [appointmentSnap, ...lockSnaps] = await Promise.all([
      tx.get(appointmentRef),
      ...lockRefs.map((ref) => tx.get(ref)),
    ]);

    if (appointmentSnap.exists && appointmentSnap.data()!.status !== 'cancelled') {
      throw new AppError('already-exists', 'That slot was just taken.');
    }
    for (const lockSnap of lockSnaps) {
      if (lockSnap.exists && lockSnap.data()!.appointmentId !== appointmentId) {
        throw new AppError('already-exists', 'That time overlaps another booking.');
      }
    }

    tx.set(appointmentRef, {
      stylistId,
      stylistName, // denormalized — Firestore has no JOINs
      customerUid,
      customerPhone, // denormalized
      serviceId: service.id,
      serviceName: service.name, // denormalized
      durationMin: service.durationMin, // denormalized
      start: start.toJSDate(), // UTC
      end: end.toJSDate(), // UTC
      status: 'booked',
      source,
      createdAt: FieldValue.serverTimestamp(),
      checkedInAt: null,
    });

    for (const ref of lockRefs) {
      tx.set(ref, { appointmentId, stylistId, start: start.toJSDate() });
    }
  });

  return {
    appointmentId,
    stylistId,
    stylistName,
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    startISO: canonicalStartIso,
    endISO: toSlotIso(end),
    status: 'booked',
    source,
  };
}

/** Releases an appointment and every slot lock it holds. */
export async function cancelAppointment(args: {
  appointmentId: string;
  customerUid: string;
}): Promise<{ appointmentId: string; status: 'cancelled' }> {
  const { appointmentId, customerUid } = args;
  if (typeof appointmentId !== 'string' || appointmentId.length === 0) {
    throw new AppError('invalid-argument', 'Which appointment?');
  }

  const appointmentRef = adminDb.collection(COL.appointments).doc(appointmentId);
  const lockSnap = await adminDb
    .collection(COL.slotLocks)
    .where('appointmentId', '==', appointmentId)
    .get();

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(appointmentRef);
    if (!snap.exists) {
      throw new AppError('not-found', 'No such appointment.');
    }
    const appointment = snap.data()!;
    if (appointment.customerUid !== customerUid) {
      throw new AppError('permission-denied', 'That is not your appointment.');
    }
    if (appointment.status === 'cancelled') return;

    tx.update(appointmentRef, {
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
    });
    for (const doc of lockSnap.docs) {
      tx.delete(doc.ref);
    }
  });

  return { appointmentId, status: 'cancelled' };
}

/** Marks today's booked appointment as checked in. Idempotent. */
export async function checkInToday(args: {
  customerUid: string;
  from: Date;
  to: Date;
}): Promise<{ appointmentId: string; alreadyCheckedIn: boolean } | null> {
  const snap = await adminDb
    .collection(COL.appointments)
    .where('customerUid', '==', args.customerUid)
    .where('start', '>=', args.from)
    .where('start', '<=', args.to)
    .orderBy('start')
    .get();

  const candidate = snap.docs.find((d) => {
    const status = d.data().status;
    return status === 'booked' || status === 'checked-in';
  });
  if (!candidate) return null;

  if (candidate.data().status === 'checked-in') {
    return { appointmentId: candidate.id, alreadyCheckedIn: true };
  }

  await candidate.ref.update({
    status: 'checked-in',
    checkedInAt: FieldValue.serverTimestamp(),
  });
  // lastVisitAt is a convenience for the owner, not load-bearing.
  await adminDb
    .collection(COL.customers)
    .doc(args.customerUid)
    .set({ lastVisitAt: FieldValue.serverTimestamp() }, { merge: true });

  return { appointmentId: candidate.id, alreadyCheckedIn: false };
}
