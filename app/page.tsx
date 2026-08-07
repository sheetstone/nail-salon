'use client';

import { useEffect, useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';

import { listServicesAction } from '@/app/actions/booking';
import { AppShell } from '@/components/AppShell';
import { Home } from '@/components/Home';
import { Timeline } from '@/components/Timeline';
import { SALON_TZ } from '@/lib/config';
import { DateTime, localDateLabel, slotIsoToLocalClock } from '@/lib/time';
import type { BookingConfirmation, Service } from '@/lib/types';

/**
 * The Book tab. Two views, not two tabs (design 2a): home is the entry, and
 * the timeline is what you drop into — from a stylist card, from "All
 * stylists", or from the AI's "See the day".
 */

type View =
  | { name: 'home' }
  | { name: 'timeline'; serviceId: string; stylistId?: string | null; date?: string }
  | { name: 'booked'; confirmation: BookingConfirmation };

export default function BookPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [view, setView] = useState<View>({ name: 'home' });
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listServicesAction().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setServices(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const service =
    view.name === 'timeline'
      ? (services.find((s) => s.id === view.serviceId) ?? services[0])
      : services[0];

  return (
    <AppShell title="Book a visit">
      {loadError && <p style={{ fontWeight: 500 }}>{loadError}</p>}

      {view.name === 'home' && (
        <Home
          services={services}
          onSeeTheDay={({ serviceId, stylistId, date }) =>
            setView({
              name: 'timeline',
              serviceId: serviceId ?? services[0]?.id ?? '',
              stylistId: stylistId ?? null,
              date,
            })
          }
          onBooked={(confirmation) => setView({ name: 'booked', confirmation })}
        />
      )}

      {view.name === 'timeline' && service && (
        <Timeline
          service={service}
          services={services}
          initialDate={view.date}
          initialStylistId={view.stylistId}
          onChangeService={(serviceId) => setView({ ...view, serviceId })}
          onBooked={(confirmation) => setView({ name: 'booked', confirmation })}
        />
      )}

      {view.name === 'booked' && (
        <div
          className="surface"
          style={{
            padding: 'var(--space-8)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            alignItems: 'flex-start',
          }}
        >
          <CheckCircle size={28} color="var(--brand)" weight="fill" />
          <h2 style={{ margin: 0 }}>You&rsquo;re booked</h2>
          <div style={{ fontSize: 15 }}>
            {view.confirmation.serviceName} with {view.confirmation.stylistName}
          </div>
          <div className="muted" style={{ margin: 0 }}>
            {localDateLabel(
              DateTime.fromISO(view.confirmation.startISO, { zone: 'utc' })
                .setZone(SALON_TZ)
                .toFormat('yyyy-MM-dd')
            )}{' '}
            at {slotIsoToLocalClock(view.confirmation.startISO)}
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Scan the code at the front desk when you arrive.
          </p>
          <button className="btn btn-secondary" onClick={() => setView({ name: 'home' })}>
            Done
          </button>
        </div>
      )}
    </AppShell>
  );
}
