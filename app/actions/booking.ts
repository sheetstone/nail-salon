'use server';

import { FieldValue } from 'firebase-admin/firestore';

import { requireCaller } from '@/lib/server/auth';
import { adminDb, COL } from '@/lib/server/firebase-admin';
import { computeAvailability, loadServices } from '@/lib/server/availability';
import { bookSlot, cancelAppointment, checkInToday } from '@/lib/server/booking';
import { quickBook } from '@/lib/server/quick-book';
import { AppError, run, type ActionResult } from '@/lib/result';
import { humanLabel, parseSlotIso, salonDayBounds, salonToday } from '@/lib/time';
import type {
  AvailabilityPayload,
  BookingConfirmation,
  CheckInResult,
  QuickBookResult,
  Service,
} from '@/lib/types';

/**
 * Every trusted operation lives here. These run on the server (Cloud Run under
 * App Hosting) with the Admin SDK, which bypasses Firestore security rules —
 * so each one re-verifies the caller's ID token and never trusts a uid, phone
 * number, or price sent from the browser.
 *
 * Actions RETURN failures as ActionResult rather than throwing; see lib/result.ts.
 */

export async function listServicesAction(): Promise<ActionResult<Service[]>> {
  // Public catalog data — no auth needed to browse prices.
  return run(() => loadServices());
}

export async function getAvailabilityAction(args: {
  idToken: string;
  serviceId: string;
  startDate: string;
  endDate: string;
  stylistId?: string | null;
}): Promise<ActionResult<AvailabilityPayload>> {
  return run(async () => {
    await requireCaller(args.idToken);
    return computeAvailability({
      serviceId: args.serviceId,
      startDate: args.startDate,
      endDate: args.endDate,
      stylistId: args.stylistId ?? null,
    });
  });
}

export async function bookSlotAction(args: {
  idToken: string;
  stylistId: string;
  serviceId: string;
  startISO: string;
  source?: 'manual' | 'quick-book';
}): Promise<ActionResult<BookingConfirmation>> {
  return run(async () => {
    const caller = await requireCaller(args.idToken);
    return bookSlot({
      stylistId: args.stylistId,
      serviceId: args.serviceId,
      startISO: args.startISO,
      customerUid: caller.uid,
      customerPhone: caller.phone,
      source: args.source ?? 'manual',
    });
  });
}

export async function cancelAppointmentAction(args: {
  idToken: string;
  appointmentId: string;
}): Promise<ActionResult<{ appointmentId: string; status: 'cancelled' }>> {
  return run(async () => {
    const caller = await requireCaller(args.idToken);
    return cancelAppointment({
      appointmentId: args.appointmentId,
      customerUid: caller.uid,
    });
  });
}

/**
 * The caller's most recent past visit, for the home screen's "Book last visit
 * again" row. Returns null for a first-time customer.
 *
 * Reading this through an action rather than the client SDK keeps it working
 * before the rules rework in #2 lands, and lets us re-read the CURRENT service
 * price — the appointment's own `price` is the historical one and would be
 * misleading if the salon has repriced since.
 */
export async function getLastVisitAction(args: {
  idToken: string;
}): Promise<
  ActionResult<{
    serviceId: string;
    serviceName: string;
    stylistId: string;
    stylistName: string;
    price: number | null;
  } | null>
> {
  return run(async () => {
    const caller = await requireCaller(args.idToken);

    const snap = await adminDb
      .collection(COL.appointments)
      .where('customerUid', '==', caller.uid)
      .where('start', '<=', new Date())
      .orderBy('start', 'desc')
      .limit(5)
      .get();

    const past = snap.docs
      .map((d) => d.data())
      .find((a) => a.status === 'completed' || a.status === 'checked-in');
    if (!past) return null;

    // Current price, not the price they paid.
    const serviceSnap = await adminDb
      .collection(COL.services)
      .doc(String(past.serviceId))
      .get();

    return {
      serviceId: String(past.serviceId),
      serviceName: String(past.serviceName),
      stylistId: String(past.stylistId),
      stylistName: String(past.stylistName),
      price: serviceSnap.exists ? Number(serviceSnap.data()!.price ?? 0) : null,
    };
  });
}

export async function quickBookAction(args: {
  idToken: string;
  text: string;
}): Promise<ActionResult<QuickBookResult>> {
  return run(async () => {
    await requireCaller(args.idToken);
    // The model only reads. Confirming calls bookSlotAction, same as manual.
    return quickBook(args.text);
  });
}

export async function checkInAction(args: {
  idToken: string;
}): Promise<ActionResult<CheckInResult & { alreadyCheckedIn: boolean }>> {
  return run(async () => {
    const caller = await requireCaller(args.idToken);
    const { from, to } = salonDayBounds(salonToday());

    const result = await checkInToday({ customerUid: caller.uid, from, to });
    if (!result) {
      throw new AppError(
        'not-found',
        'No appointment found for today under this number.'
      );
    }

    const snap = await adminDb
      .collection(COL.appointments)
      .doc(result.appointmentId)
      .get();
    const data = snap.data()!;
    const start = parseSlotIso(data.start.toDate().toISOString());

    return {
      appointmentId: result.appointmentId,
      stylistName: String(data.stylistName),
      serviceName: String(data.serviceName),
      startISO: data.start.toDate().toISOString(),
      label: start ? humanLabel(start) : '',
      alreadyCheckedIn: result.alreadyCheckedIn,
    };
  });
}

/**
 * Creates or updates the caller's own profile.
 *
 * Security rules also permit the client to write customers/{uid} directly, but
 * routing it through here means the phone number always comes from the verified
 * token rather than from form state.
 */
export async function upsertCustomerAction(args: {
  idToken: string;
  name: string;
}): Promise<ActionResult<{ uid: string; name: string; phone: string }>> {
  return run(async () => {
    const caller = await requireCaller(args.idToken);
    const name = args.name.trim().slice(0, 80);
    if (name.length === 0) {
      throw new AppError('invalid-argument', 'Please enter a name.');
    }

    const ref = adminDb.collection(COL.customers).doc(caller.uid);
    const existing = await ref.get();

    await ref.set(
      {
        phone: caller.phone,
        name,
        ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp(), lastVisitAt: null }),
      },
      { merge: true }
    );

    return { uid: caller.uid, name, phone: caller.phone };
  });
}
