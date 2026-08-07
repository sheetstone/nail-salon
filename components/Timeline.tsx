'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FunnelSimple } from '@phosphor-icons/react';

import { bookSlotAction, getAvailabilityAction } from '@/app/actions/booking';
import { SALON_TZ } from '@/lib/config';
import { DateTime, localDateLabel, parseSlotIso, slotIsoToLocalClock } from '@/lib/time';
import type {
  AvailabilityPayload,
  BookingConfirmation,
  IsoInterval,
  Service,
  StylistAvailability,
} from '@/lib/types';
import { useAuth } from './AuthProvider';

/**
 * The day as a timeline (design 2a, screen "2a Timeline").
 *
 * Replaces the old flat chip list. The point of the redesign is that you can
 * see the SHAPE of the day — what's taken and what's off-shift, not just what's
 * free — so blocks are laid out proportionally against a shared time axis.
 *
 * Geometry: every column shares one [dayStart, dayEnd] window derived from the
 * union of that day's shifts, and each block is positioned as a percentage of
 * it. That is why `AvailabilityPayload` carries `shifts` and `busy` — discrete
 * start times alone cannot express any of this.
 */

const HOUR_MS = 3_600_000;

interface Block {
  kind: 'open' | 'busy';
  start: DateTime;
  end: DateTime;
  /** Bookable grid starts inside this block (open blocks only). */
  starts: string[];
}

/** Splits one stylist's shift into alternating booked and free blocks. */
function buildBlocks(stylist: StylistAvailability): Block[] {
  const blocks: Block[] = [];

  for (const shift of stylist.shifts) {
    const shiftStart = parseSlotIso(shift.startISO);
    const shiftEnd = parseSlotIso(shift.endISO);
    if (!shiftStart || !shiftEnd) continue;

    const busy = stylist.busy
      .map((b) => ({ start: parseSlotIso(b.startISO), end: parseSlotIso(b.endISO) }))
      .filter((b): b is { start: DateTime; end: DateTime } => !!b.start && !!b.end)
      .filter((b) => b.end > shiftStart && b.start < shiftEnd)
      .sort((a, b) => a.start.toMillis() - b.start.toMillis());

    let cursor = shiftStart;
    for (const b of busy) {
      if (b.start > cursor) {
        blocks.push({ kind: 'open', start: cursor, end: b.start, starts: [] });
      }
      blocks.push({ kind: 'busy', start: b.start, end: b.end, starts: [] });
      cursor = b.end > cursor ? b.end : cursor;
    }
    if (cursor < shiftEnd) {
      blocks.push({ kind: 'open', start: cursor, end: shiftEnd, starts: [] });
    }
  }

  // Attach each bookable start to the open block that contains it. A free
  // window can hold several grid starts; the block surfaces them as chips.
  for (const iso of stylist.starts) {
    const dt = parseSlotIso(iso);
    if (!dt) continue;
    const host = blocks.find((b) => b.kind === 'open' && dt >= b.start && dt < b.end);
    if (host) host.starts.push(iso);
  }

  // An open window with no bookable start means the service does not fit —
  // show it as unavailable rather than teasing a gap that cannot be booked.
  return blocks.map((b) =>
    b.kind === 'open' && b.starts.length === 0 ? { ...b, kind: 'busy' as const } : b
  );
}

export function Timeline({
  service,
  services,
  onChangeService,
  onBooked,
  initialDate,
  initialStylistId,
}: {
  service: Service;
  services: Service[];
  onChangeService: (serviceId: string) => void;
  onBooked: (confirmation: BookingConfirmation) => void;
  initialDate?: string;
  initialStylistId?: string | null;
}) {
  const { getIdToken } = useAuth();

  const today = DateTime.now().setZone(SALON_TZ).toFormat('yyyy-MM-dd');
  const [date, setDate] = useState(initialDate ?? today);
  const [stylistFilter, setStylistFilter] = useState<string | null>(initialStylistId ?? null);
  const [payload, setPayload] = useState<AvailabilityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ stylist: StylistAvailability; iso: string } | null>(null);
  const [booking, setBooking] = useState(false);

  const dates = useMemo(() => {
    const base = DateTime.fromISO(today, { zone: SALON_TZ });
    return Array.from({ length: 7 }, (_, i) => base.plus({ days: i }).toFormat('yyyy-MM-dd'));
  }, [today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getAvailabilityAction({
      idToken: await getIdToken(),
      serviceId: service.id,
      startDate: dates[0],
      endDate: dates[dates.length - 1],
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      setPayload(null);
      return;
    }
    setPayload(result.data);
  }, [getIdToken, service.id, dates]);

  useEffect(() => {
    void load();
    setPicked(null);
  }, [load]);

  const day = payload?.days.find((d) => d.date === date);
  const columns = (day?.stylists ?? []).filter(
    (s) => !stylistFilter || s.stylistId === stylistFilter
  );

  // One shared axis for every column, so blocks line up across stylists.
  const axis = useMemo(() => {
    const all: IsoInterval[] = columns.flatMap((s) => s.shifts);
    if (all.length === 0) return null;
    const starts = all.map((s) => parseSlotIso(s.startISO)!).filter(Boolean);
    const ends = all.map((s) => parseSlotIso(s.endISO)!).filter(Boolean);
    const start = starts.reduce((a, b) => (a < b ? a : b));
    const end = ends.reduce((a, b) => (a > b ? a : b));
    return { start, end, ms: end.toMillis() - start.toMillis() };
  }, [columns]);

  const hourMarks = useMemo(() => {
    if (!axis) return [];
    const marks: DateTime[] = [];
    let cursor = axis.start.setZone(SALON_TZ).startOf('hour');
    if (cursor < axis.start) cursor = cursor.plus({ hours: 1 });
    while (cursor <= axis.end) {
      marks.push(cursor);
      cursor = cursor.plus({ hours: 1 });
    }
    return marks;
  }, [axis]);

  async function confirm() {
    if (!picked) return;
    setBooking(true);
    setError(null);
    const result = await bookSlotAction({
      idToken: await getIdToken(),
      stylistId: picked.stylist.stylistId,
      serviceId: service.id,
      startISO: picked.iso,
      source: 'manual',
    });
    setBooking(false);
    if (!result.ok) {
      setError(result.message);
      setPicked(null);
      // Someone else won the race, or a shift changed — re-read the truth.
      if (result.code === 'already-exists' || result.code === 'failed-precondition') {
        void load();
      }
      return;
    }
    onBooked(result.data);
  }

  const pickedEnd = picked
    ? parseSlotIso(picked.iso)!.plus({ minutes: service.durationMin })
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Header: date + stylist filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <button
          className="btn btn-icon"
          aria-label="Previous day"
          disabled={date === dates[0]}
          onClick={() => setDate(dates[Math.max(0, dates.indexOf(date) - 1)])}
        >
          <ArrowLeft size={18} />
        </button>
        <span style={{ fontSize: 15, fontWeight: 500, marginRight: 'auto' }}>
          {localDateLabel(date)}
        </span>
        <button
          className="btn btn-secondary"
          onClick={() => setStylistFilter(null)}
          style={{ gap: 6 }}
        >
          <FunnelSimple size={16} />
          {stylistFilter
            ? (day?.stylists.find((s) => s.stylistId === stylistFilter)?.stylistName ?? 'Anyone')
            : 'Anyone'}
        </button>
      </div>

      {/* Service context */}
      <div
        className="surface"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        <span
          style={{
            width: 8,
            height: 34,
            borderRadius: 4,
            background: 'var(--brand)',
            flex: 'none',
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{service.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-55)' }}>
            {service.durationMin} min · ${service.price}
          </div>
        </div>
        <select
          aria-label="Change service"
          value={service.id}
          onChange={(e) => onChangeService(e.target.value)}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--brand-text)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Date strip */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          paddingBottom: 2,
        }}
      >
        {dates.map((d) => {
          const dt = DateTime.fromISO(d, { zone: SALON_TZ });
          const active = d === date;
          return (
            <button
              key={d}
              onClick={() => {
                setDate(d);
                setPicked(null);
              }}
              style={{
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 12px',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
                background: active ? 'var(--brand)' : 'var(--card)',
                color: active ? 'var(--brand-on)' : 'var(--ink-58)',
                boxShadow: active ? 'none' : 'inset 0 0 0 1px var(--line)',
              }}
            >
              <span>{dt.toFormat('ccc')}</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{dt.toFormat('d')}</span>
            </button>
          );
        })}
      </div>

      {error && <p style={{ color: 'var(--ink)', fontWeight: 500 }}>{error}</p>}
      {loading && <p className="muted">Reading the day…</p>}

      {!loading && columns.length === 0 && (
        <div className="surface" style={{ padding: 'var(--space-6)' }}>
          <p style={{ margin: 0 }}>Nobody is working on {localDateLabel(date)}.</p>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Try another day from the strip above.
          </p>
        </div>
      )}

      {/* The grid */}
      {!loading && axis && columns.length > 0 && (
        <div
          className="surface"
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            padding: 'var(--space-3)',
            height: 380,
          }}
        >
          {/* Time gutter */}
          <div
            style={{
              position: 'relative',
              width: 42,
              flex: 'none',
              marginTop: 24,
              fontSize: 10,
              color: 'var(--ink-45)',
            }}
          >
            {hourMarks.map((m) => (
              <span
                key={m.toISO()}
                style={{
                  position: 'absolute',
                  top: `${((m.toMillis() - axis.start.toMillis()) / axis.ms) * 100}%`,
                  transform: 'translateY(-50%)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {m.setZone(SALON_TZ).toFormat(m.hour === 12 ? "h 'PM'" : 'h')}
              </span>
            ))}
          </div>

          {columns.map((stylist) => {
            const blocks = buildBlocks(stylist);
            return (
              <div
                key={stylist.stylistId}
                style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
              >
                <button
                  onClick={() =>
                    setStylistFilter(
                      stylistFilter === stylist.stylistId ? null : stylist.stylistId
                    )
                  }
                  style={{
                    height: 24,
                    fontSize: 12,
                    fontWeight: 500,
                    color:
                      stylistFilter === stylist.stylistId ? 'var(--brand-text)' : 'var(--ink)',
                    textAlign: 'left',
                    padding: 0,
                  }}
                >
                  {stylist.stylistName}
                </button>

                <div style={{ position: 'relative', flex: 1 }}>
                  {blocks.map((block, i) => {
                    const top =
                      ((block.start.toMillis() - axis.start.toMillis()) / axis.ms) * 100;
                    const height =
                      ((block.end.toMillis() - block.start.toMillis()) / axis.ms) * 100;
                    const isPicked =
                      picked?.stylist.stylistId === stylist.stylistId &&
                      block.starts.includes(picked.iso);

                    return (
                      <div
                        key={i}
                        style={{
                          position: 'absolute',
                          top: `${top}%`,
                          height: `calc(${height}% - 3px)`,
                          left: 0,
                          right: 0,
                          borderRadius: 'var(--radius-sm)',
                          overflow: 'hidden',
                          background:
                            block.kind === 'busy'
                              ? 'var(--taken)'
                              : isPicked
                                ? 'var(--brand)'
                                : 'var(--brand-tint)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                          padding: 3,
                        }}
                      >
                        {block.kind === 'busy' ? (
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--taken-text)',
                              padding: '1px 4px',
                            }}
                          >
                            {block.end.diff(block.start).as('hours') >= 0.5 ? 'booked' : ''}
                          </span>
                        ) : (
                          // Every bookable start inside this free window. A long
                          // gap holds several; showing only the first would hide
                          // most of the day's real availability.
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 2,
                              overflowY: 'auto',
                              scrollbarWidth: 'none',
                            }}
                          >
                            {block.starts.map((iso) => {
                              const on = picked?.iso === iso &&
                                picked.stylist.stylistId === stylist.stylistId;
                              return (
                                <button
                                  key={iso}
                                  onClick={() => setPicked({ stylist, iso })}
                                  style={{
                                    padding: '2px 5px',
                                    fontSize: 10,
                                    fontVariantNumeric: 'tabular-nums',
                                    borderRadius: 3,
                                    background: on ? 'var(--brand)' : 'transparent',
                                    color: on ? 'var(--brand-on)' : 'var(--brand-text)',
                                  }}
                                >
                                  {slotIsoToLocalClock(iso).replace(/\s?[AP]M$/, '')}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend — the design's three block states, named. */}
      {!loading && columns.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-4)',
            fontSize: 11,
            color: 'var(--ink-55)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: 'var(--brand-tint)',
              }}
            />
            Open
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--taken)' }}
            />
            Taken
          </span>
        </div>
      )}

      {/* Sticky picked-slot footer */}
      {picked && pickedEnd && (
        <div className="sticky-action">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {picked.stylist.stylistName} · {slotIsoToLocalClock(picked.iso)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-55)' }}>
              Ends {pickedEnd.setZone(SALON_TZ).toFormat('h:mm a')} · ${service.price}
            </div>
          </div>
          <button className="btn btn-primary" onClick={confirm} disabled={booking}>
            {booking ? 'Booking…' : 'Book this'}
          </button>
        </div>
      )}
    </div>
  );
}
