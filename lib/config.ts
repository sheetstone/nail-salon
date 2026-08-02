/**
 * Single-salon constants for the POC.
 *
 * If this ever becomes multi-tenant, every one of these moves onto a
 * `salons/{salonId}` document and every query gains a salonId filter. Do not
 * build that now — see DESIGN.md §2.
 */

/** The one hard-coded salon timezone. Shifts are stored in this wall clock. */
export const SALON_TZ = 'America/Los_Angeles';

/** Slot grid. Every bookable start time lands on a multiple of this. */
export const SLOT_MINUTES = 15;

/** Cleanup/turnover time reserved after every appointment. */
export const BUFFER_MINUTES = 15;

/** Don't offer slots that start sooner than this from now. */
export const MIN_LEAD_MINUTES = 30;

/** How far ahead availability may be requested, in days. */
export const MAX_RANGE_DAYS = 21;

/**
 * Model for the AI quick-book. Flash-tier: fast and cheap, which is what
 * intent extraction wants. $0.30 / $2.50 per 1M tokens, with a free tier.
 *
 * If tool-calling reliability disappoints (wrong serviceId, invented startISO),
 * step up to 'gemini-3.6-flash' — stronger on agentic/tool use, ~5x the price.
 */
export const QUICK_BOOK_MODEL = 'gemini-2.5-flash';

/** Hard ceiling on tool-use round trips, so a confused model cannot loop forever. */
export const QUICK_BOOK_MAX_TURNS = 6;

/** Days of availability the quick-book tool may scan. */
export const QUICK_BOOK_HORIZON_DAYS = 14;
