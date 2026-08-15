/**
 * Public booking flow — /services/book/[code] (SP Sprint 2, SCRUM-402/405).
 *
 * Justlife / Urban Company checkout: a step-by-step TIMELINE on the left —
 * only the current step is expanded, completed steps collapse to a recap
 * with Edit, upcoming steps stay locked on a connected rail. Sticky summary
 * on the right with the service photo, itemized pricing + VAT breakdown,
 * inline sign-in (email → OTP, registers new customers) at the END, then
 * payment. Server-side pricing is authoritative on submit; quote-mode
 * services submit without payment. All data from GET /api/catalog/public.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  BadgeCheck, CalendarDays, Check, CheckCircle2, Clock, Loader2,
  MapPin, ShieldCheck, AlarmClockCheck, SlidersHorizontal, Lock, Sparkles, Pencil, Info, X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SiteHeader } from '@/components/upnow/SiteHeader';
import { Footer } from '@/components/upnow/Footer';
import { serviceImg } from '@/lib/serviceImages';
import { AddressMapPicker, type PickedAddress } from '@/components/upnow/AddressMapPicker';

interface Pkg { id: number; name: string; basePrice: number | null; estimatedDuration: number | null; estimatedDurationMax: number | null }
interface SvcAddon { id: number; code: string; name: string; price: number; priceUnit: string }
interface Svc {
  id: number; code: string; name: string; description: string | null;
  priceUnit: string; pricingMode: string; basePrice: number | null; isFromPrice: boolean;
  isEmergency: boolean; estimatedDuration: number | null; estimatedDurationMax: number | null;
  packageGroupLabel: string | null;
  quantityLabel: string | null;
  quantityMin: number;
  quantityMax: number | null;
  addons: SvcAddon[];
  packages: Pkg[];
  imageUrl?: string | null;
  /** SP-135: this service's RESOLVED terms (platform matrix ⊕ its own override) — what the booking is snapshotted under. */
  cancellationPolicy?: CancellationPolicy | null;
}
interface Cat { id: number; code: string; name: string; services: Svc[] }
interface CancelTier { minHoursBefore: number; feePct: number }
interface CancellationPolicy { reschedule: CancelTier[]; cancel: CancelTier[]; noShowFeePct: number; noShowGraceMinutes?: number; source?: 'platform' | 'service'; note?: string }

const HOUR_OPTIONS = [2, 3, 4, 6, 8];
const SLOT_HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 08:00–20:00
const EMIRATES = [{ value: 'dubai', label: 'Dubai' }]; // pilot launch area (sp_launch policy)

const GREEN = 'var(--green)';
const LINE = 'var(--line)';
const TINT = 'var(--green-tint)';   // selected surfaces (matches .l-catchip.active)
const GREEN_DD = 'var(--green-dd)'; // selected text, per theme

/** UAE statutory VAT. Catalog prices are VAT-INCLUSIVE (platform policy) —
 *  this rate is used only to DISPLAY the tax split; the charged total is
 *  unchanged. See docs/PAYMENTS_REFERENCE.md before touching money logic. */
const VAT_RATE = 0.05;

const fmtAed = (n: number) => n.toLocaleString('en-AE');
const fmtAed2 = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function durText(min: number | null, max: number | null): string | null {
  if (!min) return null;
  const f = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);
  return max && max !== min ? `${f(min)}–${f(max)}` : f(min);
}

/** Human rows for a fee-tier ladder; concrete datetimes once a slot is set. */
function tierRows(tiers: CancelTier[], word: string, slot: Date | null): string[] {
  const sorted = [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  const fmtD = (d: Date) =>
    d.toLocaleString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const minus = (d: Date, h: number) => new Date(d.getTime() - h * 3_600_000);
  return sorted.map((t, i) => {
    const upper = i > 0 ? sorted[i - 1].minHoursBefore : null;
    if (t.feePct === 0) {
      return slot
        ? `Free ${word} until ${fmtD(minus(slot, t.minHoursBefore))}`
        : `Free ${word} up to ${t.minHoursBefore}h before the visit`;
    }
    if (t.minHoursBefore === 0) return `${t.feePct}% fee within ${upper}h of the visit`;
    return `${t.feePct}% fee ${t.minHoursBefore}–${upper}h before`;
  });
}

/** Compact policy link — opens the terms in a popup instead of inline. */
function TermsLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold hover:underline"
      style={{ color: GREEN_DD }}
    >
      <Info size={13} /> {label}
    </button>
  );
}

/** Themed popup for policy terms. */
function PolicyModal({ title, rows, onClose }: { title: string; rows: string[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bk-body w-full max-w-md rounded-[18px] bg-white overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <h3 className="text-[15px] font-bold inline-flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <Info size={15} style={{ color: GREEN_DD }} /> {title}
          </h3>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--mute)' }}><X size={17} /></button>
        </div>
        <ul className="px-5 py-4 space-y-2.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              <span className="w-1.5 h-1.5 rounded-full mt-[7px] flex-shrink-0" style={{ background: GREEN }} />
              {r}
            </li>
          ))}
        </ul>
        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
            style={{ background: GREEN }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

type StepKey = 'customize' | 'schedule' | 'address';

export default function BookServicePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { user, register, login, verifyLoginOtp } = useAuth();

  const [svc, setSvc] = useState<Svc | null>(null);
  const [catName, setCatName] = useState<string>('');
  const [catCode, setCatCode] = useState<string>('');
  const [cancelPolicy, setCancelPolicy] = useState<CancellationPolicy | null>(null);
  const [loading, setLoading] = useState(true);

  // selections
  const [pkgId, setPkgId] = useState<number | null>(null);
  const [hours, setHours] = useState<number>(2);
  const [qty, setQty] = useState<number>(1);
  const [addonIds, setAddonIds] = useState<Set<number>>(new Set());
  const [day, setDay] = useState<string>('');
  const [hour, setHour] = useState<number | null>(null);
  const [pin, setPin] = useState<PickedAddress | null>(null);
  const [addrDetails, setAddrDetails] = useState(''); // flat / villa / floor / access
  const [landmark, setLandmark] = useState('');       // nearby landmark (Gulf-style addressing)
  const [emirate, setEmirate] = useState('dubai');
  const [notes, setNotes] = useState('');

  // timeline
  const [policyModal, setPolicyModal] = useState<'pricing' | 'cancel' | 'visit' | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);

  // auth gate
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [authPhase, setAuthPhase] = useState<'idle' | 'otp' | 'busy'>('idle');
  const [devOtp, setDevOtp] = useState<string | null>(null);

  // submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<{ id: number; total: number | null; quote: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/catalog/public')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { categories?: Cat[]; policies?: { cancellationPolicy?: CancellationPolicy | null } }) => {
        setCancelPolicy(d.policies?.cancellationPolicy ?? null);
        for (const c of d.categories ?? []) {
          const found = c.services.find((s) => s.code === code);
          if (found) {
            setSvc(found); setCatName(c.name); setCatCode(c.code);
            // The service's own resolved terms win over the platform matrix (SP-135).
            if (found.cancellationPolicy) setCancelPolicy(found.cancellationPolicy);
            if (found.quantityLabel) setQty(found.quantityMin || 1);
            return;
          }
        }
        setSvc(null);
      })
      .catch(() => setSvc(null))
      .finally(() => setLoading(false));
  }, [code]);

  const days = useMemo(() => {
    const out: { value: string; wd: string; num: string; mon: string }[] = [];
    const now = new Date();
    for (let i = 1; i <= 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        wd: d.toLocaleDateString('en-AE', { weekday: 'short' }),
        num: String(d.getDate()),
        mon: d.toLocaleDateString('en-AE', { month: 'short' }),
      });
    }
    return out;
  }, []);

  const isQuote = svc?.pricingMode === 'quote';
  const isHourly = svc?.priceUnit === 'per_hour';
  const hasLadder = (svc?.packages.length ?? 0) > 0;
  const chosenPkg = svc?.packages.find((p) => p.id === pkgId) ?? null;
  const hasOptionsStep = Boolean(svc && (hasLadder || isHourly || svc.quantityLabel || (!isQuote && svc.addons.length > 0)));

  /** Ordered steps for this service — the timeline. */
  const steps: StepKey[] = useMemo(
    () => (hasOptionsStep ? ['customize', 'schedule', 'address'] : ['schedule', 'address']),
    [hasOptionsStep],
  );

  /* Itemized display estimate — the server recomputes authoritatively on submit. */
  const lineItems = useMemo(() => {
    if (!svc || isQuote) return [];
    const q = svc.quantityLabel ? qty : 1;
    const items: { label: string; amount: number | null }[] = [];
    if (isHourly) {
      const rate = chosenPkg?.basePrice ?? svc.basePrice ?? 0;
      items.push({
        label: `${svc.name} · ${hours}h${q > 1 ? ` × ${q} ${svc.quantityLabel!.toLowerCase()}` : ''}`,
        amount: rate * hours * q,
      });
    } else if (chosenPkg) {
      items.push({
        label: `${chosenPkg.name}${q > 1 ? ` × ${q}` : ''}`,
        amount: chosenPkg.basePrice != null ? chosenPkg.basePrice * q : null,
      });
    } else if (!hasLadder) {
      items.push({
        label: `${svc.name}${q > 1 ? ` × ${q}` : ''}`,
        amount: svc.basePrice != null ? svc.basePrice * q : null,
      });
    }
    for (const a of svc.addons) {
      if (!addonIds.has(a.id)) continue;
      const amt = a.priceUnit === 'per_hour' ? a.price * (isHourly ? hours : 1) : a.price;
      items.push({ label: a.name, amount: amt });
    }
    return items;
  }, [svc, isQuote, isHourly, chosenPkg, hours, hasLadder, qty, addonIds]);

  const estimate = useMemo(() => {
    if (!svc || isQuote || lineItems.length === 0) return null;
    if (lineItems.some((i) => i.amount == null)) return null;
    return lineItems.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  }, [svc, isQuote, lineItems]);

  /* Display-only VAT split of the inclusive total. */
  const vatSplit = useMemo(() => {
    if (estimate == null) return null;
    const net = estimate / (1 + VAT_RATE);
    return { net, vat: estimate - net };
  }, [estimate]);

  const optionsDone = Boolean(svc) && (!hasLadder || isHourly || pkgId != null);
  const scheduleDone = Boolean(day) && hour != null;
  const address = pin
    ? [addrDetails.trim(), landmark.trim() ? `Near ${landmark.trim()}` : '', pin.address].filter(Boolean).join(' — ')
    : '';
  const inServiceArea = pin == null || pin.emirate == null || EMIRATES.some((e) => e.value === pin.emirate);
  const addressDone = pin != null && address.trim().length >= 8 && inServiceArea;
  const selectionsComplete = optionsDone && scheduleDone && addressDone;
  const missing = !optionsDone
    ? `Choose ${svc?.packageGroupLabel?.toLowerCase() ?? 'an option'} to continue`
    : !scheduleDone ? 'Pick a date and time' : !addressDone ? (pin && !inServiceArea ? 'We currently serve Dubai only' : 'Pin your location') : null;

  const stepDone: Record<StepKey, boolean> = { customize: optionsDone, schedule: scheduleDone, address: addressDone };
  const stepContinueOk: Record<StepKey, boolean> = stepDone;

  const slotDate = useMemo(
    () => (day && hour != null ? new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`) : null),
    [day, hour],
  );

  const dayLabel = useMemo(() => {
    const d = days.find((x) => x.value === day);
    return d ? `${d.wd} ${d.num} ${d.mon}` : '';
  }, [days, day]);

  /** One-line recap shown when a step is collapsed-done. */
  const qtyWord = (n: number, label: string) => `${n} ${n === 1 ? label.toLowerCase().replace(/s$/, '') : label.toLowerCase()}`;
  const stepRecap: Record<StepKey, string> = {
    customize: [
      chosenPkg?.name ?? (isHourly ? `${hours} hours` : svc?.name ?? ''),
      svc?.quantityLabel ? qtyWord(qty, svc.quantityLabel) : '',
      addonIds.size ? `${addonIds.size} add-on${addonIds.size > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' · '),
    schedule: scheduleDone ? `${dayLabel} · ${String(hour).padStart(2, '0')}:00` : '',
    address: address ? `${address}${emirate ? ` — ${EMIRATES.find((e) => e.value === emirate)?.label ?? emirate}` : ''}` : '',
  };

  const onPinChange = (picked: PickedAddress) => {
    setPin(picked);
    if (picked.emirate && EMIRATES.some((e) => e.value === picked.emirate)) setEmirate(picked.emirate);
  };

  const goContinue = (idx: number) => {
    const next = Math.min(idx + 1, steps.length);
    setMaxReached((m) => Math.max(m, next));
    setActiveStep(next); // steps.length ⇒ everything collapsed, focus on summary
    // Let the next step mount, then glide to it (summary card if we're done).
    setTimeout(() => {
      document.getElementById(next < steps.length ? `bk-step-${next}` : 'bk-summary')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  const isCustomer = user?.role === 'customer';

  /* ── inline auth (cookie session; registers new customers on the fly) ── */
  const startAuth = async () => {
    setError(null);
    setAuthPhase('busy');
    try {
      await register('customer', { email: email.trim() });
      setAuthPhase('idle'); // session cookie set; user context refreshes
    } catch {
      try {
        const res = await login(email.trim());
        setDevOtp(res.devOtp ?? null);
        setAuthPhase('otp');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not sign you in');
        setAuthPhase('idle');
      }
    }
  };
  const confirmOtp = async () => {
    setError(null);
    setAuthPhase('busy');
    try {
      await verifyLoginOtp(email.trim(), otp.trim());
      setAuthPhase('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code');
      setAuthPhase('otp');
    }
  };

  /* ── submit: create → (pay) → confirm ── */
  const submit = async () => {
    if (!svc || !selectionsComplete || hour == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const scheduledAt = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString();
      const createRes = await fetch('/api/bookings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: svc.id,
          variantId: !isHourly && pkgId != null ? pkgId : undefined,
          hours: isHourly ? hours : undefined,
          quantity: svc.quantityLabel ? qty : undefined,
          addonIds: addonIds.size ? [...addonIds] : undefined,
          scheduledAt,
          addressText: address.trim(),
          addressLat: pin?.lat,
          addressLng: pin?.lng,
          emirate,
          notes: notes.trim() || undefined,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created?.message ?? 'Could not create the booking');

      if (isQuote) {
        setConfirmedBooking({ id: created.id, total: null, quote: true });
        return;
      }
      const payRes = await fetch(`/api/bookings/${created.id}/pay`, {
        method: 'POST',
        credentials: 'include',
      });
      const paid = await payRes.json();
      if (!payRes.ok) throw new Error(paid?.message ?? 'Payment failed');
      setConfirmedBooking({ id: created.id, total: created.totalAmount ?? estimate, quote: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── render ── */
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: GREEN }} />
        <span className="text-sm" style={{ color: 'var(--mute)' }}>Loading service…</span>
      </div>
    );
  }
  if (!svc) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          This service isn&apos;t available right now.
        </p>
        <Link href="/services" className="text-sm font-semibold" style={{ color: GREEN }}>
          Browse all services
        </Link>
      </div>
    );
  }

  if (confirmedBooking) {
    return (
      <div className="min-h-screen" style={{ background: '#fff' }}>
        <SiteHeader />
        <div className="min-h-[70vh] flex items-center justify-center px-6">
          <div className="max-w-md w-full text-center rounded-[18px] border bg-white p-10" style={{ borderColor: LINE, boxShadow: 'var(--shadow-card)' }}>
            <div className="w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: '#d8f2e8' }}>
              <CheckCircle2 size={30} style={{ color: '#1a7a5a' }} />
            </div>
            <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--ink)' }}>
              {confirmedBooking.quote ? 'Quote request received' : 'Booking confirmed'}
            </h1>
            <p className="text-sm mb-1" style={{ color: 'var(--mute)' }}>
              Reference <b>BK-{confirmedBooking.id}</b>
            </p>
            <p className="text-sm mb-6" style={{ color: 'var(--mute)' }}>
              {confirmedBooking.quote
                ? 'A professional will assess the job and you’ll receive a quote to approve — you pay only after approving it.'
                : `Paid AED ${confirmedBooking.total != null ? fmtAed(Number(confirmedBooking.total)) : '—'} (VAT included). We’ll assign a professional and keep you posted.`}
            </p>
            <button
              type="button"
              onClick={() => router.push('/dashboard/customer/services')}
              className="w-full rounded-xl px-5 py-3 text-sm font-semibold text-white"
              style={{ background: GREEN }}
            >
              Track my bookings
            </button>
          </div>
        </div>
      </div>
    );
  }

  const svcDur = durText(svc.estimatedDuration, svc.estimatedDurationMax)
    ?? durText(chosenPkg?.estimatedDuration ?? null, chosenPkg?.estimatedDurationMax ?? null);

  /* ── Step bodies (rendered only when a step is expanded) ── */
  const stepBody: Record<StepKey, React.ReactNode> = {
    customize: (
      <>
        {hasLadder && !isHourly && (
          <div className="mb-5">
            <p className="text-[12px] font-semibold mb-2.5" style={{ color: 'var(--mute)' }}>{svc.packageGroupLabel ?? 'Choose an option'}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {svc.packages.map((p) => {
                const on = pkgId === p.id;
                const d = durText(p.estimatedDuration, p.estimatedDurationMax);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPkgId(p.id)}
                    className="bk-tile relative rounded-[14px] border-2 px-4 py-3.5 text-left"
                    style={{
                      borderColor: on ? GREEN : LINE,
                      background: on ? TINT : '#fff',
                      boxShadow: on ? 'var(--shadow-card)' : 'none',
                    }}
                  >
                    {on && (
                      <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: GREEN }}>
                        <Check size={12} style={{ color: '#fff' }} />
                      </span>
                    )}
                    <span className="block text-sm font-semibold pr-6" style={{ color: 'var(--ink)' }}>{p.name}</span>
                    <span className="flex items-baseline gap-2 mt-1.5">
                      <span className="text-[15px] font-bold" style={{ color: on ? GREEN_DD : 'var(--ink)' }}>
                        {p.basePrice != null ? `AED ${fmtAed(Number(p.basePrice))}` : '—'}
                      </span>
                      {d && <span className="text-[11px]" style={{ color: 'var(--mute)' }}>~{d}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isHourly && (
          <div className="mb-5">
            <p className="text-[12px] font-semibold mb-2.5" style={{ color: 'var(--mute)' }}>How many hours?</p>
            <div className="flex gap-2 flex-wrap">
              {HOUR_OPTIONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHours(h)}
                  className="bk-tile w-[54px] h-12 rounded-[14px] border-2 text-sm font-bold"
                  style={{
                    borderColor: hours === h ? GREEN : LINE,
                    background: hours === h ? TINT : '#fff',
                    color: hours === h ? GREEN_DD : 'var(--ink-2)',
                    boxShadow: hours === h ? 'var(--shadow-card)' : 'none',
                  }}
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>
        )}

        {svc.quantityLabel && (
          <div className="mb-5">
            <p className="text-[12px] font-semibold mb-2.5" style={{ color: 'var(--mute)' }}>How many {svc.quantityLabel.toLowerCase()}?</p>
            <div className="inline-flex items-center rounded-[14px] border-2 overflow-hidden" style={{ borderColor: LINE }}>
              <button
                type="button"
                onClick={() => setQty(Math.max(svc.quantityMin || 1, qty - 1))}
                className="w-11 h-11 text-lg font-bold transition-colors hover:bg-[#f1faf5]"
                style={{ color: 'var(--mute)' }}
              >−</button>
              <span className="text-base font-bold w-12 text-center tabular-nums" style={{ color: 'var(--ink)' }}>{qty}</span>
              <button
                type="button"
                onClick={() => setQty(Math.min(svc.quantityMax ?? 99, qty + 1))}
                className="w-11 h-11 text-lg font-bold transition-colors hover:bg-[#f1faf5]"
                style={{ color: GREEN }}
              >+</button>
            </div>
            <span className="ml-3 text-[11px]" style={{ color: 'var(--mute)' }}>
              {svc.quantityMin || 1}–{svc.quantityMax ?? '∞'} {svc.quantityLabel.toLowerCase()}
            </span>
          </div>
        )}

        {!isQuote && svc.addons.length > 0 && (
          <div>
            <p className="text-[12px] font-semibold mb-2.5 inline-flex items-center gap-1.5" style={{ color: 'var(--mute)' }}>
              <Sparkles size={12} style={{ color: GREEN }} /> Popular add-ons
            </p>
            <div className="space-y-2">
              {svc.addons.map((a) => {
                const on = addonIds.has(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAddonIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                      return next;
                    })}
                    className="bk-tile w-full flex items-center justify-between rounded-[14px] border-2 px-4 py-3 text-left"
                    style={{
                      borderColor: on ? GREEN : LINE,
                      background: on ? TINT : '#fff',
                    }}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="w-5 h-5 rounded-md flex items-center justify-center border-2 transition-colors"
                        style={{ borderColor: on ? GREEN : LINE, background: on ? GREEN : '#fff' }}
                      >{on && <Check size={12} style={{ color: '#fff' }} />}</span>
                      <span className="text-sm font-medium" style={{ color: 'var(--ink-2)' }}>{a.name}</span>
                    </span>
                    <span className="text-sm font-bold whitespace-nowrap" style={{ color: on ? GREEN_DD : 'var(--ink)' }}>
                      +AED {fmtAed(a.price)}{a.priceUnit === 'per_hour' ? '/hr' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </>
    ),
    schedule: (
      <>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {days.map((d) => {
            const on = day === d.value;
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => setDay(d.value)}
                className="bk-tile flex flex-col items-center justify-center w-[62px] h-[72px] rounded-[14px] border-2 flex-shrink-0"
                style={{
                  borderColor: on ? GREEN : LINE,
                  background: on ? TINT : '#fff',
                  boxShadow: on ? 'var(--shadow-card)' : 'none',
                }}
              >
                <span className="text-[10px] font-semibold uppercase" style={{ color: on ? GREEN_DD : 'var(--mute)' }}>{d.wd}</span>
                <span className="text-lg font-bold leading-tight tabular-nums" style={{ color: on ? GREEN_DD : 'var(--ink)' }}>{d.num}</span>
                <span className="text-[10px]" style={{ color: 'var(--mute)' }}>{d.mon}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[12px] font-semibold mt-3 mb-2" style={{ color: 'var(--mute)' }}>Start time</p>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {SLOT_HOURS.map((h) => {
            const on = hour === h;
            return (
              <button
                key={h}
                type="button"
                onClick={() => setHour(h)}
                className="bk-tile py-2.5 rounded-xl border-2 text-[12.5px] font-semibold tabular-nums"
                style={{
                  borderColor: on ? GREEN : LINE,
                  background: on ? TINT : '#fff',
                  color: on ? GREEN_DD : 'var(--mute)',
                }}
              >
                {String(h).padStart(2, '0')}:00
              </button>
            );
          })}
        </div>
      </>
    ),
    address: (
      <>
        <AddressMapPicker value={pin} onChange={onPinChange} />

        {/* Confirmed location */}
        {pin && (
          <div
            className="bk-recap flex items-start gap-2.5 rounded-[14px] px-4 py-3 mt-3 border"
            style={inServiceArea
              ? { background: TINT, borderColor: 'transparent' }
              : { background: '#fffbeb', borderColor: '#fde68a' }}
          >
            <MapPin size={15} className="mt-0.5 flex-shrink-0" style={{ color: inServiceArea ? GREEN_DD : '#b45309' }} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-snug" style={{ color: inServiceArea ? GREEN_DD : '#92400e' }}>
                {pin.address}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: inServiceArea ? 'var(--mute)' : '#b45309' }}>
                {inServiceArea
                  ? `${EMIRATES.find((e) => e.value === (pin.emirate ?? emirate))?.label ?? 'Dubai'} — in our service area`
                  : 'We currently serve Dubai only — move the pin to a Dubai address'}
              </p>
            </div>
            {inServiceArea && <Check size={15} className="flex-shrink-0 mt-0.5" style={{ color: GREEN_DD }} />}
          </div>
        )}

        {/* Door details — the pin finds the building, these find the door */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <p className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--mute)' }}>
              Apartment / villa &amp; floor <span className="font-normal">(optional)</span>
            </p>
            <input
              value={addrDetails}
              onChange={(e) => setAddrDetails(e.target.value)}
              placeholder="e.g. Apt 1204, Tower 2, 12th floor"
              className="rounded-xl border-2 px-4 py-3 text-sm outline-none w-full transition-colors focus:border-[#2e9f82]"
              style={{ borderColor: LINE }}
            />
          </div>
          <div>
            <p className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--mute)' }}>
              Nearby landmark <span className="font-normal">(optional)</span>
            </p>
            <input
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              placeholder="e.g. Near Spinneys, opposite ENOC"
              className="rounded-xl border-2 px-4 py-3 text-sm outline-none w-full transition-colors focus:border-[#2e9f82]"
              style={{ borderColor: LINE }}
            />
          </div>
        </div>
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--mute)' }}>
          The pin finds your building — these help the professional find your door.
        </p>
        <div className="mt-3">
          <p className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--mute)' }}>
            Notes for the professional <span className="font-normal">(optional)</span>
          </p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Parking, pets, access instructions…"
            rows={2}
            className="rounded-xl border-2 px-4 py-3 text-sm outline-none w-full transition-colors focus:border-[#2e9f82]"
            style={{ borderColor: LINE }}
          />
        </div>
      </>
    ),
  };

  const stepMeta: Record<StepKey, { title: string; icon: React.ElementType; continueLabel: string; policy: 'pricing' | 'cancel' | 'visit'; policyLabel: string }> = {
    customize: { title: 'Customize your service', icon: SlidersHorizontal, continueLabel: 'Continue to date & time', policy: 'pricing', policyLabel: 'Pricing terms' },
    schedule: { title: 'Pick a date & time', icon: CalendarDays, continueLabel: 'Continue to address', policy: 'cancel', policyLabel: 'Cancellation policy' },
    address: { title: 'Where should we come?', icon: MapPin, continueLabel: isQuote ? 'Review request' : 'Review & pay', policy: 'visit', policyLabel: 'Visit terms' },
  };

  return (
    <div className="min-h-screen" style={{ background: '#fff' }}>
      <SiteHeader />
      {/* Hero band — same lst-hero as /services and /listings */}
      <section className="lst-hero">
        <div className="l-wrap">
          <nav className="crumb">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Link href="/">Home</Link></span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span className="sep">/</span><Link href="/services">Services</Link>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span className="sep">/</span><span className="here">{svc.name}</span>
            </span>
          </nav>
          <div className="lst-head">
            <h1>{svc.name}</h1>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[13px] flex-wrap" style={{ color: 'var(--mute)' }}>
            {svc.isEmergency && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                <AlarmClockCheck size={11} /> 24/7
              </span>
            )}
            {svc.description && <span>{svc.description}</span>}
            {svcDur && <span className="inline-flex items-center gap-1"><Clock size={12} /> ~{svcDur}</span>}
            <span className="inline-flex items-center gap-1"><BadgeCheck size={12} style={{ color: GREEN }} /> Vetted &amp; licensed</span>
          </div>
        </div>
      </section>

      <div className="l-wrap" style={{ paddingTop: 28, paddingBottom: 72 }}>
        {/* ── Two columns: timeline left, sticky summary right ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_384px] gap-7 items-start">

          {/* LEFT — step-by-step timeline (one step open at a time) */}
          <div className="min-w-0 relative">
            {/* connector rail */}
            <div className="absolute left-[15px] top-5 bottom-8 w-px" style={{ background: LINE }} />

            {steps.map((key, idx) => {
              // Progressive reveal — a step only appears once the previous
              // one is completed (never show upcoming steps).
              if (idx > maxReached) return null;
              const meta = stepMeta[key];
              const state: 'active' | 'done' = idx === activeStep ? 'active' : 'done';
              const clickable = state === 'done';
              const Icon = meta.icon;
              return (
                <div key={key} id={`bk-step-${idx}`} className="bk-step relative pl-11 mb-4">
                  {/* timeline node */}
                  <span
                    className={`absolute left-0 top-4 w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold border-2 bg-white z-10 transition-colors${state === 'done' ? ' bk-node-done' : ''}`}
                    style={state === 'done'
                      ? { background: GREEN, borderColor: GREEN, color: '#fff' }
                      : { borderColor: GREEN, color: GREEN_DD }}
                  >
                    {state === 'done' ? <Check size={14} /> : idx + 1}
                  </span>

                  {/* card */}
                  <div
                    className="rounded-[18px] border bg-white transition-all"
                    style={{
                      borderColor: state === 'active' ? GREEN : LINE,
                      boxShadow: state === 'active' ? 'var(--shadow-card)' : 'none',
                    }}
                  >
                    {/* header */}
                    <button
                      type="button"
                      onClick={() => clickable && setActiveStep(idx)}
                      className="w-full flex items-center gap-2.5 px-5 py-4 text-left"
                      style={{ cursor: clickable ? 'pointer' : 'default' }}
                    >
                      <span className="text-[15px] font-bold flex-1 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                        {meta.title}
                        <Icon size={15} style={{ color: 'var(--mute)' }} />
                      </span>
                      {state === 'done' && (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: GREEN_DD }}>
                          <Pencil size={12} /> Edit
                        </span>
                      )}
                    </button>

                    {/* collapsed recap */}
                    {state === 'done' && stepRecap[key] && (
                      <p className="bk-recap px-5 pb-4 -mt-1 text-[13px] truncate" style={{ color: 'var(--mute)' }}>
                        {stepRecap[key]}
                      </p>
                    )}

                    {/* expanded body */}
                    {state === 'active' && (
                      <div className="bk-body px-5 pb-5">
                        {stepBody[key]}
                        <div className="mt-5 pt-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop: '1px solid var(--line-2, #eff2ef)' }}>
                          <button
                            type="button"
                            disabled={!stepContinueOk[key]}
                            onClick={() => goContinue(idx)}
                            className="rounded-xl px-6 py-3 text-sm font-bold text-white transition-opacity"
                            style={{ background: GREEN, opacity: stepContinueOk[key] ? 1 : 0.45 }}
                          >
                            {meta.continueLabel}
                          </button>
                          {(meta.policy !== 'cancel' || cancelPolicy) && (
                            <TermsLink label={meta.policyLabel} onClick={() => setPolicyModal(meta.policy)} />
                          )}
                        </div>
                        {!stepContinueOk[key] && (
                          <p className="mt-2 text-[12px]" style={{ color: 'var(--mute)' }}>
                            {key === 'customize' ? `Choose ${svc.packageGroupLabel?.toLowerCase() ?? 'an option'} first` : key === 'schedule' ? 'Pick a date and a start time' : 'Search or drop the pin on your location'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* RIGHT — sticky summary, sign-in, payment */}
          <aside id="bk-summary" className="lg:sticky lg:top-24">
            <div className="rounded-[18px] border bg-white overflow-hidden" style={{ borderColor: LINE, boxShadow: 'var(--shadow-card)' }}>
              {/* Service photo header */}
              <div className="relative h-28">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={serviceImg(svc.code, catCode, 0, svc.imageUrl)}
                  alt={svc.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(14,26,22,0) 0%, rgba(14,26,22,.72) 100%)' }} />
                <div className="absolute bottom-3 left-4 right-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,.75)' }}>{catName}</p>
                  <p className="text-[15px] font-bold text-white leading-tight">{svc.name}</p>
                </div>
              </div>

              <div className="p-5">
                {/* Line items */}
                {isQuote ? (
                  <div className="rounded-xl px-4 py-3 mb-4 text-[13px]" style={{ background: 'var(--green-tint-2)', color: 'var(--mute)' }}>
                    Free assessment visit — a professional inspects the job and you approve a quote before any work starts.
                  </div>
                ) : (
                  <div className="space-y-2 mb-3">
                    {lineItems.length === 0 && (
                      <p className="text-xs" style={{ color: 'var(--mute)' }}>
                        Select {svc.packageGroupLabel?.toLowerCase() ?? 'your options'} to see the price.
                      </p>
                    )}
                    {lineItems.map((li, i) => (
                      <div key={li.label + i} className="bk-recap flex items-baseline justify-between gap-3 text-[13px]">
                        <span style={{ color: 'var(--mute)' }}>{li.label}</span>
                        <span className="font-semibold whitespace-nowrap tabular-nums" style={{ color: 'var(--ink-2)' }}>
                          {li.amount != null ? `AED ${fmtAed(li.amount)}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Schedule + address recap */}
                {(day || address) && (
                  <div className="space-y-1.5 mb-4 pt-3 text-xs" style={{ borderTop: `1px dashed var(--line)`, color: 'var(--mute)' }}>
                    {day && hour != null && (
                      <p className="inline-flex items-center gap-1.5 w-full">
                        <CalendarDays size={12} style={{ color: GREEN }} /> {dayLabel} · {String(hour).padStart(2, '0')}:00
                      </p>
                    )}
                    {address && <p className="inline-flex items-start gap-1.5 w-full"><MapPin size={12} className="mt-0.5 flex-shrink-0" style={{ color: GREEN }} /> {address}</p>}
                  </div>
                )}

                {/* Totals — subtotal / VAT / total (prices are VAT-inclusive) */}
                {!isQuote && (
                  <>
                    <div className="pt-3 space-y-1.5" style={{ borderTop: `1px solid var(--line)` }}>
                      <div className="flex items-baseline justify-between text-[12.5px]">
                        <span style={{ color: 'var(--mute)' }}>Subtotal (excl. VAT)</span>
                        <span className="tabular-nums" style={{ color: 'var(--ink-2)' }}>
                          {vatSplit ? `AED ${fmtAed2(vatSplit.net)}` : '—'}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between text-[12.5px]">
                        <span style={{ color: 'var(--mute)' }}>VAT ({Math.round(VAT_RATE * 100)}%)</span>
                        <span className="tabular-nums" style={{ color: 'var(--ink-2)' }}>
                          {vatSplit ? `AED ${fmtAed2(vatSplit.vat)}` : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between py-3 mt-2" style={{ borderTop: `1px solid var(--line)` }}>
                      <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Total</span>
                      <span key={estimate ?? -1} className="bk-total-flash text-[22px] font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                        {estimate != null ? `AED ${fmtAed(Number(estimate))}` : '—'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPolicyModal('cancel')}
                      className="inline-flex items-center gap-1 text-[11px] mb-4 hover:underline"
                      style={{ color: 'var(--mute)' }}
                    >
                      <Info size={11} />
                      {(() => {
                        const free = cancelPolicy ? [...cancelPolicy.cancel].sort((a, b) => b.minHoursBefore - a.minHoursBefore).find((t) => t.feePct === 0) : null;
                        return free ? `Free cancellation up to ${free.minHoursBefore} hours before your slot` : 'Cancellation policy';
                      })()}
                    </button>
                  </>
                )}

                {/* Sign-in — the LAST step, after details are captured */}
                {!user && selectionsComplete && (
                  <div className="bk-body rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--green-tint-2)' }}>
                    <p className="text-xs font-semibold mb-2.5 inline-flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
                      <Lock size={12} /> Almost done — verify your email to confirm
                    </p>
                    {authPhase !== 'otp' ? (
                      <div className="flex gap-2">
                        <input
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@email.com"
                          type="email"
                          className="flex-1 min-w-0 rounded-xl border px-3.5 py-2.5 text-sm outline-none"
                          style={{ borderColor: LINE, background: '#fff' }}
                        />
                        <button
                          type="button"
                          disabled={!email.includes('@') || authPhase === 'busy'}
                          onClick={startAuth}
                          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white flex-shrink-0"
                          style={{ background: GREEN, opacity: authPhase === 'busy' ? 0.6 : 1 }}
                        >
                          {authPhase === 'busy' ? <Loader2 size={15} className="animate-spin" /> : 'Continue'}
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap items-center">
                        <input
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          placeholder="6-digit code"
                          inputMode="numeric"
                          className="w-32 rounded-xl border px-3.5 py-2.5 text-sm outline-none tracking-widest"
                          style={{ borderColor: LINE, background: '#fff' }}
                        />
                        <button
                          type="button"
                          disabled={otp.trim().length !== 6}
                          onClick={confirmOtp}
                          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                          style={{ background: GREEN }}
                        >
                          Verify
                        </button>
                        {devOtp && (
                          <span className="text-[11px]" style={{ color: 'var(--mute)' }}>dev code: {devOtp}</span>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] mt-2" style={{ color: 'var(--mute)' }}>
                      New here? We&apos;ll create your account automatically — no forms.
                    </p>
                  </div>
                )}
                {user && isCustomer && (
                  <p className="text-xs rounded-xl px-3.5 py-2.5 mb-4 inline-flex items-center gap-1.5 w-full" style={{ background: 'var(--green-tint)', color: GREEN_DD }}>
                    <BadgeCheck size={13} /> Booking as {user.email ?? 'your account'}
                  </p>
                )}
                {user && !isCustomer && (
                  <p className="text-xs rounded-xl px-4 py-3 mb-4" style={{ background: '#fffbeb', color: '#92400e' }}>
                    You&apos;re signed in as a {user.role.replace('_', ' ')} — bookings are made from customer accounts.
                  </p>
                )}

                {error && (
                  <p className="text-xs rounded-xl px-4 py-3 mb-4" style={{ background: '#fef2f2', color: '#b91c1c' }}>{error}</p>
                )}

                <button
                  type="button"
                  disabled={!selectionsComplete || !isCustomer || submitting}
                  onClick={submit}
                  className="w-full rounded-xl px-5 py-4 text-[15px] font-bold text-white inline-flex items-center justify-center gap-2 transition-opacity"
                  style={{
                    background: GREEN,
                    opacity: !selectionsComplete || !isCustomer || submitting ? 0.45 : 1,
                    boxShadow: selectionsComplete && isCustomer ? 'var(--shadow-card)' : 'none',
                  }}
                >
                  {submitting
                    ? <Loader2 size={16} className="animate-spin" />
                    : isQuote
                      ? 'Request free quote'
                      : estimate != null
                        ? <>Confirm &amp; pay · AED {fmtAed(Number(estimate))}</>
                        : 'Confirm & pay'}
                </button>
                {missing && (
                  <p className="text-[11px] text-center mt-2" style={{ color: 'var(--mute)' }}>{missing}</p>
                )}

                <div className="flex items-center justify-center gap-3 mt-4 text-[10px] flex-wrap" style={{ color: 'var(--mute)' }}>
                  <span className="inline-flex items-center gap-1"><BadgeCheck size={12} style={{ color: GREEN }} /> Licensed providers</span>
                  <span className="inline-flex items-center gap-1"><ShieldCheck size={12} style={{ color: GREEN }} /> Secure payment</span>
                  <span className="inline-flex items-center gap-1"><Clock size={12} style={{ color: GREEN }} /> 48h re-do guarantee</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Policy popups — terms live behind info links, not inline */}
      {policyModal === 'pricing' && (
        <PolicyModal
          title="Pricing terms"
          onClose={() => setPolicyModal(null)}
          rows={[
            'All prices include 5% VAT — no surprises at checkout.',
            ...(isHourly ? ['Hourly services are billed per hour, per professional.'] : []),
            ...(hasLadder && !isHourly ? ['The price shown applies to the selected package size.'] : []),
            ...(svc.addons.length > 0 && !isQuote ? ['Add-ons are charged together with the service.'] : []),
            'The final amount is confirmed before you pay — no hidden charges.',
          ]}
        />
      )}
      {policyModal === 'cancel' && cancelPolicy && (
        <PolicyModal
          title="Cancellation & reschedule"
          onClose={() => setPolicyModal(null)}
          rows={[
            ...tierRows(cancelPolicy.cancel, 'cancellation', slotDate),
            ...tierRows(cancelPolicy.reschedule, 'reschedule', slotDate),
            `No-show: ${cancelPolicy.noShowFeePct}% of the booking value.`,
          ]}
        />
      )}
      {policyModal === 'visit' && (
        <PolicyModal
          title="Visit terms"
          onClose={() => setPolicyModal(null)}
          rows={[
            'We serve Dubai during the pilot — your pin confirms the service area.',
            'The professional calls when nearby; gate codes and parking notes prevent delays.',
            'Someone 18+ should be present (or provide access instructions in the notes).',
          ]}
        />
      )}
      <Footer />
    </div>
  );
}
