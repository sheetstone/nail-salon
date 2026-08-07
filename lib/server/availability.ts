import 'server-only';

import type { Interval } from 'luxon';
import { adminDb, COL, ACTIVE_STATUSES } from './firebase-admin';
import { AppError } from '../result';
import {
  BUFFER_MINUTES,
  MAX_RANGE_DAYS,
  MIN_LEAD_MINUTES,
  SALON_TZ,
  SLOT_MINUTES,
} from '../config';
import {
  DateTime,
  ceilToSlotGrid,
  interval,
  localDateRange,
  localRangeToUtcBounds,
  localWallClockToUtc,
  toSlotIso,
} from '../time';
import type {
  AvailabilityPayload,
  IsoInterval,
  Service,
  Shift,
  Stylist,
} from '../types';

/**
 * Availability is computed here, server-side, and returned as one compact
 * payload (DESIGN.md §8). The client must never walk slot documents one by one
 * — Firestore bills per document read.
 *
 * Cost per request: 1 service read + 1 stylist-list read, then 2 queries per
 * candidate stylist (their shifts, their appointments). Nothing per slot.
 */

export async function loadService(serviceId: unknown): Promise<Service> {
  if (typeof serviceId !== 'string' || serviceId.length === 0) {
    throw new AppError('invalid-argument', 'Pick a service first.');
  }
  const snap = await adminDb.collection(COL.services).doc(serviceId).get();
  if (!snap.exists) {
    throw new AppError('not-found', 'That service no longer exists.');
  }
  const data = snap.data()!;
  const durationMin = Number(data.durationMin);
  if (!Number.isFinite(durationMin) || durationMin <= 0) {
    throw new AppError(
      'failed-precondition',
      `Service "${serviceId}" has no usable durationMin.`
    );
  }
  return {
    id: snap.id,
    name: String(data.name ?? snap.id),
    durationMin,
    price: Number(data.price ?? 0),
  };
}

export async function loadServices(): Promise<Service[]> {
  const snap = await adminDb.collection(COL.services).get();
  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.name ?? d.id),
        durationMin: Number(data.durationMin ?? 0),
        price: Number(data.price ?? 0),
      };
    })
    .filter((s) => s.durationMin > 0)
    .sort((a, b) => a.durationMin - b.durationMin);
}

/** Active stylists who offer this service. */
export async function loadStylistsForService(serviceId: string): Promise<Stylist[]> {
  const snap = await adminDb
    .collection(COL.stylists)
    .where('active', '==', true)
    .get();

  return snap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.name ?? d.id),
        active: data.active === true,
        serviceIds: Array.isArray(data.serviceIds) ? data.serviceIds : [],
        specialty: typeof data.specialty === 'string' ? data.specialty : undefined,
      };
    })
    .filter((s) => s.serviceIds.includes(serviceId));
}

/** Shifts for one stylist inside a salon-local date range, inclusive. */
async function loadShifts(
  stylistId: string,
  startDate: string,
  endDate: string
): Promise<Shift[]> {
  const snap = await adminDb
    .collection(COL.stylists)
    .doc(stylistId)
    .collection('shifts')
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      date: String(data.date),
      start: String(data.start),
      end: String(data.end),
    };
  });
}

/**
 * Booked intervals for one stylist — the REAL appointment spans, with no
 * cleanup buffer applied. The buffer is added where free slots are computed
 * (`slotsForShift`), so that the timeline can draw a "booked" block matching
 * the appointment a customer actually has, rather than one padded by 15
 * invisible minutes.
 *
 * Uses the (stylistId, start) composite index in firestore.indexes.json.
 */
async function loadBusyIntervals(
  stylistId: string,
  from: DateTime,
  to: DateTime
): Promise<Interval[]> {
  const snap = await adminDb
    .collection(COL.appointments)
    .where('stylistId', '==', stylistId)
    // A long appointment can start just before the window and still overlap it,
    // so widen the lower bound by more than any plausible service length.
    .where('start', '>=', from.minus({ hours: 6 }).toJSDate())
    .where('start', '<=', to.toJSDate())
    .get();

  return snap.docs
    .map((d) => d.data())
    .filter((a) => (ACTIVE_STATUSES as readonly string[]).includes(a.status))
    .map((a) => {
      const start = DateTime.fromJSDate(a.start.toDate(), { zone: 'utc' });
      const end = DateTime.fromJSDate(a.end.toDate(), { zone: 'utc' });
      return interval(start, end);
    });
}

/**
 * Free start times for one stylist on one shift.
 *
 * A candidate is offered when the service fits before the shift ends AND the
 * service plus its cleanup buffer overlaps nothing already booked. The same
 * claim window is what lib/server/booking.ts locks, so what we show here and
 * what a booking will accept cannot drift apart.
 */
function slotsForShift(args: {
  shift: Shift;
  durationMin: number;
  busy: Interval[];
  notBefore: DateTime;
}): { starts: string[]; window: Interval | null } {
  const { shift, durationMin, busy, notBefore } = args;
  const shiftStart = localWallClockToUtc(shift.date, shift.start);
  const shiftEnd = localWallClockToUtc(shift.date, shift.end);
  if (shiftEnd <= shiftStart) return { starts: [], window: null };

  const starts: string[] = [];
  let cursor = ceilToSlotGrid(shiftStart > notBefore ? shiftStart : notBefore);

  while (cursor < shiftEnd) {
    const serviceEnd = cursor.plus({ minutes: durationMin });
    if (serviceEnd > shiftEnd) break;

    // Expand each booked interval by the buffer here, rather than storing it
    // padded — so display keeps the true appointment span while booking still
    // reserves turnover time. Same window lib/server/booking.ts locks.
    const claim = interval(cursor, serviceEnd.plus({ minutes: BUFFER_MINUTES }));
    const collides = busy.some((b) =>
      interval(b.start!, b.end!.plus({ minutes: BUFFER_MINUTES })).overlaps(claim)
    );
    if (!collides) starts.push(toSlotIso(cursor));

    cursor = cursor.plus({ minutes: SLOT_MINUTES });
  }
  return { starts, window: interval(shiftStart, shiftEnd) };
}

export async function computeAvailability(args: {
  serviceId: string;
  /** Salon-local "yyyy-MM-dd". */
  startDate: string;
  /** Salon-local "yyyy-MM-dd", inclusive. */
  endDate: string;
  /** Optional: restrict to one stylist. */
  stylistId?: string | null;
}): Promise<AvailabilityPayload> {
  const service = await loadService(args.serviceId);

  const dates = localDateRange(args.startDate, args.endDate);
  if (dates.length === 0) {
    throw new AppError(
      'invalid-argument',
      'Give a salon-local yyyy-MM-dd range with endDate on or after startDate.'
    );
  }
  if (dates.length > MAX_RANGE_DAYS) {
    throw new AppError(
      'invalid-argument',
      `Date range too wide (max ${MAX_RANGE_DAYS} days).`
    );
  }

  let stylists = await loadStylistsForService(service.id);
  if (args.stylistId) {
    stylists = stylists.filter((s) => s.id === args.stylistId);
  }

  const { from, to } = localRangeToUtcBounds(args.startDate, args.endDate);
  const notBefore = DateTime.utc().plus({ minutes: MIN_LEAD_MINUTES });

  const perStylist = await Promise.all(
    stylists.map(async (stylist) => {
      const [shifts, busy] = await Promise.all([
        loadShifts(stylist.id, args.startDate, args.endDate),
        loadBusyIntervals(stylist.id, from, to),
      ]);

      // Keyed by salon-local date. A stylist appears for a date if they have a
      // shift that day — even with zero openings — so the timeline can show
      // "fully booked" as distinct from "not working".
      const byDate = new Map<
        string,
        { starts: string[]; shifts: IsoInterval[]; busy: IsoInterval[] }
      >();

      for (const shift of shifts) {
        const { starts, window } = slotsForShift({
          shift,
          durationMin: service.durationMin,
          busy,
          notBefore,
        });
        if (!window) continue;

        const entry = byDate.get(shift.date) ?? { starts: [], shifts: [], busy: [] };
        entry.starts.push(...starts);
        entry.shifts.push({
          startISO: toSlotIso(window.start!),
          endISO: toSlotIso(window.end!),
        });
        // Only the booked intervals that actually intersect this shift.
        for (const b of busy) {
          if (!b.overlaps(window)) continue;
          const iso = { startISO: toSlotIso(b.start!), endISO: toSlotIso(b.end!) };
          if (!entry.busy.some((x) => x.startISO === iso.startISO)) entry.busy.push(iso);
        }
        byDate.set(shift.date, entry);
      }
      return { stylist, byDate };
    })
  );

  const days = dates.map((date) => ({
    date,
    stylists: perStylist
      .filter(({ byDate }) => byDate.has(date))
      .map(({ stylist, byDate }) => {
        const entry = byDate.get(date)!;
        return {
          stylistId: stylist.id,
          stylistName: stylist.name,
          specialty: stylist.specialty ?? null,
          starts: [...entry.starts].sort(),
          shifts: [...entry.shifts].sort((a, b) => a.startISO.localeCompare(b.startISO)),
          busy: [...entry.busy].sort((a, b) => a.startISO.localeCompare(b.startISO)),
        };
      }),
  }));

  return {
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    price: service.price,
    timezone: SALON_TZ,
    slotMinutes: SLOT_MINUTES,
    bufferMinutes: BUFFER_MINUTES,
    days,
  };
}
