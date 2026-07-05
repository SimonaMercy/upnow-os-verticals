'use client';

/**
 * Layout View — read-only *grouped-per-plan* detail popup.
 *
 * The layout-level sibling of UnitPreviewModal: where the unit view shows one
 * unit, this shows one whole layout (every unit that shares a plan_label),
 * aggregated. It is opened from the Property View's Unit Mix table — click a
 * mix row and this slides in with the same visual language as the unit/property
 * views. Each fact appears exactly once — physical facts in the stat strip,
 * money in Pricing & fees, identity in the header — nothing is repeated:
 *   • header (layout name · plan name · type · Edit layout · close)
 *   • floor-plan hero (the one artifact shared by every unit on the plan)
 *   • stat strip — PHYSICAL only (units + occupancy · size · beds · baths)
 *   • Units on this layout (each unit's number, status, own rent)
 *   • Leasing terms (plan-level, when set)
 *   • Pricing & fees (rent/unit · AED per sq.ft · rent-roll · fee grid · market gap)
 *   • Special conditions — the addendum, opened in an in-app view-only viewer
 *
 * Pure presenter — every value comes from props the Property View already holds
 * (the floor-plan `Plan` aggregate + the units list). No fetches of its own.
 * The document viewer (floor plan / addendum) is view-only: PDFs render in an
 * iframe with the toolbar suppressed, images inline — no download, matching the
 * platform's no-download document principle.
 */
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  X, FileText, Eye, AlignLeft, Banknote, Layers, Building2, ScrollText,
  Pencil, TrendingUp, ClipboardList,
} from 'lucide-react';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { SLIDEOVER_MS } from '@/components/upnow/PropertyFormModal';
import type { Plan } from '@/components/upnow/LayoutFinancialsModal';

/* ---------- types ---------- */

/** Thin unit row (mirrors the Property View's UnitLite). */
export interface LayoutUnitLite {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  availability: string;
  listingStatus: string;
  bedrooms: number | null;
  unitSizeSqm: number | null;
  unitSizeSqft: number | null;
  planLabel: string | null;
  rentalPrice: number | null;
}

/* ---------- colour tokens (shared with the unit / property views) ---------- */
const C = {
  ink: '#1d2823', ink2: '#2b342e', body: '#5a635c',
  mute: '#7d8780', mute2: '#8a938c', mute3: '#9aa39c', mute4: '#a0a8a1',
  green: '#1a9a64', greenT: '#1a7a4f', greenD: '#1a6b4d',
  greenBg: '#e7f3ec', greenBg2: '#eef6f1', greenBg3: '#e6f4ec',
  greenBd: '#cce6d8', greenBd2: '#cfe7da', greenBd3: '#d3e8db',
  line: '#e7ebe6', line2: '#eef1ec', line3: '#f1f3f0', line4: '#f4f6f3',
  soft: '#fbfcfb', soft2: '#fafdfb',
  amber: '#b07415', danger: '#c44536',
};

/* ---------- helpers ---------- */

const nf = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });
const aed = (n: number) => nf.format(n);
const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const minOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.min(a, b));
const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
// A min–max span that collapses to one value when the rounded numbers match
// (so 1313.9 & 1314.2 sqft both read "1,314", not a range of look-alikes).
const span = (lo: number | null, hi: number | null): string => {
  if (lo == null && hi == null) return '—';
  const a = lo ?? (hi as number), b = hi ?? (lo as number);
  const fa = aed(a), fb = aed(b);
  return fa === fb ? fa : `${fa} – ${fb}`;
};
const isImageUrl = (u: string) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(u);

const availabilityChip = (a: string): { color: string; bg: string; label: string } => {
  const v = (a || '').toLowerCase();
  if (v === 'occupied') return { color: C.greenT, bg: C.greenBg, label: 'Occupied' };
  if (v === 'reserved' || v === 'on_hold' || v === 'pending') return { color: C.amber, bg: '#fdf3e3', label: titleCase(v) };
  if (v === 'maintenance') return { color: '#854d0e', bg: '#fef3c7', label: 'Maintenance' };
  return { color: C.mute, bg: C.line3, label: 'Available' };
};

/* ---------- component ---------- */

export function LayoutPreviewModal({
  title,
  planName,
  unitType,
  bedrooms,
  plan,
  units,
  propertyName,
  canEdit = false,
  onEdit,
  onClose,
}: {
  /** Display name — the mix-row label / plan_label the user clicked (also the layout's identity). */
  title: string;
  /** The plan's canonical sequential name (e.g. "Plan 01"), shown as a chip when it adds signal. */
  planName?: string | null;
  unitType: string;
  bedrooms: number | null;
  /** Full plan aggregate — carries fees, lease terms, floor plan, market, addendum. Null when no floor-plan aggregate exists for this label. */
  plan: Plan | null;
  /** Units on this layout — the source of truth for counts, rent roll and occupancy. */
  units: LayoutUnitLite[];
  propertyName?: string | null;
  /** When true, the header/footer expose the "Edit layout" action. */
  canEdit?: boolean;
  /** Opens the layout bulk editor. */
  onEdit?: () => void;
  onClose: () => void;
}) {
  // Swipe-in / swipe-out — same right-to-left slide as the unit / property views.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => onClose(), SLIDEOVER_MS);
  }, [onClose]);

  // In-app document viewer — shared by the floor-plan hero and the addendum
  // (view-only, no download; PDFs via iframe, images inline). Null = closed.
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);

  // Track viewport so the layout collapses like the sibling views.
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const isNarrow = vw < 820;
  const isTight = vw < 600;

  // ── ESC closes the topmost layer ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (viewer) setViewer(null);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, requestClose]);

  /* ---------- aggregates (from the units — always available) ---------- */
  const agg = useMemo(() => {
    let sqftLo: number | null = null, sqftHi: number | null = null;
    let sqmLo: number | null = null, sqmHi: number | null = null;
    let rentLo: number | null = null, rentHi: number | null = null;
    let sum = 0, priced = 0, unpriced = 0, occupied = 0;
    for (const u of units) {
      const sqft = numOrNull(u.unitSizeSqft), sqm = numOrNull(u.unitSizeSqm), rent = numOrNull(u.rentalPrice);
      sqftLo = minOf(sqftLo, sqft); sqftHi = maxOf(sqftHi, sqft);
      sqmLo = minOf(sqmLo, sqm); sqmHi = maxOf(sqmHi, sqm);
      if (rent != null && rent > 0) { sum += rent; priced += 1; rentLo = minOf(rentLo, rent); rentHi = maxOf(rentHi, rent); }
      else unpriced += 1;
      if ((u.availability || '').toLowerCase() === 'occupied') occupied += 1;
    }
    return { sqftLo, sqftHi, sqmLo, sqmHi, rentLo, rentHi, sum, priced, unpriced, occupied };
  }, [units]);

  const count = units.length;
  const vacant = Math.max(0, count - agg.occupied);
  const residential = isResidentialUnitType(unitType);
  const bathrooms = plan?.bathrooms ?? null;
  // The single home for units count + occupancy (value = total, sub = the split).
  const occSub = count === 0 ? undefined : vacant === 0 ? 'All occupied' : `${vacant} vacant`;
  const sizeVal = agg.sqftLo != null ? span(agg.sqftLo, agg.sqftHi) : (agg.sqmLo != null ? span(agg.sqmLo, agg.sqmHi) : null);
  const sizeUnit = agg.sqftLo != null ? 'sq.ft' : (agg.sqmLo != null ? 'sq.m' : undefined);

  // ── stat strip — PHYSICAL facts only. Money lives in Pricing & fees; the unit
  //    type is a header chip; count/occupancy is the UNITS tile — nothing repeats. ──
  const statCandidates: Array<{ label: string; value: string | null; sub?: string; accent?: boolean }> = [
    { label: 'UNITS', value: String(count), sub: occSub },
    { label: 'SIZE', value: sizeVal, sub: sizeUnit },
    ...(residential && bedrooms != null ? [{ label: 'BEDROOMS', value: bedrooms === 0 ? 'Studio' : String(bedrooms) }] : []),
    ...(bathrooms != null ? [{ label: 'BATHROOMS', value: String(bathrooms) }] : []),
  ];
  const stats = statCandidates.filter((s) => s.value != null && String(s.value).trim() !== '');

  // ── leasing terms (plan-level) ──
  const lt = plan?.leaseTerms ?? null;
  const leasing: Array<{ label: string; value: string }> = [];
  const pushLease = (label: string, value: string | null | undefined) => {
    if (value != null && String(value).trim() !== '') leasing.push({ label, value });
  };
  if (lt) {
    pushLease('Rental Type', lt.rentalType ? titleCase(String(lt.rentalType)) : null);
    pushLease('Min. lease', lt.minLeaseMonths != null ? `${lt.minLeaseMonths} month${lt.minLeaseMonths === 1 ? '' : 's'}` : null);
    pushLease('Notice period', lt.noticePeriodDays != null ? `${lt.noticePeriodDays} day${lt.noticePeriodDays === 1 ? '' : 's'}` : null);
    pushLease('Rent escalation', lt.rentEscalationPct != null ? `${lt.rentEscalationPct}% / yr` : null);
    pushLease('Payments', lt.numberOfPayments != null ? `${lt.numberOfPayments} cheque${lt.numberOfPayments === 1 ? '' : 's'}` : null);
  }

  // ── pricing & fees grid (plan-level; ejariFee is whole AED despite the fils name elsewhere) ──
  const fees: Array<{ label: string; value: string }> = [];
  const pushFee = (label: string, v: number | null | undefined) => { if (v != null) fees.push({ label, value: `AED ${aed(v)}` }); };
  if (plan) {
    pushFee('Security Deposit', plan.securityDeposit);
    pushFee('Admin Fee', plan.adminFee);
    pushFee('Ejari Fee', plan.ejariFee);
    pushFee('Commission', plan.commission);
    pushFee('Service Charges', plan.serviceCharges);
  }
  const feeCols = isTight ? 1 : (isNarrow ? 2 : 3);
  // Leasing terms render as a full-width cell grid (one row on wide screens).
  const leaseCols = isTight ? 2 : (isNarrow ? 3 : Math.min(5, Math.max(1, leasing.length)));

  // Rent per sq.ft — a price benchmark, so it belongs with the money, not the
  // physical facts (annual rent ÷ size). Rendered with an explicit "AED" prefix.
  const aedPerSqft = plan?.aedPerSqft ?? null;

  // Market comparison (plan-level).
  const marketLo = plan?.marketFrom ?? null, marketHi = plan?.marketTo ?? null;
  const gap = plan?.marketGap ?? null; // marketFrom − rentFrom (>0 ⇒ priced below market)
  const hasMarket = marketLo != null || marketHi != null;

  const termsVer = plan?.termsVersion ?? null;
  const fpUrl = plan?.floorPlanUrl ?? null;
  const fpIsImage = fpUrl ? isImageUrl(fpUrl) : false;

  // shared bits
  const sectionIcon = (Icon: typeof Banknote) => (
    <span style={{ width: 28, height: 28, borderRadius: 8, background: C.greenBg2, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 28px' }}>
      <Icon size={16} />
    </span>
  );
  const sectionTitle = (t: string) => <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', color: C.ink }}>{t}</div>;

  // Property name only — the plan label is already the title, so it isn't repeated here.
  const subline = propertyName ?? '';

  /* ---------- render ---------- */

  return (
    <>
      {/* ── MAIN CARD — full-screen panel that swipes in from the right ── */}
      <div onClick={requestClose}
        className={`slideover-scrim${closing ? ' closing' : ''}`}
        style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,25,.46)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', zIndex: 55 }}>
        <div onClick={(e) => e.stopPropagation()}
          className={`slideover-panel${closing ? ' closing' : ''}`}
          style={{ width: '100%', height: '100dvh', maxHeight: '100dvh', background: '#fff', boxShadow: '0 24px 70px rgba(15,30,22,.30)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* HEADER */}
          <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 24px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: C.ink }}>{title}</h1>
                {planName && planName !== title && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: C.mute, background: C.line3, padding: '3px 9px', borderRadius: 6 }}>{planName}</span>
                )}
                {unitType && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: C.mute, background: C.line3, padding: '3px 9px', borderRadius: 6 }}>{titleCase(unitType)}</span>
                )}
              </div>
              {subline && <div style={{ fontSize: 12.5, color: C.mute2, marginTop: 5 }}>{subline}</div>}
            </div>
            {canEdit && onEdit && (
              <button type="button" onClick={onEdit}
                style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '8px 14px', borderRadius: 10, cursor: 'pointer' }}>
                <Pencil size={14} /> Edit layout
              </button>
            )}
            <button type="button" onClick={requestClose} aria-label="Close"
              style={{ width: 34, height: 34, flex: '0 0 34px', borderRadius: 10, border: `1px solid ${C.line}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.body, cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </header>

          {/* BODY */}
          <main style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ maxWidth: 920, margin: '0 auto', padding: isTight ? 16 : '20px 24px 28px' }}>

              {/* STATS */}
              {stats.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: isTight ? 'repeat(2,1fr)' : `repeat(${stats.length},1fr)`, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', background: '#fff', marginBottom: 24 }}>
                  {stats.map((s, i) => (
                    <div key={s.label} style={{ padding: '14px 18px', borderLeft: `1px solid ${i === 0 ? 'transparent' : C.line2}` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: C.mute4 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: s.accent ? C.greenD : C.ink, marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                      {s.sub && <div style={{ fontSize: 11, color: C.mute3, marginTop: 1 }}>{s.sub}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* UNITS ON THIS LAYOUT (full width) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {sectionIcon(Building2)}{sectionTitle('Units on this layout')}
              </div>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', marginBottom: 28 }}>
                {count === 0 ? (
                  <div style={{ padding: '14px 16px', fontSize: 13, color: C.mute3 }}>No units on this layout.</div>
                ) : (
                  <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {units.map((u, i) => {
                      const chip = availabilityChip(u.availability);
                      const rent = numOrNull(u.rentalPrice);
                      return (
                        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderTop: i === 0 ? 'none' : `1px solid ${C.line3}`, background: '#fff' }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, background: C.line3, padding: '4px 10px', borderRadius: 7, flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' }}>{u.unitNumber}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: '#6b756f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.unitName || titleCase(u.unitType)}</span>
                          {rent != null && rent > 0
                            ? <span style={{ fontSize: 12.5, fontWeight: 700, color: C.greenD, fontVariantNumeric: 'tabular-nums' }}>AED {aed(rent)}</span>
                            : <span style={{ fontSize: 11, fontWeight: 600, color: C.amber }}>No price</span>}
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: chip.color, background: chip.bg, padding: '4px 9px', borderRadius: 7, flex: '0 0 auto' }}>{chip.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* LEASING TERMS (full width — a cell grid, not a cramped side card) */}
              {leasing.length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{sectionIcon(ClipboardList)}{sectionTitle('Leasing terms')}</div>
                  <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', marginBottom: 28, display: 'grid', gridTemplateColumns: `repeat(${leaseCols},1fr)` }}>
                    {leasing.map((l, i) => (
                      <div key={l.label} style={{ padding: '13px 16px', borderTop: i >= leaseCols ? `1px solid ${C.line3}` : 'none', borderLeft: i % leaseCols === 0 ? 'none' : `1px solid ${C.line3}` }}>
                        <div style={{ fontSize: 11.5, color: C.mute2 }}>{l.label}</div>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: C.ink2, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{l.value}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* FLOOR PLAN — shown as a document (opens the view-only viewer), not a hero image */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{sectionIcon(Layers)}{sectionTitle('Floor plan')}</div>
              <div
                onClick={fpUrl ? () => setViewer({ url: fpUrl, title: `Floor plan · ${title}` }) : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 18px', border: `1px solid ${fpUrl ? C.greenBd2 : C.line}`, background: fpUrl ? C.soft2 : '#fff', borderRadius: 14, marginBottom: 28, flexWrap: 'wrap', cursor: fpUrl ? 'pointer' : 'default' }}>
                <span style={{ width: 40, height: 40, flex: '0 0 40px', borderRadius: 10, background: fpUrl ? C.greenBg2 : C.line4, color: fpUrl ? C.greenT : C.mute3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink2 }}>Floor plan</div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: fpUrl ? C.greenT : C.mute3 }}>{fpUrl ? `${fpIsImage ? 'Image' : 'PDF'} · tap to view` : 'Not uploaded for this layout'}</div>
                </div>
                {fpUrl && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '8px 13px', borderRadius: 9 }}><Eye size={14} /> View</span>}
              </div>

              {/* PRICING & FEES */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{sectionIcon(Banknote)}{sectionTitle('Pricing & fees')}</div>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', marginBottom: hasMarket || termsVer ? 24 : 28 }}>
                {/* rent per unit + rent roll */}
                <div style={{ display: 'grid', gridTemplateColumns: isTight ? '1fr' : '1.2fr 1fr', background: C.soft, borderBottom: fees.length > 0 ? `1px solid ${C.line2}` : 'none' }}>
                  <div style={{ padding: '16px 18px', borderRight: isTight ? 'none' : `1px solid ${C.line2}`, borderBottom: isTight ? `1px solid ${C.line2}` : 'none' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: C.mute4 }}>RENT / UNIT · YEARLY</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: C.greenD, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{agg.rentLo != null ? `AED ${span(agg.rentLo, agg.rentHi)}` : '—'}</div>
                    {aedPerSqft != null && <div style={{ fontSize: 11, color: C.mute3, marginTop: 3 }}>AED {aed(aedPerSqft)} / sq.ft / yr</div>}
                    {agg.unpriced > 0 && <div style={{ fontSize: 11, color: C.amber, fontWeight: 600, marginTop: 3 }}>{agg.unpriced} unit{agg.unpriced === 1 ? '' : 's'} not yet priced</div>}
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: C.mute4 }}>RENT ROLL / YR</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: agg.sum > 0 ? C.ink : C.mute3, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{agg.sum > 0 ? `AED ${aed(agg.sum)}` : '—'}</div>
                    <div style={{ fontSize: 11, color: C.mute3, marginTop: 3 }}>{agg.priced} priced unit{agg.priced === 1 ? '' : 's'} × rent</div>
                  </div>
                </div>
                {fees.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${feeCols},1fr)` }}>
                    {fees.map((f, i) => (
                      <div key={`${f.label}-${i}`} style={{ padding: '13px 18px', borderTop: `1px solid ${C.line3}`, borderLeft: `1px solid ${i % feeCols === 0 ? 'transparent' : C.line3}` }}>
                        <div style={{ fontSize: 11.5, color: C.mute2 }}>{f.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink2, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{f.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* MARKET COMPARISON */}
              {hasMarket && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 18px', border: `1px solid ${C.line}`, borderRadius: 14, marginBottom: termsVer ? 24 : 28, background: '#fff', flexWrap: 'wrap' }}>
                  {sectionIcon(TrendingUp)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2 }}>Market rent</div>
                    <div style={{ fontSize: 11.5, color: C.mute2 }}>Benchmark for this layout</div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>AED {span(marketLo, marketHi)}</div>
                  {gap != null && gap !== 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: gap > 0 ? C.amber : C.greenT, background: gap > 0 ? '#fdf3e3' : C.greenBg3, padding: '5px 10px', borderRadius: 8, flex: '0 0 auto' }}>
                      {gap > 0 ? `AED ${aed(gap)} below market` : `AED ${aed(-gap)} above market`}
                    </span>
                  )}
                </div>
              )}

              {/* SPECIAL CONDITIONS / ADDENDUM */}
              {termsVer && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{sectionIcon(ScrollText)}{sectionTitle('Special conditions')}</div>
                  <div
                    onClick={termsVer.addendumUrl ? () => setViewer({ url: termsVer.addendumUrl!, title: termsVer.addendumFileName || 'Layout addendum' }) : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 18px', border: `1px solid ${termsVer.addendumUrl ? C.greenBd2 : C.line}`, background: termsVer.addendumUrl ? C.soft2 : '#fff', borderRadius: 14, marginBottom: 8, flexWrap: 'wrap', cursor: termsVer.addendumUrl ? 'pointer' : 'default' }}>
                    <span style={{ width: 40, height: 40, flex: '0 0 40px', borderRadius: 10, background: C.greenBg2, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={18} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink2 }}>{termsVer.addendumFileName || 'Layout addendum'}</div>
                      <div style={{ fontSize: 11.5, color: C.mute2 }}>Version {termsVer.versionNo}{termsVer.versionsCount ? ` of ${termsVer.versionsCount}` : ''} · applies to every unit on this layout</div>
                    </div>
                    {termsVer.addendumUrl ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '8px 13px', borderRadius: 9 }}>
                        <Eye size={14} /> View
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: C.mute3 }}>No file</span>
                    )}
                  </div>
                </>
              )}

              {/* editorial caption */}
              <div style={{ fontSize: 11.5, color: C.mute2, lineHeight: 1.5 }}>
                <AlignLeft size={12} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
                Pricing, fees and lease terms shown here are set for the whole layout and apply to every unit on it{canEdit ? ' — use “Edit layout” to change them.' : '.'}
              </div>

            </div>
          </main>

          {/* FOOTER */}
          {canEdit && onEdit && (
            <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderTop: `1px solid ${C.line2}`, background: C.soft, flex: '0 0 auto' }}>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={onEdit}
                style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 700, color: '#fff', background: C.green, padding: '12px 22px', borderRadius: 11, border: 'none', cursor: 'pointer', boxShadow: '0 6px 16px rgba(26,154,100,.26)' }}>
                <Pencil size={15} /> Edit layout
              </button>
            </footer>
          )}
        </div>
      </div>

      {/* ── DOCUMENT VIEWER (floor plan / addendum · view-only, no download) ── */}
      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(12,20,15,.82)', display: 'flex', flexDirection: 'column', zIndex: 70 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', color: '#fff' }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><FileText size={15} /> {viewer.title}</div>
            <div onClick={() => setViewer(null)} style={{ width: 36, height: 36, flex: '0 0 36px', borderRadius: 10, background: 'rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={18} /></div>
          </div>
          <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isTight ? 10 : '0 24px 24px' }}>
            {isImageUrl(viewer.url) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewer.url} alt={viewer.title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 14, background: '#fff' }} />
            ) : (
              <iframe src={`${viewer.url}#toolbar=0&navpanes=0&statusbar=0&view=FitH`} title={viewer.title} style={{ width: '100%', maxWidth: 900, height: '100%', border: 0, borderRadius: 12, background: '#fff' }} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
