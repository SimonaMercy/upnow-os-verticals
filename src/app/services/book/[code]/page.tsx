/**
 * Public booking flow — /services/book/[code] (SP Sprint 2, SCRUM-402/405).
 *
 * Justlife / Urban Company checkout: numbered detail-capture steps in the
 * LEFT column (customize → date & time → address), a STICKY summary card on
 * the RIGHT with the service photo, itemized live pricing, inline sign-in
 * (email → OTP, registers new customers on the fly) at the END, then payment.
 * Server-side pricing is authoritative on submit; quote-mode services submit
 * without payment. Everything rendered comes from GET /api/catalog/public.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  BadgeCheck, CalendarDays, Check, CheckCircle2, Clock, Loader2,
  MapPin, ShieldCheck, AlarmClockCheck, SlidersHorizontal, Lock, Sparkles,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Navbar } from '@/components/upnow/Navbar';
import { serviceImg } from '@/lib/serviceImages';

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
}
interface Cat { id: number; code: string; name: string; services: Svc[] }

const HOUR_OPTIONS = [2, 3, 4, 6, 8];
const SLOT_HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 08:00–20:00
const EMIRATES = [{ value: 'dubai', label: 'Dubai' }]; // pilot launch area (sp_launch policy)

const GREEN = 'var(--green)';
const LINE = 'var(--line)';
const TINT = 'var(--green-tint)';   // selected surfaces (matches .l-catchip.active)
const GREEN_DD = 'var(--green-dd)'; // selected text, per theme

const fmtAed = (n: number) => n.toLocaleString('en-AE');
function durText(min: number | null, max: number | null): string | null {
  if (!min) return null;
  const f = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);
  return max && max !== min ? `${f(min)}–${f(max)}` : f(min);
}

export default function BookServicePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { user, register, login, verifyLoginOtp } = useAuth();

  const [svc, setSvc] = useState<Svc | null>(null);
  const [catName, setCatName] = useState<string>('');
  const [catCode, setCatCode] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // selections
  const [pkgId, setPkgId] = useState<number | null>(null);
  const [hours, setHours] = useState<number>(2);
  const [qty, setQty] = useState<number>(1);
  const [addonIds, setAddonIds] = useState<Set<number>>(new Set());
  const [day, setDay] = useState<string>('');
  const [hour, setHour] = useState<number | null>(null);
  const [address, setAddress] = useState('');
  const [emirate, setEmirate] = useState('dubai');
  const [notes, setNotes] = useState('');

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
      .then((d: { categories?: Cat[] }) => {
        for (const c of d.categories ?? []) {
          const found = c.services.find((s) => s.code === code);
          if (found) {
            setSvc(found); setCatName(c.name); setCatCode(c.code);
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

  const optionsDone = Boolean(svc) && (!hasLadder || isHourly || pkgId != null);
  const scheduleDone = Boolean(day) && hour != null;
  const addressDone = address.trim().length >= 8;
  const selectionsComplete = optionsDone && scheduleDone && addressDone;
  const missing = !optionsDone
    ? `Choose ${svc?.packageGroupLabel?.toLowerCase() ?? 'an option'} to continue`
    : !scheduleDone ? 'Pick a date and time' : !addressDone ? 'Add your address' : null;

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
        <Navbar />
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

  let stepNo = 0;
  const nextStep = () => String(++stepNo);
  const svcDur = durText(svc.estimatedDuration, svc.estimatedDurationMax)
    ?? durText(chosenPkg?.estimatedDuration ?? null, chosenPkg?.estimatedDurationMax ?? null);

  return (
    <div className="min-h-screen" style={{ background: '#fff' }}>
      <Navbar />
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
            <span className="font-semibold" style={{ color: 'var(--green-dd)' }}>{catName}</span>
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
        {/* ── Two columns: steps left, sticky summary right ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_384px] gap-7 items-start">

          {/* LEFT — detail capture steps */}
          <div className="min-w-0">
            {/* Step: customize */}
            {(hasLadder || isHourly || svc.quantityLabel || (!isQuote && svc.addons.length > 0)) && (
              <StepCard no={nextStep()} title="Customize your service" icon={SlidersHorizontal} done={optionsDone && (hasLadder && !isHourly ? pkgId != null : true)}>
                {/* Package ladder */}
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
                            className="relative rounded-[14px] border-2 px-4 py-3.5 text-left transition-all"
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

                {/* Hours */}
                {isHourly && (
                  <div className="mb-5">
                    <p className="text-[12px] font-semibold mb-2.5" style={{ color: 'var(--mute)' }}>How many hours?</p>
                    <div className="flex gap-2 flex-wrap">
                      {HOUR_OPTIONS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setHours(h)}
                          className="w-[54px] h-12 rounded-2xl border-2 text-sm font-bold transition-all"
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

                {/* Quantity (admin-configured: Cleaners, AC units, …) */}
                {svc.quantityLabel && (
                  <div className="mb-5">
                    <p className="text-[12px] font-semibold mb-2.5" style={{ color: 'var(--mute)' }}>How many {svc.quantityLabel.toLowerCase()}?</p>
                    <div className="inline-flex items-center rounded-2xl border-2 overflow-hidden" style={{ borderColor: LINE }}>
                      <button
                        type="button"
                        onClick={() => setQty(Math.max(svc.quantityMin || 1, qty - 1))}
                        className="w-11 h-11 text-lg font-bold transition-colors hover:bg-[#f4f9f7]"
                        style={{ color: 'var(--mute)' }}
                      >−</button>
                      <span className="text-base font-bold w-12 text-center tabular-nums" style={{ color: 'var(--ink)' }}>{qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty(Math.min(svc.quantityMax ?? 99, qty + 1))}
                        className="w-11 h-11 text-lg font-bold transition-colors hover:bg-[#f4f9f7]"
                        style={{ color: GREEN }}
                      >+</button>
                    </div>
                    <span className="ml-3 text-[11px]" style={{ color: 'var(--mute)' }}>
                      {svc.quantityMin || 1}–{svc.quantityMax ?? '∞'} {svc.quantityLabel.toLowerCase()}
                    </span>
                  </div>
                )}

                {/* Add-ons */}
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
                            className="w-full flex items-center justify-between rounded-2xl border-2 px-4 py-3 text-left transition-all"
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
              </StepCard>
            )}

            {/* Step: schedule */}
            <StepCard no={nextStep()} title="Pick a date & time" icon={CalendarDays} done={scheduleDone}>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                {days.map((d) => {
                  const on = day === d.value;
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDay(d.value)}
                      className="flex flex-col items-center justify-center w-[62px] h-[72px] rounded-2xl border-2 flex-shrink-0 transition-all"
                      style={{
                        borderColor: on ? GREEN : LINE,
                        background: on ? TINT : '#fff',
                        boxShadow: on ? 'var(--shadow-card)' : 'none',
                      }}
                    >
                      <span className="text-[10px] font-semibold uppercase" style={{ color: on ? GREEN_DD : 'var(--mute)' }}>{d.wd}</span>
                      <span className="text-lg font-bold leading-tight tabular-nums" style={{ color: on ? GREEN_DD : 'var(--ink-2)' }}>{d.num}</span>
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
                      className="py-2.5 rounded-xl border-2 text-[12.5px] font-semibold tabular-nums transition-all"
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
            </StepCard>

            {/* Step: address */}
            <StepCard no={nextStep()} title="Where should we come?" icon={MapPin} done={addressDone}>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-3">
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Building, street, area — e.g. Marina Heights, Tower 2, Apt 1204"
                  className="rounded-xl border-2 px-4 py-3 text-sm outline-none w-full transition-colors focus:border-[#2e9f82]"
                  style={{ borderColor: LINE }}
                />
                <select
                  value={emirate}
                  onChange={(e) => setEmirate(e.target.value)}
                  className="rounded-xl border-2 px-3 py-3 text-sm bg-white"
                  style={{ borderColor: LINE }}
                >
                  {EMIRATES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the professional should know? (optional)"
                rows={2}
                className="rounded-xl border-2 px-4 py-3 text-sm outline-none w-full mt-2.5 transition-colors focus:border-[#2e9f82]"
                style={{ borderColor: LINE }}
              />
            </StepCard>
          </div>

          {/* RIGHT — sticky summary, sign-in, payment */}
          <aside className="lg:sticky lg:top-24">
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
                      <div key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
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
                  <div className="space-y-1.5 mb-4 pt-3 text-xs" style={{ borderTop: `1px dashed ${'var(--line)'}`, color: 'var(--mute)' }}>
                    {day && hour != null && (
                      <p className="inline-flex items-center gap-1.5 w-full">
                        <CalendarDays size={12} style={{ color: GREEN }} />
                        {(() => { const d = days.find((x) => x.value === day); return d ? `${d.wd} ${d.num} ${d.mon}` : day; })()} · {String(hour).padStart(2, '0')}:00
                      </p>
                    )}
                    {address && <p className="inline-flex items-start gap-1.5 w-full"><MapPin size={12} className="mt-0.5 flex-shrink-0" style={{ color: GREEN }} /> {address}</p>}
                  </div>
                )}

                {/* Total */}
                {!isQuote && (
                  <>
                    <div className="flex items-center justify-between py-3" style={{ borderTop: `1px solid ${'var(--line)'}` }}>
                      <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>Total</span>
                      <span className="text-[22px] font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                        {estimate != null ? `AED ${fmtAed(Number(estimate))}` : '—'}
                      </span>
                    </div>
                    <p className="text-[11px] mb-4" style={{ color: 'var(--mute)' }}>
                      VAT included · free cancellation up to 6 hours before your slot
                    </p>
                  </>
                )}

                {/* Sign-in — the LAST step, after details are captured */}
                {!user && (
                  <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--green-tint-2)' }}>
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
                  <p className="text-xs rounded-xl px-3.5 py-2.5 mb-4 inline-flex items-center gap-1.5 w-full" style={{ background: '#f0faf6', color: '#1a7a5a' }}>
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
                  className="w-full rounded-2xl px-5 py-4 text-[15px] font-bold text-white inline-flex items-center justify-center gap-2 transition-opacity"
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
    </div>
  );
}

/** Numbered step card — Justlife/UC-style checkout section with a done tick. */
function StepCard({ no, title, icon: Icon, done, children }: {
  no: string; title: string; icon?: React.ElementType; done?: boolean; children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[18px] border bg-white p-6 mb-5 transition-shadow"
      style={{ borderColor: done ? 'var(--green)' : 'var(--line)', boxShadow: 'var(--shadow-card)' }}
    >
      <h2 className="text-[15px] font-bold mb-4 flex items-center gap-2.5" style={{ color: 'var(--ink)' }}>
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-colors"
          style={done
            ? { background: 'var(--green)', color: '#fff' }
            : { background: 'color-mix(in srgb, var(--green) 10%, white)', color: 'var(--green)' }}
        >
          {done ? <Check size={14} /> : no}
        </span>
        {title}
        {Icon && <Icon size={15} style={{ color: 'var(--mute)' }} />}
      </h2>
      {children}
    </div>
  );
}
