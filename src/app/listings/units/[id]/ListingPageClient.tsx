'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth, dashboardPath, type UserRole } from '@/contexts/AuthContext';
import {
  MapPin, X, ChevronLeft, ChevronRight, BedDouble, Bath, Maximize2,
  Layers, Wind, CheckCircle2, Check, Shield, Clock,
  Calendar, MessageSquare, ImageIcon,
  Flame, AppWindow, DoorOpen, Hash, Star, Ruler,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────────────── */
export interface UnitMediaItem {
  id: number;
  url: string;
  caption: string | null;
  sortOrder: number;
}

export interface PublicUnit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  unitTier: string;
  floor: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  // TypeORM numeric columns come back as strings over JSON
  unitSizeSqft: string | number | null;
  unitSizeSqm: string | number | null;
  view: string | null;
  facilities: string | null;
  numBalconies: number;
  numAcs: number;
  numHeaters: number;
  numWindows: number;
  numDoors: number;
  kitchenType: string | null;
  premiseNumber: string | null;
  serviceTier: string | null;
  rentalPrice: string | number | null;
  marketPrice: string | number | null;
  serviceCharges: string | number | null;
  leaseAmount: string | number | null;
  availability: string;
  description: string | null;
  nameAr: string | null;
  descriptionAr: string | null;
}

export interface PublicProperty {
  id: number;
  buildingName: string;
  fullAddress: string | null;
  spaceCategory: string;
  // TypeORM numeric columns come back as strings over JSON
  latitude: string | number | null;
  longitude: string | number | null;
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  propertyDescription: string | null;
  numberOfFloors: string | null;
  makaniNumber: string | null;
  plotNumber: string | null;
  community: { nameEn: string } | null;
  emirate: { nameEn: string } | null;
}

/* ── Dummy image sets by category ─────────────────────────────────────── */
const CATEGORY_IMAGES: Record<string, string[]> = {
  residential: [
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=1400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=900&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=900&q=80&auto=format&fit=crop',
  ],
  commercial: [
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=900&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=900&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1568992687947-868a62a9f521?w=900&q=80&auto=format&fit=crop',
  ],
  industrial: [
    'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1400&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=900&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1553697388-94e804e2f0f6?w=900&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1601598851547-4302969d0614?w=900&q=80&auto=format&fit=crop',
  ],
};
const FALLBACK_IMAGES = CATEGORY_IMAGES.residential;

/* ── Helpers ────────────────────────────────────────────────────────────── */
function fmt(n: string | number | null) {
  if (n == null) return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return new Intl.NumberFormat('en-AE').format(num);
}
function fmtAed(n: string | number | null) {
  if (n == null) return null;
  const num = Number(n);
  if (isNaN(num)) return null;
  return `AED ${new Intl.NumberFormat('en-AE').format(num)}`;
}
function humanType(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
/** Build a full display address from the structured location fields. */
function buildAddress(property: PublicProperty): string {
  const parts: string[] = [];
  if (property.fullAddress) parts.push(property.fullAddress);
  else {
    if (property.community?.nameEn) parts.push(property.community.nameEn);
    if (property.emirate?.nameEn) parts.push(property.emirate.nameEn);
    parts.push('UAE');
  }
  return parts.join(', ');
}

const AVAIL_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  available: { bg: '#d8f2e8', text: '#1a7a5a', label: 'Available' },
  occupied: { bg: '#dbeafe', text: '#1e40af', label: 'Occupied' },
  under_renewal: { bg: '#ede9fe', text: '#6d28d9', label: 'Under Renewal' },
  renewal_pending: { bg: '#fef3c7', text: '#92400e', label: 'Renewal Pending' },
  maintenance: { bg: '#fee2e2', text: '#b91c1c', label: 'Maintenance' },
};
const CATEGORY_BG: Record<string, string> = {
  residential: '#d8f2e8', commercial: '#dbeafe',
  industrial: '#fef3c7',
};

/* ── Gallery Lightbox ──────────────────────────────────────────────────── */
function GalleryModal({
  images, index, onClose, onNav,
}: { images: string[]; index: number; onClose: () => void; onNav: (i: number) => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}>
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white rounded-full p-2 hover:bg-white/10 transition-colors z-10"
        onClick={onClose}
      >
        <X size={24} />
      </button>
      <button
        className="absolute left-4 text-white/80 hover:text-white rounded-full p-2 hover:bg-white/10 transition-colors"
        onClick={() => onNav((index - 1 + images.length) % images.length)}
      >
        <ChevronLeft size={32} />
      </button>
      <img
        src={images[index]}
        alt={`Photo ${index + 1}`}
        className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
      />
      <button
        className="absolute right-4 text-white/80 hover:text-white rounded-full p-2 hover:bg-white/10 transition-colors"
        onClick={() => onNav((index + 1) % images.length)}
      >
        <ChevronRight size={32} />
      </button>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {images.map((_, i) => (
          <button
            key={i}
            onClick={() => onNav(i)}
            className={`w-2 h-2 rounded-full transition-colors ${i === index ? 'bg-white' : 'bg-white/40'}`}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Inquiry Panel ──────────────────────────────────────────────────────── */
function InquiryPanel({
  unit, property, onBook, onInquire,
}: { unit: PublicUnit; property: PublicProperty; onBook: () => void; onInquire: () => void }) {
  return (
    <>
      {/* Provider */}
      <div className="flex items-center gap-3 mb-5 pb-5 border-b border-[#e8e6e0]">
        <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
          style={{ background: 'linear-gradient(135deg, #2e9f82, #1f6655)' }}>
          {property.buildingName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-[#1a1916] truncate">{property.buildingName}</span>
            <span className="flex-shrink-0 text-xs font-medium rounded-full px-2 py-0.5 bg-[#d8f2e8] text-[#1a7a5a] flex items-center gap-1">
              <Shield size={10} /> Verified
            </span>
          </div>
          <p className="text-xs text-[#9b9890] flex items-center gap-1 mt-0.5">
            <Clock size={11} /> Responds within 2 hours
          </p>
        </div>
      </div>

      {/* CTA buttons */}
      <div className="flex flex-col gap-3 mb-5">
        <button
          onClick={onInquire}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#2e9f82' }}
        >
          Book Now
        </button>
        <button
          onClick={onBook}
          className="w-full py-3 rounded-xl text-sm font-semibold border border-[#2e9f82] hover:bg-[#edf7f3] transition-colors"
          style={{ color: '#2e9f82' }}
        >
          Schedule Viewing
        </button>
      </div>

      {/* Price */}
      <div className="bg-[#f4f3ef] rounded-xl p-4 space-y-2 text-sm">
        {unit.rentalPrice != null && (
          <div className="flex justify-between">
            <span className="text-[#6b6860]">Annual Rent</span>
            <span className="font-bold text-[#1a1916]">{fmtAed(unit.rentalPrice)}</span>
          </div>
        )}
        {unit.marketPrice != null && (
          <div className="flex justify-between">
            <span className="text-[#6b6860]">Market Price</span>
            <span className="font-medium text-[#1a1916]">{fmtAed(unit.marketPrice)}</span>
          </div>
        )}

      </div>
    </>
  );
}

/* ── Mini Calendar ──────────────────────────────────────────────────────── */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function MiniCalendar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const selected = value ? new Date(value + 'T00:00:00') : null;

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const firstDay = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();

  function prevMonth() {
    setCursor(c => {
      const m = c.month === 0 ? 11 : c.month - 1;
      const y = c.month === 0 ? c.year - 1 : c.year;
      return { year: y, month: m };
    });
  }
  function nextMonth() {
    setCursor(c => {
      const m = c.month === 11 ? 0 : c.month + 1;
      const y = c.month === 11 ? c.year + 1 : c.year;
      return { year: y, month: m };
    });
  }
  function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-2xl border border-[#e8e6e0] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: '#f9f8f6' }}>
        <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-[#e8e6e0] transition-colors cursor-pointer">
          <ChevronLeft size={16} style={{ color: '#6b6860' }} />
        </button>
        <span className="text-sm font-semibold" style={{ color: '#1a1916' }}>
          {MONTHS[cursor.month]} {cursor.year}
        </span>
        <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-[#e8e6e0] transition-colors cursor-pointer">
          <ChevronRight size={16} style={{ color: '#6b6860' }} />
        </button>
      </div>
      {/* Day labels */}
      <div className="grid grid-cols-7 border-b border-[#e8e6e0]">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs font-medium py-2" style={{ color: '#9b9890' }}>{d}</div>
        ))}
      </div>
      {/* Cells */}
      <div className="grid grid-cols-7 p-2 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const cellDate = new Date(cursor.year, cursor.month, day);
          const isPast = cellDate < todayDate;
          const iso = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
          const isSelected = selected
            ? selected.getFullYear() === cursor.year && selected.getMonth() === cursor.month && selected.getDate() === day
            : false;
          const isToday = cellDate.getTime() === todayDate.getTime();
          return (
            <button
              key={i}
              type="button"
              disabled={isPast}
              onClick={() => onChange(iso)}
              className="text-xs rounded-lg py-1.5 w-full text-center transition-all cursor-pointer"
              style={{
                backgroundColor: isSelected ? '#2e9f82' : isToday && !isSelected ? '#edf7f3' : 'transparent',
                color: isSelected ? '#fff' : isPast ? '#c8c6c0' : '#1a1916',
                fontWeight: isSelected || isToday ? 600 : 400,
                cursor: isPast ? 'not-allowed' : 'pointer',
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Time Slots ─────────────────────────────────────────────────────────── */
const TIME_SLOTS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
function fmtSlot(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${m === 0 ? '00' : m} ${suffix}`;
}

/* ── Book Viewing Modal ─────────────────────────────────────────────────── */
const BOOKING_INTENT_KEY = 'upnow_booking_intent';

function BookModal({ unit, property, onClose }: { unit: PublicUnit; property: PublicProperty; onClose: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [moveInDate, setMoveInDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null); // confirmed scheduledAt ISO string

  // Inline auth state — shown when unauthenticated user hits "Confirm Viewing"
  type AuthStep = null | 'register' | 'verify-otp' | 'register-success';
  const [authStep, setAuthStep] = useState<AuthStep>(null);
  const [authIsNewUser, setAuthIsNewUser] = useState(false);
  const [authVerificationStep, setAuthVerificationStep] = useState<'email' | 'phone'>('email');
  const [authEmail, setAuthEmail] = useState('');
  const [authDevOtp, setAuthDevOtp] = useState<string | null>(null);
  const [authOtp, setAuthOtp] = useState(['', '', '', '', '', '']);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([null, null, null, null, null, null]);

  // Shared API call — used by both manual submit and auto-submit after login redirect
  async function submitBooking(d: string, t: string, n: string, mi?: string): Promise<boolean> {
    setError(null);
    setSubmitting(true);
    try {
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
      if (me.role !== 'customer') {
        setError('Only customers can book viewings. Please log in with a customer account.');
        return false;
      }
      const scheduledAt = new Date(`${d}T${t || '10:00'}:00`).toISOString();
      const res = await fetch('/api/leads/viewings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unitId: unit.id,
          scheduledAt,
          notes: n || undefined,
          desiredMoveIn: mi || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Failed: ${res.status}`);
      }
      const body = await res.json().catch(() => ({}));
      const leadId: number | undefined = body?.lead?.id;
      if (leadId) {
        router.push(`/dashboard/customer/spaces?space=v-${leadId}`);
        return true;
      }
      // Fallback: no lead id in response — show inline success screen
      setDone(scheduledAt);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  // On mount: if user returned from login with a saved intent, auto-book immediately
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BOOKING_INTENT_KEY);
      if (raw) {
        const intent = JSON.parse(raw);
        if (intent.unitId === unit.id && intent.date) {
          sessionStorage.removeItem(BOOKING_INTENT_KEY);
          // Pre-fill state for the success screen context, then auto-submit
          setDate(intent.date);
          setTime(intent.time ?? '');
          setNotes(intent.notes ?? '');
          setMoveInDate(intent.moveInDate ?? '');
          submitBooking(intent.date, intent.time ?? '', intent.notes ?? '', intent.moveInDate ?? '');
        }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.id]);

  async function handleBook() {
    setError(null);
    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (meRes.status === 401) {
      // Not logged in → show inline register form instead of redirecting
      setAuthStep('register');
      return;
    }
    await submitBooking(date, time, notes, moveInDate);
  }

  // Step 1 — unified: try login first, auto-register if no account found
  async function handleAuthIdentify() {
    const raw = authEmail.trim();
    if (!raw) { setAuthError('Enter your email or phone number.'); return; }
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const isPhone = !raw.includes('@');
      const identifier = isPhone
        ? (raw.startsWith('+') ? raw : /^\d{8,12}$/.test(raw) ? `+971${raw.replace(/^0+/, '')}` : raw)
        : raw.toLowerCase();

      // Always try login first
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier }),
      });
      const loginBody = await loginRes.json();

      if (loginRes.ok) {
        // Existing user — OTP sent
        setAuthIsNewUser(false);
        setAuthVerificationStep(loginBody.verificationStep ?? (isPhone ? 'phone' : 'email'));
        if (loginBody.devOtp) setAuthDevOtp(loginBody.devOtp);
        setAuthOtp(['', '', '', '', '', '']);
        setAuthEmail(identifier);
        setAuthStep('verify-otp');
        return;
      }

      // If any error other than "no account found" — surface it
      const isNotFound = loginRes.status === 401 &&
        (loginBody.message ?? '').toLowerCase().includes('no account');
      if (!isNotFound) {
        throw new Error(Array.isArray(loginBody.message) ? loginBody.message.join(', ') : loginBody.message ?? 'Something went wrong');
      }

      // New user — auto-register with whatever they provided
      const regPayload = isPhone ? { phone: identifier } : { email: identifier };
      const regRes = await fetch('/api/auth/register/customer', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regPayload),
      });
      const regBody = await regRes.json();
      if (!regRes.ok) {
        throw new Error(Array.isArray(regBody.message) ? regBody.message.join(', ') : regBody.message ?? 'Registration failed');
      }
      setAuthIsNewUser(true);
      setAuthVerificationStep(regBody.verificationStep ?? (isPhone ? 'phone' : 'email'));
      if (regBody.devOtp) setAuthDevOtp(regBody.devOtp);
      setAuthOtp(['', '', '', '', '', '']);
      setAuthEmail(identifier);
      setAuthStep('verify-otp');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setAuthSubmitting(false);
    }
  }

  // Step 2 — verify OTP, route to correct endpoint based on flow
  async function handleAuthVerifyOtp() {
    const code = authOtp.join('');
    if (code.length !== 6) { setAuthError('Enter the 6-digit code.'); return; }
    setAuthError(null);
    setAuthSubmitting(true);
    try {
      const identifier = authEmail;
      let res: Response;

      if (!authIsNewUser) {
        // Existing user: login verify (works for email and phone)
        res = await fetch('/api/auth/login/verify-otp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, code }),
        });
      } else if (authVerificationStep === 'phone') {
        // New phone-only user: cookie from registration carries the JWT
        res = await fetch('/api/auth/otp/verify', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
      } else {
        // New email user
        res = await fetch('/api/auth/email/verify-otp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier, code }),
        });
      }

      const body = await res.json();
      if (!res.ok) {
        const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Verification failed';
        throw new Error(msg);
      }
      const booked = await submitBooking(date, time, notes, moveInDate);
      if (booked) setAuthStep('register-success');
      else setAuthError('Verified! But could not submit the viewing request. Please try again.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setAuthSubmitting(false);
    }
  }

  function handleOtpDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...authOtp];
    next[index] = digit;
    setAuthOtp(next);
    if (digit && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !authOtp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setAuthOtp(pasted.split(''));
      otpInputRefs.current[5]?.focus();
      e.preventDefault();
    }
  }

  // ── Step 1: email or phone entry — auto-detects login vs register ────────
  if (authStep === 'register') {
    return (
      <ModalShell onClose={onClose}>
        <h3 className="font-bold text-xl text-[#1a1916] mb-1">Continue to UpNow</h3>
        <p className="text-sm text-[#9b9890] mb-5">
          Enter your email or phone number. We&apos;ll send a one-time code to sign you in — or create your account instantly if you&apos;re new.
        </p>

        {authError && (
          <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{authError}</div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#3d3b35] uppercase tracking-wide mb-1.5">
            Email or phone number
          </label>
          <input
            type="text"
            inputMode="email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuthIdentify()}
            placeholder="you@example.com or +971 50 123 4567"
            autoComplete="username"
            autoFocus
            className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3.5 py-3 text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#1a1916]/20 focus:border-[#1a1916]"
          />
        </div>

        <button
          disabled={authSubmitting || !authEmail.trim()}
          onClick={handleAuthIdentify}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#1a1916' }}
        >
          {authSubmitting ? 'Sending code…' : 'Continue →'}
        </button>
      </ModalShell>
    );
  }

  // ── Step 2: OTP verification ───────────────────────────────────────────────
  if (authStep === 'verify-otp') {
    const otpCode = authOtp.join('');
    return (
      <ModalShell onClose={onClose}>
        <button
          type="button"
          onClick={() => { setAuthStep('register'); setAuthError(null); setAuthOtp(['','','','','','']); }}
          className="flex items-center gap-1 text-xs text-[#9b9890] hover:text-[#1a1916] mb-4 transition-colors"
        >
          <ChevronLeft size={14} /> Back
        </button>

        <h3 className="font-bold text-xl text-[#1a1916] mb-1">
          {authVerificationStep === 'phone' ? 'Check your phone' : 'Check your email'}
        </h3>
        <p className="text-sm text-[#9b9890] mb-5">
          We sent a 6-digit code to{' '}
          <span className="font-semibold text-[#1a1916]">{authEmail}</span>
        </p>

        {authError && (
          <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{authError}</div>
        )}

        {/* Dev hint */}
        {authDevOtp && (
          <div className="mb-4 rounded-xl px-4 py-3 text-sm font-mono font-bold tracking-widest text-center"
            style={{ background: '#fdf3e1', color: '#7e3b00' }}>
            Dev code: {authDevOtp}
          </div>
        )}

        <div className="flex gap-2 justify-center mb-5">
          {authOtp.map((d, i) => (
            <input
              key={i}
              ref={(el) => { otpInputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              autoFocus={i === 0}
              onChange={(e) => handleOtpDigit(i, e.target.value)}
              onKeyDown={(e) => {
                handleOtpKeyDown(i, e);
                if (e.key === 'Enter' && otpCode.length === 6) handleAuthVerifyOtp();
              }}
              onPaste={handleOtpPaste}
              className="w-11 h-12 text-center text-xl font-semibold border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a1916]/20"
              style={{
                borderColor: d ? '#1a1916' : '#e8e6e0',
                background: '#fafaf8',
                color: '#1a1916',
              }}
            />
          ))}
        </div>

        <button
          disabled={authSubmitting || otpCode.length !== 6}
          onClick={handleAuthVerifyOtp}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90 mb-3"
          style={{ backgroundColor: '#1a1916' }}
        >
          {authSubmitting ? 'Verifying…' : 'Verify & confirm booking'}
        </button>

        <p className="text-xs text-center text-[#9b9890]">
          Didn&apos;t receive the code?{' '}
          <button
            type="button"
            className="font-semibold hover:underline"
            style={{ color: '#1a1916' }}
            onClick={async () => {
              try {
                await fetch('/api/auth/email/resend-otp', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: authEmail.trim().toLowerCase() }),
                });
                setAuthError(null);
              } catch {
                setAuthError('Could not resend code. Please try again.');
              }
            }}
          >
            Resend
          </button>
        </p>
      </ModalShell>
    );
  }

  // ── Step 3: booking confirmed ──────────────────────────────────────────────
  if (authStep === 'register-success') {
    return (
      <ModalShell onClose={onClose}>
        <div className="text-center py-2 mb-5">
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#d8f2e8' }}>
            <Check size={28} style={{ color: '#2e9f82' }} />
          </div>
          <h3 className="font-bold text-xl text-[#1a1916] mb-1">Viewing requested!</h3>
          <p className="text-sm text-[#6b6860]">
            Your account is ready and your viewing request is submitted.
          </p>
        </div>
        <button
          disabled={authSubmitting}
          onClick={() => router.push('/dashboard/customer/spaces')}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90 mb-3"
          style={{ backgroundColor: '#1a1916' }}
        >
          Track my booking
        </button>
        <button
          disabled={authSubmitting}
          onClick={onClose}
          className="w-full py-3 rounded-xl text-sm font-semibold border border-[#e8e6e0] text-[#1a1916] disabled:opacity-40 hover:bg-[#f9f8f6] transition-colors"
        >
          Continue browsing
        </button>
        <div className="mt-4 flex items-center justify-center gap-4 text-sm">
          <Link href="/listings" className="underline underline-offset-2 text-[#9b9890] hover:text-[#1a1916]">
            Browse listings
          </Link>
          <span className="text-[#c8c6c0]">|</span>
          <Link href="/services" className="underline underline-offset-2 text-[#9b9890] hover:text-[#1a1916]">
            Browse services
          </Link>
        </div>
      </ModalShell>
    );
  }

  if (done) {
    const dt = new Date(done);
    const dateStr = dt.toLocaleDateString('en-AE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dubai' });
    const timeStr = dt.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' });
    return (
      <ModalShell onClose={onClose}>
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#d8f2e8' }}>
            <Check size={28} style={{ color: '#2e9f82' }} />
          </div>
          <h3 className="font-bold text-xl text-[#1a1916] mb-2">Viewing Booked!</h3>
          <p className="text-sm text-[#6b6860] mb-1">{property.buildingName} · {unit.unitName ?? `Unit ${unit.unitNumber}`}</p>
          <p className="text-sm font-semibold text-[#1a1916]">{dateStr}</p>
          <p className="text-sm text-[#9b9890]">{timeStr}</p>
          <p className="mt-3 text-xs text-[#9b9890]">The rental provider will confirm your viewing shortly.</p>

          {/* Next-step nudge */}
          <div className="mt-5 rounded-xl p-4 text-left" style={{ backgroundColor: '#f0faf6', border: '1px solid #c3e8da' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#2e9f82' }}>You&apos;re just 1 step away!</p>
            <p className="text-sm text-[#1a1916] font-medium mb-0.5">Attend your viewing &amp; sign your lease</p>
            <p className="text-xs text-[#6b6860]">Once the provider confirms, visit your viewings dashboard to track status and move to contract.</p>
          </div>

          <button
            onClick={() => router.push('/dashboard/customer/spaces')}
            className="mt-4 w-full py-3 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#2e9f82' }}
          >
            Go to My Spaces →
          </button>
          <button onClick={onClose} className="mt-2 w-full py-2.5 rounded-xl text-sm font-medium text-[#6b6860] bg-[#f4f3f0] hover:bg-[#ece9e3] transition-colors">
            Stay on this page
          </button>
          <div className="mt-4 flex items-center justify-center gap-4 text-sm">
            <Link href="/listings" className="underline underline-offset-2" style={{ color: '#2e9f82' }}>
              Browse listings
            </Link>
            <span className="text-[#c8c6c0]">|</span>
            <Link href="/services" className="underline underline-offset-2" style={{ color: '#2e9f82' }}>
              Browse services
            </Link>
          </div>
        </div>
      </ModalShell>
    );
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <ModalShell onClose={onClose}>
      <h3 className="font-bold text-xl text-[#1a1916] mb-1">Book a Viewing</h3>
      <p className="text-sm text-[#9b9890] mb-5">{unit.unitName ?? `Unit ${unit.unitNumber}`} · {property.buildingName}</p>
      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>
      )}

      {/* Date + Time — horizontal */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-[#3d3b35] mb-2">
            <Calendar size={14} className="inline mr-1.5" />Pick a date
          </label>
          <MiniCalendar value={date} onChange={setDate} />
          {date && (
            <p className="mt-2 text-xs text-center font-medium" style={{ color: '#2e9f82' }}>
              {new Date(date + 'T00:00:00').toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
          )}
        </div>
        <div className="flex flex-col">
          <label className="block text-sm font-medium text-[#3d3b35] mb-2">
            Preferred time <span className="text-[#9b9890] font-normal">(optional)</span>
          </label>
          <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[200px] pr-1">
            {TIME_SLOTS.filter(slot => {
              if (date !== today) return true;
              const [h] = slot.split(':').map(Number);
              return h > new Date().getHours();
            }).map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => setTime(time === slot ? '' : slot)}
                className="w-full py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer shrink-0"
                style={{
                  borderColor: time === slot ? '#2e9f82' : '#e8e6e0',
                  backgroundColor: time === slot ? '#edf7f3' : '#fff',
                  color: time === slot ? '#2e9f82' : '#3d3b35',
                }}
              >
                {fmtSlot(slot)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preferred move-in date — optional */}
      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">
        Preferred move-in date <span className="text-[#9b9890] font-normal">(optional)</span>
      </label>
      <input
        type="date"
        value={moveInDate}
        min={new Date().toISOString().split('T')[0]}
        onChange={(e) => setMoveInDate(e.target.value)}
        className="w-full text-sm mb-4 border border-[#e8e6e0] rounded-xl px-3 py-2.5 text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
      />

      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">
        Notes <span className="text-[#9b9890] font-normal">(optional)</span>
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Any questions or special requests…"
        className="w-full text-sm mb-5 border border-[#e8e6e0] rounded-xl px-3 py-2.5 text-[#1a1916] resize-none focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
      />
      <button
        disabled={!date || submitting}
        onClick={handleBook}
        className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#2e9f82' }}
      >
        {submitting ? 'Booking…' : 'Confirm Viewing'}
      </button>
    </ModalShell>
  );
}

/* ── Book Now Modal ─────────────────────────────────────────────────────── */
function InquireModal({ unit, property, onClose }: { unit: PublicUnit; property: PublicProperty; onClose: () => void }) {
  const router = useRouter();

  // Form state
  const [moveIn,       setMoveIn]       = useState('');
  const [adults,       setAdults]       = useState('1');
  const [children,     setChildren]     = useState('0');
  const [pets,         setPets]         = useState('0');
  const [installments, setInstallments] = useState('4');
  const [msg,          setMsg]          = useState('');

  // Submission state
  const [submitting, setSubmitting]   = useState(false);
  const [error,      setError]        = useState<string | null>(null);
  const [contractId, setContractId]   = useState<number | null>(null); // set on success

  // Inline auth state
  type AuthStep = null | 'register' | 'verify-otp';
  const [authStep,       setAuthStep]       = useState<AuthStep>(null);
  const [authMode,       setAuthMode]       = useState<'register' | 'login'>('register');
  const [authEmail,      setAuthEmail]      = useState('');
  const [authDevOtp,     setAuthDevOtp]     = useState<string | null>(null);
  const [authOtp,        setAuthOtp]        = useState(['','','','','','']);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError,      setAuthError]      = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([null,null,null,null,null,null]);

  // ── Submit contract ────────────────────────────────────────────────────
  async function submitContract(): Promise<boolean> {
    setError(null);
    setSubmitting(true);
    try {
      const start = new Date(moveIn);
      const end   = new Date(start);
      end.setFullYear(end.getFullYear() + 1);
      end.setDate(end.getDate() - 1); // 1-year lease: end = start + 1yr - 1day
      const body = {
        unitId:              unit.id,
        contractStartDate:   moveIn,
        contractEndDate:     end.toISOString().split('T')[0],
        annualRent:          Number(unit.rentalPrice),
        numberOfInstallments: Number(installments),

        notes:               msg || undefined,
      };
      const res = await fetch('/api/contracts/tenant/initiate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const m = Array.isArray(data.message) ? data.message.join(', ') : data.message ?? `Error ${res.status}`;
        throw new Error(m);
      }
      setContractId(data.id ?? null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  // ── Handle main submit button ──────────────────────────────────────────
  async function handleSubmit() {
    setError(null);
    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (meRes.status === 401) {
      setAuthStep('register');
      return;
    }
    const me = await meRes.json().catch(() => ({}));
    if (me.role && me.role !== 'customer') {
      setError('Only customer accounts can submit rental applications. Please sign in as a customer.');
      return;
    }
    await submitContract();
  }

  // ── Step 1: send OTP (register or sign-in) ────────────────────────────
  async function handleIdentify() {
    const email = authEmail.trim().toLowerCase();
    if (!email) { setAuthError('Enter your email address.'); return; }
    setAuthError(null); setAuthSubmitting(true);
    try {
      const endpoint = authMode === 'register'
        ? '/api/auth/register/customer'
        : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();
      if (!res.ok) {
        const m = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Something went wrong';
        throw new Error(m);
      }
      if (body.devOtp) setAuthDevOtp(body.devOtp);
      setAuthOtp(['','','','','','']);
      setAuthStep('verify-otp');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setAuthSubmitting(false);
    }
  }

  // ── Step 2: verify OTP → then submit contract ─────────────────────────
  async function handleVerifyOtp() {
    const code = authOtp.join('');
    if (code.length !== 6) { setAuthError('Enter the 6-digit code.'); return; }
    setAuthError(null); setAuthSubmitting(true);
    try {
      const email = authEmail.trim().toLowerCase();
      let res: Response;
      if (authMode === 'register') {
        res = await fetch('/api/auth/email/verify-otp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code }),
        });
      } else {
        res = await fetch('/api/auth/login/verify-otp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: email, code }),
        });
      }
      const body = await res.json();
      if (!res.ok) {
        const m = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Verification failed';
        throw new Error(m);
      }
      const ok = await submitContract();
      if (!ok) setAuthError('Verified! But could not create your reservation. Please try again.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setAuthSubmitting(false);
    }
  }

  function handleOtpDigit(i: number, v: string) {
    const d = v.replace(/\D/g,'').slice(-1);
    const next = [...authOtp]; next[i] = d; setAuthOtp(next);
    if (d && i < 5) otpRefs.current[i+1]?.focus();
  }
  function handleOtpKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !authOtp[i] && i > 0) otpRefs.current[i-1]?.focus();
  }
  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const p = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6);
    if (p.length === 6) { setAuthOtp(p.split('')); otpRefs.current[5]?.focus(); e.preventDefault(); }
  }

  const inputCls = 'w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2.5 text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30';

  // ── Success state ──────────────────────────────────────────────────────
  if (contractId !== null) {
    return (
      <ModalShell onClose={onClose}>
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#d8f2e8' }}>
            <CheckCircle2 size={24} style={{ color: '#2e9f82' }} />
          </div>
          <h3 className="font-bold text-xl text-[#1a1916] mb-2">Reservation Submitted!</h3>
          <p className="text-sm text-[#6b6860] mb-1">Your application for <span className="font-medium text-[#1a1916]">{unit.unitName ?? `Unit ${unit.unitNumber}`}</span> has been received.</p>
          <p className="text-xs text-[#9b9890] mb-6">Reference: <span className="font-mono font-medium">CID-{contractId}</span> · We&apos;ll be in touch within 24 hours.</p>
          <button
            onClick={() => router.push('/dashboard/customer/spaces')}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#2e9f82' }}
          >
            View My Application &amp; Upload Documents
          </button>
          <button onClick={onClose} className="mt-2 w-full py-2.5 rounded-xl text-sm font-medium text-[#6b6860] bg-[#f4f3f0] hover:bg-[#ece9e3] transition-colors">
            Stay on this page
          </button>
        </div>
      </ModalShell>
    );
  }

  // ── Step 1: email entry (register or sign-in toggle) ──────────────────
  if (authStep === 'register') {
    return (
      <ModalShell onClose={onClose}>
        <div className="flex rounded-xl overflow-hidden border border-[#e8e6e0] mb-5">
          <button type="button" onClick={() => { setAuthMode('register'); setAuthError(null); }}
            className="flex-1 py-2.5 text-sm font-semibold transition-colors"
            style={{ backgroundColor: authMode === 'register' ? '#1a1916' : 'transparent', color: authMode === 'register' ? '#fff' : '#6b6860' }}>
            Create account
          </button>
          <button type="button" onClick={() => { setAuthMode('login'); setAuthError(null); }}
            className="flex-1 py-2.5 text-sm font-semibold transition-colors"
            style={{ backgroundColor: authMode === 'login' ? '#1a1916' : 'transparent', color: authMode === 'login' ? '#fff' : '#6b6860' }}>
            Sign in
          </button>
        </div>
        <h3 className="font-bold text-xl text-[#1a1916] mb-1">
          {authMode === 'register' ? 'Create your account' : 'Welcome back'}
        </h3>
        <p className="text-sm text-[#9b9890] mb-5">
          {authMode === 'register' ? 'Enter your email — we\'ll send a verification code.' : 'Enter your email — we\'ll send a sign-in code.'}
        </p>
        {authError && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{authError}</div>}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#3d3b35] uppercase tracking-wide mb-1.5">Email address</label>
          <input
            type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleIdentify()}
            placeholder="you@example.com" autoComplete="email" autoFocus
            className={inputCls}
          />
        </div>
        <button disabled={authSubmitting || !authEmail.trim()} onClick={handleIdentify}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#1a1916' }}>
          {authSubmitting ? 'Sending code…' : 'Send verification code →'}
        </button>
      </ModalShell>
    );
  }

  // ── Step 2: OTP verification ───────────────────────────────────────────
  if (authStep === 'verify-otp') {
    const otpCode = authOtp.join('');
    return (
      <ModalShell onClose={onClose}>
        <button type="button" onClick={() => { setAuthStep('register'); setAuthError(null); setAuthOtp(['','','','','','']); }}
          className="flex items-center gap-1 text-xs text-[#9b9890] hover:text-[#1a1916] mb-4 transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
        <h3 className="font-bold text-xl text-[#1a1916] mb-1">Check your email</h3>
        <p className="text-sm text-[#9b9890] mb-5">
          We sent a 6-digit code to <span className="font-semibold text-[#1a1916]">{authEmail}</span>
        </p>
        {authError && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{authError}</div>}
        {authDevOtp && (
          <div className="mb-4 rounded-xl px-4 py-3 text-sm font-mono font-bold tracking-widest text-center"
            style={{ background: '#fdf3e1', color: '#7e3b00' }}>
            Dev code: {authDevOtp}
          </div>
        )}
        <div className="flex gap-2 justify-center mb-5">
          {authOtp.map((v, i) => (
            <input key={i} ref={el => { otpRefs.current[i] = el; }}
              type="text" inputMode="numeric" maxLength={1} value={v} autoFocus={i === 0}
              onChange={e => handleOtpDigit(i, e.target.value)}
              onKeyDown={e => { handleOtpKey(i, e); if (e.key === 'Enter' && otpCode.length === 6) handleVerifyOtp(); }}
              onPaste={handleOtpPaste}
              className="w-11 h-12 text-center text-lg font-bold border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1a1916]/20"
              style={{ borderColor: v ? '#1a1916' : '#e8e6e0', background: '#fafaf8', color: '#1a1916' }}
            />
          ))}
        </div>
        <button disabled={authSubmitting || otpCode.length !== 6} onClick={handleVerifyOtp}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#1a1916' }}>
          {authSubmitting ? 'Verifying…' : 'Verify & reserve'}
        </button>
        <p className="text-xs text-center text-[#9b9890] mt-3">
          Didn&apos;t receive the code?{' '}
          <button type="button" className="font-semibold hover:underline" style={{ color: '#1a1916' }}
            onClick={async () => {
              try {
                await fetch('/api/auth/email/resend-otp', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: authEmail.trim().toLowerCase() }),
                });
              } catch { setAuthError('Could not resend. Please try again.'); }
            }}>Resend</button>
        </p>
      </ModalShell>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────
  return (
    <ModalShell onClose={onClose}>
      <h3 className="font-bold text-xl text-[#1a1916] mb-1">Book Now</h3>
      <p className="text-sm text-[#9b9890] mb-5">{unit.unitName ?? `Unit ${unit.unitNumber}`} · {property.buildingName}</p>

      {error && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">Move-in date <span className="text-red-500">*</span></label>
      <input type="date" value={moveIn} min={new Date().toISOString().split('T')[0]} required
        onChange={e => setMoveIn(e.target.value)} className={`${inputCls} mb-4`} />

      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">Occupants <span className="text-red-500">*</span></label>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[['Adults','1',adults,setAdults],['Children','0',children,setChildren],['Pets','0',pets,setPets]].map(([label, min, val, setter]) => (
          <div key={label as string}>
            <p className="text-[11px] text-[#9b9890] mb-1">{label as string}</p>
            <input type="number" min={min as string} value={val as string} onChange={e => (setter as (v:string)=>void)(e.target.value)} className={inputCls} />
          </div>
        ))}
      </div>

      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">Payment installments</label>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[['1','Annual'],['2','Semi-annual'],['4','Quarterly'],['12','Monthly']].map(([v, lbl]) => (
          <button key={v} type="button" onClick={() => setInstallments(v)}
            className={`py-2 rounded-xl text-xs font-medium border transition-colors ${installments === v ? 'border-[#2e9f82] bg-[#d8f2e8] text-[#1a7a5a]' : 'border-[#e8e6e0] text-[#6b6860] hover:border-[#2e9f82]'}`}>
            {lbl}
          </button>
        ))}
      </div>


      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">Message <span className="text-[#9b9890] font-normal">(optional)</span></label>
      <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2}
        placeholder="Any questions or requirements…"
        className={`${inputCls} resize-none mb-5`} />

      <button disabled={!moveIn || Number(adults) < 1 || submitting} onClick={handleSubmit}
        className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#2e9f82' }}>
        {submitting ? 'Submitting…' : 'Submit Application'}
      </button>
    </ModalShell>
  );
}

/* ── Modal shell ─────────────────────────────────────────────────────────── */
function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl p-8 w-full max-w-xl shadow-xl overflow-y-auto max-h-[90vh]">
        <button className="absolute top-4 right-4 text-[#9b9890] hover:text-[#1a1916]" onClick={onClose}>
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ── Header auth section ──────────────────────────────────────────────────── */
function HeaderAuthSection() {
  const { isAuthenticated, user, signOut } = useAuth();

  if (isAuthenticated && user) {
    const displayName = user.name ?? [user.firstName, user.lastName].filter(Boolean).join(' ');
    const initials = (displayName?.charAt(0) ?? 'U').toUpperCase();
    const dest = dashboardPath(user.role as UserRole);
    return (
      <div className="flex items-center gap-3">
        <Link href={dest} className="text-sm font-medium hover:text-[#1a1916] transition-colors">
          Dashboard
        </Link>
        <button
          onClick={() => { signOut(); }}
          className="text-sm hover:text-[#1a1916] transition-colors"
        >
          Sign Out
        </button>
        <Link href={dest} className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: '#2e9f82' }}>
          {initials}
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link href="/login" className="hover:text-[#1a1916] transition-colors">Sign In</Link>
      <Link href="/register" className="py-2 px-4 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: '#2e9f82' }}>
        Register
      </Link>
    </>
  );
}

/* ── Main page component ─────────────────────────────────────────────────── */
export default function ListingPageClient({ unit, property, media = [] }: { unit: PublicUnit; property: PublicProperty; media?: UnitMediaItem[] }) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [modal, setModal] = useState<'book' | 'inquire' | null>(null);

  // Auto-open booking modal if user just returned from login with a saved intent
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BOOKING_INTENT_KEY);
      if (raw) {
        const intent = JSON.parse(raw);
        if (intent.unitId === unit.id) {
          setModal('book');
        }
      }
    } catch { /* ignore */ }
  }, [unit.id]);

  const catKey = property.spaceCategory.toLowerCase();
  const fallbackImages = CATEGORY_IMAGES[catKey] ?? FALLBACK_IMAGES;
  // Use real uploaded photos if available; otherwise fall back to Unsplash placeholders
  // Relative URLs (e.g. /uploads/...) are proxied via Next.js rewrites — works on any device
  const images: string[] = media.length > 0
    ? media.map(m => m.url.startsWith('http') ? m.url : m.url)
    : fallbackImages;
  const catBg = CATEGORY_BG[catKey] ?? '#f4f3ef';
  const avail = AVAIL_STYLE[unit.availability] ?? { bg: '#f4f3ef', text: '#6b6860', label: unit.availability };
  const unitLabel = unit.unitName ?? `Unit ${unit.unitNumber}`;

  const specs = [
    unit.bedrooms != null && { icon: <BedDouble size={18} />, label: 'Bedrooms', value: unit.bedrooms === 0 ? 'Studio' : String(unit.bedrooms) },
    unit.bathrooms != null && { icon: <Bath size={18} />, label: 'Bathrooms', value: String(unit.bathrooms) },
    unit.unitSizeSqft && { icon: <Maximize2 size={18} />, label: 'Size (sqft)', value: `${fmt(Number(unit.unitSizeSqft))} sqft` },
    unit.unitSizeSqm && { icon: <Ruler size={18} />, label: 'Size (sqm)', value: `${fmt(Number(unit.unitSizeSqm))} sqm` },
    unit.floor && { icon: <Layers size={18} />, label: 'Floor', value: unit.floor },
    unit.unitTier && { icon: <Star size={18} />, label: 'Tier', value: humanType(unit.unitTier) },
    unit.view && { icon: <ImageIcon size={18} />, label: 'View', value: unit.view },
    unit.numAcs > 0 && { icon: <Wind size={18} />, label: 'A/Cs', value: String(unit.numAcs) },
    unit.numHeaters > 0 && { icon: <Flame size={18} />, label: 'Heaters', value: String(unit.numHeaters) },
    unit.numWindows > 0 && { icon: <AppWindow size={18} />, label: 'Windows', value: String(unit.numWindows) },
    unit.numDoors > 0 && { icon: <DoorOpen size={18} />, label: 'Doors', value: String(unit.numDoors) },
    unit.kitchenType && { icon: <CheckCircle2 size={18} />, label: 'Kitchen', value: `${humanType(unit.kitchenType)} Kitchen` },
    unit.numBalconies > 0 && { icon: <CheckCircle2 size={18} />, label: 'Balconies', value: String(unit.numBalconies) },
    unit.premiseNumber && { icon: <Hash size={18} />, label: 'Premise No.', value: unit.premiseNumber },
  ].filter(Boolean) as Array<{ icon: React.ReactNode; label: string; value: string }>;

  const facilities: string[] = (() => {
    try { return JSON.parse(unit.facilities ?? '[]'); } catch { return []; }
  })();

  // `facilities` is the authoritative per-unit amenities list set by the RP.
  const features = facilities;

  const displayAddress = buildAddress(property);
  const lat = property.latitude != null ? Number(property.latitude) : null;
  const lng = property.longitude != null ? Number(property.longitude) : null;
  const hasCoords = lat != null && lng != null && !isNaN(lat) && !isNaN(lng);

  const openGallery = (i: number) => { setGalleryIdx(i); setGalleryOpen(true); };

  return (
    <div className="min-h-screen bg-white">
      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#e8e6e0]">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between">
          <Link href="/listings" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl text-sm font-extrabold text-white" style={{ backgroundColor: '#2e9f82' }}>U</span>
            <span className="font-extrabold text-lg text-[#1a1916] tracking-tight">UpNow</span>
          </Link>
          <div className="hidden sm:flex items-center gap-4 text-sm text-[#6b6860]">
            <Link href="/listings" className="hover:text-[#1a1916] transition-colors">Browse Listings</Link>
            <HeaderAuthSection />
          </div>
        </div>
      </header>

      <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-10 pt-4 pb-24">
        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <nav className="text-sm py-4 text-[#9b9890]">
          <Link href="/" className="hover:text-[#1a1916] transition-colors">Home</Link>
          <span className="mx-1.5 text-[#c8c6c0]">/</span>
          <Link href="/listings" className="hover:text-[#1a1916] transition-colors">Listings</Link>
          <span className="mx-1.5 text-[#c8c6c0]">/</span>
          <Link href={`/listings?category=${catKey}`} className="hover:text-[#1a1916] transition-colors">{humanType(property.spaceCategory)}</Link>
          <span className="mx-1.5 text-[#c8c6c0]">/</span>
          <span className="text-[#3d3b35]">{unitLabel}</span>
        </nav>

        {/* ── Gallery ─────────────────────────────────────────────────────── */}
        <div className="mb-8 overflow-hidden rounded-2xl">
          {/* Desktop: 60% main + 40% right */}
          <div className="hidden md:grid gap-2" style={{ gridTemplateColumns: '60% 40%', gridTemplateRows: 'repeat(3, 140px)' }}>
            <div
              className="relative row-span-3 cursor-pointer overflow-hidden"
              onClick={() => openGallery(0)}
            >
              <img src={images[0]} alt={unitLabel} className="w-full h-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
              <button
                className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-white rounded-full px-4 py-2 text-sm font-medium text-[#1a1916] shadow-md hover:shadow-lg transition-shadow"
                onClick={(e) => { e.stopPropagation(); openGallery(0); }}
              >
                <ImageIcon size={15} /> Show all photos
              </button>
            </div>
            {images.slice(1, 4).map((img, i) => (
              <div key={i} className="cursor-pointer overflow-hidden" onClick={() => openGallery(i + 1)}>
                <img src={img} alt={`${unitLabel} ${i + 2}`} className="w-full h-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
              </div>
            ))}
          </div>
          {/* Mobile */}
          <div className="md:hidden relative cursor-pointer overflow-hidden rounded-2xl" style={{ height: 260 }} onClick={() => openGallery(0)}>
            <img src={images[0]} alt={unitLabel} className="w-full h-full object-cover" />
            <button className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-white rounded-full px-3 py-1.5 text-xs font-medium text-[#1a1916] shadow-md">
              <ImageIcon size={13} /> {images.length} photos
            </button>
          </div>
        </div>

        {/* ── Title block ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="text-xs font-medium rounded-full px-3 py-1" style={{ backgroundColor: catBg, color: '#1a1916' }}>
            {humanType(property.spaceCategory)}
          </span>
          <span className="text-xs font-medium rounded-full px-3 py-1 bg-[#e8e6e0] text-[#3d3b35]">
            {humanType(unit.unitType)}
          </span>
          <span className="text-xs font-medium rounded-full px-3 py-1" style={{ backgroundColor: avail.bg, color: avail.text }}>
            {avail.label}
          </span>
        </div>
        <h1 className="font-bold text-[42px] leading-tight text-[#1a1916]">{unitLabel}</h1>
        <div className="flex items-center gap-2 mt-2 text-[#3d3b35]">
          <MapPin size={18} style={{ color: '#2e9f82', flexShrink: 0 }} />
          <span className="text-base">{displayAddress}</span>
        </div>
        {unit.rentalPrice != null && (
          <>
            <p className="font-bold mt-4 text-[36px]" style={{ color: '#2e9f82' }}>
              {fmtAed(unit.rentalPrice)}
            </p>
            <p className="text-base text-[#9b9890]">per year</p>
          </>
        )}

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-10 items-start mt-8">
          {/* Left */}
          <div className="flex-grow min-w-0">

            {/* Key specs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
              {specs.map((s) => (
                <div key={s.label} className="bg-white border border-[#e8e6e0] rounded-xl p-4 flex items-center gap-3 shadow-sm">
                  <span style={{ color: '#2e9f82' }}>{s.icon}</span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#9b9890]">{s.label}</p>
                    <p className="text-sm font-semibold text-[#1a1916]">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Description */}
            {(unit.description ?? property.propertyDescription) && (
              <div className="mb-8">
                <h2 className="font-semibold text-[22px] text-[#1a1916] mb-3">About this space</h2>
                <p className="text-base text-[#3d3b35] leading-[1.7] whitespace-pre-wrap">
                  {unit.description ?? property.propertyDescription}
                </p>
              </div>
            )}

            {/* Features */}
            {features.length > 0 && (
              <div className="mb-8">
                <h2 className="font-semibold text-[22px] text-[#1a1916] mb-3">Key features</h2>
                <div className="grid grid-cols-2 gap-3">
                  {features.map((f) => (
                    <div key={f} className="flex items-center gap-2">
                      <div className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full" style={{ backgroundColor: '#d8f2e8' }}>
                        <Check size={11} style={{ color: '#2e9f82' }} />
                      </div>
                      <span className="text-sm text-[#3d3b35]">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Building details */}
            {(property.buildingName || property.numberOfFloors) && (
              <div className="mb-8">
                <h2 className="font-semibold text-[22px] text-[#1a1916] mb-3">Building details</h2>
                <div className="bg-[#f4f3ef] rounded-xl divide-y divide-[#e8e6e0]">
                  {property.buildingName && (
                    <div className="flex justify-between px-4 py-3 text-sm">
                      <span className="text-[#6b6860]">Building Name</span>
                      <span className="font-medium text-[#1a1916]">{property.buildingName}</span>
                    </div>
                  )}
                  {property.numberOfFloors && (
                    <div className="flex justify-between px-4 py-3 text-sm">
                      <span className="text-[#6b6860]">Total Floors</span>
                      <span className="font-medium text-[#1a1916]">{property.numberOfFloors}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Location */}
            <div className="mb-8">
              <h2 className="font-semibold text-[22px] text-[#1a1916] mb-3">Location</h2>
              {hasCoords ? (
                <div className="rounded-2xl overflow-hidden" style={{ height: 240 }}>
                  <iframe
                    title="Unit location"
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng! - 0.005},${lat! - 0.005},${lng! + 0.005},${lat! + 0.005}&layer=mapnik&marker=${lat},${lng}`}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-2xl" style={{ backgroundColor: '#eef8f5', height: 180 }}>
                  <div className="text-center">
                    <MapPin size={28} style={{ color: '#2e9f82', margin: '0 auto' }} />
                    <p className="text-sm mt-2 text-[#3d3b35]">{displayAddress}</p>
                  </div>
                </div>
              )}
    
            </div>

          </div>

          {/* Right — Desktop sticky panel */}
          <aside
            className="hidden lg:block flex-shrink-0 bg-white rounded-2xl shadow-md p-7"
            style={{ width: 360, position: 'sticky', top: 84 }}
          >
            <h2 className="font-semibold text-xl text-[#1a1916] mb-4">Interested in this space?</h2>
            <InquiryPanel unit={unit} property={property} onBook={() => setModal('book')} onInquire={() => setModal('inquire')} />
          </aside>
        </div>
      </div>

      {/* Mobile bottom bar */}
      <div className="fixed bottom-0 inset-x-0 lg:hidden z-50 flex items-center justify-between bg-white border-t border-[#e8e6e0] px-5 py-4">
        <div>
          {unit.rentalPrice != null && (
            <p className="font-bold text-[#1a1916] text-base">{fmtAed(unit.rentalPrice)}<span className="text-xs font-normal text-[#9b9890]"> /yr</span></p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setModal('inquire')}
            className="py-2.5 px-5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#2e9f82' }}
          >
            Book Now
          </button>
          <button
            onClick={() => setModal('book')}
            className="py-2.5 px-4 rounded-xl text-sm font-semibold border"
            style={{ borderColor: '#2e9f82', color: '#2e9f82' }}
          >
            Schedule Viewing
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {galleryOpen && (
        <GalleryModal
          images={images}
          index={galleryIdx}
          onClose={() => setGalleryOpen(false)}
          onNav={setGalleryIdx}
        />
      )}

      {/* Modals */}
      {modal === 'book' && <BookModal unit={unit} property={property} onClose={() => setModal(null)} />}
      {modal === 'inquire' && <InquireModal unit={unit} property={property} onClose={() => setModal(null)} />}
    </div>
  );
}
