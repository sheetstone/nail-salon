'use client';

import { useCallback, useEffect, useState } from 'react';
import { DateTime } from 'luxon';

import { getAvailabilityAction, bookSlotAction, listServicesAction } from '@/app/actions/booking';
import { SALON_TZ } from '@/lib/config';
import { localDateLabel, slotIsoToLocalClock } from '@/lib/time';
import type { AvailabilityPayload, BookingConfirmation, Service } from '@/lib/types';
import { useAuth } from './AuthProvider';

/**
 * Manual booking (DESIGN.md §6.2, §6.3).
 *
 * One getAvailability call returns the whole week as a computed payload; the
 * client never reads slot documents. Tapping a slot calls bookSlotAction, which
 * runs the deterministic-ID transaction and may legitimately come back
 * 'already-exists' if someone else won the race — that is surfaced, not hidden.
 */
export function BookFlow() {
  const { getIdToken } = useAuth();

  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [availability, setAvailability] = useState<AvailabilityPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<BookingConfirmation | null>(null);

  // Step 1: the service, because slot length depends on durationMin.
  useEffect(() => {
    let cancelled = false;
    listServicesAction().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setServices(result.data);
      setServiceId((current) => current ?? result.data[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAvailability = useCallback(
    async (targetServiceId: string) => {
      setLoading(true);
      setError(null);
      const today = DateTime.now().setZone(SALON_TZ);
      const result = await getAvailabilityAction({
        idToken: await getIdToken(),
        serviceId: targetServiceId,
        startDate: today.toFormat('yyyy-MM-dd'),
        endDate: today.plus({ days: 6 }).toFormat('yyyy-MM-dd'),
      });
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        setAvailability(null);
        return;
      }
      setAvailability(result.data);
    },
    [getIdToken]
  );

  useEffect(() => {
    if (serviceId) void loadAvailability(serviceId);
  }, [serviceId, loadAvailability]);

  async function book(stylistId: string, startISO: string) {
    if (!serviceId) return;
    setPending(`${stylistId}_${startISO}`);
    setError(null);
    const result = await bookSlotAction({
      idToken: await getIdToken(),
      stylistId,
      serviceId,
      startISO,
      source: 'manual',
    });
    setPending(null);

    if (!result.ok) {
      setError(result.message);
      // Someone else took it (or a shift changed) — re-read the truth.
      if (result.code === 'already-exists' || result.code === 'failed-precondition') {
        void loadAvailability(serviceId);
      }
      return;
    }
    setConfirmed(result.data);
  }

  if (confirmed) {
    return (
      <div className="card success">
        <h2>You’re booked</h2>
        <p className="big">
          {confirmed.serviceName} with {confirmed.stylistName}
        </p>
        <p>
          {localDateLabel(
            DateTime.fromISO(confirmed.startISO).setZone(SALON_TZ).toFormat('yyyy-MM-dd')
          )}{' '}
          at {slotIsoToLocalClock(confirmed.startISO)}
        </p>
        <p className="muted">
          Scan the QR code at the front desk when you arrive to check in.
        </p>
        <button
          className="ghost"
          onClick={() => {
            setConfirmed(null);
            if (serviceId) void loadAvailability(serviceId);
          }}
        >
          Book another
        </button>
      </div>
    );
  }

  const daysWithOpenings = availability?.days.filter((d) => d.stylists.length > 0) ?? [];

  return (
    <div className="stack">
      <div className="card">
        <h2>Book a visit</h2>
        <label htmlFor="service">Service</label>
        <select
          id="service"
          value={serviceId ?? ''}
          onChange={(e) => setServiceId(e.target.value)}
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.durationMin} min · ${s.price}
            </option>
          ))}
        </select>
        {availability && (
          <p className="muted">
            On duty this week · times shown in {availability.timezone.replace('_', ' ')}
          </p>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Finding open times…</p>}

      {!loading && availability && daysWithOpenings.length === 0 && (
        <div className="card">
          <p>No openings for {availability.serviceName} in the next 7 days.</p>
          <p className="muted">Try a shorter service, or check back tomorrow.</p>
        </div>
      )}

      {!loading &&
        daysWithOpenings.map((day) => (
          <div className="card" key={day.date}>
            <h3>{localDateLabel(day.date)}</h3>
            {day.stylists.map((stylist) => (
              <div className="stylist-row" key={stylist.stylistId}>
                <div className="stylist-name">{stylist.stylistName}</div>
                <div className="slots">
                  {stylist.starts.map((startISO) => {
                    const key = `${stylist.stylistId}_${startISO}`;
                    return (
                      <button
                        key={key}
                        className="slot"
                        disabled={pending !== null}
                        onClick={() => book(stylist.stylistId, startISO)}
                      >
                        {pending === key ? '…' : slotIsoToLocalClock(startISO)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
