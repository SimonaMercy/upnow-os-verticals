'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * Unit View — read-only unit detail popup (RP /units + manager properties).
 *
 * Redesigned to the "Unit View" handoff (sibling of the Property View modal): a
 * single near-full-screen card with
 * Each value appears once — physical facts in the stat strip, money in Pricing
 * & fees, type/status in the header, other identifiers in Key facts:
 *   • header (name · status · type · Edit · close)
 *   • photo gallery (hero + thumbnails → full-screen lightbox)
 *   • stat strip — PHYSICAL only (size · beds/baths · view)
 *   • About + Key facts (description, amenities, leasing terms)
 *   • Pricing & fees (annual rent + the one-off fee grid)
 *   • Documents grid + a view-only reader (floor plan, title deed, …)
 *   • Lease renewal history + Unit price revision (both from the price timeline)
 *
 * Data — the same endpoints the previous version used:
 *   GET /api{fetchBase}/:pid/units/:uid/media           (unit photos)
 *   GET /api{fetchBase}/:pid/units/:uid/price-history   (lease + reprice timeline)
 *   GET /api/documents?ownerType=unit&ownerId=:uid       (unit documents)
 * Documents are view-only here (the header "Edit" opens the unit form for
 * changes), matching the no-download document-viewer principle.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  X, ArrowLeft, ExternalLink, FileText, Eye, AlignLeft, Banknote, Users, History,
  Image as ImageIcon, Check, Pencil, ChevronLeft, ChevronRight, Loader2,
  ArrowUp, ArrowDown,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { isSubleaseChargeRow } from '@/lib/unitForm';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { useSlideOver } from '@/lib/useSlideOver';

/* ---------- types ---------- */

interface Unit {
  id: number;
  propertyId: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  unitTier: string;
  floor: string | null;
  premiseNumber: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces?: number | null;
  unitSizeSqft: number | null;
  unitSizeSqm: number | null;
  view: string | null;
  furnishing: string | null;
  facilities: string | null;
  rentalPrice: number | null;
  securityDeposit: number | null;
  adminFee: number | null;
  ejariFeeFils: number | null;
  commission: number | null;
  serviceCharges: number | null;
  availability: string;
  description: string | null;
  isListed: boolean;
  listingStatus: string;
  planLabel?: string | null;
  floorPlanUrl?: string | null;
}

interface UnitMedia {
  id: number;
  url: string;
  caption?: string | null;
}

interface LeaseEvent {
  kind: 'lease';
  date: string | null;
  effectiveTo: string | null;
  contractId: number | null;
  contractType: string | null;
  annualRent: number | null;
  listedPrice: number | null;
  discountAmount: number | null;
}

interface RepriceEvent {
  kind: 'reprice';
  date: string | null;
  field: string | null;
  oldPrice: number | null;
  newPrice: number | null;
  source: string | null;
  reason: string | null;
  changedByUserId: number | null;
}

type PriceEvent = LeaseEvent | RepriceEvent;

interface PriceHistory {
  unitId: number;
  unitNumber: string | null;
  currentRentalPrice: number | null;
  leaseCount: number;
  repriceCount: number;
  timeline: PriceEvent[];
}

/** A contract on this unit — used to enrich the renewal history. */
interface UnitContract {
  id: number;
  tenantName: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  active?: boolean;
}

/** Defensive shape for a document record returned by GET /documents. */
interface DocRecord {
  id?: number;
  documentKey?: string;
  document_key?: string;
  displayName?: string | null;
  display_name?: string | null;
  fileUrl?: string;
  file_url?: string;
  url?: string;
  fileName?: string;
  file_name?: string;
  mimeType?: string | null;
  mime_type?: string | null;
}

interface SlotFile { id: number; name: string; url: string; mime: string | null }
interface DocSlot { key: string; label: string; files: SlotFile[] }

/* ---------- colour tokens (from the handoff) ---------- */
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

const aed = (v: number | null | undefined) =>
  v === null || v === undefined ? null : `AED ${Number(v).toLocaleString('en-AE')}`;

const fmtDate = (v: string | null | undefined) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
};

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function docKey(d: DocRecord): string { return d.documentKey ?? d.document_key ?? ''; }
function docUrl(d: DocRecord): string | null { return d.fileUrl ?? d.file_url ?? d.url ?? null; }
function docMime(d: DocRecord): string | null { return d.mimeType ?? d.mime_type ?? null; }
function docName(d: DocRecord): string {
  return d.displayName ?? d.display_name ?? d.fileName ?? d.file_name ?? 'Document';
}
function isImageFile(f: SlotFile): boolean {
  return (f.mime ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(f.url);
}

interface LeaseTerms {
  rentalType?: string; minLeaseMonths?: number; noticePeriodDays?: number; rentEscalationPct?: number;
}
/** The `facilities` column packs amenities + optional lease terms + extra fees
 *  as JSON (bare array, or { amenities, leaseTerms, additionalPayments }). */
function parseFacilities(facilities: string | null): {
  amenities: string[];
  leaseTerms: LeaseTerms;
  additionalPayments: Array<{ label: string; amount: number; vat: number }>;
} {
  if (!facilities) return { amenities: [], leaseTerms: {}, additionalPayments: [] };
  try {
    const parsed = JSON.parse(facilities);
    if (Array.isArray(parsed)) return { amenities: parsed as string[], leaseTerms: {}, additionalPayments: [] };
    if (parsed && typeof parsed === 'object') {
      const lt = (parsed.leaseTerms ?? {}) as LeaseTerms;
      const rawAp = (parsed.additionalPayments ?? []) as Array<{ label?: string; amount?: number; vat?: number }>;
      const additionalPayments = Array.isArray(rawAp)
        ? rawAp.filter((p) => p && p.label && Number(p.amount) > 0)
               .map((p) => ({ label: String(p.label), amount: Number(p.amount) || 0, vat: Number(p.vat) || 0 }))
        : [];
      return {
        amenities: Array.isArray(parsed.amenities) ? (parsed.amenities as string[]) : [],
        leaseTerms: lt,
        additionalPayments,
      };
    }
    return { amenities: [], leaseTerms: {}, additionalPayments: [] };
  } catch { return { amenities: [], leaseTerms: {}, additionalPayments: [] }; }
}

const availabilityChip = (a: string): { color: string; bg: string } => {
  const v = (a || '').toLowerCase();
  if (v === 'occupied') return { color: C.greenT, bg: C.greenBg };
  if (v === 'reserved' || v === 'on_hold' || v === 'pending') return { color: C.amber, bg: '#fdf3e3' };
  if (v === 'maintenance') return { color: '#854d0e', bg: '#fef3c7' };
  return { color: C.mute, bg: C.line3 };
};
const contractChip = (s: string): { color: string; bg: string } => {
  const v = (s || '').toLowerCase();
  if (v === 'active') return { color: C.greenT, bg: C.greenBg3 };
  if (v.includes('pending') || v.includes('draft') || v.includes('renew')) return { color: C.amber, bg: '#fdf3e3' };
  return { color: '#6b756f', bg: C.line3 };
};

function leaseLabel(contractType: string | null, isNewest: boolean, isActive: boolean): string {
  const t = (contractType || '').toLowerCase();
  if (isNewest) return isActive ? 'Current term' : 'Latest term';
  if (t.includes('renew')) return 'Renewal';
  if (t.includes('new')) return 'New lease';
  return 'Lease';
}

/* ---------- component ---------- */

export function UnitPreviewModal({
  propertyId,
  fetchBase = '/properties',
  fetchQuery = '',
  propertyName,
  leasingType,
  unit,
  contract,
  contracts,
  onEdit,
  onClose,
}: {
  propertyId: number;
  /** Manager portal passes '/manager/properties' + 'rp=N'. */
  fetchBase?: string;
  fetchQuery?: string;
  propertyName?: string | null;
  /** Parent property's leasing model — `'sub'` shows the auto-calculated
   *  sub-lease charge (20% of Market Rent + 5% VAT), matching the layout view. */
  leasingType?: 'direct' | 'sub' | 'management' | null;
  unit: Unit;
  /** Current / latest contract — drives the renewal history when `contracts` is absent. */
  contract?: UnitContract | null;
  /** All contracts on this unit — enriches each renewal-history row with its tenant + status. */
  contracts?: UnitContract[];
  /** Opens the edit form (header "Edit" button). Hidden when omitted. */
  onEdit?: () => void;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<UnitMedia[]>([]);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [docs, setDocs] = useState<DocRecord[]>([]);

  // Overlays + UI state
  const [lb, setLb] = useState<number | null>(null);          // lightbox photo index
  const [reader, setReader] = useState<string | null>(null);  // active doc slot key
  const [readerFile, setReaderFile] = useState(0);            // active file in slot

  // Swipe-in / swipe-out — same right-to-left full-screen slide as
  // PropertyDetailsModal (see globals.css .slideover-*). Conditionally mounted,
  // so slide-in plays on mount; `dismiss` plays the reverse slide, then calls
  // onClose (which unmounts us). The shared hook also wires the browser Back
  // button to close the panel instead of navigating away.
  const { closing, dismiss } = useSlideOver(onClose);
  const [descOpen, setDescOpen] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);
  const [descClamps, setDescClamps] = useState(false);        // does the clamped description overflow?

  // Track viewport so the layout collapses like the handoff.
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const isNarrow = vw < 820;
  const isTight = vw < 600;

  const q = fetchQuery ? `?${fetchQuery}` : '';
  // Manager portal has no standalone unit-detail page; this modal IS the full
  // unit view for managers, so we suppress the "Open full page" jump-out (which
  // would dead-link into the RP-only /rental-provider route) in manager mode.
  const isManagerView = fetchBase.startsWith('/manager');

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoryLoading(true);
    apiGet<UnitMedia[]>(`${fetchBase}/${propertyId}/units/${unit.id}/media${q}`)
      .then((m) => { if (!cancelled) setMedia(m || []); })
      .catch(() => {});
    apiGet<PriceHistory>(`${fetchBase}/${propertyId}/units/${unit.id}/price-history${q}`)
      .then((h) => { if (!cancelled) setHistory(h); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    apiGet<DocRecord[]>(`/documents?ownerType=unit&ownerId=${unit.id}`)
      .then((d) => { if (!cancelled) setDocs(Array.isArray(d) ? d : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [propertyId, unit.id, fetchBase, q]);

  // ── ESC closes the topmost layer ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lb !== null) setLb(null);
      else if (reader !== null) setReader(null);
      else dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lb, reader, dismiss]);

  // Show the "Read more" toggle only when the 3-line clamp actually truncates the
  // text — a char-count heuristic mis-fires for short-but-tall descriptions.
  useEffect(() => {
    const el = descRef.current;
    if (!el || descOpen) return; // only measure in the clamped state; keep the flag while expanded
    setDescClamps(el.scrollHeight > el.clientHeight + 2);
  }, [unit.description, descOpen, vw]);

  /* ---------- derived ---------- */

  const unitTitle = unit.unitName || `Unit ${unit.unitNumber ?? unit.id}`;
  const residential = isResidentialUnitType(unit.unitType);
  const rent = unit.rentalPrice;

  // Property name only — premise / floor live in Key facts, so they aren't repeated here.
  const subline = propertyName ? String(propertyName) : '';

  const { amenities, leaseTerms, additionalPayments } = parseFacilities(unit.facilities);

  // ── stat strip — PHYSICAL facts only. Rent lives in Pricing & fees; the unit
  //    type is a header chip; other identifiers are in Key facts — nothing repeats. ──
  const sizeSub = [
    unit.unitSizeSqft != null ? 'sq.ft' : null,
    unit.unitSizeSqm != null ? `${Number(unit.unitSizeSqm).toLocaleString('en-AE')} sq.m` : null,
  ].filter(Boolean).join(' · ');
  const statCandidates: Array<{ label: string; value: string | null; sub?: string; accent?: boolean }> = [
    {
      label: 'SIZE',
      value: unit.unitSizeSqft != null ? Number(unit.unitSizeSqft).toLocaleString('en-AE')
        : unit.unitSizeSqm != null ? Number(unit.unitSizeSqm).toLocaleString('en-AE') : null,
      sub: unit.unitSizeSqft != null ? sizeSub : (unit.unitSizeSqm != null ? 'sq.m' : undefined),
    },
    ...(residential && unit.bedrooms != null ? [{ label: 'BEDROOMS', value: String(unit.bedrooms) }] : []),
    ...(unit.bathrooms != null ? [{ label: 'BATHROOMS', value: String(unit.bathrooms) }] : []),
    ...(unit.view ? [{ label: 'VIEW', value: unit.view, sub: 'View facing' }] : []),
  ];
  const stats = statCandidates.filter((s) => s.value != null && String(s.value).trim() !== '');

  // ── key facts (identifiers not shown in the stat strip / header / pricing) ──
  const facts: Array<{ label: string; value: string }> = [];
  const pushFact = (label: string, value: string | null | undefined) => {
    if (value != null && String(value).trim() !== '') facts.push({ label, value });
  };
  pushFact('Unit Number', unit.unitNumber);
  pushFact('Premise No.', unit.premiseNumber);
  pushFact('Floor', unit.floor);
  if (unit.unitTier) pushFact('Tier', titleCase(unit.unitTier));
  if (residential) pushFact('Furnishing', unit.furnishing ? titleCase(unit.furnishing) : null);
  if (unit.parkingSpaces != null && unit.parkingSpaces > 0)
    pushFact('Parking', `${unit.parkingSpaces} bay${unit.parkingSpaces === 1 ? '' : 's'}`);
  pushFact('Plan', unit.planLabel ?? null);

  // ── leasing terms ──
  const leasing: Array<{ label: string; value: string }> = [];
  const pushLease = (label: string, value: string | null | undefined) => {
    if (value != null && String(value).trim() !== '') leasing.push({ label, value });
  };
  pushLease('Rental Type', leaseTerms.rentalType ? titleCase(String(leaseTerms.rentalType)) : null);
  pushLease('Min. lease', leaseTerms.minLeaseMonths != null ? `${leaseTerms.minLeaseMonths} month${leaseTerms.minLeaseMonths === 1 ? '' : 's'}` : null);
  pushLease('Notice period', leaseTerms.noticePeriodDays != null ? `${leaseTerms.noticePeriodDays} day${leaseTerms.noticePeriodDays === 1 ? '' : 's'}` : null);
  pushLease('Rent escalation', leaseTerms.rentEscalationPct != null ? `${leaseTerms.rentEscalationPct}% / yr` : null);

  // ── pricing & fees grid ──
  // ejariFeeFils is actually whole AED despite the column name.
  const fees: Array<{ label: string; value: string }> = [];
  const pushFee = (label: string, value: string | null) => { if (value != null) fees.push({ label, value }); };
  pushFee('Security Deposit', aed(unit.securityDeposit));
  pushFee('Admin Fee', aed(unit.adminFee));
  pushFee('Contract Registration Fee', aed(unit.ejariFeeFils));
  pushFee('Commission', aed(unit.commission));
  pushFee('Service Charges', aed(unit.serviceCharges));
  // The sub-lease charge is shown in its own auto-calculated block below, so keep
  // its persisted rows out of the generic fee grid to avoid showing it twice.
  additionalPayments
    .filter((p) => !isSubleaseChargeRow(p.label))
    .forEach((p) => pushFee(p.vat > 0 ? `${p.label} (incl. VAT)` : p.label, aed(p.amount + p.vat)));
  // Sub-lease charge — auto-calculated from Market Rent (20% + 5% VAT on that
  // 20%), only for sub-lease properties. Matches the layout Details view.
  const subFees: Array<{ label: string; value: string }> = [];
  if (leasingType === 'sub' && rent != null && Number(rent) > 0) {
    const net = Math.round(Number(rent) * 0.20);
    subFees.push({ label: '20% on sub-lease', value: aed(net) ?? '—' });
    subFees.push({ label: '5% VAT on sub-lease', value: aed(Math.round(net * 0.05)) ?? '—' });
  }
  const feeCols = isTight ? 1 : (isNarrow ? 2 : 3);

  // ── documents (view-only) ──
  // Floor plan lives on the unit row (a column); the title deed + any addendums
  // live in the documents table under ownerType=unit.
  const slots: DocSlot[] = useMemo(() => {
    const records = docs.filter((d) => d.id != null && docUrl(d));
    const toFile = (d: DocRecord): SlotFile => ({ id: d.id as number, name: docName(d), url: docUrl(d)!, mime: docMime(d) });
    const out: DocSlot[] = [];

    const fpName = unit.floorPlanUrl ? unit.floorPlanUrl.split('/').pop()?.split('?')[0] || 'Floor plan' : 'Floor plan';
    out.push({
      key: 'floor_plan',
      label: 'Floor Plans',
      files: unit.floorPlanUrl ? [{ id: -1, name: fpName, url: unit.floorPlanUrl, mime: null }] : [],
    });

    const titleDeeds = records.filter((d) => docKey(d) === 'title_deed').map(toFile);
    out.push({ key: 'title_deed', label: 'Title Deed', files: titleDeeds });

    const others = records.filter((d) => docKey(d) !== 'title_deed').map(toFile);
    if (others.length) out.push({ key: 'other', label: 'Other Documents', files: others });
    return out;
  }, [docs, unit.floorPlanUrl]);

  const onFileCount = slots.filter((s) => s.files.length > 0).length;
  const docsSummary = `${onFileCount} of ${slots.length} on file`;

  // reader derived
  const rSlot = reader ? slots.find((s) => s.key === reader) ?? null : null;
  const rFiles = rSlot?.files ?? [];
  const rf = Math.min(readerFile, Math.max(0, rFiles.length - 1));
  const rActive = rFiles[rf] ?? null;
  const seq = useMemo(() => {
    const o: { key: string; idx: number }[] = [];
    slots.forEach((s) => s.files.forEach((_, i) => o.push({ key: s.key, idx: i })));
    return o;
  }, [slots]);
  const curPos = seq.findIndex((x) => x.key === reader && x.idx === rf);
  const goSeq = (delta: number) => {
    if (!seq.length) return;
    const pos = ((curPos < 0 ? 0 : curPos) + delta + seq.length) % seq.length;
    setReader(seq[pos].key); setReaderFile(seq[pos].idx);
  };

  // ── renewal history + price revision (from the price timeline) ──
  const timeline = history?.timeline ?? [];
  const leaseEvents = timeline.filter((e): e is LeaseEvent => e.kind === 'lease'); // newest-first

  const byContract = useMemo(() => {
    const m = new Map<number, UnitContract>();
    (contracts ?? []).forEach((c) => m.set(c.id, c));
    if (contract && !m.has(contract.id)) m.set(contract.id, contract);
    return m;
  }, [contracts, contract]);

  const renewals = leaseEvents.slice(0, 6).map((e, i) => {
    const c = e.contractId != null ? byContract.get(e.contractId) : undefined;
    const isNewest = i === 0;
    // When no contract record is available (manager portal), fall back to the
    // rent-history signal: an open tenancy (effectiveTo == null) on the newest row.
    const isActive = c
      ? (c.active === true || (c.status || '').toLowerCase() === 'active')
      : (isNewest && e.effectiveTo == null);
    const status = c ? titleCase(c.status) : (isActive ? 'Active' : 'Completed');
    const tone = c ? contractChip(c.status) : contractChip(isActive ? 'active' : 'completed');
    // Only paint the current tenant onto the newest row — older rows keep their own
    // tenant (from the contracts map) or show none, never the current one.
    const tenant = c?.tenantName ?? (isNewest ? contract?.tenantName ?? null : null);
    return {
      ref: isActive ? 'Now' : (e.contractId != null ? `#${e.contractId}` : '—'),
      tenant,
      label: leaseLabel(e.contractType, isNewest, isActive),
      range: `${fmtDate(e.date)} → ${fmtDate(e.effectiveTo)}`,
      rent: aed(e.annualRent) ?? '—',
      status, statusColor: tone.color, statusBg: tone.bg,
      contractId: e.contractId,
    };
  });

  // Price revision: distinct rent levels oldest→newest (collapse same-rent renewals).
  const progPoints: Array<{ date: string | null; rent: number }> = [];
  [...leaseEvents].reverse().filter((e) => e.annualRent != null).forEach((e) => {
    if (!progPoints.length || progPoints[progPoints.length - 1].rent !== e.annualRent) {
      progPoints.push({ date: e.date, rent: e.annualRent as number });
    }
  });
  const progression = progPoints.map((p, i) => {
    const prev = i > 0 ? progPoints[i - 1].rent : null;
    const pct = prev != null && prev !== 0 ? ((p.rent - prev) / prev) * 100 : null;
    return {
      date: fmtDate(p.date),
      rent: `AED ${p.rent.toLocaleString('en-AE')}`,
      current: i === progPoints.length - 1,
      up: pct != null ? pct >= 0 : true,
      change: pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : null,
      connector: i < progPoints.length - 1,
    };
  });

  const isPublished = unit.isListed || (unit.listingStatus || '').toLowerCase() === 'published';
  const avChip = availabilityChip(unit.availability);

  // photos
  const photoSmalls = media.slice(1, 5);
  const extraPhotos = Math.max(0, media.length - 5);
  const showSmalls = !isTight && media.length > 1;

  // shared bits
  const sectionIcon = (Icon: typeof Banknote) => (
    <span style={{ width: 28, height: 28, borderRadius: 8, background: C.greenBg2, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 28px' }}>
      <Icon size={16} />
    </span>
  );
  const sectionTitle = (t: string) => <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', color: C.ink }}>{t}</div>;

  /* ---------- render ---------- */

  return (
    <>
      {/* ── MAIN CARD — full-screen panel that swipes in from the right ── */}
      <div onClick={dismiss}
        className={`slideover-scrim${closing ? ' closing' : ''}`}
        style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,25,.46)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', zIndex: 50 }}>
        <div onClick={(e) => e.stopPropagation()}
          className={`slideover-panel${closing ? ' closing' : ''}`}
          style={{ width: '100%', height: '100dvh', maxHeight: '100dvh', background: '#fff', boxShadow: '0 24px 70px rgba(15,30,22,.30)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* HEADER */}
          <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 24px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
            <button type="button" onClick={dismiss} aria-label="Back"
              style={{ width: 34, height: 34, flex: '0 0 34px', borderRadius: 10, border: `1px solid ${C.line}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.body, cursor: 'pointer' }}>
              <ArrowLeft size={18} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', color: C.ink }}>{unitTitle}</h1>
                {unit.availability && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: avChip.color, background: avChip.bg, padding: '3px 9px', borderRadius: 6 }}>{titleCase(unit.availability)}</span>
                )}
                {unit.unitType && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: C.mute, background: C.line3, padding: '3px 9px', borderRadius: 6 }}>{titleCase(unit.unitType)}</span>
                )}
              </div>
              {subline && <div style={{ fontSize: 12.5, color: C.mute2, marginTop: 5 }}>{subline}</div>}
            </div>
            {onEdit && (
              <button type="button" onClick={onEdit}
                style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '8px 14px', borderRadius: 10, cursor: 'pointer' }}>
                <Pencil size={14} /> Edit
              </button>
            )}
          </header>

          {/* BODY */}
          <main style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ maxWidth: 920, margin: '0 auto', padding: isTight ? 16 : '20px 24px 28px' }}>

              {/* GALLERY */}
              {media.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: showSmalls ? '1.7fr 1fr 1fr' : '1fr', gridTemplateRows: showSmalls ? '160px 160px' : (isTight ? '220px' : '320px'), gap: 8, marginBottom: 18 }}>
                  <div onClick={() => setLb(0)} style={{ gridColumn: 1, gridRow: showSmalls ? '1 / span 2' : '1', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={media[0].url} alt={media[0].caption || unitTitle} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <span style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, color: '#fff', background: 'rgba(20,40,30,.5)', padding: '6px 12px', borderRadius: 9 }}>
                      <ImageIcon size={14} /> {media.length} photo{media.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {showSmalls && photoSmalls.map((ph, i) => {
                    const idx = i + 1;
                    const showMore = i === 3 && extraPhotos > 0;
                    return (
                      <div key={ph.id} onClick={() => setLb(idx)} style={{ borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ph.url} alt={ph.caption || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {showMore && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,40,30,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>+{extraPhotos}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ height: 160, borderRadius: 14, background: 'linear-gradient(140deg,#dfe8e1,#cdddd2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.mute3, marginBottom: 18 }}>
                  <ImageIcon size={26} />
                  <span style={{ fontSize: 12, marginTop: 6 }}>No photos yet</span>
                </div>
              )}

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

              {/* ABOUT + KEY FACTS */}
              <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1.5fr 1fr', gap: 24, marginBottom: 28 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    {sectionIcon(AlignLeft)}{sectionTitle('About this unit')}
                  </div>
                  {unit.unitName && <div style={{ fontSize: 14.5, fontWeight: 700, color: C.ink, marginBottom: 7 }}>{unit.unitName}</div>}
                  <div ref={descRef} style={{ fontSize: 13.5, color: C.body, lineHeight: 1.65, ...(descOpen ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
                    {unit.description || 'No description has been added for this unit yet.'}
                  </div>
                  {unit.description && descClamps && (
                    <span onClick={() => setDescOpen((o) => !o)} style={{ display: 'inline-block', marginTop: 7, fontSize: 12.5, fontWeight: 700, color: C.greenT, cursor: 'pointer' }}>
                      {descOpen ? 'Show less' : 'Read more'}
                    </span>
                  )}
                  {amenities.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: C.mute4, margin: '18px 0 10px' }}>AMENITIES</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {amenities.map((a, i) => (
                          <span key={`${a}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd3}`, padding: '6px 12px', borderRadius: 999 }}>
                            <Check size={12} />{a}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div style={{ background: C.soft, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, alignSelf: 'start' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: C.mute4, marginBottom: 6 }}>KEY FACTS</div>
                  {facts.map((f) => (
                    <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: `1px solid ${C.line3}` }}>
                      <span style={{ fontSize: 12.5, color: C.mute2 }}>{f.label}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, textAlign: 'right' }}>{f.value}</span>
                    </div>
                  ))}
                  {leasing.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: C.mute4, margin: '14px 0 6px' }}>LEASING TERMS</div>
                      {leasing.map((l) => (
                        <div key={l.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 0', borderTop: `1px solid ${C.line3}` }}>
                          <span style={{ fontSize: 12.5, color: C.mute2 }}>{l.label}</span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, textAlign: 'right' }}>{l.value}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* PRICING & FEES */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{sectionIcon(Banknote)}{sectionTitle('Pricing & fees')}</div>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, padding: '16px 18px', background: C.soft, borderBottom: `1px solid ${C.line2}`, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: C.mute4 }}>MARKET RENT</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: C.greenD, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{rent != null ? `AED ${Number(rent).toLocaleString('en-AE')}` : '—'}</div>
                  </div>
                  {fees.length > 0 && <div style={{ fontSize: 11.5, color: C.mute3 }}>Excludes deposit &amp; one-off fees below</div>}
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
                {subFees.length > 0 && (
                  <div style={{ borderTop: `1px solid ${C.line3}`, background: '#fbf6ea', padding: '13px 18px' }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.07em', color: '#8a7a4e', textTransform: 'uppercase', marginBottom: 9 }}>Sub-lease charge · auto-calculated from Market Rent</div>
                    <div style={{ display: 'grid', gridTemplateColumns: isTight ? '1fr' : 'repeat(2,1fr)', gap: '10px 18px' }}>
                      {subFees.map((f, i) => (
                        <div key={`${f.label}-${i}`}>
                          <div style={{ fontSize: 11.5, color: C.mute2 }}>{f.label}</div>
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink2, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* DOCUMENTS */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {sectionIcon(FileText)}{sectionTitle('Documents')}
                <span style={{ fontSize: 11.5, color: C.mute3 }}>{docsSummary}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isTight ? '1fr' : 'repeat(2,1fr)', gap: 10, marginBottom: 28 }}>
                {slots.map((slot) => {
                  const attached = slot.files.length > 0;
                  const multi = slot.files.length > 1;
                  const statusText = attached ? (multi ? `${slot.files.length} files · uploaded` : 'Uploaded · PDF') : 'Not uploaded';
                  return (
                    <div key={slot.key} onClick={() => { if (attached) { setReader(slot.key); setReaderFile(0); } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', border: `1px solid ${attached ? C.greenBd2 : C.line}`, background: attached ? C.soft2 : '#fff', borderRadius: 11, cursor: attached ? 'pointer' : 'default' }}>
                      <div style={{ position: 'relative', width: 40, height: 50, flex: '0 0 40px' }}>
                        {attached ? (
                          <div style={{ width: 40, height: 50, background: '#fff', border: '1px solid #e2e7e1', borderRadius: 5, boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: 5 }}>
                            <div style={{ width: 14, height: 14, borderRadius: 3, background: C.green }} />
                            <div style={{ height: 3, width: '80%', background: '#e6eae5', borderRadius: 2, marginTop: 5 }} />
                            <div style={{ height: 3, width: '92%', background: '#eef1ec', borderRadius: 2, marginTop: 3 }} />
                            <div style={{ height: 3, width: '70%', background: '#eef1ec', borderRadius: 2, marginTop: 3 }} />
                          </div>
                        ) : (
                          <div style={{ width: 40, height: 50, border: '1.5px dashed #d6ddd6', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bcc4bd' }}><FileText size={15} /></div>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{slot.label}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: attached ? C.greenT : C.mute3, marginTop: 2 }}>{statusText}</div>
                      </div>
                      {attached && <span style={{ color: C.mute3, flex: '0 0 auto' }}><Eye size={15} /></span>}
                    </div>
                  );
                })}
              </div>

              {/* LEASE RENEWAL HISTORY + PRICE REVISION */}
              <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1.5fr 1fr', gap: 24, marginBottom: 6, alignItems: 'start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{sectionIcon(Users)}{sectionTitle('Lease renewal history')}</div>
                  <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
                    {historyLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', fontSize: 13, color: C.mute3 }}><Loader2 size={15} className="animate-spin" /> Loading…</div>
                    ) : renewals.length === 0 ? (
                      <div style={{ padding: '14px 16px', fontSize: 13, color: C.mute3 }}>No lease history yet.</div>
                    ) : renewals.map((r, i) => (
                      <div key={`${r.contractId}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderTop: i === 0 ? 'none' : `1px solid ${C.line3}` }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: C.greenT, background: C.greenBg2, padding: '4px 9px', borderRadius: 7, flex: '0 0 auto', minWidth: 42, textAlign: 'center' }}>{r.ref}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {r.tenant && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.tenant}</div>}
                          <div style={{ fontSize: 11, color: C.mute2, fontVariantNumeric: 'tabular-nums' }}>{r.label} · {r.range}</div>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink2, fontVariantNumeric: 'tabular-nums' }}>{r.rent}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: r.statusColor, background: r.statusBg, padding: '4px 8px', borderRadius: 7, flex: '0 0 auto' }}>{r.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>{sectionIcon(History)}{sectionTitle('Per Unit pricing history')}</div>
                  <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column' }}>
                    {historyLoading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.mute3 }}><Loader2 size={15} className="animate-spin" /> Loading…</div>
                    ) : progression.length === 0 ? (
                      <div style={{ fontSize: 13, color: C.mute3 }}>No price history yet.</div>
                    ) : progression.map((p, i) => (
                      <div key={i}>
                        <div style={{ width: '100%', borderRadius: 11, padding: '11px 13px', border: `1.5px solid ${p.current ? C.greenBd2 : C.line}`, background: p.current ? '#f1f8f4' : '#fff' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                            <span style={{ fontSize: 11, color: C.mute2, fontWeight: 600 }}>{p.date}</span>
                            {p.current && <span style={{ fontSize: 9, fontWeight: 700, color: C.greenT, background: C.greenBg3, padding: '2px 6px', borderRadius: 5 }}>CURRENT</span>}
                          </div>
                          <div style={{ fontSize: 17, fontWeight: 800, color: p.current ? C.greenD : C.ink2, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{p.rent}</div>
                        </div>
                        {p.connector && progression[i + 1]?.change && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: progression[i + 1].up ? C.greenT : C.danger, padding: '5px 0 5px 14px' }}>
                            {progression[i + 1].up ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                            <span style={{ fontSize: 11, fontWeight: 700 }}>{progression[i + 1].change}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          </main>

          {/* FOOTER */}
          <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderTop: `1px solid ${C.line2}`, background: C.soft, flex: '0 0 auto' }}>
            {isPublished && (
              <Link href={`/listings/units/${unit.id}`} target="_blank"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: C.mute, textDecoration: 'none' }}>
                Public listing <ExternalLink size={13} />
              </Link>
            )}
            <div style={{ flex: 1 }} />
            {/* No "Open full page" any more. It pointed at the standalone
                /dashboard/units/{id} page, which was a second rendering of the
                unit maintained alongside this one; that page is gone and THIS
                is where a unit is read, so the button would now link the reader
                back to what they are already looking at. */}
          </footer>
        </div>
      </div>

      {/* ── LIGHTBOX ── */}
      {lb !== null && media.length > 0 && (
        <div onClick={() => setLb(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(12,20,15,.82)', display: 'flex', flexDirection: 'column', zIndex: 70 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', color: '#fff' }}>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{lb + 1} / {media.length}</div>
            <div onClick={() => setLb(null)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={18} /></div>
          </div>
          <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 16px' }}>
            {media.length > 1 && (
              <div onClick={() => setLb((lb - 1 + media.length) % media.length)} style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: '50%', background: 'rgba(255,255,255,.16)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ChevronLeft size={24} /></div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={media[lb].url} alt="" style={{ flex: 1, maxWidth: 820, maxHeight: '72%', objectFit: 'contain', borderRadius: 14 }} />
            {media.length > 1 && (
              <div onClick={() => setLb((lb + 1) % media.length)} style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: '50%', background: 'rgba(255,255,255,.16)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ChevronRight size={24} /></div>
            )}
          </div>
          {media.length > 1 && (
            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 18, overflowX: 'auto' }}>
              {media.map((ph, i) => (
                <div key={ph.id} onClick={() => setLb(i)} style={{ width: 64, height: 46, flex: '0 0 64px', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', opacity: i === lb ? 1 : 0.5, border: `2px solid ${i === lb ? C.green : 'transparent'}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DOCUMENT READER (view-only) ── */}
      {reader !== null && rSlot && (
        <div onClick={() => setReader(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,18,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isTight ? 0 : 22, zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 900, height: isTight ? '100%' : '90vh', maxHeight: isTight ? '100%' : '90vh', background: '#fff', borderRadius: isTight ? 0 : 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(15,30,22,.42)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
              <span style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 9, background: C.greenBg2, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rActive?.name || rSlot.label}</div>
                <div style={{ fontSize: 11, color: C.greenT, fontWeight: 600 }}>
                  {rActive ? (rFiles.length > 1 ? `File ${rf + 1} of ${rFiles.length} · ${isImageFile(rActive) ? 'Image' : 'PDF'}` : `${isImageFile(rActive) ? 'Image' : 'PDF'} · Uploaded`) : 'Not uploaded'}
                </div>
              </div>
              <div onClick={() => setReader(null)} style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 9, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.body, cursor: 'pointer' }}><X size={17} /></div>
            </div>

            <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
              {/* cross-document nav */}
              {rActive && seq.length > 1 && (
                <>
                  <div onClick={() => goSeq(-1)} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: '#fff', border: '1px solid #e2e7e1', boxShadow: '0 4px 14px rgba(20,40,30,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a443d', cursor: 'pointer', zIndex: 5 }}><ChevronLeft size={21} /></div>
                  <div onClick={() => goSeq(1)} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: '#fff', border: '1px solid #e2e7e1', boxShadow: '0 4px 14px rgba(20,40,30,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a443d', cursor: 'pointer', zIndex: 5 }}><ChevronRight size={21} /></div>
                  <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(20,40,30,.55)', padding: '5px 12px', borderRadius: 9, zIndex: 5 }}>{(curPos < 0 ? 0 : curPos) + 1} of {seq.length} files</div>
                </>
              )}
              {rActive ? (
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: C.line2, display: 'flex', justifyContent: 'center' }}>
                  {isImageFile(rActive) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={rActive.url} alt={rActive.name} style={{ maxWidth: '100%', alignSelf: 'flex-start', margin: 22, borderRadius: 8, boxShadow: '0 6px 22px rgba(20,40,30,.12)' }} />
                  ) : (
                    <iframe src={`${rActive.url}#toolbar=0&navpanes=0&statusbar=0&view=FitH`} title={rActive.name} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />
                  )}
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, background: C.soft, color: C.mute3, fontSize: 13 }}>This document has not been uploaded yet.</div>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
