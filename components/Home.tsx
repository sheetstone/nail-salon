'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowCounterClockwise, ArrowRight, CaretRight, Sparkle } from '@phosphor-icons/react';

import {
  bookSlotAction,
  getAvailabilityAction,
  getLastVisitAction,
  quickBookAction,
} from '@/app/actions/booking';
import { SALON_TZ } from '@/lib/config';
import { DateTime } from '@/lib/time';
import type { BookingConfirmation, QuickBookResult, Service } from '@/lib/types';
import { useAuth } from './AuthProvider';

/**
 * Home (design 2a, screen "2a Home").
 *
 * The structural change from the old build: quick-book is no longer a second
 * tab, it is the top of the screen. A customer's first interaction is meant to
 * be typing what they want, with the slot grid as the fallback rather than the
 * default.
 */

interface LastVisit {
  serviceId: string;
  serviceName: string;
  stylistId: string;
  stylistName: string;
  price: number | null;
}

interface StylistToday {
  stylistId: string;
  stylistName: string;
  specialty: string | null;
  hours: string | null;
  open: number;
}

export function Home({
  services,
  onSeeTheDay,
  onBooked,
}: {
  services: Service[];
  /** Deep-link into the timeline, optionally pre-filtered. */
  onSeeTheDay: (opts: { serviceId?: string; stylistId?: string; date?: string }) => void;
  onBooked: (confirmation: BookingConfirmation) => void;
}) {
  const { getIdToken } = useAuth();

  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [proposal, setProposal] = useState<QuickBookResult | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lastVisit, setLastVisit] = useState<LastVisit | null>(null);
  const [stylists, setStylists] = useState<StylistToday[] | null>(null);

  const today = DateTime.now().setZone(SALON_TZ).toFormat('yyyy-MM-dd');

  /**
   * "Who's in today" needs an open-count per stylist, which is service-
   * dependent. The design shows no service picker here, so we count against
   * the shortest service — the most permissive measure of "has time free".
   * One availability call, reduced client-side; not one call per stylist.
   */
  const loadToday = useCallback(async () => {
    const basis = services[0];
    if (!basis) return;

    const idToken = await getIdToken();
    const [availability, visit] = await Promise.all([
      getAvailabilityAction({ idToken, serviceId: basis.id, startDate: today, endDate: today }),
      getLastVisitAction({ idToken }),
    ]);

    if (availability.ok) {
      const day = availability.data.days.find((d) => d.date === today);
      setStylists(
        (day?.stylists ?? []).map((s) => {
          const shift = s.shifts[0];
          const fmt = (iso: string) =>
            DateTime.fromISO(iso, { zone: 'utc' }).setZone(SALON_TZ).toFormat('h a');
          return {
            stylistId: s.stylistId,
            stylistName: s.stylistName,
            specialty: s.specialty,
            hours: shift ? `${fmt(shift.startISO)}–${fmt(shift.endISO)}` : null,
            open: s.starts.length,
          };
        })
      );
    }
    if (visit.ok) setLastVisit(visit.data);
  }, [getIdToken, services, today]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  async function ask() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setThinking(true);
    setError(null);
    setProposal(null);

    const result = await quickBookAction({ idToken: await getIdToken(), text: trimmed });
    setThinking(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setProposal(result.data);
  }

  async function confirmProposal() {
    const p = proposal?.proposal;
    if (!p) return;
    setBooking(true);
    setError(null);
    const result = await bookSlotAction({
      idToken: await getIdToken(),
      stylistId: p.stylistId,
      serviceId: p.serviceId,
      startISO: p.startISO,
      source: 'quick-book',
    });
    setBooking(false);
    if (!result.ok) {
      setError(result.message);
      setProposal(null);
      return;
    }
    onBooked(result.data);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* 1 — AI entry */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <form
          className="surface"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: '10px var(--space-4)',
          }}
        >
          <Sparkle size={17} color="var(--brand)" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="gel mani friday pm with anyone"
            maxLength={500}
            disabled={thinking}
            aria-label="Describe the appointment you want"
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              font: 'inherit',
              fontSize: 14,
              color: 'var(--ink)',
              outline: 'none',
              minWidth: 0,
            }}
          />
          <button
            type="submit"
            className="btn btn-icon"
            aria-label="Find a time"
            disabled={thinking || !text.trim()}
            style={{ width: 28, height: 28, color: 'var(--brand)' }}
          >
            <ArrowRight size={16} />
          </button>
        </form>

        {thinking && <p className="muted">Looking for a time…</p>}
        {error && <p style={{ fontWeight: 500 }}>{error}</p>}

        {proposal && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--card-radius)',
              background: 'var(--brand-wash)',
            }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.45 }}>{proposal.message}</div>
            {proposal.proposal && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={confirmProposal} disabled={booking}>
                  {booking
                    ? 'Booking…'
                    : `Book ${DateTime.fromISO(proposal.proposal.startISO, { zone: 'utc' })
                        .setZone(SALON_TZ)
                        .toFormat('h:mm a')}`}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    onSeeTheDay({
                      serviceId: proposal.proposal!.serviceId,
                      stylistId: proposal.proposal!.stylistId,
                      date: DateTime.fromISO(proposal.proposal!.startISO, { zone: 'utc' })
                        .setZone(SALON_TZ)
                        .toFormat('yyyy-MM-dd'),
                    })
                  }
                >
                  See the day
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2 — Repeat last visit */}
      {lastVisit && (
        <button
          className="surface"
          onClick={() =>
            onSeeTheDay({ serviceId: lastVisit.serviceId, stylistId: lastVisit.stylistId })
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-4)',
            textAlign: 'left',
          }}
        >
          <ArrowCounterClockwise size={20} color="var(--brand)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Book last visit again</div>
            <div style={{ fontSize: 12, color: 'var(--ink-55)' }}>
              {lastVisit.serviceName} with {lastVisit.stylistName}
              {lastVisit.price !== null && ` · $${lastVisit.price}`}
            </div>
          </div>
          <CaretRight size={16} color="var(--ink-40)" />
        </button>
      )}

      {/* 3 — Who's in today */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Who&rsquo;s in today</h2>
          <button
            onClick={() => onSeeTheDay({})}
            style={{ fontSize: 13, color: 'var(--brand-text)', padding: 0 }}
          >
            All stylists
          </button>
        </div>

        {stylists === null && <p className="muted">Checking the floor…</p>}
        {stylists?.length === 0 && (
          <div className="surface" style={{ padding: 'var(--space-4)' }}>
            <p className="muted" style={{ margin: 0 }}>
              Nobody is in today. Tap <strong>All stylists</strong> to see the rest of the week.
            </p>
          </div>
        )}

        {stylists?.map((s) => (
          <button
            key={s.stylistId}
            className="surface"
            onClick={() => onSeeTheDay({ stylistId: s.stylistId, date: today })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                flex: 'none',
                borderRadius: '50%',
                background: 'var(--brand-tint)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--brand-text)',
              }}
            >
              {s.stylistName.charAt(0)}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>
                {s.stylistName}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-55)' }}>
                {[s.specialty, s.hours].filter(Boolean).join(' · ') || 'On shift today'}
              </span>
            </span>
            <span className={s.open === 0 ? 'chip chip-quiet' : 'chip'}>
              {s.open === 0 ? 'Full' : `${s.open} open`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
