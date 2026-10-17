/**
 * Cancellation / refund maths for the PREVIEW booking engine (integer fils).
 *
 * Sources (research_notes/Short stay venue court booking flows/*.md):
 *   • Stays — Airbnb help 475: flexible (full refund until 24h before check-in, then the first
 *     night is kept), moderate (5 days; then 1 night + 50% of the other nights), limited
 *     (14 days full · 7–14 days 50% · under 7 none), firm (30 days full · 7–30 days 50% ·
 *     under 7 none), non-refundable (none). 24h grace: full refund within 24h of booking when
 *     check-in is at least 7 days away. Tourism Dirham is never kept (no nights stayed).
 *   • Venues — marketplace tiers + Dubai hotel practice (Sofitel / Emaar): venue_standard =
 *     full refund until 30 days, 50% until 14 days, then none; the holding deposit becomes
 *     non-refundable 48h after it is paid. venue_strict = holding deposit never refundable;
 *     60+ days: only the deposit is kept; 30–60 days: 50% (at least the deposit); under 30
 *     days: 100%.
 *   • Courts — court_24h: free until the club's freeCancelHours before the slot, then none.
 *   • Charters — charter_72h: ≥72h before departure 50% kept; inside 72h 100% kept. A weather /
 *     Coast Guard cancellation by the operator is a full refund (provider cancellation path).
 *   • Provider cancellations — always a full refund to the customer. Penalty note uses Airbnb
 *     help 990 tiers on (base + fees): 10% if more than 30 days out, 25% from 48h to 30 days,
 *     50% within 48h or after the start. No penalty for weather / Coast Guard cancellations or
 *     bookings that were never confirmed.
 *
 * Kept amounts are capped at what the customer has actually paid (the preview never charges
 * extra on cancellation).
 *
 * Direct-pay bookings (paymentMode 'direct'): UpNow holds no money, so refundFor returns the
 * same RefundQuote shape with refund 0 / kept 0 and the rule 'Refund is handled by the host
 * under their policy'; the policy text is still recorded on the cancellation event. A provider
 * cancellation just notes what the host must return themselves (no penalty in the preview).
 */
import type { Booking, CancellationPolicyId, PreviewListing, RefundQuote } from './types';
import { DAY_MS, HOUR_MS, formatAED, ms, netPaidFils, nightsBetween, pctOf } from './engine';

export const POLICY_LABEL: Record<CancellationPolicyId, string> = {
  flexible: 'Flexible',
  moderate: 'Moderate',
  limited: 'Limited',
  firm: 'Firm',
  non_refundable: 'Non-refundable',
  venue_standard: 'Venue standard',
  venue_strict: 'Venue strict',
  court_24h: 'Free cancellation up to 24h',
  charter_72h: 'Charter 72h',
};

/** One-line summary for listing pages ("Things to know"). */
export function policySummary(id: CancellationPolicyId, listing?: PreviewListing): string {
  switch (id) {
    case 'flexible': return 'Full refund until 24 hours before check-in.';
    case 'moderate': return 'Full refund until 5 days before check-in.';
    case 'limited': return 'Full refund until 14 days before check-in, 50% until 7 days, then non-refundable.';
    case 'firm': return 'Full refund until 30 days before check-in, 50% until 7 days, then non-refundable.';
    case 'non_refundable': return 'Non-refundable (full refund only within 24h of booking when check-in is 7+ days away).';
    case 'venue_standard': return 'Full refund until 30 days before the event, 50% until 14 days, then non-refundable. Holding deposit non-refundable 48h after payment.';
    case 'venue_strict': return 'Holding deposit non-refundable. 50% charged from 60 days before the event, 100% from 30 days.';
    case 'court_24h': {
      const h = listing?.model === 'court' ? listing.freeCancelHours : 24;
      return `Free cancellation until ${h} hours before the slot, then non-refundable.`;
    }
    case 'charter_72h': return '50% kept if cancelled 72 hours or more before departure, 100% inside 72 hours. Full refund if the operator cancels for weather or Coast Guard orders.';
  }
}

const STAY_POLICIES: CancellationPolicyId[] = ['flexible', 'moderate', 'limited', 'firm', 'non_refundable'];

function confirmedAt(b: Booking): number {
  const e = b.events.find((x) => x.type === 'confirmed');
  return e ? ms(e.at) : ms(b.createdAt);
}

function quote(paid: number, entitlement: number, rule: string): RefundQuote {
  const kept = Math.max(0, Math.min(paid, entitlement));
  return { refundFils: paid - kept, keptFils: kept, rule };
}

/** What the customer gets back if they cancel now. */
export const DIRECT_REFUND_RULE = 'Refund is handled by the host under their policy';

export function refundFor(b: Booking, listing: PreviewListing, now: number): RefundQuote {
  if (b.paymentMode === 'direct') return { refundFils: 0, keptFils: 0, rule: DIRECT_REFUND_RULE };
  const paid = netPaidFils(b);
  if (paid <= 0) return { refundFils: 0, keptFils: 0, rule: 'Nothing paid yet — cancel free of charge' };
  const start = ms(b.start);
  const hoursBefore = (start - now) / HOUR_MS;
  const daysBefore = (start - now) / DAY_MS;
  const policy = b.cancellation;
  const total = b.totalFils;

  if (STAY_POLICIES.includes(policy)) {
    const conf = confirmedAt(b);
    if (now - conf <= 24 * HOUR_MS && start - conf >= 7 * DAY_MS) {
      return quote(paid, 0, 'Cancelled within 24h of booking with check-in 7+ days away — full refund');
    }
    const taxes = b.lineItems.filter((l) => l.kind === 'tax').reduce((s, l) => s + l.fils, 0);
    const refundable = total - taxes; // Tourism Dirham is refunded: no nights stayed
    const nightsFils = b.lineItems.filter((l) => l.kind === 'base').reduce((s, l) => s + l.fils, 0);
    const nights = Math.max(1, nightsBetween(b.start, b.end));
    const oneNight = Math.round(nightsFils / nights);
    switch (policy) {
      case 'flexible':
        return hoursBefore >= 24
          ? quote(paid, 0, 'Flexible — cancelled 24h+ before check-in: full refund')
          : quote(paid, oneNight, `Flexible — under 24h before check-in: first night (${formatAED(oneNight)}) kept`);
      case 'moderate':
        return daysBefore >= 5
          ? quote(paid, 0, 'Moderate — cancelled 5+ days before check-in: full refund')
          : quote(paid, oneNight + pctOf(nightsFils - oneNight, 50), 'Moderate — under 5 days: 1 night + 50% of the other nights kept');
      case 'limited':
        if (daysBefore >= 14) return quote(paid, 0, 'Limited — cancelled 14+ days before check-in: full refund');
        if (daysBefore >= 7) return quote(paid, pctOf(refundable, 50), 'Limited — 7 to 14 days before check-in: 50% refund');
        return quote(paid, refundable, 'Limited — under 7 days before check-in: no refund (Tourism Dirham returned)');
      case 'firm':
        if (daysBefore >= 30) return quote(paid, 0, 'Firm — cancelled 30+ days before check-in: full refund');
        if (daysBefore >= 7) return quote(paid, pctOf(refundable, 50), 'Firm — 7 to 30 days before check-in: 50% refund');
        return quote(paid, refundable, 'Firm — under 7 days before check-in: no refund (Tourism Dirham returned)');
      default:
        return quote(paid, refundable, 'Non-refundable rate — no refund (Tourism Dirham returned)');
    }
  }

  const dep = b.payments.find((p) => p.id.endsWith('-dep') && p.status === 'paid');
  if (policy === 'venue_standard') {
    let kept = 0;
    let rule = 'Venue standard — 30+ days before the event: full refund';
    if (daysBefore < 14) { kept = total; rule = 'Venue standard — under 14 days before the event: no refund'; }
    else if (daysBefore < 30) { kept = pctOf(total, 50); rule = 'Venue standard — 14 to 30 days before the event: 50% refund'; }
    if (dep && dep.paidAt && now - ms(dep.paidAt) > 48 * HOUR_MS && dep.fils > kept) {
      kept = dep.fils;
      rule += '; holding deposit non-refundable (paid more than 48h ago)';
    }
    return quote(paid, kept, rule);
  }
  if (policy === 'venue_strict') {
    const depFils = dep?.fils ?? 0;
    if (daysBefore >= 60) return quote(paid, depFils, 'Venue strict — 60+ days before the event: holding deposit kept, rest refunded');
    if (daysBefore >= 30) return quote(paid, Math.max(depFils, pctOf(total, 50)), 'Venue strict — 30 to 60 days before the event: 50% kept (at least the deposit)');
    return quote(paid, total, 'Venue strict — under 30 days before the event: no refund');
  }
  if (policy === 'court_24h') {
    const free = listing.model === 'court' ? listing.freeCancelHours : 24;
    return hoursBefore >= free
      ? quote(paid, 0, `Cancelled ${free}h+ before the slot: full refund`)
      : quote(paid, total, `Under ${free}h before the slot: no refund`);
  }
  // charter_72h
  return hoursBefore >= 72
    ? quote(paid, pctOf(total, 50), 'Charter — 72h+ before departure: 50% of the charter value kept')
    : quote(paid, total, 'Charter — under 72h before departure: 100% kept');
}

export interface ProviderCancellation {
  refundFils: number;     // always everything the customer paid
  penaltyFils: number;    // noted against the provider (not charged in the preview)
  rule: string;
}

const WEATHER = /weather|coast ?guard|wind|storm|sandstorm|unsafe sea|rain/i;

export function providerCancellationFor(b: Booking, listing: PreviewListing, now: number, reason: string): ProviderCancellation {
  const refund = netPaidFils(b);
  if (b.paymentMode === 'direct') {
    return {
      refundFils: refund, penaltyFils: 0,
      rule: refund > 0
        ? `Paid directly — return the ${formatAED(refund)} you collected to the customer yourself; nothing was charged on UpNow`
        : 'Paid directly — nothing was collected, so there is nothing to refund',
    };
  }
  if (!b.events.some((e) => e.type === 'confirmed')) {
    return { refundFils: refund, penaltyFils: 0, rule: 'No provider penalty — the booking was not confirmed yet' };
  }
  if (WEATHER.test(reason) && (listing.model === 'charter' || listing.model === 'court' || listing.model === 'venue')) {
    return { refundFils: refund, penaltyFils: 0, rule: 'Weather / Coast Guard cancellation — full refund to the customer, no provider penalty' };
  }
  const base = b.lineItems.filter((l) => l.kind === 'base' || l.kind === 'fee').reduce((s, l) => s + l.fils, 0);
  const hoursBefore = (ms(b.start) - now) / HOUR_MS;
  let pct = 10;
  let when = 'more than 30 days before the start';
  if (hoursBefore < 48) { pct = 50; when = hoursBefore <= 0 ? 'after the start' : 'within 48h of the start'; }
  else if (hoursBefore <= 30 * 24) { pct = 25; when = '48h to 30 days before the start'; }
  const penalty = pctOf(base, pct);
  return { refundFils: refund, penaltyFils: penalty, rule: `Provider cancellation ${when}: penalty ${pct}% of base + fees = ${formatAED(penalty)} (noted; customer fully refunded)` };
}

/**
 * Date / slot changes requested by the customer are free until the policy's free-cancellation
 * cutoff (engine CHANGE rules). Returns that instant, or null when the policy has no free window
 * (non-refundable — changes are at the provider's discretion; the provider can still propose).
 *   flexible 24h · moderate 5d · limited 14d · firm 30d before check-in; venue_standard 30d,
 *   venue_strict 60d before the event; court_24h the club's freeCancelHours; charter_72h 72h.
 */
export function freeChangeCutoff(b: Pick<Booking, 'start' | 'cancellation'>, listing?: PreviewListing): number | null {
  const start = ms(b.start);
  if (!Number.isFinite(start)) return null;
  const H: Record<CancellationPolicyId, number | null> = {
    flexible: 24, moderate: 5 * 24, limited: 14 * 24, firm: 30 * 24, non_refundable: null,
    venue_standard: 30 * 24, venue_strict: 60 * 24,
    court_24h: listing?.model === 'court' ? listing.freeCancelHours : 24,
    charter_72h: 72,
  };
  const h = H[b.cancellation];
  return h == null ? null : start - h * HOUR_MS;
}
