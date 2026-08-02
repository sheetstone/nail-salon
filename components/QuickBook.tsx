'use client';

import { useState } from 'react';

import { bookSlotAction, quickBookAction } from '@/app/actions/booking';
import type { BookingConfirmation, QuickBookResult } from '@/lib/types';
import { useAuth } from './AuthProvider';

const EXAMPLES = [
  'Gel manicure with anyone Friday afternoon',
  'Pedicure tomorrow morning',
  'Full set as early as possible this week',
];

/**
 * AI quick-book (DESIGN.md §9).
 *
 * Two distinct steps on purpose: quickBookAction asks Claude to PROPOSE (it only
 * has read-only tools), then Confirm calls the very same bookSlotAction the
 * manual flow uses. The model never touches the write path.
 */
export function QuickBook() {
  const { getIdToken } = useAuth();

  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<QuickBookResult | null>(null);
  const [confirmed, setConfirmed] = useState<BookingConfirmation | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(request: string) {
    const trimmed = request.trim();
    if (!trimmed) return;
    setThinking(true);
    setError(null);
    setResult(null);
    setConfirmed(null);

    const response = await quickBookAction({
      idToken: await getIdToken(),
      text: trimmed,
    });
    setThinking(false);
    if (!response.ok) {
      setError(response.message);
      return;
    }
    setResult(response.data);
  }

  async function confirm() {
    const proposal = result?.proposal;
    if (!proposal) return;
    setBooking(true);
    setError(null);

    const response = await bookSlotAction({
      idToken: await getIdToken(),
      stylistId: proposal.stylistId,
      serviceId: proposal.serviceId,
      startISO: proposal.startISO,
      source: 'quick-book',
    });
    setBooking(false);
    if (!response.ok) {
      setError(response.message);
      setResult(null);
      return;
    }
    setConfirmed(response.data);
  }

  if (confirmed) {
    return (
      <div className="card success">
        <h2>Booked</h2>
        <p className="big">
          {confirmed.serviceName} with {confirmed.stylistName}
        </p>
        <button
          className="ghost"
          onClick={() => {
            setConfirmed(null);
            setText('');
          }}
        >
          Ask for something else
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <h2>Quick book</h2>
        <p className="muted">Describe what you want in your own words.</p>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Book me a gel manicure Friday afternoon"
          maxLength={500}
          disabled={thinking}
        />
        <button className="primary" onClick={() => ask(text)} disabled={thinking || !text.trim()}>
          {thinking ? 'Looking for a time…' : 'Find me a time'}
        </button>

        <div className="examples">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              className="chip"
              disabled={thinking}
              onClick={() => {
                setText(example);
                void ask(example);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="card">
          <p className="big">{result.message}</p>
          {result.proposal ? (
            <>
              <dl className="proposal">
                <div>
                  <dt>Service</dt>
                  <dd>
                    {result.proposal.serviceName} ({result.proposal.durationMin} min)
                  </dd>
                </div>
                <div>
                  <dt>Stylist</dt>
                  <dd>{result.proposal.stylistName}</dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>{result.proposal.label}</dd>
                </div>
              </dl>
              <button className="primary" onClick={confirm} disabled={booking}>
                {booking ? 'Booking…' : 'Confirm this time'}
              </button>
              <button className="ghost" onClick={() => setResult(null)} disabled={booking}>
                No thanks
              </button>
            </>
          ) : (
            <p className="muted">
              Nothing to confirm — try rewording, or use the Book tab to pick a time yourself.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
