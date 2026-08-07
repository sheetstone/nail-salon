/**
 * Firestore is denormalized — no JOINs. Small read-often fields (stylist name,
 * service name, duration) are copied onto each appointment on purpose.
 * See CLAUDE.md "Core conventions".
 */

export type AppointmentStatus =
  | 'booked'
  | 'checked-in'
  | 'completed'
  | 'cancelled';

export type BookingSource = 'manual' | 'quick-book';

export interface Customer {
  /** E.164, e.g. "+15551234567". The verified login credential. */
  phone: string;
  name: string;
  createdAt: Date | null;
  lastVisitAt: Date | null;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  price: number;
}

export interface Stylist {
  id: string;
  name: string;
  active: boolean;
  serviceIds: string[];
  /** Short line under the name on the home screen, e.g. "Gel & acrylic". */
  specialty?: string;
}

/** Stored in salon-local wall-clock time, NOT UTC. */
export interface Shift {
  id: string;
  /** Salon-local calendar date, "yyyy-MM-dd". */
  date: string;
  /** Salon-local time, "HH:mm". */
  start: string;
  /** Salon-local time, "HH:mm". */
  end: string;
}

/** Document ID is `${stylistId}_${startISO}` — see lib/server/booking.ts. */
export interface Appointment {
  id: string;
  stylistId: string;
  stylistName: string;
  customerUid: string;
  customerPhone: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  /** UTC. */
  start: Date;
  /** UTC. */
  end: Date;
  status: AppointmentStatus;
  source: BookingSource;
  createdAt: Date | null;
  checkedInAt: Date | null;
}

// --- Availability payload (computed server-side, returned in one shot) -------

/** A UTC half-open interval, as canonical slot ISO strings. */
export interface IsoInterval {
  startISO: string;
  endISO: string;
}

export interface StylistAvailability {
  stylistId: string;
  stylistName: string;
  /** Denormalized onto the payload so the home screen needs no second read. */
  specialty: string | null;
  /** Canonical UTC slot ISO strings, ascending. */
  starts: string[];
  /**
   * The stylist's shift windows for this day.
   *
   * The timeline needs these to draw the day at all: without them it cannot
   * tell "no openings because fully booked" from "no openings because off",
   * and it has no axis to lay proportional blocks against. Availability
   * computes them anyway — see lib/server/availability.ts.
   */
  shifts: IsoInterval[];
  /**
   * Appointments already on the books, WITHOUT the cleanup buffer, so a
   * rendered "booked" block matches the real appointment a customer would
   * see. The buffer is applied when computing `starts`, not here.
   */
  busy: IsoInterval[];
}

export interface DayAvailability {
  /** Salon-local "yyyy-MM-dd". */
  date: string;
  stylists: StylistAvailability[];
}

export interface AvailabilityPayload {
  serviceId: string;
  serviceName: string;
  durationMin: number;
  price: number | null;
  timezone: string;
  slotMinutes: number;
  bufferMinutes: number;
  days: DayAvailability[];
}

// --- Quick-book -------------------------------------------------------------

export interface SlotProposal {
  stylistId: string;
  stylistName: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  /** Canonical UTC slot ISO. */
  startISO: string;
  /** Salon-local, human-readable, e.g. "Fri, Jul 31 at 2:00 PM". */
  label: string;
}

export interface QuickBookResult {
  /** Null when the model could not find anything that fits. */
  proposal: SlotProposal | null;
  /** Short message to show the customer alongside the proposal. */
  message: string;
}

export interface BookingConfirmation {
  appointmentId: string;
  stylistId: string;
  stylistName: string;
  serviceId: string;
  serviceName: string;
  durationMin: number;
  startISO: string;
  endISO: string;
  status: AppointmentStatus;
  source: BookingSource;
}

export interface CheckInResult {
  appointmentId: string;
  stylistName: string;
  serviceName: string;
  startISO: string;
  label: string;
}
