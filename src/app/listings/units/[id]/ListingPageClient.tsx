'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth, dashboardPath, type UserRole } from '@/contexts/AuthContext';
import {
  MapPin, X, ChevronLeft, ChevronRight, BedDouble, Bath, Maximize2,
  Layers, Wind, CheckCircle2, Check, Shield, Clock,
  Calendar, MessageSquare, ImageIcon,
  Flame, AppWindow, DoorOpen, Ruler,
} from 'lucide-react';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';

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
  securityDeposit: string | number | null;
  adminFee: string | number | null;
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
  // Unit prices (rental_price, market_price, security_deposit, admin_fee,
  // service_charges) are stored in whole AED — NOT fils. Format as-is.
  const aed = Number(n);
  if (isNaN(aed)) return null;
  return `AED ${new Intl.NumberFormat('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(aed)}`;
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
  unit, property, onBook, onInquire, canBook,
}: { unit: PublicUnit; property: PublicProperty; onBook: () => void; onInquire: () => void; canBook: boolean }) {
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

      {/* CTA buttons — hidden for non-tenant roles (rental_provider, manager,
          admin, super_admin) since those accounts can't lease a unit through
          this flow. They're shown a contextual note instead so they know
          why the CTAs are absent. */}
      {canBook ? (
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
      ) : (
        <div className="bg-[#f4f3ef] border border-[#e8e6e0] rounded-xl p-3 mb-5 text-center">
          <p className="text-xs text-[#6b6860]">
            You're browsing listings from your operator account. Sign in with a customer account to book or schedule a viewing.
          </p>
        </div>
      )}

      {/* Public listing shows the asking Annual Rent only — no deposit / fees /
          internal market value. */}
      {unit.rentalPrice != null && (
        <div className="bg-[#f4f3ef] rounded-xl p-4 text-sm mb-4">
          <div className="flex justify-between items-baseline">
            <span className="text-[#6b6860]">Annual Rent</span>
            <span className="font-bold text-[#1a1916]">{fmtAed(unit.rentalPrice)}</span>
          </div>
        </div>
      )}

      {/* Building highlights */}
      {(property.hasParking || property.hasGym || property.hasPool) && (
        <div className="flex flex-wrap gap-2">
          {property.hasParking && (
            <span className="text-xs font-medium rounded-full px-3 py-1.5 bg-[#f4f3ef] text-[#3d3b35]">🅿 Parking</span>
          )}
          {property.hasGym && (
            <span className="text-xs font-medium rounded-full px-3 py-1.5 bg-[#f4f3ef] text-[#3d3b35]">🏋️ Gym</span>
          )}
          {property.hasPool && (
            <span className="text-xs font-medium rounded-full px-3 py-1.5 bg-[#f4f3ef] text-[#3d3b35]">🏊 Pool</span>
          )}
        </div>
      )}
    </>
  );
}

/* ── Mini Calendar ──────────────────────────────────────────────────────── */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Nearest upcoming date (today or later) whose day-of-month is allowed.
 *  '' when there is no restriction (so no preselection). */
function nextAllowedDate(allowedDays?: number[]): string {
  if (!Array.isArray(allowedDays) || allowedDays.length === 0) return '';
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 366; i++) {
    if (allowedDays.includes(d.getDate())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    d.setDate(d.getDate() + 1);
  }
  return '';
}

function MiniCalendar({ value, onChange, allowedDays, compact }: { value: string; onChange: (v: string) => void; allowedDays?: number[]; compact?: boolean }) {
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
    <div className="rounded-2xl border border-[#e8e6e0] overflow-hidden" style={compact ? { maxWidth: 300 } : undefined}>
      {/* Header */}
      <div className={`flex items-center justify-between ${compact ? 'px-3 py-1.5' : 'px-4 py-3'}`} style={{ backgroundColor: '#f9f8f6' }}>
        <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-[#e8e6e0] transition-colors cursor-pointer">
          <ChevronLeft size={compact ? 14 : 16} style={{ color: '#6b6860' }} />
        </button>
        <span className={`${compact ? 'text-[13px]' : 'text-sm'} font-semibold`} style={{ color: '#1a1916' }}>
          {MONTHS[cursor.month]} {cursor.year}
        </span>
        <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-[#e8e6e0] transition-colors cursor-pointer">
          <ChevronRight size={compact ? 14 : 16} style={{ color: '#6b6860' }} />
        </button>
      </div>
      {/* Day labels */}
      <div className="grid grid-cols-7 border-b border-[#e8e6e0]">
        {DAYS.map(d => (
          <div key={d} className={`text-center font-medium ${compact ? 'text-[10px] py-1' : 'text-xs py-2'}`} style={{ color: '#9b9890' }}>{d}</div>
        ))}
      </div>
      {/* Cells */}
      <div className={`grid grid-cols-7 ${compact ? 'p-1.5 gap-y-0.5' : 'p-2 gap-y-1'}`}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const cellDate = new Date(cursor.year, cursor.month, day);
          const isPast = cellDate < todayDate;
          // When the RP restricts contract-start days, disable any other day-of-month.
          const dayBlocked = Array.isArray(allowedDays) && allowedDays.length > 0 && !allowedDays.includes(day);
          const isDisabled = isPast || dayBlocked;
          const iso = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
          const isSelected = selected
            ? selected.getFullYear() === cursor.year && selected.getMonth() === cursor.month && selected.getDate() === day
            : false;
          const isToday = cellDate.getTime() === todayDate.getTime();
          return (
            <button
              key={i}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onChange(iso)}
              className={`rounded-lg w-full text-center transition-all cursor-pointer ${compact ? 'text-[11px] py-1' : 'text-xs py-1.5'}`}
              style={{
                backgroundColor: isSelected ? '#2e9f82' : isToday && !isSelected && !isDisabled ? '#edf7f3' : 'transparent',
                color: isSelected ? '#fff' : isDisabled ? '#c8c6c0' : '#1a1916',
                fontWeight: isSelected ? 600 : isToday && !isDisabled ? 600 : 400,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
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

function BookModal({ unit, property, preferredStartDays = [], onClose }: { unit: PublicUnit; property: PublicProperty; preferredStartDays?: number[]; onClose: () => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [moveInDate, setMoveInDate] = useState(() => nextAllowedDate(preferredStartDays));
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
        // Full-page navigation (not router.push): the session cookie was just
        // set by the auth step, and a client-side nav can replay a Router-Cache
        // entry that the middleware produced BEFORE the cookie existed (→ /login).
        // A hard navigation sends the cookie through middleware on a fresh
        // request and re-initialises AuthContext cleanly.
        window.location.assign(`/dashboard/customer/spaces/v2/v-${leadId}`);
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
    if (!raw) { setAuthError('Enter your phone number.'); return; }
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
          Enter your phone number. We&apos;ll send a one-time code to sign you in — or create your account instantly if you&apos;re new.
        </p>

        {authError && (
          <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{authError}</div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#3d3b35] uppercase tracking-wide mb-1.5">
            Phone number
          </label>
          <input
            type="tel"
            inputMode="tel"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAuthIdentify()}
            placeholder="+971 50 123 4567"
            autoComplete="tel"
            autoFocus
            className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3.5 py-3 text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 focus:border-[#2e9f82]"
          />
        </div>

        <button
          disabled={authSubmitting || !authEmail.trim()}
          onClick={handleAuthIdentify}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#2e9f82' }}
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
              className="w-11 h-12 text-center text-xl font-semibold border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
              style={{
                borderColor: d ? '#2e9f82' : '#e8e6e0',
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
          style={{ backgroundColor: '#2e9f82' }}
        >
          {authSubmitting ? 'Verifying…' : 'Verify & confirm booking'}
        </button>

        <p className="text-xs text-center text-[#9b9890]">
          Didn&apos;t receive the code?{' '}
          <button
            type="button"
            className="font-semibold hover:underline"
            style={{ color: '#2e9f82' }}
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
          onClick={() => window.location.assign('/dashboard/customer/spaces')}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90 mb-3"
          style={{ backgroundColor: '#2e9f82' }}
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
    const dateStr = dt.toLocaleDateString('en-AE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: APP_TIME_ZONE });
    const timeStr = dt.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE });
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
            onClick={() => window.location.assign('/dashboard/customer/spaces')}
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
              {new Date(date + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' })}
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

      {/* Preferred move-in date — optional; restricted to the RP's contract-start days */}
      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">
        Preferred move-in date <span className="text-[#9b9890] font-normal">(optional)</span>
      </label>
      {preferredStartDays.length > 0 && (
        <p className="text-xs text-[#9b9890] mb-1.5">
          This landlord starts contracts on the {preferredStartDays.map(d => `${d}${['st','nd','rd'][((d % 10) - 1)] || 'th'}`).join(', ')} of the month.
        </p>
      )}
      <div className="mb-4">
        <MiniCalendar value={moveInDate} onChange={setMoveInDate} allowedDays={preferredStartDays} compact />
      </div>

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
function InquireModal({ unit, property, preferredStartDays = [], allowedInstallments = [], onClose }: { unit: PublicUnit; property: PublicProperty; preferredStartDays?: number[]; allowedInstallments?: number[]; onClose: () => void }) {
  const { refresh: refreshAuth } = useAuth();

  // Form state
  const [moveIn,       setMoveIn]       = useState(() => nextAllowedDate(preferredStartDays));
  const [adults,       setAdults]       = useState('1');
  const [children,     setChildren]     = useState('0');
  const [pets,         setPets]         = useState('0');
  const [installments, setInstallments] = useState('4');
  const [msg,          setMsg]          = useState('');

  // Snap the default plan to one this landlord offers (Settings → Rules).
  const installmentChoices = allowedInstallmentPlans(allowedInstallments);
  useEffect(() => {
    if (installmentChoices.length && !installmentChoices.some(p => String(p.value) === installments)) {
      setInstallments(String(installmentChoices[0].value));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedInstallments]);

  // Submission state
  const [submitting, setSubmitting]   = useState(false);
  const [error,      setError]        = useState<string | null>(null);
  const [booked,     setBooked]       = useState(false);
  const [bookedLeadId, setBookedLeadId] = useState<number | null>(null);

  // Inline auth state — unified email-or-phone single-field flow
  type AuthStep = null | 'identify' | 'verify-otp';
  const [authStep,         setAuthStep]         = useState<AuthStep>(null);
  const [authIsNewUser,    setAuthIsNewUser]     = useState(false);
  const [authIdentifier,   setAuthIdentifier]   = useState('');
  const [authVerifyStep,   setAuthVerifyStep]   = useState<'email' | 'phone'>('email');
  const [authDevOtp,       setAuthDevOtp]       = useState<string | null>(null);
  const [authOtp,          setAuthOtp]          = useState(['','','','','','']);
  const [authSubmitting,   setAuthSubmitting]   = useState(false);
  const [authError,        setAuthError]        = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([null,null,null,null,null,null]);

  // ── Submit Book Now — interested consent (no pending contract) ──────────
  // Enters the SAME pipeline as Schedule Viewing: creates a lead at the
  // "interested" stage + auto-generates the payment plan. Documents, cheques
  // and the contract are handled downstream in My Spaces, identical to a
  // viewing that reached "interested".
  async function submitBookNow(): Promise<boolean> {
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        unitId:           unit.id,
        contractStartDate: moveIn,                 // desired move-in
        paymentsCount:     Number(installments),   // rent instalments
        occupantsAdults:   Number(adults) || 1,
        occupantsChildren: Number(children) || 0,
        occupantsPets:     Number(pets) || 0,
        occupantsDetails:  msg || undefined,
      };
      const res = await fetch('/api/leads/book-now', {
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
      setBookedLeadId(typeof data.leadId === 'number' ? data.leadId : null);
      setBooked(true);
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
      setAuthStep('identify');
      return;
    }
    const me = await meRes.json().catch(() => ({}));
    if (me.role && me.role !== 'customer') {
      setError('Only customer accounts can submit rental applications. Please sign in as a customer.');
      return;
    }
    await submitBookNow();
  }

  // ── Step 1: unified email-or-phone identify ───────────────────────────
  async function handleIdentify() {
    const raw = authIdentifier.trim();
    if (!raw) { setAuthError('Enter your phone number.'); return; }

    const isPhone = !raw.includes('@');
    const identifier = isPhone
      ? (raw.startsWith('+') ? raw : /^\d{8,12}$/.test(raw) ? `+971${raw.replace(/^0+/, '')}` : raw)
      : raw.toLowerCase();

    setAuthError(null); setAuthSubmitting(true);
    try {
      // Try login first — works for existing users
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: identifier }),
      });
      const loginBody = await loginRes.json().catch(() => ({})) as Record<string, unknown>;

      if (loginRes.ok) {
        setAuthIsNewUser(false);
        setAuthVerifyStep((loginBody.verificationStep as 'email' | 'phone') ?? (isPhone ? 'phone' : 'email'));
        if (loginBody.devOtp) setAuthDevOtp(loginBody.devOtp as string);
        setAuthOtp(['','','','','','']);
        setAuthStep('verify-otp');
        return;
      }

      // Not found → auto-register as new customer
      const isNotFound = loginRes.status === 401 &&
        typeof loginBody.message === 'string' &&
        loginBody.message.toLowerCase().includes('no account');
      if (!isNotFound) {
        const m = Array.isArray(loginBody.message)
          ? (loginBody.message as string[]).join(', ')
          : (loginBody.message as string) ?? 'Something went wrong';
        throw new Error(m);
      }

      const regPayload = isPhone ? { phone: identifier } : { email: identifier };
      const regRes = await fetch('/api/auth/register/customer', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regPayload),
      });
      const regBody = await regRes.json().catch(() => ({})) as Record<string, unknown>;
      if (!regRes.ok) {
        const m = Array.isArray(regBody.message)
          ? (regBody.message as string[]).join(', ')
          : (regBody.message as string) ?? 'Registration failed';
        throw new Error(m);
      }

      setAuthIsNewUser(true);
      setAuthVerifyStep((regBody.verificationStep as 'email' | 'phone') ?? (isPhone ? 'phone' : 'email'));
      if (regBody.devOtp) setAuthDevOtp(regBody.devOtp as string);
      setAuthOtp(['','','','','','']);
      setAuthStep('verify-otp');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setAuthSubmitting(false);
    }
  }

  // ── Step 2: verify OTP → refresh auth context → submit contract ────────
  async function handleVerifyOtp() {
    const code = authOtp.join('');
    if (code.length !== 6) { setAuthError('Enter the 6-digit code.'); return; }
    setAuthError(null); setAuthSubmitting(true);
    try {
      const identifier = authIdentifier.trim();
      const isPhone = !identifier.includes('@');
      let res: Response;

      if (!authIsNewUser) {
        // Existing user — standard login verify
        res = await fetch('/api/auth/login/verify-otp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, code }),
        });
      } else if (authVerifyStep === 'phone') {
        // New user registered via phone — OTP from /auth/otp/verify
        res = await fetch('/api/auth/otp/verify', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
      } else {
        // New user registered via email — verify email OTP
        res = await fetch('/api/auth/email/verify-otp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier.toLowerCase(), code }),
        });
      }

      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        const m = Array.isArray(body.message)
          ? (body.message as string[]).join(', ')
          : (body.message as string) ?? 'Verification failed';
        throw new Error(m);
      }

      // Sync AuthContext so DashboardShell sees an authenticated user on navigation
      await refreshAuth();

      const ok = await submitBookNow();
      if (!ok) setAuthError('Verified! But could not submit your booking. Please try again.');
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
  if (booked) {
    return (
      <ModalShell onClose={onClose}>
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#d8f2e8' }}>
            <CheckCircle2 size={24} style={{ color: '#2e9f82' }} />
          </div>
          <h3 className="font-bold text-xl text-[#1a1916] mb-2">You&apos;re interested! 🎉</h3>
          <p className="text-sm text-[#6b6860] mb-1">Your interest in <span className="font-medium text-[#1a1916]">{unit.unitName ?? `Unit ${unit.unitNumber}`}</span> is registered.</p>
          {/* Next-step nudge — mirrors the Schedule Viewing flow */}
          <div className="rounded-xl p-3 my-4 text-left" style={{ backgroundColor: '#f0faf6' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#2e9f82' }}>Next step</p>
            <p className="text-sm text-[#1a1916] font-medium mb-0.5">Upload your documents &amp; review your payment plan</p>
            <p className="text-xs text-[#6b6860]">We&apos;ve prepared a payment plan from your preferences. Complete your documents in My Spaces to move toward your contract.</p>
          </div>
          <button
            onClick={() => window.location.assign(
              bookedLeadId
                ? `/dashboard/customer/spaces/v2/v-${bookedLeadId}`
                : '/dashboard/customer/spaces',
            )}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#2e9f82' }}
          >
            Continue in My Spaces
          </button>
          <button onClick={onClose} className="mt-2 w-full py-2.5 rounded-xl text-sm font-medium text-[#6b6860] bg-[#f4f3f0] hover:bg-[#ece9e3] transition-colors">
            Stay on this page
          </button>
        </div>
      </ModalShell>
    );
  }

  // ── Step 1: unified email-or-phone identify ──────────────────────────
  if (authStep === 'identify') {
    return (
      <ModalShell onClose={onClose}>
        <h3 className="font-bold text-xl text-[#1a1916] mb-1">Continue to UpNow</h3>
        <p className="text-sm text-[#9b9890] mb-5">Enter your phone number — we&apos;ll send a verification code.</p>
        {authError && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{authError}</div>}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#3d3b35] uppercase tracking-wide mb-1.5">Phone number</label>
          <input
            type="tel" inputMode="tel" value={authIdentifier} onChange={e => setAuthIdentifier(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleIdentify()}
            placeholder="+971 50 123 4567"
            autoComplete="tel" autoFocus
            className={inputCls}
          />
        </div>
        <button disabled={authSubmitting || !authIdentifier.trim()} onClick={handleIdentify}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#2e9f82' }}>
          {authSubmitting ? 'Sending code…' : 'Send verification code →'}
        </button>
      </ModalShell>
    );
  }

  // ── Step 2: OTP verification ───────────────────────────────────────────
  if (authStep === 'verify-otp') {
    const otpCode = authOtp.join('');
    const isPhoneVerify = authVerifyStep === 'phone';
    return (
      <ModalShell onClose={onClose}>
        <button type="button" onClick={() => { setAuthStep('identify'); setAuthError(null); setAuthOtp(['','','','','','']); }}
          className="flex items-center gap-1 text-xs text-[#9b9890] hover:text-[#1a1916] mb-4 transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
        <h3 className="font-bold text-xl text-[#1a1916] mb-1">
          {isPhoneVerify ? 'Check your phone' : 'Check your email'}
        </h3>
        <p className="text-sm text-[#9b9890] mb-5">
          We sent a 6-digit code to <span className="font-semibold text-[#1a1916]">{authIdentifier}</span>
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
              className="w-11 h-12 text-center text-lg font-bold border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
              style={{ borderColor: v ? '#2e9f82' : '#e8e6e0', background: '#fafaf8', color: '#1a1916' }}
            />
          ))}
        </div>
        <button disabled={authSubmitting || otpCode.length !== 6} onClick={handleVerifyOtp}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#2e9f82' }}>
          {authSubmitting ? 'Verifying…' : 'Verify & reserve'}
        </button>
        <p className="text-xs text-center text-[#9b9890] mt-3">
          Didn&apos;t receive the code?{' '}
          <button type="button" className="font-semibold hover:underline" style={{ color: '#2e9f82' }}
            onClick={async () => {
              try {
                if (!isPhoneVerify) {
                  await fetch('/api/auth/email/resend-otp', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: authIdentifier.trim().toLowerCase() }),
                  });
                }
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
      <p className="text-sm text-[#9b9890] mb-4">{unit.unitName ?? `Unit ${unit.unitNumber}`} · {property.buildingName}</p>

      {/* Booking summary */}
      <div className="rounded-xl p-4 mb-5" style={{ backgroundColor: '#f0faf6' }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[#6b6860]">Annual rent</span>
          <span className="text-sm font-bold text-[#1a1916]">AED {fmt(Number(unit.rentalPrice))}/yr</span>
        </div>
        <p className="text-xs text-[#6b6860] leading-relaxed">
          Tell us your preferences below and confirm your interest. We&apos;ll prepare your payment plan and guide you through documents — no payment is taken now.
        </p>
      </div>

      {error && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">Move-in date <span className="text-red-500">*</span></label>
      {preferredStartDays.length > 0 && (
        <p className="text-xs text-[#9b9890] mb-1.5">
          Contracts start on the {preferredStartDays.map(d => `${d}${['st','nd','rd'][((d % 10) - 1)] || 'th'}`).join(', ')} of the month.
        </p>
      )}
      <div className="mb-4">
        <MiniCalendar value={moveIn} onChange={setMoveIn} allowedDays={preferredStartDays} compact />
      </div>

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
        {installmentChoices.map(p => (
          <button key={p.value} type="button" onClick={() => setInstallments(String(p.value))}
            className={`py-2 rounded-xl text-xs font-medium border transition-colors ${installments === String(p.value) ? 'border-[#2e9f82] bg-[#d8f2e8] text-[#1a7a5a]' : 'border-[#e8e6e0] text-[#6b6860] hover:border-[#2e9f82]'}`}>
            {p.label}
          </button>
        ))}
      </div>


      <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">Notes <span className="text-[#9b9890] font-normal">(optional)</span></label>
      <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2}
        placeholder="Any questions or requirements…"
        className={`${inputCls} resize-none mb-4`} />

      {/* Interested consent */}
      <p className="text-xs text-[#9b9890] mb-3 leading-relaxed">
        By continuing you confirm you&apos;re interested in renting this unit. Next, you&apos;ll review your payment plan and upload your documents.
      </p>

      <button disabled={!moveIn || Number(adults) < 1 || submitting} onClick={handleSubmit}
        className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#2e9f82' }}>
        {submitting ? 'Submitting…' : "I'm Interested — Continue"}
      </button>
    </ModalShell>
  );
}

/* ── Modal shell ─────────────────────────────────────────────────────────── */
function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
export default function ListingPageClient({ unit, property, media = [], preferredStartDays = [], allowedInstallments = [] }: { unit: PublicUnit; property: PublicProperty; media?: UnitMediaItem[]; preferredStartDays?: number[]; allowedInstallments?: number[] }) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [modal, setModal] = useState<'book' | 'inquire' | null>(null);
  const { user } = useAuth();
  // Booking CTAs only make sense for customers (or visitors who haven't logged
  // in yet — they'll be prompted to register as a customer during the flow).
  // Operator-side accounts (rental_provider, manager, admin, super_admin) can
  // still browse the listing but the Book Now / Schedule Viewing surfaces
  // are hidden — those flows aren't wired for non-customer roles.
  const canBook = !user || user.role === 'customer' || user.role === 'service_provider' || user.role === 'technician';

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
    ? media.map(m => m.url.startsWith('http') || m.url.startsWith('/') ? m.url : `/uploads/${m.url}`)
    : fallbackImages;
  const catBg = CATEGORY_BG[catKey] ?? '#f4f3ef';
  const avail = AVAIL_STYLE[unit.availability] ?? { bg: '#f4f3ef', text: '#6b6860', label: unit.availability };
  const unitLabel = unit.unitName ?? `Unit ${unit.unitNumber}`;

  // Hide bedrooms (residential-only) and bathrooms on a non-residential listing:
  // a retail shop showing "Bedrooms: 1 / Bathrooms: 1" is leftover phantom form
  // data. (Washroom counts are kept in the DB for the move-in template, but not
  // surfaced publicly until the form captures a real, RP-verified count.)
  const residential = isResidentialUnitType(unit.unitType);
  const specs = [
    residential && unit.bedrooms != null && { icon: <BedDouble size={18} />, label: 'Bedrooms', value: unit.bedrooms === 0 ? 'Studio' : String(unit.bedrooms) },
    residential && unit.bathrooms != null && { icon: <Bath size={18} />, label: 'Bathrooms', value: String(unit.bathrooms) },
    unit.unitSizeSqft && { icon: <Maximize2 size={18} />, label: 'Size (sqft)', value: `${fmt(Number(unit.unitSizeSqft))} sqft` },
    unit.unitSizeSqm && { icon: <Ruler size={18} />, label: 'Size (sqm)', value: `${fmt(Number(unit.unitSizeSqm))} sqm` },
    unit.floor && { icon: <Layers size={18} />, label: 'Floor', value: unit.floor },
    unit.view && { icon: <ImageIcon size={18} />, label: 'View', value: unit.view },
    unit.numAcs > 0 && { icon: <Wind size={18} />, label: 'A/Cs', value: String(unit.numAcs) },
    unit.numHeaters > 0 && { icon: <Flame size={18} />, label: 'Heaters', value: String(unit.numHeaters) },
    unit.numWindows > 0 && { icon: <AppWindow size={18} />, label: 'Windows', value: String(unit.numWindows) },
    unit.numDoors > 0 && { icon: <DoorOpen size={18} />, label: 'Doors', value: String(unit.numDoors) },
    unit.kitchenType && { icon: <CheckCircle2 size={18} />, label: 'Kitchen', value: `${humanType(unit.kitchenType)} Kitchen` },
    unit.numBalconies > 0 && { icon: <CheckCircle2 size={18} />, label: 'Balconies', value: String(unit.numBalconies) },
  ].filter(Boolean) as Array<{ icon: React.ReactNode; label: string; value: string }>;

  const facilities: string[] = (() => {
    try {
      const parsed = JSON.parse(unit.facilities ?? '[]');
      if (Array.isArray(parsed)) return parsed as string[];
      if (parsed && Array.isArray(parsed.amenities)) return parsed.amenities as string[];
      return [];
    } catch { return []; }
  })();

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
            <span style={{
              width: 24, height: 24, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg, #1f8a6e 0%, #34c79f 100%)',
              color: '#fff', display: 'grid', placeItems: 'center',
              fontSize: 13, fontWeight: 800,
            }}>U</span>
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
        {/* Frame the whole grid so it stays visually contained on the page
            even when the underlying images are white / transparent. Each
            tile gets a cream backdrop (#f4f3ef, same neutral used on the
            inquiry panel) so white-backed images don't vanish into the
            page; a hairline border and subtle shadow give the gallery a
            crisp edge. */}
        <div className="mb-8 overflow-hidden rounded-2xl border border-[#e8e6e0] shadow-sm bg-[#f4f3ef]">
          {/* Desktop: 60% main + 40% right */}
          <div className="hidden md:grid gap-2 p-2" style={{ gridTemplateColumns: '60% 40%', gridTemplateRows: 'repeat(3, 140px)' }}>
            <div
              className="relative row-span-3 cursor-pointer overflow-hidden rounded-xl bg-[#ecebe5]"
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
              <div key={i} className="cursor-pointer overflow-hidden rounded-xl bg-[#ecebe5]" onClick={() => openGallery(i + 1)}>
                <img src={img} alt={`${unitLabel} ${i + 2}`} className="w-full h-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
              </div>
            ))}
          </div>
          {/* Mobile */}
          <div className="md:hidden relative cursor-pointer overflow-hidden rounded-xl m-2 bg-[#ecebe5]" style={{ height: 260 }} onClick={() => openGallery(0)}>
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
            <InquiryPanel unit={unit} property={property} onBook={() => setModal('book')} onInquire={() => setModal('inquire')} canBook={canBook} />
          </aside>
        </div>
      </div>

      {/* Mobile bottom bar — only rendered when the viewer can actually
          book. Operator accounts get nothing here so the mobile UX matches
          the desktop sidebar (which shows a "switch to a customer account"
          note instead of the CTAs). */}
      {canBook && (
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
      )}

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
      {modal === 'book' && <BookModal unit={unit} property={property} preferredStartDays={preferredStartDays} onClose={() => setModal(null)} />}
      {modal === 'inquire' && <InquireModal unit={unit} property={property} preferredStartDays={preferredStartDays} allowedInstallments={allowedInstallments} onClose={() => setModal(null)} />}
    </div>
  );
}
