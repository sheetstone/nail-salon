'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import QRCode from 'qrcode';

import { firebaseDb } from '@/lib/firebase-client';
import { SALON_TZ } from '@/lib/config';
import { DateTime, salonDayBounds, salonToday } from '@/lib/time';
import type { AppointmentStatus } from '@/lib/types';

interface Row {
  id: string;
  stylistName: string;
  customerPhone: string;
  serviceName: string;
  start: Date;
  durationMin: number;
  status: AppointmentStatus;
  source: string;
}

/**
 * Owner dashboard on the owner's own tablet (DESIGN.md §6.5).
 *
 * Reads Firestore directly with onSnapshot — no polling — so a customer's QR
 * check-in lands here within a second. This is the one place the client SDK
 * reads appointments; the query is a single range on `start`, so it needs no
 * composite index, and status is filtered in memory.
 */
export function OwnerDashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [checkInUrl, setCheckInUrl] = useState('');
  const qrRendered = useRef(false);

  const today = salonToday();

  useEffect(() => {
    const { from, to } = salonDayBounds(today);
    const q = query(
      collection(firebaseDb(), 'appointments'),
      where('start', '>=', from),
      where('start', '<=', to),
      orderBy('start')
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              stylistName: String(data.stylistName ?? ''),
              customerPhone: String(data.customerPhone ?? ''),
              serviceName: String(data.serviceName ?? ''),
              start: data.start.toDate(),
              durationMin: Number(data.durationMin ?? 0),
              status: data.status as AppointmentStatus,
              source: String(data.source ?? 'manual'),
            };
          })
        );
        setError(null);
      },
      (err) => {
        console.error(err);
        setError('Lost the live connection. Reload to reconnect.');
      }
    );
    return unsubscribe;
  }, [today]);

  // The salon's one QR code. Print it, or leave this tab open on the counter.
  useEffect(() => {
    if (qrRendered.current) return;
    qrRendered.current = true;
    const url = `${window.location.origin}/checkin`;
    setCheckInUrl(url);
    QRCode.toDataURL(url, { width: 320, margin: 1 })
      .then(setQrDataUrl)
      .catch((err) => console.error('QR render failed', err));
  }, []);

  const visible = useMemo(
    () => rows.filter((r) => r.status !== 'cancelled'),
    [rows]
  );
  const checkedIn = visible.filter((r) => r.status === 'checked-in').length;

  return (
    <div className="stack">
      <div className="card">
        <h2>Today · {DateTime.fromISO(today, { zone: SALON_TZ }).toFormat('cccc, LLL d')}</h2>
        <p className="muted">
          {visible.length} appointment{visible.length === 1 ? '' : 's'} · {checkedIn} checked in
          · updates live
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {visible.length === 0 ? (
          <p className="muted">Nothing on the books today.</p>
        ) : (
          <table className="schedule">
            <thead>
              <tr>
                <th>Time</th>
                <th>Stylist</th>
                <th>Service</th>
                <th>Customer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className={row.status === 'checked-in' ? 'here' : undefined}>
                  <td>
                    {DateTime.fromJSDate(row.start).setZone(SALON_TZ).toFormat('h:mm a')}
                  </td>
                  <td>{row.stylistName}</td>
                  <td>
                    {row.serviceName}
                    {row.source === 'quick-book' && <span className="tag">AI</span>}
                  </td>
                  <td>{row.customerPhone}</td>
                  <td>
                    <span className={`status ${row.status}`}>{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card center">
        <h3>Check-in code</h3>
        <p className="muted">Customers scan this with their own phone camera.</p>
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt={`QR code linking to ${checkInUrl}`} width={240} height={240} />
        ) : (
          <p className="muted">Generating…</p>
        )}
        <p className="mono">{checkInUrl}</p>
      </div>
    </div>
  );
}
