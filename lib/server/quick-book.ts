import 'server-only';

import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type Part,
} from '@google/genai';

import { computeAvailability, loadService, loadServices } from './availability';
import { AppError } from '../result';
import {
  QUICK_BOOK_HORIZON_DAYS,
  QUICK_BOOK_MAX_TURNS,
  QUICK_BOOK_MODEL,
  SALON_TZ,
} from '../config';
import { DateTime, humanLabel, parseSlotIso, salonToday } from '../time';
import type { QuickBookResult, SlotProposal } from '../types';

/**
 * AI quick-book (DESIGN.md §9), on the Gemini Developer API.
 *
 * The model gets READ-ONLY tools and proposes a slot. It never writes to
 * Firestore — the actual booking goes through the same bookSlot() transaction
 * after the customer taps Confirm, so the AI path inherits the identical
 * availability rules and double-booking guarantee as manual booking.
 *
 * `propose_slot` is a terminating function call rather than free text: a
 * structured argument object is far more reliable to validate than parsing a
 * sentence, and it keeps the model out of the write path just the same.
 */

const FUNCTIONS: FunctionDeclaration[] = [
  {
    name: 'list_services',
    description:
      'List every service the salon offers, with its duration in minutes and price. ' +
      'Call this first to map what the customer asked for onto a real serviceId.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'find_availability',
    description:
      'Find open appointment start times for a service over a salon-local date range. ' +
      'Call this when the user asks about times and you know which serviceId they want. ' +
      'Returns, per day, each available stylist and their open start times.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        serviceId: {
          type: Type.STRING,
          description: 'A serviceId returned by list_services.',
        },
        startDate: {
          type: Type.STRING,
          description: 'Salon-local start date, "yyyy-MM-dd", inclusive.',
        },
        endDate: {
          type: Type.STRING,
          description:
            'Salon-local end date, "yyyy-MM-dd", inclusive. Keep the range narrow — ' +
            'a few days at most unless the user was vague.',
        },
        stylistId: {
          type: Type.STRING,
          description:
            'Optional. Only when the customer named a specific stylist. Omit for "anyone".',
        },
      },
      required: ['serviceId', 'startDate', 'endDate'],
    },
  },
  {
    name: 'propose_slot',
    description:
      'Record the single best slot to offer the customer, and stop. ' +
      'This does NOT book anything — the customer still has to confirm. ' +
      'The startISO must be copied verbatim from a find_availability result.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        serviceId: { type: Type.STRING },
        stylistId: { type: Type.STRING },
        startISO: {
          type: Type.STRING,
          description:
            'Exactly as returned by find_availability, e.g. "2026-07-31T21:00:00Z".',
        },
        message: {
          type: Type.STRING,
          description:
            'One friendly sentence for the customer explaining the pick, in salon-local time.',
        },
      },
      required: ['serviceId', 'stylistId', 'startISO', 'message'],
    },
  },
];

function systemInstruction(): string {
  const now = DateTime.now().setZone(SALON_TZ);
  return [
    'You are the booking assistant for a single nail salon.',
    '',
    `The salon timezone is ${SALON_TZ}. Right now it is ${now.toFormat(
      "cccc, LLLL d yyyy 'at' h:mm a"
    )} salon-local.`,
    'Resolve relative dates ("tomorrow", "Friday afternoon", "next week") against that.',
    'Treat morning as 09:00–12:00, afternoon as 12:00–17:00, evening as 17:00 onward, all salon-local.',
    '',
    'Your job:',
    '1. Work out which service the customer wants (call list_services).',
    '2. Find open times (call find_availability with a narrow date range).',
    '3. Call propose_slot with the single best match, then stop.',
    '',
    'Rules:',
    '- Propose exactly one slot. The customer confirms before anything is booked.',
    '- Never invent a startISO. Copy one verbatim from find_availability output.',
    '- Prefer the earliest time that fits what the customer asked for.',
    '- If the customer named a stylist, honour it; otherwise any stylist is fine.',
    '- If nothing fits, do not call propose_slot. Reply with one sentence saying what ' +
      'is unavailable and suggest the nearest alternative you did see.',
    '- Keep any text you write to one or two short sentences. No preamble.',
  ].join('\n');
}

function genai(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Surfaced as a clean message rather than a 500 — the likeliest cause is a
    // missing Secret Manager grant or an absent .env.local entry.
    throw new AppError(
      'unavailable',
      'Quick-book is not configured yet. Ask the owner to set GEMINI_API_KEY.'
    );
  }
  return new GoogleGenAI({ apiKey });
}

/** Executes a read-only tool call and returns its result object for the model. */
async function runTool(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (name === 'list_services') {
    const services = await loadServices();
    return {
      services: services.map((s) => ({
        serviceId: s.id,
        name: s.name,
        durationMin: s.durationMin,
        price: s.price,
      })),
    };
  }

  if (name === 'find_availability') {
    const today = salonToday();
    const startDate = typeof args.startDate === 'string' ? args.startDate : today;
    const requestedEnd = typeof args.endDate === 'string' ? args.endDate : startDate;

    // Clamp the model's range so a hallucinated year cannot fan out into a
    // huge number of Firestore reads.
    const horizonEnd = DateTime.fromISO(today, { zone: SALON_TZ })
      .plus({ days: QUICK_BOOK_HORIZON_DAYS })
      .toFormat('yyyy-MM-dd');
    const clampedStart = startDate < today ? today : startDate;
    const clampedEnd = requestedEnd > horizonEnd ? horizonEnd : requestedEnd;

    const payload = await computeAvailability({
      serviceId: String(args.serviceId ?? ''),
      startDate: clampedStart,
      endDate: clampedEnd < clampedStart ? clampedStart : clampedEnd,
      stylistId: typeof args.stylistId === 'string' ? args.stylistId : null,
    });

    // Trim to what the model actually needs to choose a slot. Availability
    // payloads can be long, and every token here is an input token.
    return {
      serviceId: payload.serviceId,
      serviceName: payload.serviceName,
      durationMin: payload.durationMin,
      timezone: payload.timezone,
      days: payload.days
        .filter((d) => d.stylists.length > 0)
        .map((d) => ({
          date: d.date,
          stylists: d.stylists.map((s) => ({
            stylistId: s.stylistId,
            stylistName: s.stylistName,
            starts: s.starts.slice(0, 24),
          })),
        })),
    };
  }

  return { error: `Unknown tool "${name}".` };
}

/**
 * Validates a model proposal against real data before it is ever shown to the
 * customer. The model is not trusted to have copied a real slot.
 */
async function validateProposal(
  args: Record<string, unknown>
): Promise<SlotProposal | null> {
  const serviceId = typeof args.serviceId === 'string' ? args.serviceId : '';
  const stylistId = typeof args.stylistId === 'string' ? args.stylistId : '';
  const startISO = typeof args.startISO === 'string' ? args.startISO : '';

  const start = parseSlotIso(startISO);
  if (!serviceId || !stylistId || !start) return null;

  const service = await loadService(serviceId).catch(() => null);
  if (!service) return null;

  // Re-derive availability for just that day and confirm the slot is really open.
  const date = start.setZone(SALON_TZ).toFormat('yyyy-MM-dd');
  const payload = await computeAvailability({
    serviceId,
    startDate: date,
    endDate: date,
    stylistId,
  });

  const day = payload.days.find((d) => d.date === date);
  const stylist = day?.stylists.find((s) => s.stylistId === stylistId);
  // Compare on the canonical form so a model-supplied "+00:00" offset or stray
  // milliseconds still matches the slot we actually offer.
  const canonical = start.toUTC().startOf('second').toISO({ suppressMilliseconds: true });
  if (!stylist || !canonical || !stylist.starts.includes(canonical)) return null;

  return {
    stylistId,
    stylistName: stylist.stylistName,
    serviceId: service.id,
    serviceName: service.name,
    durationMin: service.durationMin,
    startISO: canonical,
    label: humanLabel(start),
  };
}

export async function quickBook(text: string): Promise<QuickBookResult> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AppError('invalid-argument', 'Tell me what you would like booked.');
  }
  if (trimmed.length > 500) {
    throw new AppError('invalid-argument', 'Please keep the request under 500 characters.');
  }

  const ai = genai();
  const contents: Content[] = [{ role: 'user', parts: [{ text: trimmed }] }];
  let lastText = '';

  for (let turn = 0; turn < QUICK_BOOK_MAX_TURNS; turn++) {
    const response = await ai.models.generateContent({
      model: QUICK_BOOK_MODEL,
      contents,
      config: {
        systemInstruction: systemInstruction(),
        tools: [{ functionDeclarations: FUNCTIONS }],
        maxOutputTokens: 2048, // deliberately small: the output is one function call
        // This is mechanical slot-matching, not reasoning. Thinking would add
        // latency and cost for no benefit on a latency-sensitive feature.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    if (response.text?.trim()) lastText = response.text.trim();

    const calls: FunctionCall[] = response.functionCalls ?? [];
    if (calls.length === 0) {
      // The model answered in prose — usually "nothing fits". No proposal.
      return {
        proposal: null,
        message:
          lastText ||
          'I could not find an opening for that. Try another day or a different service.',
      };
    }

    // propose_slot terminates the loop.
    const proposeCall = calls.find((c) => c.name === 'propose_slot');
    if (proposeCall) {
      const args = (proposeCall.args ?? {}) as Record<string, unknown>;
      const proposal = await validateProposal(args);
      const modelMessage = typeof args.message === 'string' ? args.message : '';

      if (!proposal) {
        return {
          proposal: null,
          message:
            'That time just filled up. Pick a slot from the booking screen and I will hold it.',
        };
      }
      return {
        proposal,
        message: modelMessage || `How about ${proposal.label} with ${proposal.stylistName}?`,
      };
    }

    // Otherwise run the read-only data tools and loop. Echo the model's own turn
    // back first, then answer every call it made.
    const modelTurn = response.candidates?.[0]?.content;
    contents.push(
      modelTurn ?? {
        role: 'model',
        parts: calls.map((c) => ({ functionCall: c })),
      }
    );

    const parts: Part[] = await Promise.all(
      calls.map(async (call) => {
        const name = call.name ?? 'unknown';
        try {
          const output = await runTool(name, (call.args ?? {}) as Record<string, unknown>);
          return { functionResponse: { id: call.id, name, response: output } };
        } catch (error) {
          const message =
            error instanceof AppError
              ? error.message
              : 'Tool failed. Try a different range.';
          return {
            functionResponse: { id: call.id, name, response: { error: message } },
          };
        }
      })
    );
    // All results for one model turn go back in a SINGLE user turn — splitting
    // them trains the model out of making parallel calls.
    contents.push({ role: 'user', parts });
  }

  return {
    proposal: null,
    message:
      lastText ||
      'I could not narrow that down. Try naming a day and a service, e.g. "gel manicure Friday afternoon".',
  };
}
