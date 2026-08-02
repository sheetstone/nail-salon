import { NextResponse } from 'next/server';

import { computeAvailability, loadServices } from '@/lib/server/availability';
import { bookSlot, cancelAppointment } from '@/lib/server/booking';
import { SALON_TZ } from '@/lib/config';
import { DateTime, parseSlotIso, toSlotIso } from '@/lib/time';
import { AppError } from '@/lib/result';

/**
 * DEV-ONLY smoke test for the booking invariants. Not part of the product.
 *
 * It bypasses requireCaller on purpose (there is no browser to mint an ID
 * token), which is exactly why it must never exist in a deployed build — hence
 * the hard NODE_ENV gate below.
 *
 *   npm run emulators      # terminal 1
 *   npm run seed           # terminal 2
 *   npm run dev            # terminal 3
 *   curl -s localhost:3000/api/dev/smoke | jq
 */

const TEST_UID = 'smoke-test-uid';
const TEST_PHONE = '+15550000000';

interface Step {
  step: string;
  pass: boolean;
  detail: string;
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }

  const steps: Step[] = [];
  const record = (step: string, pass: boolean, detail: string) => {
    steps.push({ step, pass, detail });
  };
  // Track the owning uid too — cancelAppointment enforces ownership.
  const created: Array<{ appointmentId: string; uid: string }> = [];

  try {
    // 1. Catalog is seeded.
    const services = await loadServices();
    record('services seeded', services.length > 0, `${services.length} services`);
    const service =
      services.find((s) => s.durationMin >= 45) ?? services[services.length - 1];
    if (!service) throw new Error('No services — run `npm run seed` first.');

    // 2. Availability returns a compact payload with real openings.
    const today = DateTime.now().setZone(SALON_TZ);
    const range = {
      serviceId: service.id,
      startDate: today.toFormat('yyyy-MM-dd'),
      endDate: today.plus({ days: 6 }).toFormat('yyyy-MM-dd'),
    };
    const before = await computeAvailability(range);
    const firstDay = before.days.find((d) => d.stylists.length > 0);
    const firstStylist = firstDay?.stylists[0];
    record(
      'availability computed',
      Boolean(firstStylist),
      `${service.name} (${service.durationMin}min) · first opening ${
        firstStylist ? `${firstDay!.date} ${firstStylist.starts[0]}` : 'none'
      }`
    );
    if (!firstDay || !firstStylist) throw new Error('No availability to test against.');

    const stylistId = firstStylist.stylistId;
    const startISO = firstStylist.starts[0];

    // 3. THE RACE: two simultaneous bookings of the identical slot.
    //    Deterministic doc ID means exactly one must win.
    const contenders = [
      { uid: TEST_UID, phone: TEST_PHONE },
      { uid: `${TEST_UID}-rival`, phone: '+15550000001' },
    ];
    const raced = await Promise.allSettled(
      contenders.map((c) =>
        bookSlot({
          stylistId,
          serviceId: service.id,
          startISO,
          customerUid: c.uid,
          customerPhone: c.phone,
        })
      )
    );
    const wins = raced.filter((r) => r.status === 'fulfilled');
    const losses = raced.filter(
      (r) => r.status === 'rejected' && r.reason instanceof AppError
    );
    raced.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') {
        created.push({
          appointmentId: outcome.value.appointmentId,
          uid: contenders[i].uid,
        });
      }
    });
    record(
      'identical-slot race → exactly one winner',
      wins.length === 1 && losses.length === 1,
      `${wins.length} booked, ${losses.length} rejected (${
        losses[0]?.status === 'rejected' ? (losses[0].reason as AppError).code : 'n/a'
      })`
    );

    // 4. THE OVERLAP: a different start time whose service overlaps the one just
    //    booked. Distinct doc IDs, so ONLY the slotLocks cells catch this.
    const overlapStart = parseSlotIso(startISO)!.plus({ minutes: 15 });
    const overlapUid = `${TEST_UID}-overlap`;
    let overlapCode = 'unexpectedly-succeeded';
    try {
      const appt = await bookSlot({
        stylistId,
        serviceId: service.id,
        startISO: toSlotIso(overlapStart),
        customerUid: overlapUid,
        customerPhone: '+15550000002',
      });
      created.push({ appointmentId: appt.appointmentId, uid: overlapUid });
    } catch (error) {
      overlapCode = error instanceof AppError ? error.code : 'unknown-error';
    }
    record(
      'overlapping-slot booking rejected (multi-cell locks)',
      overlapCode === 'already-exists',
      `+15min on the same stylist → ${overlapCode}`
    );

    // 5. The booked slot disappears from availability.
    const after = await computeAvailability(range);
    const stillOffered = after.days
      .find((d) => d.date === firstDay.date)
      ?.stylists.find((s) => s.stylistId === stylistId)
      ?.starts.includes(startISO);
    record(
      'booked slot removed from availability',
      stillOffered !== true,
      stillOffered ? 'still offered — availability and booking disagree' : 'gone'
    );

    // 6. Buffer is enforced: nothing may start inside duration + buffer.
    const blockedUntil = parseSlotIso(startISO)!.plus({
      minutes: service.durationMin + after.bufferMinutes,
    });
    const offendingStart = after.days
      .find((d) => d.date === firstDay.date)
      ?.stylists.find((s) => s.stylistId === stylistId)
      ?.starts.find((iso) => {
        const dt = parseSlotIso(iso)!;
        return dt >= parseSlotIso(startISO)! && dt < blockedUntil;
      });
    record(
      'cleanup buffer respected',
      offendingStart === undefined,
      offendingStart
        ? `${offendingStart} offered inside the buffer window`
        : `nothing offered before ${toSlotIso(blockedUntil)}`
    );
  } catch (error) {
    record(
      'fatal',
      false,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    // Leave the emulator as we found it so the test can be re-run.
    for (const { appointmentId, uid } of created) {
      await cancelAppointment({ appointmentId, customerUid: uid }).catch(() => {});
    }
  }

  const passed = steps.filter((s) => s.pass).length;
  return NextResponse.json(
    { ok: passed === steps.length, passed, total: steps.length, steps },
    { status: passed === steps.length ? 200 : 500 }
  );
}
