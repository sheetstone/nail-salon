import { DateTime, Interval } from 'luxon';
import { SALON_TZ, SLOT_MINUTES } from './config';

/**
 * Time rules for the whole system (see CLAUDE.md "Core conventions"):
 *   - Anything persisted as a timestamp is UTC.
 *   - Shifts are salon-local wall clock ("2026-07-31" + "09:00").
 *   - Conversion happens here and nowhere else.
 *
 * This module is imported by both server actions and client components, so it
 * must stay free of firebase-admin and of anything Node-only.
 */

/** "2026-07-31" + "09:00" (salon-local) -> UTC DateTime. */
export function localWallClockToUtc(dateStr: string, timeStr: string): DateTime {
  const dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'yyyy-MM-dd HH:mm', {
    zone: SALON_TZ,
  });
  if (!dt.isValid) {
    throw new Error(`Invalid salon-local datetime: "${dateStr} ${timeStr}"`);
  }
  return dt.toUTC();
}

/** Salon-local calendar date ("2026-07-31") for a UTC instant. */
export function utcToLocalDate(dt: DateTime): string {
  return dt.setZone(SALON_TZ).toFormat('yyyy-MM-dd');
}

/** Salon-local wall clock ("14:15") for a UTC instant. */
export function utcToLocalTime(dt: DateTime): string {
  return dt.setZone(SALON_TZ).toFormat('HH:mm');
}

/**
 * Canonical UTC ISO string used in deterministic document IDs.
 * Second-precision, always ends in "Z" — e.g. "2026-07-31T14:00:00Z".
 * Firestore doc IDs may not contain "/", and this format never does.
 */
export function toSlotIso(dt: DateTime): string {
  const iso = dt.toUTC().startOf('second').toISO({ suppressMilliseconds: true });
  if (!iso) throw new Error('Cannot format an invalid DateTime as a slot ISO.');
  return iso;
}

/** Parse a slot ISO string back to a UTC DateTime, or null if malformed. */
export function parseSlotIso(iso: unknown): DateTime | null {
  if (typeof iso !== 'string') return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  return dt.isValid ? dt.startOf('second') : null;
}

/** True when the instant sits exactly on the slot grid (no stray seconds). */
export function isOnSlotGrid(dt: DateTime): boolean {
  return dt.second === 0 && dt.millisecond === 0 && dt.minute % SLOT_MINUTES === 0;
}

/** Round an instant up to the next slot-grid boundary. */
export function ceilToSlotGrid(dt: DateTime): DateTime {
  const floored = dt
    .startOf('minute')
    .minus({ minutes: dt.minute % SLOT_MINUTES });
  // floored <= dt always. They are equal only when dt already sits exactly on
  // the grid with no leftover seconds or milliseconds.
  return floored.equals(dt) ? floored : floored.plus({ minutes: SLOT_MINUTES });
}

/**
 * Every grid cell start covered by [start, end).
 * A 45-minute service on a 15-minute grid covers 3 cells; add the cleanup
 * buffer and it covers 4. The booking transaction claims all of them.
 */
export function slotCellsBetween(start: DateTime, end: DateTime): DateTime[] {
  const cells: DateTime[] = [];
  let cursor = start.toUTC();
  const limit = end.toUTC();
  // Guard against a pathological range producing an unbounded loop.
  let guard = 0;
  while (cursor < limit && guard++ < 500) {
    cells.push(cursor);
    cursor = cursor.plus({ minutes: SLOT_MINUTES });
  }
  return cells;
}

/** Half-open interval helper; luxon Intervals are already half-open. */
export function interval(start: DateTime, end: DateTime): Interval {
  return Interval.fromDateTimes(start, end);
}

/** Salon-local list of dates, inclusive, from a "yyyy-MM-dd" pair. */
export function localDateRange(startDateStr: string, endDateStr: string): string[] {
  const start = DateTime.fromISO(startDateStr, { zone: SALON_TZ });
  const end = DateTime.fromISO(endDateStr, { zone: SALON_TZ });
  if (!start.isValid || !end.isValid || end < start) return [];
  const dates: string[] = [];
  let cursor = start.startOf('day');
  const last = end.startOf('day');
  while (cursor <= last) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

/** Start/end UTC bounds covering a salon-local date range, inclusive. */
export function localRangeToUtcBounds(
  startDateStr: string,
  endDateStr: string
): { from: DateTime; to: DateTime } {
  const start = DateTime.fromISO(startDateStr, { zone: SALON_TZ }).startOf('day');
  const end = DateTime.fromISO(endDateStr, { zone: SALON_TZ }).endOf('day');
  return { from: start.toUTC(), to: end.toUTC() };
}

/** Today, in the salon's timezone — not the viewer's. */
export function salonToday(): string {
  return DateTime.now().setZone(SALON_TZ).toFormat('yyyy-MM-dd');
}

/** UTC bounds of one salon-local day. */
export function salonDayBounds(dateStr: string): { from: Date; to: Date } {
  const start = DateTime.fromISO(dateStr, { zone: SALON_TZ }).startOf('day');
  return { from: start.toUTC().toJSDate(), to: start.endOf('day').toUTC().toJSDate() };
}

/** Human label for a proposal, in salon-local time. "Fri, Jul 31 at 2:00 PM". */
export function humanLabel(dt: DateTime): string {
  return dt.setZone(SALON_TZ).toFormat("ccc, LLL d 'at' h:mm a");
}

/** "2:00 PM" in salon-local time, from a canonical slot ISO. */
export function slotIsoToLocalClock(iso: string): string {
  const dt = parseSlotIso(iso);
  return dt ? dt.setZone(SALON_TZ).toFormat('h:mm a') : iso;
}

/** "Fri, Jul 31" from a salon-local "yyyy-MM-dd". */
export function localDateLabel(dateStr: string): string {
  const dt = DateTime.fromISO(dateStr, { zone: SALON_TZ });
  return dt.isValid ? dt.toFormat('ccc, LLL d') : dateStr;
}

export { DateTime };
