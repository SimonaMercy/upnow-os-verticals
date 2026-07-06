/**
 * Public booking flow — /services/book/[code] (SP Sprint 2, SCRUM-402/405).
 *
 * Single-page wizard for one admin-configured service: package/hours →
 * schedule → address → VAT-inclusive summary → inline customer auth (OTP,
 * cookie session) → POST /bookings (server-side pricing is authoritative)
 * → Mock payment → confirmation. Quote-mode services submit without payment.
 * Everything rendered comes from GET /api/catalog/public — no hardcoded
 * services or prices.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, BadgeCheck, CalendarDays, CheckCircle2, Clock, Loader2,
  MapPin, ShieldCheck, AlarmClockCheck,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

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
}
interface Cat { id: number; code: string; name: string; services: Svc[] }

const HOUR_OPTIONS = [2, 3, 4, 6, 8];
const SLOT_HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 08:00–20:00
const EMIRATES = [{ value: 'dubai', label: 'Dubai' }]; // pilot launch area (sp_launch policy)

const fmtAed = (n: number) => n.toLocaleString('en-AE');

export default function BookServicePage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const { user, register, login, verifyLoginOtp } = useAuth();

  const [svc, setSvc] = useState<Svc | null>(null);
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
        const found = (d.categories ?? []).flatMap((c) => c.services).find((s) => s.code === code) ?? null;
        setSvc(found);
        if (found?.quantityLabel) setQty(found.quantityMin || 1);
      })
      .catch(() => setSvc(null))
      .finally(() => setLoading(false));
  }, [code]);

  const days = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 1; i <= 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' }),
      });
    }
    return out;
  }, []);

  const isQuote = svc?.pricingMode === 'quote';
  const isHourly = svc?.priceUnit === 'per_hour';
  const hasLadder = (svc?.packages.length ?? 0) > 0;
  const chosenPkg = svc?.packages.find((p) => p.id === pkgId) ?? null;

  // Display-only estimate — the server recomputes authoritatively on submit.
  const estimate = useMemo(() => {
    if (!svc || isQuote) return null;
    const q = svc.quantityLabel ? qty : 1;
    let base: number | null;
    if (isHourly) base = (chosenPkg?.basePrice ?? svc.basePrice ?? 0) * hours * q;
    else if (chosenPkg) base = chosenPkg.basePrice != null ? chosenPkg.basePrice * q : null;
    else if (hasLadder) base = null;
    else base = svc.basePrice != null ? svc.basePrice * q : null;
    if (base == null) return null;
    const addonsTotal = svc.addons
      .filter((a) => addonIds.has(a.id))
      .reduce((sum, a) => sum + (a.priceUnit === 'per_hour' ? a.price * (isHourly ? hours : 1) : a.price), 0);
    return base + addonsTotal;
  }, [svc, isQuote, isHourly, chosenPkg, hours, hasLadder, qty, addonIds]);

  const selectionsComplete =
    Boolean(svc) && Boolean(day) && hour != null && address.trim().length >= 8 &&
    (!hasLadder || isHourly || pkgId != null);

  const isCustomer = user?.role === 'customer';

  /* ── inline auth (cookie session; devOtp surfaces locally) ── */
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
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-primary)' }} />
        <span className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>Loading service…</span>
      </div>
    );
  }
  if (!svc) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-semibold" style={{ color: 'var(--color-neutral-900)' }}>
          This service isn&apos;t available right now.
        </p>
        <Link href="/services" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          Browse all services
        </Link>
      </div>
    );
  }

  if (confirmedBooking) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center rounded-3xl border bg-white p-10" style={{ borderColor: 'var(--color-base-200)' }}>
          <div className="w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: '#d8f2e8' }}>
            <CheckCircle2 size={30} style={{ color: '#1a7a5a' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--color-neutral-900)' }}>
            {confirmedBooking.quote ? 'Quote request received' : 'Booking confirmed'}
          </h1>
          <p className="text-sm mb-1" style={{ color: 'var(--color-neutral-500)' }}>
            Reference <b>BK-{confirmedBooking.id}</b>
          </p>
          <p className="text-sm mb-6" style={{ color: 'var(--color-neutral-500)' }}>
            {confirmedBooking.quote
              ? 'A professional will assess the job and you’ll receive a quote to approve — you pay only after approving it.'
              : `Paid AED ${confirmedBooking.total != null ? fmtAed(Number(confirmedBooking.total)) : '—'} (VAT included). We’ll assign a professional and keep you posted.`}
          </p>
          <button
            type="button"
            onClick={() => router.push('/dashboard/customer/services')}
            className="w-full rounded-xl px-5 py-3 text-sm font-semibold text-white"
            style={{ background: 'var(--color-primary)' }}
          >
            Track my bookings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-base-100, #f9f8f6)' }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/services" className="inline-flex items-center gap-1.5 text-sm mb-5" style={{ color: 'var(--color-neutral-500)' }}>
          <ArrowLeft size={15} /> All services
        </Link>

        {/* Service header */}
        <div className="rounded-3xl border bg-white p-6 mb-4" style={{ borderColor: 'var(--color-base-200)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--color-neutral-900)' }}>{svc.name}</h1>
              {svc.description && <p className="text-sm mt-1" style={{ color: 'var(--color-neutral-500)' }}>{svc.description}</p>}
            </div>
            {svc.isEmergency && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full flex-shrink-0" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                <AlarmClockCheck size={11} /> 24/7
              </span>
            )}
          </div>
          <p className="text-sm font-bold mt-3" style={{ color: 'var(--color-primary)' }}>
            {isQuote
              ? 'Free quote — pay only after you approve it'
              : `${svc.isFromPrice ? 'From ' : ''}AED ${fmtAed(Number(chosenPkg?.basePrice ?? svc.basePrice ?? 0))}${isHourly ? '/hr' : ''} · VAT included`}
          </p>
        </div>

        {/* Package ladder */}
        {hasLadder && !isHourly && (
          <Section title={svc.packageGroupLabel ?? 'Choose an option'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {svc.packages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPkgId(p.id)}
                  className="flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left"
                  style={{
                    borderColor: pkgId === p.id ? 'var(--color-primary)' : 'var(--color-base-200)',
                    background: pkgId === p.id ? 'color-mix(in srgb, var(--color-primary) 6%, white)' : '#fff',
                  }}
                >
                  <span className="text-sm font-medium" style={{ color: 'var(--color-neutral-800)' }}>{p.name}</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--color-neutral-900)' }}>
                    {p.basePrice != null ? `AED ${fmtAed(Number(p.basePrice))}` : '—'}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Hours */}
        {isHourly && (
          <Section title="How many hours?">
            <div className="flex gap-2 flex-wrap">
              {HOUR_OPTIONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHours(h)}
                  className="w-14 h-11 rounded-xl border-2 text-sm font-bold"
                  style={{
                    borderColor: hours === h ? 'var(--color-primary)' : 'var(--color-base-200)',
                    background: hours === h ? 'color-mix(in srgb, var(--color-primary) 6%, white)' : '#fff',
                    color: hours === h ? 'var(--color-primary)' : 'var(--color-neutral-700)',
                  }}
                >
                  {h}h
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Quantity (admin-configured: Cleaners, AC units, …) */}
        {svc.quantityLabel && (
          <Section title={`How many ${svc.quantityLabel.toLowerCase()}?`}>
            <div className="inline-flex items-center gap-4 rounded-xl border-2 px-4 py-2.5" style={{ borderColor: 'var(--color-base-200)' }}>
              <button
                type="button"
                onClick={() => setQty(Math.max(svc.quantityMin || 1, qty - 1))}
                className="w-8 h-8 rounded-lg border text-lg font-bold"
                style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-700)' }}
              >−</button>
              <span className="text-base font-bold w-8 text-center" style={{ color: 'var(--color-neutral-900)' }}>{qty}</span>
              <button
                type="button"
                onClick={() => setQty(Math.min(svc.quantityMax ?? 99, qty + 1))}
                className="w-8 h-8 rounded-lg border text-lg font-bold"
                style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-700)' }}
              >+</button>
            </div>
          </Section>
        )}

        {/* Add-ons (admin-configured priced extras) */}
        {!isQuote && svc.addons.length > 0 && (
          <Section title="Add-ons">
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
                    className="w-full flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left"
                    style={{
                      borderColor: on ? 'var(--color-primary)' : 'var(--color-base-200)',
                      background: on ? 'color-mix(in srgb, var(--color-primary) 6%, white)' : '#fff',
                    }}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center border-2"
                        style={{
                          borderColor: on ? 'var(--color-primary)' : 'var(--color-base-200)',
                          background: on ? 'var(--color-primary)' : '#fff',
                        }}
                      >{on && <CheckCircle2 size={12} style={{ color: '#fff' }} />}</span>
                      <span className="text-sm font-medium" style={{ color: 'var(--color-neutral-800)' }}>{a.name}</span>
                    </span>
                    <span className="text-sm font-bold" style={{ color: 'var(--color-neutral-900)' }}>
                      +AED {fmtAed(a.price)}{a.priceUnit === 'per_hour' ? '/hr' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {/* Schedule */}
        <Section title="When should we come?" icon={CalendarDays}>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {days.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDay(d.value)}
                className="px-3.5 py-2.5 rounded-xl border-2 text-xs font-semibold whitespace-nowrap"
                style={{
                  borderColor: day === d.value ? 'var(--color-primary)' : 'var(--color-base-200)',
                  background: day === d.value ? 'color-mix(in srgb, var(--color-primary) 6%, white)' : '#fff',
                  color: day === d.value ? 'var(--color-primary)' : 'var(--color-neutral-700)',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap mt-2">
            {SLOT_HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHour(h)}
                className="px-3 py-2 rounded-lg border text-xs font-semibold"
                style={{
                  borderColor: hour === h ? 'var(--color-primary)' : 'var(--color-base-200)',
                  background: hour === h ? 'color-mix(in srgb, var(--color-primary) 6%, white)' : '#fff',
                  color: hour === h ? 'var(--color-primary)' : 'var(--color-neutral-600)',
                }}
              >
                {String(h).padStart(2, '0')}:00
              </button>
            ))}
          </div>
        </Section>

        {/* Address */}
        <Section title="Where?" icon={MapPin}>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Building, street, area — e.g. Marina Heights, Tower 2, Apt 1204"
              className="rounded-xl border px-4 py-3 text-sm outline-none w-full"
              style={{ borderColor: 'var(--color-base-200)' }}
            />
            <select
              value={emirate}
              onChange={(e) => setEmirate(e.target.value)}
              className="rounded-xl border px-3 py-3 text-sm bg-white"
              style={{ borderColor: 'var(--color-base-200)' }}
            >
              {EMIRATES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the professional should know? (optional)"
            rows={2}
            className="rounded-xl border px-4 py-3 text-sm outline-none w-full mt-2.5"
            style={{ borderColor: 'var(--color-base-200)' }}
          />
        </Section>

        {/* Summary + auth + submit */}
        <div className="rounded-3xl border bg-white p-6" style={{ borderColor: 'var(--color-base-200)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm" style={{ color: 'var(--color-neutral-500)' }}>
              {isQuote ? 'Assessment visit' : `${svc.name}${chosenPkg ? ` — ${chosenPkg.name}` : ''}${isHourly ? ` · ${hours}h` : ''}${svc.quantityLabel ? ` · ${qty} ${svc.quantityLabel.toLowerCase()}` : ''}${addonIds.size ? ` · +${addonIds.size} add-on${addonIds.size > 1 ? 's' : ''}` : ''}`}
            </span>
            <span className="text-lg font-bold" style={{ color: 'var(--color-neutral-900)' }}>
              {isQuote ? 'Free quote' : estimate != null ? `AED ${fmtAed(Number(estimate))}` : '—'}
            </span>
          </div>
          {!isQuote && (
            <p className="text-[11px] mb-4" style={{ color: 'var(--color-neutral-400)' }}>
              VAT included · free cancellation up to 6 hours before your slot
            </p>
          )}

          {!user && (
            <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--color-base-100)' }}>
              <p className="text-xs font-semibold mb-2.5" style={{ color: 'var(--color-neutral-800)' }}>
                Sign in to confirm your booking
              </p>
              {authPhase !== 'otp' ? (
                <div className="flex gap-2 flex-wrap">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    type="email"
                    className="flex-1 min-w-[200px] rounded-xl border px-4 py-2.5 text-sm outline-none"
                    style={{ borderColor: 'var(--color-base-200)', background: '#fff' }}
                  />
                  <button
                    type="button"
                    disabled={!email.includes('@') || authPhase === 'busy'}
                    onClick={startAuth}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                    style={{ background: 'var(--color-primary)', opacity: authPhase === 'busy' ? 0.6 : 1 }}
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
                    className="w-36 rounded-xl border px-4 py-2.5 text-sm outline-none tracking-widest"
                    style={{ borderColor: 'var(--color-base-200)', background: '#fff' }}
                  />
                  <button
                    type="button"
                    disabled={otp.trim().length !== 6}
                    onClick={confirmOtp}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    Verify
                  </button>
                  {devOtp && (
                    <span className="text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>dev code: {devOtp}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {user && !isCustomer && (
            <p className="text-xs rounded-xl px-4 py-3 mb-4" style={{ background: '#fffbeb', color: '#92400e' }}>
              You&apos;re signed in as a {user.role.replace('_', ' ')} — bookings are made from customer accounts.
            </p>
          )}

          {error && (
            <p className="text-xs rounded-xl px-4 py-3 mb-4" style={{ background: '#fef2f2', color: 'var(--color-error)' }}>{error}</p>
          )}

          <button
            type="button"
            disabled={!selectionsComplete || !isCustomer || submitting}
            onClick={submit}
            className="w-full rounded-xl px-5 py-3.5 text-sm font-bold text-white inline-flex items-center justify-center gap-2"
            style={{
              background: 'var(--color-primary)',
              opacity: !selectionsComplete || !isCustomer || submitting ? 0.5 : 1,
            }}
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : isQuote ? 'Request free quote' : 'Confirm & pay'}
          </button>

          <div className="flex items-center justify-center gap-4 mt-4 text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>
            <span className="inline-flex items-center gap-1"><BadgeCheck size={12} style={{ color: 'var(--color-primary)' }} /> Licensed providers</span>
            <span className="inline-flex items-center gap-1"><ShieldCheck size={12} style={{ color: 'var(--color-primary)' }} /> Secure payment</span>
            <span className="inline-flex items-center gap-1"><Clock size={12} style={{ color: 'var(--color-primary)' }} /> 48h re-do guarantee</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border bg-white p-6 mb-4" style={{ borderColor: 'var(--color-base-200)' }}>
      <h2 className="text-sm font-bold mb-3.5 inline-flex items-center gap-2" style={{ color: 'var(--color-neutral-900)' }}>
        {Icon && <Icon size={15} style={{ color: 'var(--color-primary)' }} />}
        {title}
      </h2>
      {children}
    </div>
  );
}
