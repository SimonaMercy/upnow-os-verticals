'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { MiniCalendar, TIME_SLOTS, fmtSlot, nextAllowedDate } from '@/components/booking/MiniCalendar';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { SiteHeader } from '@/components/upnow/SiteHeader';
import { Footer } from '@/components/upnow/Footer';
import {
  MapPin, X, ChevronLeft, ChevronRight, BedDouble, Bath, Maximize2,
  Layers, Wind, CheckCircle2, Check, Shield, Clock,
  Calendar, MessageSquare, ImageIcon,
  Flame, AppWindow, DoorOpen, Ruler, Phone,
} from 'lucide-react';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { isResidentialUnitType, isRentVatable } from '@/lib/unitTaxonomy';
import { authorityNames, spaceSubcategory, type SpaceSubcategory } from '@/lib/spaceJourney';
import { estimateMoveInCost, fmtAedFromFils } from '@/lib/moveInCost';
import { FIRST_RESPONSE_SLA_LABEL } from '@/lib/os/sla';
import { useBackClose } from '@/lib/useSlideOver';

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
  serviceCharges: string | number | null;
  securityDeposit: string | number | null;
  adminFee: string | number | null;
  /** Landlord's commission (whole AED) and Ejari fee (whole AED despite the
   *  name) — served by GET /listings/units/:id; optional so older payloads type-check. */
  commission?: string | number | null;
  ejariFeeFils?: string | number | null;
  furnishing?: string | null;
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
  // Unit prices (rental_price, security_deposit, admin_fee,
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
  available: { bg: '#d8efe3', text: '#1a7a5a', label: 'Available' },
  occupied: { bg: '#dbeafe', text: '#1e40af', label: 'Occupied' },
  under_renewal: { bg: '#ede9fe', text: '#6d28d9', label: 'Under Renewal' },
  renewal_pending: { bg: '#fef3c7', text: '#92400e', label: 'Renewal Pending' },
  maintenance: { bg: '#fee2e2', text: '#b91c1c', label: 'Maintenance' },
};
const CATEGORY_BG: Record<string, string> = {
  residential: '#d8efe3', commercial: '#dbeafe',
  industrial: '#fef3c7',
};

/* ── Gallery Lightbox ──────────────────────────────────────────────────── */
function GalleryModal({
  images, index, onClose, onNav,
}: { images: string[]; index: number; onClose: () => void; onNav: (i: number) => void }) {
  // Browser Back closes the photo viewer instead of navigating away. See useBackClose.
  const dismiss = useBackClose(onClose);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}>
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white rounded-full p-2 hover:bg-white/10 transition-colors z-10"
        onClick={dismiss}
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

/* ── Per-subcategory offer (MarketSpace data/listings.js) ─────────────────── */
// The CTA, the enquiry form and the "what happens next" steps follow the
// long-term subcategory. Every path still lands on the SAME two endpoints —
// POST /leads/viewings (enquiry / visit / call back) and POST /leads/book-now
// (apply directly) — so the backend pipeline is unchanged.
interface ListingOffer { action: string; visit: string; flow: string[]; doneTitle: string }
function listingOffer(sub: SpaceSubcategory): ListingOffer {
  switch (sub) {
    case 'commercial': return { action: 'Request a viewing', visit: 'viewing', flow: ['Enquiry', 'Site visit', 'Heads of terms', 'Lease & Ejari', 'Fit-out & handover'], doneTitle: 'Viewing requested' };
    case 'industrial': return { action: 'Request a site visit', visit: 'site visit', flow: ['Enquiry', 'Site visit', 'Offer', 'Lease & Ejari', 'Handover'], doneTitle: 'Site visit requested' };
    case 'land':       return { action: 'Enquire about plot', visit: 'site visit', flow: ['Enquiry', 'Site visit', 'Due diligence', 'Land lease agreement', 'Handover'], doneTitle: 'Enquiry sent' };
    case 'residential':
    default:           return { action: 'Request a viewing', visit: 'viewing', flow: ['Enquiry', 'Viewing', 'Offer & cheques', 'Ejari & contract', 'Move-in'], doneTitle: 'Viewing requested' };
  }
}

/** Numbered "what happens next" row (MarketSpace contact-steps). */
function WhatHappensNext({ flow }: { flow: string[] }) {
  return (
    <div className="mb-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8a948d] mb-2">What happens next</p>
      <ol className="flex flex-col gap-1.5">
        {flow.map((f, i) => (
          <li key={f} className="flex items-center gap-2 text-xs text-[#46534c]">
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
              style={{ backgroundColor: i === 0 ? '#047246' : '#eef1ef', color: i === 0 ? '#fff' : '#5f6b63' }}>{i + 1}</span>
            {f}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── Cost to move in (estimate) ─────────────────────────────────────────── */
function MoveInCostSection({ unit, property, sub, allowedInstallments }: { unit: PublicUnit; property: PublicProperty; sub: SpaceSubcategory; allowedInstallments: number[] }) {
  const plans = allowedInstallmentPlans(allowedInstallments);
  const [cheques, setCheques] = useState<number>(() => (plans.find(p => p.value === 4) ?? plans[0])?.value ?? 4);
  const rent = Number(unit.rentalPrice);
  if (!Number.isFinite(rent) || rent <= 0) return null;
  const num = (v: string | number | null | undefined) => (v == null || v === '' ? null : Number(v));
  const names = authorityNames(property.emirate?.nameEn);
  const est = estimateMoveInCost({
    subcategory: sub,
    annualRentAed: rent,
    cheques,
    furnished: (unit.furnishing ?? '').toLowerCase().startsWith('furnished'),
    villa: ['villa', 'villa_compound', 'townhouse'].includes(unit.unitType),
    rentVatable: sub !== 'land' && isRentVatable(unit.unitType, property.spaceCategory),
    securityDepositAed: num(unit.securityDeposit),
    commissionAed: num(unit.commission),
    adminFeeAed: num(unit.adminFee),
    ejariFeeAed: num(unit.ejariFeeFils),
    registrationLabel: sub === 'land' ? 'Registration' : names.registration,
    utilityLabel: names.utility,
  });
  const anyDefault = est.rows.some(r => !r.fromListing);
  return (
    <div className="mb-8" id="move-in-cost">
      <h2 className="font-semibold text-[22px] text-[#14201a] mb-1">Cost to move in</h2>
      <p className="text-sm text-[#5f6b63] mb-3">
        <strong>Estimate</strong> of what is due on signing for the payment option you pick. Figures marked “typical” are common Dubai charges, not this landlord’s — your payment plan is confirmed by the landlord.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Number of rent cheques">
        <span className="text-xs font-medium text-[#46534c]">Pay rent in</span>
        {plans.map(p => (
          <button key={p.value} type="button" onClick={() => setCheques(p.value)}
            aria-pressed={cheques === p.value}
            className={`py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${cheques === p.value ? 'border-[#047246] bg-[#d8efe3] text-[#1a7a5a]' : 'border-[#e4e9e5] text-[#5f6b63] hover:border-[#047246]'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="bg-white border border-[#e4e9e5] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-[#eef1ef]">
            {est.rows.map(r => (
              <tr key={r.key}>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-[#14201a]">{r.label}</p>
                  <p className="text-[11px] text-[#8a948d]">{r.note}{!r.fromListing && !/typical/i.test(r.note) ? ' · typical' : ''}</p>
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-[#14201a] tabular-nums whitespace-nowrap">{fmtAedFromFils(r.fils)}</td>
              </tr>
            ))}
            <tr style={{ backgroundColor: '#eef7f2' }}>
              <td className="px-4 py-3 font-bold text-[#14201a]">Estimated due at signing</td>
              <td className="px-4 py-3 text-right font-bold text-[#047246] tabular-nums whitespace-nowrap">{fmtAedFromFils(est.totalFils)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-[#8a948d] mt-2">
        {sub === 'land' ? 'Utility connection for a plot is quoted per site and is not included. ' : ''}
        {anyDefault ? 'Rows marked typical use market defaults because this listing does not publish that figure. ' : ''}
        Deposits marked refundable are returned at the end of the lease, less any agreed deductions.
      </p>
    </div>
  );
}

/* ── Inquiry Panel ──────────────────────────────────────────────────────── */
function InquiryPanel({
  unit, property, sub, onBook, onInquire, onCallback, canBook,
}: { unit: PublicUnit; property: PublicProperty; sub: SpaceSubcategory; onBook: () => void; onInquire: () => void; onCallback: () => void; canBook: boolean }) {
  const offer = listingOffer(sub);
  return (
    <>
      {/* Provider */}
      <div className="flex items-center gap-3 mb-5 pb-5 border-b border-[#e4e9e5]">
        <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
          style={{ background: 'linear-gradient(135deg, #047246, #1f6655)' }}>
          {property.buildingName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-[#14201a] truncate">{property.buildingName}</span>
            <span className="flex-shrink-0 text-xs font-medium rounded-full px-2 py-0.5 bg-[#d8efe3] text-[#1a7a5a] flex items-center gap-1">
              <Shield size={10} /> Verified
            </span>
          </div>
          <p className="text-xs text-[#8a948d] flex items-center gap-1 mt-0.5">
            <Clock size={11} /> First-reply target: {FIRST_RESPONSE_SLA_LABEL}
          </p>
        </div>
      </div>

      {/* CTA buttons — hidden for non-tenant roles (rental_provider, manager,
          admin, super_admin) since those accounts can't lease a unit through
          this flow. They're shown a contextual note instead so they know
          why the CTAs are absent. */}
      {/* Call / WhatsApp: the public listing API exposes no provider or agent
          phone (GET /listings/units/:id carries the unit + property only), so
          there is no number to dial. "Request a call back" sends the request
          through the existing viewing endpoint with a structured note instead. */}
      {canBook ? (
        <div className="flex flex-col gap-3 mb-5">
          <button
            onClick={onBook}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#047246' }}
          >
            {offer.action}
          </button>
          <button
            onClick={onInquire}
            className="w-full py-3 rounded-xl text-sm font-semibold border border-[#047246] hover:bg-[#edf7f3] transition-colors"
            style={{ color: '#047246' }}
          >
            Book now — apply directly
          </button>
          <button
            onClick={onCallback}
            className="w-full py-2.5 rounded-xl text-sm font-semibold border border-[#e4e9e5] text-[#46534c] hover:border-[#047246] transition-colors inline-flex items-center justify-center gap-2"
          >
            <Phone size={14} /> Request a call back
          </button>
        </div>
      ) : (
        <div className="bg-[#eef1ef] border border-[#e4e9e5] rounded-xl p-3 mb-5 text-center">
          <p className="text-xs text-[#5f6b63]">
            You&apos;re browsing listings from your operator account. Sign in with a customer account to enquire, book or request a {offer.visit}.
          </p>
        </div>
      )}

      {canBook && <WhatHappensNext flow={offer.flow} />}

      {/* Annual rent here; the itemised move-in estimate sits in the page body. */}
      {unit.rentalPrice != null && (
        <div className="bg-[#eef1ef] rounded-xl p-4 text-sm mb-4">
          <div className="flex justify-between items-baseline">
            <span className="text-[#5f6b63]">Annual Rent</span>
            <span className="font-bold text-[#14201a]">{fmtAed(unit.rentalPrice)}</span>
          </div>
          <a href="#move-in-cost" className="mt-1.5 inline-block text-xs font-medium underline underline-offset-2" style={{ color: '#047246' }}>
            See the estimated cost to move in
          </a>
        </div>
      )}

      {/* Building highlights */}
      {(property.hasParking || property.hasGym || property.hasPool) && (
        <div className="flex flex-wrap gap-2">
          {property.hasParking && (
            <span className="text-xs font-medium rounded-full px-3 py-1.5 bg-[#eef1ef] text-[#46534c]">🅿 Parking</span>
          )}
          {property.hasGym && (
            <span className="text-xs font-medium rounded-full px-3 py-1.5 bg-[#eef1ef] text-[#46534c]">🏋️ Gym</span>
          )}
          {property.hasPool && (
            <span className="text-xs font-medium rounded-full px-3 py-1.5 bg-[#eef1ef] text-[#46534c]">🏊 Pool</span>
          )}
        </div>
      )}
    </>
  );
}

/* ── Mini Calendar ──────────────────────────────────────────────────────── */
// MiniCalendar / nextAllowedDate live in components/booking/MiniCalendar so the
// landlord's "Add a Lead" form uses the very same date controls as this page.

/* ── Time Slots ─────────────────────────────────────────────────────────── */
// TIME_SLOTS / fmtSlot are shared with the portal-side lead form — see above.

/* ── Book Viewing Modal ─────────────────────────────────────────────────── */
const BOOKING_INTENT_KEY = 'upnow_booking_intent';

/**
 * The enquiry block that rides in the viewing's `notes`.
 *
 * POST /leads/viewings accepts { unitId, scheduledAt, notes } and the backend
 * validates with a whitelist, so the per-subcategory fields (move-in, company,
 * trade licence, power, intended use…) cannot be sent as their own JSON keys.
 * They are folded into notes as a short labelled block the landlord reads on
 * the lead. Capped so a long free-text note can't push the request over a
 * length limit.
 */
const NOTES_MAX = 1000;
const ENQ_INPUT = 'mt-1 w-full text-sm font-normal border border-[#e4e9e5] rounded-xl px-3 py-2 text-[#14201a] bg-white focus:outline-none focus:ring-2 focus:ring-[#047246]/30';

/** Labelled segmented choice (no icon-only controls). Tapping the active one clears it. */
function SegPick({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex gap-1.5 flex-wrap" role="group">
      {options.map(o => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(value === o ? '' : o)}
          className={`py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${value === o ? 'border-[#047246] bg-[#d8efe3] text-[#1a7a5a]' : 'border-[#e4e9e5] text-[#5f6b63] hover:border-[#047246]'}`}>
          {o}
        </button>
      ))}
    </div>
  );
}
function composeEnquiryNotes(header: string, fields: [string, string][], free: string): string | undefined {
  const lines = fields.filter(([, v]) => v.trim()).map(([k, v]) => `${k}: ${v.trim()}`);
  const head = lines.length || header ? [`[${header}]`, ...lines].join('\n') : '';
  const room = NOTES_MAX - head.length - 2;
  const tail = free.trim() ? (room > 20 ? free.trim().slice(0, room) : '') : '';
  const out = [head, tail].filter(Boolean).join('\n\n');
  return out || undefined;
}

type EnquiryMode = 'visit' | 'callback';

function BookModal({ unit, property, sub, mode = 'visit', allowedInstallments = [], onClose }: { unit: PublicUnit; property: PublicProperty; sub: SpaceSubcategory; mode?: EnquiryMode; allowedInstallments?: number[]; onClose: () => void }) {
  const offer = listingOffer(sub);
  const isCallback = mode === 'callback';
  // Default to today so the time list immediately reflects the current date —
  // past slots are filtered out (see TIME_SLOTS filter below), leaving only
  // upcoming times.
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  // Per-subcategory enquiry fields (MarketSpace `form`) — folded into notes.
  const [fMoveIn, setFMoveIn] = useState('');
  const [fOccupants, setFOccupants] = useState('');
  const [fCheques, setFCheques] = useState('');
  const [fViewType, setFViewType] = useState('In person');
  const [fCompany, setFCompany] = useState('');
  const [fActivity, setFActivity] = useState('');
  const [fLicence, setFLicence] = useState('');
  const [fSize, setFSize] = useState('');
  const [fPower, setFPower] = useState('');
  const [fUse, setFUse] = useState('');
  const [fTerm, setFTerm] = useState('');
  const chequeChoices = allowedInstallmentPlans(allowedInstallments);
  const visitWord = offer.visit; // "viewing" | "site visit"
  const composedNotes = () => {
    if (isCallback) {
      return composeEnquiryNotes('Call-back request — please call me; no visit booked yet', [
        ['Preferred call time', time ? `${date} ${fmtSlot(time)}` : date],
      ], notes);
    }
    const fields: [string, string][] = sub === 'residential'
      ? [['Move-in', fMoveIn], ['Occupants', fOccupants], ['Preferred cheques', fCheques], ['Viewing', fViewType]]
      : sub === 'land'
        ? [['Company', fCompany], ['Intended use', fUse], ['Lease term wanted', fTerm]]
        : [['Company', fCompany], ['Business activity', fActivity], ['Trade licence', fLicence], ['Size needed (sqft)', fSize],
           ...(sub === 'industrial' ? [['Power needed', fPower] as [string, string]] : []), ['Move-in', fMoveIn]];
    return composeEnquiryNotes(`${offer.action} — enquiry details`, fields, notes);
  };
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
  async function submitBooking(d: string, t: string, n: string): Promise<boolean> {
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
          submitBooking(intent.date, intent.time ?? '', intent.notes ?? '');
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
    await submitBooking(date, time, composedNotes() ?? '');
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
      const booked = await submitBooking(date, time, composedNotes() ?? '');
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
        <h3 className="font-bold text-xl text-[#14201a] mb-1">Continue to UpNow</h3>
        <p className="text-sm text-[#8a948d] mb-5">
          Enter your phone number. We&apos;ll send a one-time code to sign you in — or create your account instantly if you&apos;re new.
        </p>

        {authError && (
          <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{authError}</div>
        )}

        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#46534c] uppercase tracking-wide mb-1.5">
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
            className="w-full text-sm border border-[#e4e9e5] rounded-xl px-3.5 py-3 text-[#14201a] focus:outline-none focus:ring-2 focus:ring-[#047246]/30 focus:border-[#047246]"
          />
        </div>

        <button
          disabled={authSubmitting || !authEmail.trim()}
          onClick={handleAuthIdentify}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#047246' }}
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
          className="flex items-center gap-1 text-xs text-[#8a948d] hover:text-[#14201a] mb-4 transition-colors"
        >
          <ChevronLeft size={14} /> Back
        </button>

        <h3 className="font-bold text-xl text-[#14201a] mb-1">
          {authVerificationStep === 'phone' ? 'Check your phone' : 'Check your email'}
        </h3>
        <p className="text-sm text-[#8a948d] mb-5">
          We sent a 6-digit code to{' '}
          <span className="font-semibold text-[#14201a]">{authEmail}</span>
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
              className="w-11 h-12 text-center text-xl font-semibold border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#047246]/30"
              style={{
                borderColor: d ? '#047246' : '#e4e9e5',
                background: '#f6f8f6',
                color: '#14201a',
              }}
            />
          ))}
        </div>

        <button
          disabled={authSubmitting || otpCode.length !== 6}
          onClick={handleAuthVerifyOtp}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90 mb-3"
          style={{ backgroundColor: '#047246' }}
        >
          {authSubmitting ? 'Verifying…' : 'Verify & confirm booking'}
        </button>

        <p className="text-xs text-center text-[#8a948d]">
          Didn&apos;t receive the code?{' '}
          <button
            type="button"
            className="font-semibold hover:underline"
            style={{ color: '#047246' }}
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
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#d8efe3' }}>
            <Check size={28} style={{ color: '#047246' }} />
          </div>
          <h3 className="font-bold text-xl text-[#14201a] mb-1">Viewing requested!</h3>
          <p className="text-sm text-[#5f6b63]">
            Your account is ready and your viewing request is submitted.
          </p>
        </div>
        <button
          disabled={authSubmitting}
          onClick={() => window.location.assign('/dashboard/customer/spaces')}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90 mb-3"
          style={{ backgroundColor: '#047246' }}
        >
          Track my booking
        </button>
        <button
          disabled={authSubmitting}
          onClick={onClose}
          className="w-full py-3 rounded-xl text-sm font-semibold border border-[#e4e9e5] text-[#14201a] disabled:opacity-40 hover:bg-[#f9f8f6] transition-colors"
        >
          Continue browsing
        </button>
        <div className="mt-4 flex items-center justify-center gap-4 text-sm">
          <Link href="/listings" className="underline underline-offset-2 text-[#8a948d] hover:text-[#14201a]">
            Browse listings
          </Link>
          <span className="text-[#c8c6c0]">|</span>
          <Link href="/services" className="underline underline-offset-2 text-[#8a948d] hover:text-[#14201a]">
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
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#d8efe3' }}>
            <Check size={28} style={{ color: '#047246' }} />
          </div>
          <h3 className="font-bold text-xl text-[#14201a] mb-2">{isCallback ? 'Call back requested' : offer.doneTitle}</h3>
          <p className="text-sm text-[#5f6b63] mb-1">{property.buildingName} · {unit.unitName ?? `Unit ${unit.unitNumber}`}</p>
          <p className="text-sm font-semibold text-[#14201a]">{dateStr}</p>
          <p className="text-sm text-[#8a948d]">{timeStr}</p>
          <p className="mt-3 text-xs text-[#8a948d]">{isCallback ? 'The rental provider will call you around this time.' : `The rental provider will confirm your ${visitWord} shortly.`}</p>

          {/* Next-step nudge */}
          <div className="mt-5 rounded-xl p-4 text-left" style={{ backgroundColor: '#eef7f2', border: '1px solid #c3e8da' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#047246' }}>You&apos;re just 1 step away!</p>
            <p className="text-sm text-[#14201a] font-medium mb-0.5">{offer.flow.slice(1).join(' → ')}</p>
            <p className="text-xs text-[#5f6b63]">Track every step in My Spaces once the provider confirms.</p>
          </div>

          <button
            onClick={() => window.location.assign('/dashboard/customer/spaces')}
            className="mt-4 w-full py-3 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#047246' }}
          >
            Go to My Spaces →
          </button>
          <button onClick={onClose} className="mt-2 w-full py-2.5 rounded-xl text-sm font-medium text-[#5f6b63] bg-[#f4f3f0] hover:bg-[#ece9e3] transition-colors">
            Stay on this page
          </button>
          <div className="mt-4 flex items-center justify-center gap-4 text-sm">
            <Link href="/listings" className="underline underline-offset-2" style={{ color: '#047246' }}>
              Browse listings
            </Link>
            <span className="text-[#c8c6c0]">|</span>
            <Link href="/services" className="underline underline-offset-2" style={{ color: '#047246' }}>
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
      <h3 className="font-bold text-xl text-[#14201a] mb-1">{isCallback ? 'Request a call back' : offer.action}</h3>
      <p className="text-sm text-[#8a948d] mb-4">{unit.unitName ?? `Unit ${unit.unitNumber}`} · {property.buildingName}</p>
      {isCallback && (
        <p className="text-xs text-[#5f6b63] mb-4 rounded-xl px-3 py-2.5" style={{ backgroundColor: '#eef7f2' }}>
          This listing doesn&apos;t publish a phone number. Pick a time and the rental provider will call you on the number on your account.
        </p>
      )}
      {!isCallback && <WhatHappensNext flow={offer.flow} />}
      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>
      )}

      {/* Per-subcategory enquiry fields (MarketSpace form) */}
      {!isCallback && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {sub !== 'residential' && (
            <label className="col-span-2 text-sm font-medium text-[#46534c]">Company name
              <input value={fCompany} onChange={e => setFCompany(e.target.value)} className={ENQ_INPUT} placeholder="Registered company name" />
            </label>
          )}
          {(sub === 'commercial' || sub === 'industrial') && (
            <>
              <label className="col-span-2 text-sm font-medium text-[#46534c]">Business activity
                <input value={fActivity} onChange={e => setFActivity(e.target.value)} className={ENQ_INPUT} placeholder="e.g. General trading, e-commerce fulfilment" />
              </label>
              <div className="col-span-2">
                <p className="text-sm font-medium text-[#46534c] mb-1">Trade licence</p>
                <SegPick value={fLicence} onChange={setFLicence} options={['Mainland', 'Free zone', 'Not yet']} />
              </div>
              <label className="text-sm font-medium text-[#46534c]">Size needed (sqft)
                <input value={fSize} onChange={e => setFSize(e.target.value)} className={ENQ_INPUT} inputMode="numeric" placeholder="e.g. 1,500" />
              </label>
              {sub === 'industrial' ? (
                <label className="text-sm font-medium text-[#46534c]">Power needed
                  <select value={fPower} onChange={e => setFPower(e.target.value)} className={ENQ_INPUT}>
                    <option value="">Select…</option>
                    {['Under 50 kW', '50–200 kW', '200 kW+'].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              ) : <span />}
            </>
          )}
          {sub === 'land' && (
            <>
              <label className="col-span-2 text-sm font-medium text-[#46534c]">Intended use
                <input value={fUse} onChange={e => setFUse(e.target.value)} className={ENQ_INPUT} placeholder="e.g. Logistics hub, residential G+4" />
              </label>
              <label className="col-span-2 text-sm font-medium text-[#46534c]">Lease term wanted
                <select value={fTerm} onChange={e => setFTerm(e.target.value)} className={ENQ_INPUT}>
                  <option value="">Select…</option>
                  {['5 years', '10 years', '20 years', '30 years'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            </>
          )}
          {sub !== 'land' && (
            <label className="text-sm font-medium text-[#46534c]">Move-in date
              <input type="date" value={fMoveIn} min={today} onChange={e => setFMoveIn(e.target.value)} className={ENQ_INPUT} />
            </label>
          )}
          {sub === 'residential' && (
            <>
              <label className="text-sm font-medium text-[#46534c]">Occupants
                <select value={fOccupants} onChange={e => setFOccupants(e.target.value)} className={ENQ_INPUT}>
                  <option value="">Select…</option>
                  {['Just me', 'Couple', 'Family', 'Sharing'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[#46534c]">Preferred cheques
                <select value={fCheques} onChange={e => setFCheques(e.target.value)} className={ENQ_INPUT}>
                  <option value="">Select…</option>
                  {chequeChoices.map(p => <option key={p.value} value={`${p.value} (${p.label})`}>{p.value} — {p.label}</option>)}
                </select>
              </label>
              <div>
                <p className="text-sm font-medium text-[#46534c] mb-1">Viewing</p>
                <SegPick value={fViewType} onChange={setFViewType} options={['In person', 'Video call']} />
              </div>
            </>
          )}
        </div>
      )}

      {/* Date + Time — horizontal */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-[#46534c] mb-2">
            <Calendar size={14} className="inline mr-1.5" />{isCallback ? 'Call me on' : `Preferred ${visitWord} date`}
          </label>
          <MiniCalendar value={date} onChange={setDate} />
          {date && (
            <p className="mt-2 text-xs text-center font-medium" style={{ color: '#047246' }}>
              {new Date(date + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' })}
            </p>
          )}
        </div>
        <div className="flex flex-col">
          <label className="block text-sm font-medium text-[#46534c] mb-2">
            Preferred time <span className="text-[#8a948d] font-normal">(optional)</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {TIME_SLOTS.filter(slot => {
              if (date !== today) return true;
              const [h] = slot.split(':').map(Number);
              return h > new Date().getHours();
            }).map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => setTime(time === slot ? '' : slot)}
                className="w-full py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
                style={{
                  borderColor: time === slot ? '#047246' : '#e4e9e5',
                  backgroundColor: time === slot ? '#edf7f3' : '#fff',
                  color: time === slot ? '#047246' : '#46534c',
                }}
              >
                {fmtSlot(slot)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="block text-sm font-medium text-[#46534c] mb-1.5">
        Notes <span className="text-[#8a948d] font-normal">(optional)</span>
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Any questions or special requests…"
        className="w-full text-sm mb-5 border border-[#e4e9e5] rounded-xl px-3 py-2.5 text-[#14201a] resize-none focus:outline-none focus:ring-2 focus:ring-[#047246]/30"
      />
      <button
        disabled={!date || submitting}
        onClick={handleBook}
        className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#047246' }}
      >
        {submitting ? 'Sending…' : isCallback ? 'Request call back' : `Send — ${offer.action.toLowerCase()}`}
      </button>
    </ModalShell>
  );
}

/* ── Book Now Modal ─────────────────────────────────────────────────────── */
function InquireModal({ unit, property, sub, preferredStartDays = [], allowedInstallments = [], onClose }: { unit: PublicUnit; property: PublicProperty; sub: SpaceSubcategory; preferredStartDays?: number[]; allowedInstallments?: number[]; onClose: () => void }) {
  const { refresh: refreshAuth } = useAuth();
  const offer = listingOffer(sub);
  // Business fields for a commercial / industrial / land application. The
  // book-now DTO has no columns for them, so they ride in `occupantsDetails`
  // (the free-text field this form already sends) as a labelled block.
  const [bCompany, setBCompany]   = useState('');
  const [bActivity, setBActivity] = useState('');
  const [bLicence, setBLicence]   = useState('');
  const [bUse, setBUse]           = useState('');

  // Occupants (adults / children / pets) are a residential-only concept. For
  // commercial, industrial and mixed-use commercial unit types there are no
  // occupants — the tenant is a business — so the whole block is hidden.
  const residential = isResidentialUnitType(unit.unitType);

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
        // Occupants only apply to residential lettings; commercial tenants are
        // businesses, so we don't collect or send adults/children/pets there.
        occupantsAdults:   residential ? (Number(adults) || 1) : 1,
        occupantsChildren: residential ? (Number(children) || 0) : 0,
        occupantsPets:     residential ? (Number(pets) || 0) : 0,
        occupantsDetails:  sub === 'residential'
          ? (msg || undefined)
          : composeEnquiryNotes('Book now — business details', sub === 'land'
              ? [['Company', bCompany], ['Intended use', bUse]]
              : [['Company', bCompany], ['Business activity', bActivity], ['Trade licence', bLicence]], msg),
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

  const inputCls = 'w-full text-sm border border-[#e4e9e5] rounded-xl px-3 py-2.5 text-[#14201a] focus:outline-none focus:ring-2 focus:ring-[#047246]/30';

  // ── Success state ──────────────────────────────────────────────────────
  if (booked) {
    return (
      <ModalShell onClose={onClose}>
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: '#d8efe3' }}>
            <CheckCircle2 size={24} style={{ color: '#047246' }} />
          </div>
          <h3 className="font-bold text-xl text-[#14201a] mb-2">You&apos;re interested! 🎉</h3>
          <p className="text-sm text-[#5f6b63] mb-1">Your interest in <span className="font-medium text-[#14201a]">{unit.unitName ?? `Unit ${unit.unitNumber}`}</span> is registered.</p>
          {/* Next-step nudge — mirrors the Schedule Viewing flow */}
          <div className="rounded-xl p-3 my-4 text-left" style={{ backgroundColor: '#eef7f2' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#047246' }}>Next step</p>
            <p className="text-sm text-[#14201a] font-medium mb-0.5">Upload your documents &amp; review your payment plan</p>
            <p className="text-xs text-[#5f6b63]">We&apos;ve prepared a payment plan from your preferences. Complete your documents in My Spaces to move toward your contract.</p>
          </div>
          <button
            onClick={() => window.location.assign(
              bookedLeadId
                ? `/dashboard/customer/spaces/v2/v-${bookedLeadId}`
                : '/dashboard/customer/spaces',
            )}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#047246' }}
          >
            Continue in My Spaces
          </button>
          <button onClick={onClose} className="mt-2 w-full py-2.5 rounded-xl text-sm font-medium text-[#5f6b63] bg-[#f4f3f0] hover:bg-[#ece9e3] transition-colors">
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
        <h3 className="font-bold text-xl text-[#14201a] mb-1">Continue to UpNow</h3>
        <p className="text-sm text-[#8a948d] mb-5">Enter your phone number — we&apos;ll send a verification code.</p>
        {authError && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{authError}</div>}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-[#46534c] uppercase tracking-wide mb-1.5">Phone number</label>
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
          style={{ backgroundColor: '#047246' }}>
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
          className="flex items-center gap-1 text-xs text-[#8a948d] hover:text-[#14201a] mb-4 transition-colors">
          <ChevronLeft size={14} /> Back
        </button>
        <h3 className="font-bold text-xl text-[#14201a] mb-1">
          {isPhoneVerify ? 'Check your phone' : 'Check your email'}
        </h3>
        <p className="text-sm text-[#8a948d] mb-5">
          We sent a 6-digit code to <span className="font-semibold text-[#14201a]">{authIdentifier}</span>
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
              className="w-11 h-12 text-center text-lg font-bold border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#047246]/30"
              style={{ borderColor: v ? '#047246' : '#e4e9e5', background: '#f6f8f6', color: '#14201a' }}
            />
          ))}
        </div>
        <button disabled={authSubmitting || otpCode.length !== 6} onClick={handleVerifyOtp}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#047246' }}>
          {authSubmitting ? 'Verifying…' : 'Verify & reserve'}
        </button>
        <p className="text-xs text-center text-[#8a948d] mt-3">
          Didn&apos;t receive the code?{' '}
          <button type="button" className="font-semibold hover:underline" style={{ color: '#047246' }}
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
      <h3 className="font-bold text-xl text-[#14201a] mb-1">Book now — apply directly</h3>
      <p className="text-sm text-[#8a948d] mb-4">{unit.unitName ?? `Unit ${unit.unitNumber}`} · {property.buildingName}</p>

      {/* Booking summary */}
      <div className="rounded-xl p-4 mb-5" style={{ backgroundColor: '#eef7f2' }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[#5f6b63]">Annual rent</span>
          <span className="text-sm font-bold text-[#14201a]">AED {fmt(Number(unit.rentalPrice))}/yr</span>
        </div>
        <p className="text-xs text-[#5f6b63] leading-relaxed">
          Tell us your preferences below and confirm your interest. We&apos;ll prepare your payment plan and guide you through documents — no payment is taken now.
        </p>
      </div>

      <WhatHappensNext flow={['Application', ...offer.flow.slice(2)]} />

      {error && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}

      <label className="block text-sm font-medium text-[#46534c] mb-1.5">Move-in date <span className="text-red-500">*</span></label>
      {preferredStartDays.length > 0 && (
        <p className="text-xs text-[#8a948d] mb-1.5">
          Contracts start on the {preferredStartDays.map(d => `${d}${['st','nd','rd'][((d % 10) - 1)] || 'th'}`).join(', ')} of the month.
        </p>
      )}
      <div className="mb-4">
        <MiniCalendar value={moveIn} onChange={setMoveIn} allowedDays={preferredStartDays} compact />
      </div>

      {residential && (
        <>
          <label className="block text-sm font-medium text-[#46534c] mb-1.5">Occupants <span className="text-red-500">*</span></label>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[['Adults','1',adults,setAdults],['Children','0',children,setChildren],['Pets','0',pets,setPets]].map(([label, min, val, setter]) => (
              <div key={label as string}>
                <p className="text-[11px] text-[#8a948d] mb-1">{label as string}</p>
                <input type="number" min={min as string} value={val as string} onChange={e => (setter as (v:string)=>void)(e.target.value)} className={inputCls} />
              </div>
            ))}
          </div>
        </>
      )}

      {sub !== 'residential' && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <label className="col-span-2 text-sm font-medium text-[#46534c]">Company name
            <input value={bCompany} onChange={e => setBCompany(e.target.value)} className={ENQ_INPUT} placeholder="Registered company name (if leasing as a company)" />
          </label>
          {sub === 'land' ? (
            <label className="col-span-2 text-sm font-medium text-[#46534c]">Intended use
              <input value={bUse} onChange={e => setBUse(e.target.value)} className={ENQ_INPUT} placeholder="e.g. Logistics hub, residential G+4" />
            </label>
          ) : (
            <>
              <label className="col-span-2 text-sm font-medium text-[#46534c]">Business activity
                <input value={bActivity} onChange={e => setBActivity(e.target.value)} className={ENQ_INPUT} placeholder="e.g. General trading" />
              </label>
              <div className="col-span-2">
                <p className="text-sm font-medium text-[#46534c] mb-1">Trade licence</p>
                <SegPick value={bLicence} onChange={setBLicence} options={['Mainland', 'Free zone', 'Not yet']} />
              </div>
            </>
          )}
        </div>
      )}

      <label className="block text-sm font-medium text-[#46534c] mb-1.5">Payment installments</label>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {installmentChoices.map(p => (
          <button key={p.value} type="button" onClick={() => setInstallments(String(p.value))}
            className={`py-2 rounded-xl text-xs font-medium border transition-colors ${installments === String(p.value) ? 'border-[#047246] bg-[#d8efe3] text-[#1a7a5a]' : 'border-[#e4e9e5] text-[#5f6b63] hover:border-[#047246]'}`}>
            {p.label}
          </button>
        ))}
      </div>


      <label className="block text-sm font-medium text-[#46534c] mb-1.5">Notes <span className="text-[#8a948d] font-normal">(optional)</span></label>
      <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2}
        placeholder="Any questions or requirements…"
        className={`${inputCls} resize-none mb-4`} />

      {/* Interested consent */}
      <p className="text-xs text-[#8a948d] mb-3 leading-relaxed">
        By continuing you confirm you&apos;re interested in renting this unit. Next, you&apos;ll review your payment plan and upload your documents.
      </p>

      <button disabled={!moveIn || Number(adults) < 1 || submitting} onClick={handleSubmit}
        className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#047246' }}>
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
        <button className="absolute top-4 right-4 text-[#8a948d] hover:text-[#14201a]" onClick={onClose}>
          <X size={20} />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ── Main page component ─────────────────────────────────────────────────── */
export default function ListingPageClient({ unit, property, media = [], preferredStartDays = [], allowedInstallments = [] }: { unit: PublicUnit; property: PublicProperty; media?: UnitMediaItem[]; preferredStartDays?: number[]; allowedInstallments?: number[] }) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [modal, setModal] = useState<'book' | 'callback' | 'inquire' | null>(null);
  // Long-term subcategory → CTA wording, enquiry fields, next steps, estimator.
  const sub = spaceSubcategory(unit.unitType, property.spaceCategory);
  const offer = listingOffer(sub);
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
  const catBg = CATEGORY_BG[catKey] ?? '#eef1ef';
  const avail = AVAIL_STYLE[unit.availability] ?? { bg: '#eef1ef', text: '#5f6b63', label: unit.availability };
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
      <SiteHeader />

      <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-10 pt-4 pb-24">
        {/* ── Breadcrumb ──────────────────────────────────────────────────── */}
        <nav className="text-sm py-4 text-[#8a948d]">
          <Link href="/" className="hover:text-[#14201a] transition-colors">Home</Link>
          <span className="mx-1.5 text-[#c8c6c0]">/</span>
          <Link href="/listings" className="hover:text-[#14201a] transition-colors">Listings</Link>
          <span className="mx-1.5 text-[#c8c6c0]">/</span>
          <Link href={`/listings?category=${catKey}`} className="hover:text-[#14201a] transition-colors">{humanType(property.spaceCategory)}</Link>
          <span className="mx-1.5 text-[#c8c6c0]">/</span>
          <span className="text-[#46534c]">{unitLabel}</span>
        </nav>

        {/* ── Gallery ─────────────────────────────────────────────────────── */}
        {/* Frame the whole grid so it stays visually contained on the page
            even when the underlying images are white / transparent. Each
            tile gets a cream backdrop (#eef1ef, same neutral used on the
            inquiry panel) so white-backed images don't vanish into the
            page; a hairline border and subtle shadow give the gallery a
            crisp edge. */}
        <div className="mb-8 overflow-hidden rounded-2xl border border-[#e4e9e5] shadow-sm bg-[#eef1ef]">
          {/* Desktop: 60% main + 40% right */}
          <div className="hidden md:grid gap-2 p-2" style={{ gridTemplateColumns: '60% 40%', gridTemplateRows: 'repeat(3, 140px)' }}>
            <div
              className="relative row-span-3 cursor-pointer overflow-hidden rounded-xl bg-[#ecebe5]"
              onClick={() => openGallery(0)}
            >
              <img src={images[0]} alt={unitLabel} className="w-full h-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
              <button
                className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-white rounded-full px-4 py-2 text-sm font-medium text-[#14201a] shadow-md hover:shadow-lg transition-shadow"
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
            <button className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-white rounded-full px-3 py-1.5 text-xs font-medium text-[#14201a] shadow-md">
              <ImageIcon size={13} /> {images.length} photos
            </button>
          </div>
        </div>

        {/* ── Title block ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="text-xs font-medium rounded-full px-3 py-1" style={{ backgroundColor: catBg, color: '#14201a' }}>
            {humanType(property.spaceCategory)}
          </span>
          <span className="text-xs font-medium rounded-full px-3 py-1 bg-[#e4e9e5] text-[#46534c]">
            {humanType(unit.unitType)}
          </span>
          <span className="text-xs font-medium rounded-full px-3 py-1" style={{ backgroundColor: avail.bg, color: avail.text }}>
            {avail.label}
          </span>
        </div>
        <h1 className="font-bold text-[42px] leading-tight text-[#14201a]">{unitLabel}</h1>
        <div className="flex items-center gap-2 mt-2 text-[#46534c]">
          <MapPin size={18} style={{ color: '#047246', flexShrink: 0 }} />
          <span className="text-base">{displayAddress}</span>
        </div>
        {unit.rentalPrice != null && (
          <>
            <p className="font-bold mt-4 text-[36px]" style={{ color: '#047246' }}>
              {fmtAed(unit.rentalPrice)}
            </p>
            <p className="text-base text-[#8a948d]">per year</p>
          </>
        )}

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-10 items-start mt-8">
          {/* Left */}
          <div className="flex-grow min-w-0">

            {/* Key specs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
              {specs.map((s) => (
                <div key={s.label} className="bg-white border border-[#e4e9e5] rounded-xl p-4 flex items-center gap-3 shadow-sm">
                  <span style={{ color: '#047246' }}>{s.icon}</span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#8a948d]">{s.label}</p>
                    <p className="text-sm font-semibold text-[#14201a]">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Description */}
            {(unit.description ?? property.propertyDescription) && (
              <div className="mb-8">
                <h2 className="font-semibold text-[22px] text-[#14201a] mb-3">About this space</h2>
                <p className="text-base text-[#46534c] leading-[1.7] whitespace-pre-wrap">
                  {unit.description ?? property.propertyDescription}
                </p>
              </div>
            )}

            {/* Features */}
            {features.length > 0 && (
              <div className="mb-8">
                <h2 className="font-semibold text-[22px] text-[#14201a] mb-3">Key features</h2>
                <div className="grid grid-cols-2 gap-3">
                  {features.map((f) => (
                    <div key={f} className="flex items-center gap-2">
                      <div className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full" style={{ backgroundColor: '#d8efe3' }}>
                        <Check size={11} style={{ color: '#047246' }} />
                      </div>
                      <span className="text-sm text-[#46534c]">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cost to move in — frontend estimate (MarketSpace detail/spaces.js) */}
            <MoveInCostSection unit={unit} property={property} sub={sub} allowedInstallments={allowedInstallments} />

            {/* Building details */}
            {(property.buildingName || property.numberOfFloors) && (
              <div className="mb-8">
                <h2 className="font-semibold text-[22px] text-[#14201a] mb-3">Building details</h2>
                <div className="bg-[#eef1ef] rounded-xl divide-y divide-[#e4e9e5]">
                  {property.buildingName && (
                    <div className="flex justify-between px-4 py-3 text-sm">
                      <span className="text-[#5f6b63]">Building Name</span>
                      <span className="font-medium text-[#14201a]">{property.buildingName}</span>
                    </div>
                  )}
                  {property.numberOfFloors && (
                    <div className="flex justify-between px-4 py-3 text-sm">
                      <span className="text-[#5f6b63]">Total Floors</span>
                      <span className="font-medium text-[#14201a]">{property.numberOfFloors}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Location */}
            <div className="mb-8">
              <h2 className="font-semibold text-[22px] text-[#14201a] mb-3">Location</h2>
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
                    <MapPin size={28} style={{ color: '#047246', margin: '0 auto' }} />
                    <p className="text-sm mt-2 text-[#46534c]">{displayAddress}</p>
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
            <h2 className="font-semibold text-xl text-[#14201a] mb-4">Interested in this space?</h2>
            <InquiryPanel unit={unit} property={property} sub={sub} onBook={() => setModal('book')} onInquire={() => setModal('inquire')} onCallback={() => setModal('callback')} canBook={canBook} />
          </aside>
        </div>
      </div>

      {/* Mobile bottom bar — only rendered when the viewer can actually
          book. Operator accounts get nothing here so the mobile UX matches
          the desktop sidebar (which shows a "switch to a customer account"
          note instead of the CTAs). */}
      {canBook && (
        <div className="fixed bottom-0 inset-x-0 lg:hidden z-50 flex items-center justify-between bg-white border-t border-[#e4e9e5] px-5 py-4">
          <div>
            {unit.rentalPrice != null && (
              <p className="font-bold text-[#14201a] text-base">{fmtAed(unit.rentalPrice)}<span className="text-xs font-normal text-[#8a948d]"> /yr</span></p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => setModal('book')}
              className="py-2.5 px-4 rounded-xl text-sm font-semibold text-white"
              style={{ backgroundColor: '#047246' }}
            >
              {offer.action}
            </button>
            <button
              onClick={() => setModal('inquire')}
              className="py-2.5 px-3 rounded-xl text-sm font-semibold border"
              style={{ borderColor: '#047246', color: '#047246' }}
            >
              Book now
            </button>
            <button
              onClick={() => setModal('callback')}
              className="py-2.5 px-3 rounded-xl text-sm font-semibold border border-[#e4e9e5] text-[#46534c]"
            >
              Call back
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
      {modal === 'book' && <BookModal unit={unit} property={property} sub={sub} allowedInstallments={allowedInstallments} onClose={() => setModal(null)} />}
      {modal === 'callback' && <BookModal unit={unit} property={property} sub={sub} mode="callback" onClose={() => setModal(null)} />}
      {modal === 'inquire' && <InquireModal unit={unit} property={property} sub={sub} preferredStartDays={preferredStartDays} allowedInstallments={allowedInstallments} onClose={() => setModal(null)} />}
      <Footer />
    </div>
  );
}
