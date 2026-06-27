'use client';

/**
 * RP "Add Units" — Claude-Design handoff build (self-contained).
 *
 * Reached from /rental-provider/dashboard/units/add when NO ?rp is present
 * (an RP owner adding units to one of their own existing properties). The
 * manager property-creation + CSV-import wizard stays in page.tsx and is
 * untouched. This component owns its own state + a units-only save flow.
 *
 * Standalone rule: when the chosen property is a standalone unit (villa held
 * as one whole, isStandaloneUnit=true) the Floor-plan slot is hidden and only
 * the Title Deed is collected; the deed is always saved to the UNIT.
 *
 * Field applicability follows lib/unitTaxonomy: bedrooms + furnishing are
 * residential-only; bathrooms apply to every built space except land; floor /
 * view / parking are built-space only.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SLIDEOVER_MS } from '@/components/upnow/PropertyFormModal';
import Link from 'next/link';
import {
  ArrowLeft, Plus, X, Camera, Copy, Building2, Eye, FileText,
  AlertCircle, Loader2, CheckCircle2, ImagePlus, ChevronDown, Search, Check, Pencil, Layers,
} from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import {
  unitTypesForCategory, FURNISHING_OPTIONS, UNIT_TYPE_LABELS,
  getAmenitiesForCategory, RENTAL_TYPE_OPTIONS, sqmFromSqft,
} from '@/components/upnow/UnitFormModal';
import { isResidentialUnitType, isLandUnitType } from '@/lib/unitTaxonomy';
import AddendumEditorModal from '@/components/upnow/AddendumEditorModal';
import AddendumTemplatePicker from '@/components/upnow/AddendumTemplatePicker';
import { type AddendumTerms, emptyAddendumTerms, hasAddendumTerms } from '@/lib/addendumTerms';
import { openAddendumPdfInNewTab } from '@/lib/openAddendumPdf';
import s from '@/components/upnow/unitForm.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ─── types ───────────────────────────────────────────────────────────────── */
interface WizardProperty {
  id: number;
  buildingName: string;
  spaceCategory: string;
  fullAddress: string | null;
  isStandaloneUnit?: boolean;
}

interface StagedPhoto { file: File; previewUrl: string; }

interface UnitRow {
  id: string;
  unitName: string;
  unitType: string;
  unitTier: string;
  unitNumber: string;
  floor: string;
  premiseNumber: string;
  bedrooms: string;
  bathrooms: string;
  parkingSpaces: string;
  unitSizeSqft: string;
  unitSizeSqm: string;
  furnishing: string;
  rentalPrice: string;
  securityDeposit: string;
  adminFee: string;
  ejariFeeFils: string;
  commission: string;
  serviceCharges: string;
  view: string;
  amenities: string[];
  minLeaseMonths: string;
  noticePeriodDays: string;
  rentEscalationPct: string;
  rentalType: string;
  numberOfPayments: string;
  advancePayment: string;
  gracePeriodDays: string;
  latePaymentFee: string;
  additionalPayments: Array<{ label: string; amount: string; vat: string }>;
  description: string;
  stagedPhotos: StagedPhoto[];
  stagedFloorPlan: File | null;
  stagedTitleDeed: File | null;
}

function emptyRow(): UnitRow {
  return {
    id: Math.random().toString(36).slice(2),
    unitName: '', unitType: '', unitTier: 'standard', unitNumber: '',
    floor: '', premiseNumber: '', bedrooms: '1', bathrooms: '1', parkingSpaces: '', unitSizeSqft: '', unitSizeSqm: '',
    furnishing: 'Unfurnished', rentalPrice: '',
    securityDeposit: '', adminFee: '', ejariFeeFils: '', commission: '', serviceCharges: '',
    view: '', amenities: [], minLeaseMonths: '12', noticePeriodDays: '60', rentEscalationPct: '',
    rentalType: 'yearly', numberOfPayments: '', advancePayment: '', gracePeriodDays: '', latePaymentFee: '',
    additionalPayments: [], description: '', stagedPhotos: [], stagedFloorPlan: null, stagedTitleDeed: null,
  };
}

const SPACE_CATEGORY_LABELS: Record<string, string> = {
  residential: 'Residential', commercial: 'Commercial', industrial: 'Industrial',
  workspaces: 'Workspaces', venues: 'Venues', land: 'Land', mixed_use: 'Mixed-use',
};
const spaceCategoryLabel = (c: string) =>
  SPACE_CATEGORY_LABELS[c] ?? (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Property');

const VIEW_OPTIONS = [
  'Sea View', 'Partial Sea View', 'Full Sea View', 'Beach View', 'Marina View',
  'Canal View', 'Lake View', 'Lagoon View', 'Pool View', 'Garden View',
  'Park View', 'Community View', 'Courtyard View', 'City View', 'Skyline View',
  'Downtown View', 'Landmark View', 'Burj View', 'Golf Course View', 'Mountain View',
  'Desert View', 'Road View', 'Street View', 'Creek View', 'Harbour View',
  'Waterfront View', 'Palm View', 'Panoramic View', 'Open View',
  'Burj Khalifa View', 'Palm Jumeirah View', 'Dubai Marina View', 'Fountain View',
];

const SECTIONS = [
  { id: 'prop',      label: 'Property' },
  { id: 'details',   label: 'Unit details' },
  { id: 'pricing',   label: 'Pricing & fees' },
  { id: 'leasing',   label: 'Leasing terms' },
  { id: 'amenities', label: 'Amenities' },
  { id: 'media',     label: 'Photos & documents' },
  { id: 'addendum',  label: 'Addendum' },
];
const SECTION_ORDER = SECTIONS.map(x => x.id);

/* ══════════════════════════════════════════════════════════════════════════ */
export default function AddUnitsExperience({ backHref }: { backHref: string }) {
  const router = useRouter();

  // Swipe-in / swipe-out — this full-page route uses the same .fullscreen
  // takeover as UnitFormModal, so give it the matching slide (globals.css
  // .slideover-*). Slide-in plays on mount; requestBack plays the reverse slide
  // first, then navigates back once it has finished.
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const requestBack = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(() => router.push(backHref), SLIDEOVER_MS);
  }, [router, backHref]);

  const [existingProps, setExistingProps] = useState<WizardProperty[]>([]);
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);
  const [selectedPropCat, setSelectedPropCat] = useState('');

  const [rows, setRows] = useState<UnitRow[]>([emptyRow()]);
  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<keyof UnitRow, string>>>>({});
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  const [sec, setSec] = useState('prop');
  const [propOpen, setPropOpen] = useState(false);
  const [propQuery, setPropQuery] = useState('');
  const [kycReview, setKycReview] = useState(false);

  const [addendumTerms, setAddendumTerms] = useState<AddendumTerms>(emptyAddendumTerms());
  const [addendumEditorOpen, setAddendumEditorOpen] = useState(false);
  const [addendumPreviewBusy, setAddendumPreviewBusy] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [doneMsg, setDoneMsg] = useState('');
  const [doneErrs, setDoneErrs] = useState<string[]>([]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const secRefs = useRef<Record<string, HTMLElement | null>>({});
  const scrollingRef = useRef(false);

  useEffect(() => {
    apiGet<WizardProperty[]>('/properties').then(setExistingProps).catch(() => {});
    apiGet<{ complianceStatus?: string }>('/profiles/rental-provider/me')
      .then(p => setKycReview(p?.complianceStatus === 'pending_review'))
      .catch(() => {});
  }, []);

  /* ── row helpers ── */
  const updRow = (id: string, patch: Partial<UnitRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    const keys = Object.keys(patch) as (keyof UnitRow)[];
    setRowErrors(prev => {
      const next = { ...prev };
      if (next[id]) keys.forEach(k => { delete next[id][k]; });
      return next;
    });
  };

  const selectedProp   = existingProps.find(p => p.id === selectedPropId) ?? null;
  const propStandalone = !!selectedProp?.isStandaloneUnit;
  const propCategory   = selectedProp?.spaceCategory ?? '';

  const activeId = rows.find(r => r.id === activeRowId)?.id ?? rows[0]?.id ?? '';
  const active   = rows.find(r => r.id === activeId) ?? rows[0];
  const aErr     = rowErrors[activeId] ?? {};
  const upd      = (patch: Partial<UnitRow>) => updRow(activeId, patch);
  const aps      = active?.additionalPayments ?? [];

  // Field applicability — mirrors the mock: Bedrooms + Bathrooms + Furnishing are
  // ONE residential-only group, gated by the EFFECTIVE category. A unit's type
  // wins; before a type is picked we fall back to the property's base category, so
  // an industrial / commercial building never shows beds/baths. Floor / view /
  // parking + size apply to every type.
  const rowResidential = (r?: { unitType?: string }) => {
    const t = r?.unitType ?? '';
    const fromType = t ? (isLandUnitType(t) ? 'land' : (isResidentialUnitType(t) ? 'residential' : 'commercial')) : null;
    const base = propCategory === 'residential' || propCategory === 'mixed_use' ? 'residential'
      : propCategory === 'land' ? 'land' : 'commercial';
    return (fromType ?? base) === 'residential';
  };
  const showResi          = rowResidential(active);  // beds + baths + furnishing
  const isResidentialUnit = showResi;                // ejari default (AED 220) is residential-only

  /* ── scroll-spy ── */
  const setRef = (id: string) => (el: HTMLElement | null) => { secRefs.current[id] = el; };
  const goToSection = (id: string) => {
    setSec(id);
    const c = bodyRef.current, el = secRefs.current[id];
    if (!c || !el) return;
    const top = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 14;
    scrollingRef.current = true;
    c.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    window.setTimeout(() => { scrollingRef.current = false; }, 340);
  };
  const onBodyScroll = () => {
    const c = bodyRef.current;
    if (!c || scrollingRef.current) return;
    const cTop = c.getBoundingClientRect().top;
    let cur = SECTION_ORDER[0];
    for (const id of SECTION_ORDER) {
      const el = secRefs.current[id];
      if (el && (el.getBoundingClientRect().top - cTop) <= 80) cur = id;
    }
    if (c.scrollTop + c.clientHeight >= c.scrollHeight - 4) cur = SECTION_ORDER[SECTION_ORDER.length - 1];
    if (cur !== sec) setSec(cur);
  };

  /* ── tabs ── */
  const addUnitTab = () => { const r = emptyRow(); setRows(prev => [...prev, r]); setActiveRowId(r.id); };
  const cloneUnitTab = () => {
    const src = rows.find(r => r.id === activeId);
    if (!src) return;
    const dup: UnitRow = { ...src, id: Math.random().toString(36).slice(2), unitNumber: '', stagedPhotos: [], stagedFloorPlan: null, stagedTitleDeed: null };
    setRows(prev => { const i = prev.findIndex(r => r.id === activeId); const next = [...prev]; next.splice(i + 1, 0, dup); return next; });
    setActiveRowId(dup.id);
  };
  const removeUnitTab = (id: string) => {
    if (rows.length <= 1) return;
    const next = rows.filter(r => r.id !== id);
    setRows(next);
    if (id === activeId) setActiveRowId(next[0].id);
  };

  /* ── photos / docs (active row) ── */
  const stagePhotos = (files: File[]) => {
    const add = files.map(file => ({ file, previewUrl: URL.createObjectURL(file) }));
    setRows(prev => prev.map(r => r.id === activeId ? { ...r, stagedPhotos: [...r.stagedPhotos, ...add].slice(0, 20) } : r));
  };
  const removePhoto = (idx: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== activeId) return r;
      const next = [...r.stagedPhotos];
      URL.revokeObjectURL(next[idx].previewUrl);
      next.splice(idx, 1);
      return { ...r, stagedPhotos: next };
    }));
  };
  const reorderPhotos = (next: StagedPhoto[]) => setRows(prev => prev.map(r => r.id === activeId ? { ...r, stagedPhotos: next } : r));
  const setFloorPlan  = (file: File | null) => setRows(prev => prev.map(r => r.id === activeId ? { ...r, stagedFloorPlan: file } : r));
  const setTitleDeed  = (file: File | null) => setRows(prev => prev.map(r => r.id === activeId ? { ...r, stagedTitleDeed: file } : r));

  /* ── property combobox ── */
  const q = propQuery.trim().toLowerCase();
  const filteredProps = existingProps.filter(p =>
    !q || `${p.buildingName} ${p.fullAddress ?? ''} ${spaceCategoryLabel(p.spaceCategory)}`.toLowerCase().includes(q));
  const comboValue = propOpen
    ? propQuery
    : (selectedProp ? `${selectedProp.buildingName}${selectedProp.fullAddress ? ' · ' + selectedProp.fullAddress : ''}` : '');
  const pickProp = (p: WizardProperty) => {
    const catChanged = p.spaceCategory !== selectedPropCat;
    setSelectedPropId(p.id); setSelectedPropCat(p.spaceCategory); setError(null);
    setRows(prev => prev.map(r => ({ ...r, amenities: [], ...(catChanged ? { unitType: '' } : {}) })));
    setPropQuery(''); setPropOpen(false);
  };

  /* ── validate + save ── */
  const validate = (): boolean => {
    if (!selectedPropId) { setError('Select a property to add units to.'); return false; }
    let ok = true;
    const errs: typeof rowErrors = {};
    for (const r of rows) {
      const e: Partial<Record<keyof UnitRow, string>> = {};
      if (!r.unitNumber.trim()) { e.unitNumber = 'Required'; ok = false; }
      if (!r.unitType)          { e.unitType   = 'Required'; ok = false; }
      if (Object.keys(e).length) errs[r.id] = e;
    }
    setRowErrors(errs);
    if (!ok) { const first = Object.keys(errs)[0]; if (first) { setActiveRowId(first); setSec('details'); } }
    return ok;
  };

  const handleSaveAll = async () => {
    setError(null);
    if (!validate()) return;
    setSaving(true);
    const errs: string[] = [];
    try {
      const propId = selectedPropId!;
      const propName = existingProps.find(p => p.id === propId)?.buildingName ?? 'Property';

      /* 1. Create units */
      const unitIds: { rowId: string; unitId: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        setSaveProgress({ phase: `Creating units… (${i + 1}/${rows.length})`, done: i, total: rows.length });
        try {
          const created = await apiPost<{ id: number }>(`/properties/${propId}/units`, {
            unitName:          r.unitName        || undefined,
            unitType:          r.unitType,
            unitTier:          r.unitTier || 'standard',
            unitNumber:        r.unitNumber,
            floor:             r.floor           || undefined,
            premiseNumber:     r.premiseNumber   || undefined,
            bedrooms:          r.bedrooms && r.bedrooms !== 'Studio' ? Number(r.bedrooms) : undefined,
            bathrooms:         r.bathrooms       ? Number(r.bathrooms)       : undefined,
            parkingSpaces:     r.parkingSpaces   ? Number(r.parkingSpaces)   : undefined,
            unitSizeSqft:      r.unitSizeSqft    ? Number(r.unitSizeSqft)    : undefined,
            unitSizeSqm:       r.unitSizeSqm     ? Number(r.unitSizeSqm)     : undefined,
            rentalPrice:       r.rentalPrice     ? Number(r.rentalPrice)     : undefined,
            marketPrice:       r.rentalPrice     ? Number(r.rentalPrice)     : undefined,
            securityDeposit:   r.securityDeposit ? Number(r.securityDeposit) : undefined,
            adminFee:          r.adminFee        ? Number(r.adminFee)        : undefined,
            ejariFeeFils:      r.ejariFeeFils    ? Number(r.ejariFeeFils)    : undefined,
            commission:        r.commission      ? Number(r.commission)      : undefined,
            serviceCharges:    r.serviceCharges  ? Number(r.serviceCharges)  : undefined,
            minLeaseMonths:    r.minLeaseMonths   ? Number(r.minLeaseMonths)   : undefined,
            noticePeriodDays:  r.noticePeriodDays ? Number(r.noticePeriodDays) : undefined,
            rentEscalationPct: r.rentEscalationPct ? Number(r.rentEscalationPct) : undefined,
            rentalType:        r.rentalType       || undefined,
            numberOfPayments:  r.numberOfPayments ? Number(r.numberOfPayments) : undefined,
            advancePayment:    r.advancePayment   ? Number(r.advancePayment)   : undefined,
            gracePeriodDays:   r.gracePeriodDays  ? Number(r.gracePeriodDays)  : undefined,
            latePaymentFee:    r.latePaymentFee   ? Number(r.latePaymentFee)   : undefined,
            additionalPayments: (r.additionalPayments ?? [])
              .map(p => ({ label: p.label.trim(), amount: Number(p.amount) || 0, vat: p.vat ? Number(p.vat) : 0 }))
              .filter(p => p.label !== '' && p.amount > 0),
            view:              r.view            || undefined,
            furnishing:        r.furnishing      || undefined,
            amenities:         r.amenities.length ? r.amenities : undefined,
            description:       r.description     || undefined,
          });
          unitIds.push({ rowId: r.id, unitId: created.id });
        } catch (e) {
          errs.push(`Unit "${r.unitNumber}": ${e instanceof Error ? e.message : 'create failed'}`);
        }
      }

      /* 2. Photos */
      const photoRows = unitIds.filter(({ rowId }) => rows.find(r => r.id === rowId)?.stagedPhotos.length);
      if (photoRows.length) {
        const totalPhotos = photoRows.reduce((sum, { rowId }) => sum + (rows.find(r => r.id === rowId)?.stagedPhotos.length ?? 0), 0);
        let photoDone = 0;
        setSaveProgress({ phase: 'Uploading photos…', done: 0, total: totalPhotos });
        for (const { rowId, unitId } of photoRows) {
          const row = rows.find(r => r.id === rowId)!;
          for (const sp of row.stagedPhotos) {
            try {
              const fd = new FormData(); fd.append('file', sp.file);
              await fetch(`/api/properties/${propId}/units/${unitId}/media`, { method: 'POST', body: fd, credentials: 'include' });
            } catch { errs.push(`Photo for unit "${row.unitNumber}": upload failed`); }
            photoDone++;
            setSaveProgress({ phase: 'Uploading photos…', done: photoDone, total: totalPhotos });
          }
        }
      }

      /* 3. Floor plans */
      const planRows = unitIds.filter(({ rowId }) => rows.find(r => r.id === rowId)?.stagedFloorPlan);
      if (planRows.length) {
        let planDone = 0;
        setSaveProgress({ phase: 'Uploading floor plans…', done: 0, total: planRows.length });
        for (const { rowId, unitId } of planRows) {
          const row = rows.find(r => r.id === rowId)!;
          try {
            const fd = new FormData(); fd.append('file', row.stagedFloorPlan!);
            const res = await fetch(`/api/properties/${propId}/units/${unitId}/floor-plan`, { method: 'POST', body: fd, credentials: 'include' });
            if (!res.ok) throw new Error();
          } catch { errs.push(`Floor plan for unit "${row.unitNumber}": upload failed`); }
          planDone++;
          setSaveProgress({ phase: 'Uploading floor plans…', done: planDone, total: planRows.length });
        }
      }

      /* 4. Title deeds — always saved to the UNIT (documentKey 'title_deed') */
      const deedRows = unitIds.filter(({ rowId }) => rows.find(r => r.id === rowId)?.stagedTitleDeed);
      if (deedRows.length) {
        let deedDone = 0;
        setSaveProgress({ phase: 'Uploading title deeds…', done: 0, total: deedRows.length });
        for (const { rowId, unitId } of deedRows) {
          const row = rows.find(r => r.id === rowId)!;
          try {
            await uploadOwnedDocument({ ownerType: 'unit', ownerId: unitId, documentKey: 'title_deed', category: 'legal', displayName: 'Title deed', file: row.stagedTitleDeed! });
          } catch (e) { errs.push(`Title deed for unit "${row.unitNumber}": ${e instanceof Error ? e.message : 'upload failed'}`); }
          deedDone++;
          setSaveProgress({ phase: 'Uploading title deeds…', done: deedDone, total: deedRows.length });
        }
      }

      /* 5. Apply the listing's in-app Agreement addendum to the new layout(s). */
      if (hasAddendumTerms(addendumTerms) && unitIds.length) {
        setSaveProgress({ phase: 'Saving addendum…', done: 0, total: 1 });
        try {
          const fp = await apiGet<{ plans: Array<{ planLabel: string | null }> }>(`/properties/floor-plans?propertyId=${propId}`);
          const labels = Array.from(new Set((fp.plans ?? []).map(p => p.planLabel).filter((l): l is string => !!l)));
          for (const planLabel of labels) {
            await apiPatch('/properties/floor-plans/addendum-terms', { propertyId: propId, planLabel, terms: addendumTerms });
          }
        } catch { errs.push('Addendum: could not be saved to the new layout(s) — add it from the Units page.'); }
      }

      setDoneErrs(errs);
      setDoneMsg(`${propName} · ${unitIds.length} unit${unitIds.length !== 1 ? 's' : ''} saved.`);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed — please try again.');
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  };

  const resetForMore = () => {
    setDone(false); setRows([emptyRow()]); setActiveRowId(null);
    setSelectedPropId(null); setSelectedPropCat(''); setPropQuery(''); setPropOpen(false);
    setDoneErrs([]); setError(null); setAddendumTerms(emptyAddendumTerms()); setSec('prop');
  };

  const seg = (value: string, opt: string) => cx(s.seg, value === opt && s.segOn);

  /* ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className={`${s.fullscreen} slideover-panel${closing ? ' closing' : ''}`}>
    <div className={s.app}>
      {/* ── Header ── */}
      <header className={s.header}>
        <button className={s.backBtn} onClick={requestBack} aria-label="Back to Units"><ArrowLeft size={17} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.headTitle}>Add Units</div>
          <div className={s.headSub}>Add units to one of your properties</div>
        </div>
        {kycReview && <div className={s.kyc}><AlertCircle size={13} /> KYC under review</div>}
      </header>

      {done ? (
        <div className={s.doneWrap}>
          <div className={s.doneCard}>
            <div className={s.doneIcon}><CheckCircle2 size={32} /></div>
            <div className={s.doneTitle}>All done!</div>
            <div className={s.doneMsg}>{doneMsg}</div>
            {doneErrs.length > 0 && (
              <div className={s.doneErrs}>
                <div className={s.doneErrsTitle}>Some items had errors:</div>
                {doneErrs.map((e, i) => <div key={i} className={s.doneErr}>• {e}</div>)}
              </div>
            )}
            <div className={s.doneActions}>
              <button className={s.doneGhost} onClick={resetForMore}>Add more units</button>
              <button className={s.donePrimary} onClick={requestBack}>Go to Units</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div ref={bodyRef} onScroll={onBodyScroll} className={s.body}>

            {/* Steps nav */}
            <aside className={s.nav}>
              <div className={s.navLabel}>STEPS</div>
              {SECTIONS.map((sx, i) => (
                <button key={sx.id} type="button" onClick={() => goToSection(sx.id)}
                  className={cx(s.navItem, sec === sx.id && s.navItemActive)}>
                  <span className={cx(s.navBadge, sec === sx.id && s.navBadgeActive)}>{i + 1}</span>
                  <span style={{ flex: 1 }}>{sx.label}</span>
                </button>
              ))}
              <div className={s.navFoot}>
                <div className={s.navFootCount}>{rows.length} unit{rows.length !== 1 ? 's' : ''} added</div>
                <div className={s.navFootHint}>Fill top to bottom, then clone or add another unit.</div>
              </div>
            </aside>

            {/* Form */}
            <div className={s.form}>
              <div className={s.formInner}>

                {/* 1 · PROPERTY */}
                <section ref={setRef('prop')} className={s.section}>
                  <div className={s.propCard}>
                    <div className={s.secHead}>
                      <span className={s.secNum}>1</span>
                      <div><div className={s.secTitle}>Choose a property</div><div className={s.secSub}>Pick the building first — the unit form adapts to its type.</div></div>
                    </div>

                    {existingProps.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '14px 6px 6px' }}>
                        <Building2 size={22} style={{ margin: '0 auto 8px', color: '#b0ae9a' }} />
                        <p className={s.emptySub} style={{ marginBottom: 12 }}>You don’t have any properties yet. Create a property first, then come back to add its units.</p>
                        <Link href="/rental-provider/dashboard/portfolio?add=1" className={s.emptyCta}><Building2 size={15} /> Add a property</Link>
                      </div>
                    ) : (
                      <>
                        <div className={s.combo}>
                          <span className={s.comboIcon}><Search size={16} /></span>
                          <input className={s.comboInput} value={comboValue} placeholder="Search building, area or emirate…"
                            onChange={e => { setPropQuery(e.target.value); setPropOpen(true); }} onFocus={() => setPropOpen(true)} />
                          <span className={cx(s.comboChev, propOpen && s.comboChevOpen)} onClick={() => setPropOpen(o => !o)}><ChevronDown size={16} /></span>
                          {propOpen && (
                            <>
                              <div className={s.comboScrim} onClick={() => setPropOpen(false)} />
                              <div className={s.comboMenu}>
                                {filteredProps.map(p => (
                                  <button key={p.id} type="button" onClick={() => pickProp(p)} className={cx(s.comboRow, p.id === selectedPropId && s.comboRowOn)}>
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                      <span className={s.comboName}>{p.buildingName || 'Unnamed property'}</span>
                                      {p.fullAddress && <span className={s.comboAddr} style={{ display: 'block' }}>{p.fullAddress}</span>}
                                    </span>
                                    <span className={s.comboType}>{spaceCategoryLabel(p.spaceCategory)}</span>
                                    {p.id === selectedPropId && <span className={s.comboCheck}><Check size={15} /></span>}
                                  </button>
                                ))}
                                {filteredProps.length === 0 && <div className={s.comboEmpty}>No properties match “{propQuery}”.</div>}
                              </div>
                            </>
                          )}
                        </div>
                        <div className={s.propHelp}>Need a new building? <Link href="/rental-provider/dashboard/portfolio?add=1">Add a property</Link> on the Portfolio page.</div>
                      </>
                    )}
                  </div>
                </section>

                {!selectedProp && existingProps.length > 0 && (
                  <div className={s.empty}>
                    <div className={s.emptyTitle}>Select a property to begin</div>
                    <div className={s.emptySub}>The unit form will appear here, tailored to the property type.</div>
                  </div>
                )}

                {selectedProp && (
                  <>
                    <div className={s.divider} />

                    {/* Unit tabs */}
                    <div className={s.tabsBar}>
                      <div className={s.tabsScroll}>
                        {rows.map((r, i) => (
                          <button key={r.id} type="button" onClick={() => setActiveRowId(r.id)} className={cx(s.tab, r.id === activeId && s.tabOn)}>
                            Unit {i + 1}
                            {rows.length > 1 && <span className={s.tabRemove} onClick={e => { e.stopPropagation(); removeUnitTab(r.id); }}>×</span>}
                          </button>
                        ))}
                      </div>
                      <div className={s.tabsSpacer} />
                      <button type="button" className={s.cloneBtn} onClick={cloneUnitTab}><Copy size={14} /> Clone unit</button>
                      <button type="button" className={s.addBtn} onClick={addUnitTab}><span className={s.plus}>+</span> Add unit</button>
                    </div>

                    {/* 2 · UNIT DETAILS */}
                    <section ref={setRef('details')} className={s.section}>
                      <div className={s.secHead}><span className={s.secNum}>2</span><div><div className={s.secTitle}>Unit details</div><div className={s.secSub}>Identity, layout and size of this unit.</div></div></div>

                      <div className={s.field}>
                        <label className={s.lbl}>Listing Unit Title</label>
                        <input className={s.input} placeholder="e.g. Spacious 2BR Apartment with Balcony in Al Raffa" value={active?.unitName ?? ''} onChange={e => upd({ unitName: e.target.value })} />
                      </div>

                      <div className={cx(s.grid3, s.field)}>
                        <div>
                          <label className={s.lbl}>Unit Type <span className={s.req}>*</span></label>
                          <select className={cx(s.select, aErr.unitType && s.inputErr)} value={active?.unitType ?? ''} onChange={e => upd({ unitType: e.target.value })}>
                            <option value="">Select type</option>
                            {unitTypesForCategory(propCategory).map(t => <option key={t} value={t}>{UNIT_TYPE_LABELS[t] ?? t.replace(/_/g, ' ')}</option>)}
                          </select>
                          {aErr.unitType && <p className={s.errText}>{aErr.unitType}</p>}
                        </div>
                        <div>
                          <label className={s.lbl}>Unit Number <span className={s.req}>*</span></label>
                          <input className={cx(s.input, aErr.unitNumber && s.inputErr)} placeholder="e.g. 101, G-02" value={active?.unitNumber ?? ''} onChange={e => upd({ unitNumber: e.target.value })} />
                          {aErr.unitNumber && <p className={s.errText}>{aErr.unitNumber}</p>}
                        </div>
                        <div>
                          <label className={s.lbl}>Utility Premises No.</label>
                          <input className={s.input} placeholder="e.g. 1234567" value={active?.premiseNumber ?? ''} onChange={e => upd({ premiseNumber: e.target.value })} />
                        </div>
                      </div>

                      {showResi && (
                        <>
                          <div className={cx(s.grid2, s.gap22, s.field)}>
                            <div>
                              <label className={s.lbl}>Bedrooms</label>
                              <div className={s.segGroup}>
                                {['Studio', '1', '2', '3', '4', '5', '6+'].map(b => (
                                  <button key={b} type="button" className={seg(active?.bedrooms ?? '', b)} onClick={() => upd({ bedrooms: b })}>{b === 'Studio' ? 'Studio' : `${b} BR`}</button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className={s.lbl}>Bathrooms</label>
                              <div className={s.segGroup}>
                                {['1', '2', '3', '4', '5+'].map(b => (
                                  <button key={b} type="button" className={seg(active?.bathrooms ?? '', b)} onClick={() => upd({ bathrooms: b })}>{b}</button>
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className={s.field}>
                            <label className={s.lbl}>Furnishing</label>
                            <div className={s.segGroup}>
                              {FURNISHING_OPTIONS.map(f => <button key={f} type="button" className={seg(active?.furnishing ?? '', f)} onClick={() => upd({ furnishing: f })}>{f}</button>)}
                            </div>
                          </div>
                        </>
                      )}

                      <div className={cx(s.grid3, s.field)}>
                        <div><label className={s.lbl}>Floor</label><input className={s.input} placeholder="e.g. G, 1, 2…" value={active?.floor ?? ''} onChange={e => upd({ floor: e.target.value })} /></div>
                        <div><label className={s.lbl}>View</label><ViewInput value={active?.view ?? ''} onChange={v => upd({ view: v })} /></div>
                        <div><label className={s.lbl}>Parking</label><input className={s.input} type="number" min="0" step="1" placeholder="e.g. 1" value={active?.parkingSpaces ?? ''} onChange={e => upd({ parkingSpaces: e.target.value })} /></div>
                      </div>

                      <div style={{ maxWidth: 320 }}>
                        <label className={s.lbl}>Size (sq.ft) <span className={s.req}>*</span></label>
                        <input className={cx(s.input, aErr.unitSizeSqft && s.inputErr)} type="number" min="0" step="any" placeholder="e.g. 1200"
                          value={active?.unitSizeSqft ?? ''} onChange={e => upd({ unitSizeSqft: e.target.value, unitSizeSqm: sqmFromSqft(e.target.value) })} />
                        <div className={s.hintGreen}>≈ {active?.unitSizeSqm ? `${active.unitSizeSqm} sq.m` : '— sq.m'} <span>· stored in both units</span></div>
                      </div>
                    </section>

                    <div className={s.divider} />

                    {/* 3 · PRICING & FEES */}
                    <section ref={setRef('pricing')} className={s.section}>
                      <div className={s.secHead}><span className={s.secNum}>3</span><div><div className={s.secTitle}>Pricing &amp; fees</div><div className={s.secSub}>Rent and one-off charges for this unit.</div></div></div>

                      <div className={s.field}>
                        <label className={s.lbl}>Annual Rent (AED) <span className={s.req}>*</span></label>
                        <input className={cx(s.input, aErr.rentalPrice && s.inputErr)} type="number" min="0" step="any" placeholder="e.g. 85000"
                          value={active?.rentalPrice ?? ''}
                          onChange={e => {
                            const val = e.target.value; const rent = parseFloat(val);
                            const patch: Partial<UnitRow> = { rentalPrice: val };
                            if (!isNaN(rent) && rent > 0) {
                              patch.securityDeposit = String(Math.round(rent * 0.05));
                              patch.adminFee        = String(Math.round(rent * 0.05));
                              patch.ejariFeeFils    = isResidentialUnit ? '220' : '';
                              patch.commission      = String(Math.round(rent * 0.05));
                            }
                            upd(patch);
                          }} />
                        {aErr.rentalPrice && <p className={s.errText}>{aErr.rentalPrice}</p>}
                      </div>

                      <div className={s.feesBox}>
                        <div className={s.feesTitle}>FEES</div>
                        <div className={s.grid2}>
                          <div><label className={s.lbl}>Security Deposit</label><input className={s.input} type="number" min="0" step="any" placeholder="e.g. 10000" value={active?.securityDeposit ?? ''} onChange={e => upd({ securityDeposit: e.target.value })} /></div>
                          <div><label className={s.lbl}>Admin Fee</label><input className={s.input} type="number" min="0" step="any" placeholder="e.g. 5000" value={active?.adminFee ?? ''} onChange={e => upd({ adminFee: e.target.value })} /></div>
                          <div><label className={s.lbl}>Ejari Fee</label><input className={s.input} type="number" min="0" step="any" placeholder="220" value={active?.ejariFeeFils ?? ''} onChange={e => upd({ ejariFeeFils: e.target.value })} /></div>
                          <div><label className={s.lbl}>Commission</label><input className={s.input} type="number" min="0" step="any" placeholder="e.g. 4000" value={active?.commission ?? ''} onChange={e => upd({ commission: e.target.value })} /></div>
                          <div><label className={s.lbl}>Service Charges</label><input className={s.input} type="number" min="0" step="any" placeholder="e.g. 3000" value={active?.serviceCharges ?? ''} onChange={e => upd({ serviceCharges: e.target.value })} /></div>
                        </div>

                        <div className={s.addRow}>
                          <div style={{ flex: 1 }}>
                            <div className={s.addRowTitle}>Additional Payments</div>
                            <div className={s.addRowSub}>{aps.length === 0 ? 'None — only rent, deposit and the fees above apply.' : `${aps.length} extra charge${aps.length === 1 ? '' : 's'} added to the contract.`}</div>
                          </div>
                          <button type="button" className={s.linkBtn} onClick={() => upd({ additionalPayments: [...aps, { label: '', amount: '', vat: '' }] })}>+ Add payment</button>
                        </div>
                        {aps.length > 0 && (
                          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div className={s.payGrid}><span className={s.payHead}>Label</span><span className={s.payHead}>Net AED</span><span className={s.payHead}>VAT AED</span><span /></div>
                            {aps.map((p, i) => (
                              <div key={i} className={s.payGrid}>
                                <input className={s.input} type="text" placeholder="e.g. Chiller deposit" value={p.label} onChange={e => upd({ additionalPayments: aps.map((r, j) => j === i ? { ...r, label: e.target.value } : r) })} />
                                <input className={s.input} type="number" min="0" step="any" placeholder="0" value={p.amount} onChange={e => upd({ additionalPayments: aps.map((r, j) => j === i ? { ...r, amount: e.target.value } : r) })} />
                                <input className={s.input} type="number" min="0" step="any" placeholder="0" value={p.vat} onChange={e => upd({ additionalPayments: aps.map((r, j) => j === i ? { ...r, vat: e.target.value } : r) })} />
                                <button type="button" className={s.payDel} title="Remove" onClick={() => upd({ additionalPayments: aps.filter((_, j) => j !== i) })}>×</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>

                    <div className={s.divider} />

                    {/* 4 · LEASING TERMS */}
                    <section ref={setRef('leasing')} className={s.section}>
                      <div className={s.secHead}><span className={s.secNum}>4</span><div><div className={s.secTitle}>Leasing terms</div><div className={s.secSub}>Default terms new contracts on this unit will use.</div></div></div>
                      <div className={s.leaseBox}>
                        <div className={s.grid2} style={{ gap: '13px 22px', alignItems: 'start' }}>
                          <div>
                            <label className={s.lbl}>Rental Type</label>
                            <div className={s.segGroup}>
                              {RENTAL_TYPE_OPTIONS.map(o => <button key={o.id} type="button" className={seg(active?.rentalType ?? '', o.id)} onClick={() => upd({ rentalType: o.id })}>{o.label}</button>)}
                            </div>
                          </div>
                          <div>
                            <label className={s.lbl}>Notice (days)</label>
                            <input className={s.input} type="number" min="0" step="any" placeholder="60" value={active?.noticePeriodDays ?? ''} onChange={e => upd({ noticePeriodDays: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    </section>

                    <div className={s.divider} />

                    {/* 5 · AMENITIES & DESCRIPTION */}
                    <section ref={setRef('amenities')} className={s.section}>
                      <div className={s.secHead}><span className={s.secNum}>5</span><div><div className={s.secTitle}>Amenities &amp; description</div><div className={s.secSub}>What this unit offers, in its own words.</div></div></div>
                      <label className={s.lbl}>Amenities{(active?.amenities.length ?? 0) > 0 && <span style={{ color: '#1a7a5a', fontWeight: 700 }}> · {active?.amenities.length} selected</span>}</label>
                      {!propCategory ? (
                        <p className={s.amenNote}>Select a property above to see relevant amenities.</p>
                      ) : (
                        <div className={s.amenWrap} style={{ marginBottom: 16 }}>
                          {getAmenitiesForCategory(propCategory).map(a => {
                            const on = active?.amenities.includes(a);
                            return <button key={a} type="button" className={cx(s.amenChip, on && s.amenChipOn)}
                              onClick={() => upd({ amenities: on ? (active?.amenities ?? []).filter(x => x !== a) : [...(active?.amenities ?? []), a] })}>{a}</button>;
                          })}
                        </div>
                      )}
                      <label className={s.lbl}>Unit Description</label>
                      <textarea className={s.textarea} rows={3} placeholder="Describe this unit for the listing — features, highlights, unique selling points…" value={active?.description ?? ''} onChange={e => upd({ description: e.target.value })} />
                    </section>

                    <div className={s.divider} />

                    {/* 6 · PHOTOS & DOCUMENTS */}
                    <section ref={setRef('media')} className={s.section}>
                      <div className={s.secHead}><span className={s.secNum}>6</span><div><div className={s.secTitle}>Photos &amp; documents</div><div className={s.secSub}>Imagery and the paperwork for this unit.</div></div></div>

                      <div style={{ marginBottom: 16 }}>
                        <UnitPhotos photos={active?.stagedPhotos ?? []} onAdd={stagePhotos} onRemove={removePhoto} onReorder={reorderPhotos} />
                      </div>

                      <div className={s.docGrid} style={propStandalone ? { gridTemplateColumns: '1fr' } : undefined}>
                        {!propStandalone && (
                          <div>
                            <label className={s.lbl}>Floor plan <span style={{ color: '#9b9890', fontWeight: 600 }}>(optional)</span></label>
                            <DocSlot file={active?.stagedFloorPlan ?? null} onPick={setFloorPlan} onClear={() => setFloorPlan(null)} title="Attach floor plan" sub="PDF, PNG or JPG" icon={<Layers size={20} />} />
                          </div>
                        )}
                        <div>
                          <label className={s.lbl}>Title Deed <span style={{ color: '#9b9890', fontWeight: 600 }}>(unit deed)</span></label>
                          <DocSlot file={active?.stagedTitleDeed ?? null} onPick={setTitleDeed} onClear={() => setTitleDeed(null)} title="Attach title deed" sub={propStandalone ? 'Deed for this standalone unit' : 'For separately-titled units'} icon={<FileText size={20} />} />
                        </div>
                      </div>
                    </section>

                    <div className={s.divider} />

                    {/* 7 · ADDENDUM */}
                    <section ref={setRef('addendum')} className={s.section}>
                      <div className={s.secHead}><span className={s.secNum}>7</span><div><div className={s.secTitle}>Agreement addendum <span className={s.secOpt}>· optional</span></div><div className={s.secSub}>Extra wording every contract on these units will carry.</div></div></div>
                      <div className={s.addendBox}>
                        <div className={s.addendInfo}>
                          <div className={s.addendTitle}>{addendumTerms.name?.trim() || 'Agreement Addendum'}</div>
                          <div className={s.addendSub}>
                            {(() => {
                              const n = (addendumTerms.en?.filter(l => l.trim()).length ?? 0) + (addendumTerms.ar?.filter(l => l.trim()).length ?? 0);
                              return n ? `${n} term${n === 1 ? '' : 's'} written — added to the new layout(s)` : 'Pick a template or write a new one.';
                            })()}
                          </div>
                        </div>
                        <AddendumTemplatePicker onPick={t => setAddendumTerms(t)} />
                        {hasAddendumTerms(addendumTerms) && (
                          <button type="button" className={s.addendPreview} disabled={addendumPreviewBusy}
                            onClick={async () => {
                              if (addendumPreviewBusy) return;
                              setAddendumPreviewBusy(true);
                              try { await openAddendumPdfInNewTab(addendumTerms, addendumTerms.name?.trim() || 'Agreement Addendum'); }
                              finally { setAddendumPreviewBusy(false); }
                            }}>
                            {addendumPreviewBusy ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Preview
                          </button>
                        )}
                        <button type="button" className={s.addendBtn} onClick={() => setAddendumEditorOpen(true)}>
                          <Pencil size={13} /> {hasAddendumTerms(addendumTerms) ? 'Edit addendum' : 'Write new'}
                        </button>
                      </div>
                    </section>
                  </>
                )}

                {error && <div className={s.errorBanner}><AlertCircle size={15} /> {error}</div>}
                {saving && saveProgress && (
                  <div className={s.savingBar}>
                    <div className={s.savingRow}><Loader2 size={14} className="animate-spin" /> {saveProgress.phase}</div>
                    {saveProgress.total > 0 && <div className={s.savingTrack}><div className={s.savingFill} style={{ width: `${(saveProgress.done / saveProgress.total) * 100}%` }} /></div>}
                  </div>
                )}

                <div style={{ height: 8 }} />
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <footer className={s.footer}>
            <button className={s.cancelBtn} onClick={requestBack}>Cancel</button>
            <div className={s.footSpacer} />
            <button className={s.saveBtn} onClick={handleSaveAll} disabled={saving || !selectedProp}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save {rows.length} Unit{rows.length !== 1 ? 's' : ''}
            </button>
          </footer>
        </>
      )}

      {addendumEditorOpen && (
        <AddendumEditorModal value={addendumTerms} onChange={setAddendumTerms} onClose={() => setAddendumEditorOpen(false)}
          title="Agreement Addendum" subtitle="Write the terms; they're applied to the layout(s) you create. Preview on the right." />
      )}
    </div>
    </div>
  );
}

/* ─── ViewInput — type-ahead with custom entry ──────────────────────────────── */
function ViewInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const filtered = value.length >= 3 ? VIEW_OPTIONS.filter(v => v.toLowerCase().includes(value.toLowerCase())) : [];
  const exact = VIEW_OPTIONS.some(v => v.toLowerCase() === value.toLowerCase());
  const showCustom = open && value.length >= 3 && !exact;
  const showMenu = open && value.length >= 3 && (filtered.length > 0 || showCustom);
  const pick = (v: string) => { onChange(v); setOpen(false); };
  return (
    <div style={{ position: 'relative' }}>
      <input className={s.input} placeholder="e.g. Sea View…" value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (value.length >= 3) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }} />
      {showMenu && (
        <div className={s.comboMenu} style={{ top: 'calc(100% + 4px)', maxHeight: 208 }}>
          {filtered.map(v => (
            <button key={v} type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(v)} className={cx(s.comboRow, value === v && s.comboRowOn)}>
              <span className={s.comboName}>{v}</span>
            </button>
          ))}
          {showCustom && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(value)} className={s.comboRow}>
              <span className={s.comboName} style={{ color: '#1a7a5a' }}>+ Use “{value}”</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── UnitPhotos — dropzone + draggable thumbnails (first = cover) ───────────── */
function UnitPhotos({ photos, onAdd, onRemove, onReorder }: {
  photos: StagedPhoto[]; onAdd: (files: File[]) => void; onRemove: (idx: number) => void; onReorder: (next: StagedPhoto[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragIdx = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <div>
      <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only"
        onChange={e => { const f = e.target.files ? Array.from(e.target.files) : []; if (f.length) onAdd(f); e.target.value = ''; }} />
      <div className={s.photosHead}>
        <span className={s.lbl} style={{ marginBottom: 0 }}>
          Unit Photos <span style={{ color: '#9b9890', fontWeight: 600 }}>({photos.length}/20)</span>
          {photos.length > 1 && <span style={{ color: '#9b9890', fontWeight: 500 }}> · drag to set cover</span>}
        </span>
        {photos.length > 0 && photos.length < 20 && (
          <button type="button" className={s.photosAdd} onClick={() => inputRef.current?.click()}><ImagePlus size={13} /> Add photos</button>
        )}
      </div>
      {photos.length === 0 ? (
        <button type="button" className={s.photoZone} onClick={() => inputRef.current?.click()}>
          <span className={s.photoZoneIcon}><Camera size={20} /></span>
          <span className={s.photoZoneTitle}>Click to add photos</span>
          <span className={s.photoZoneSub}>JPEG, PNG or WebP · up to 20 · first image is the cover</span>
        </button>
      ) : (
        <div className={s.photoStrip}>
          {photos.map((p, idx) => (
            <div key={p.previewUrl} draggable
              onDragStart={() => { dragIdx.current = idx; }}
              onDragOver={e => { e.preventDefault(); setOver(idx); }}
              onDrop={e => {
                e.preventDefault();
                const from = dragIdx.current;
                if (from !== null && from !== idx) { const arr = [...photos]; const [m] = arr.splice(from, 1); arr.splice(idx, 0, m); onReorder(arr); }
                dragIdx.current = null; setOver(null);
              }}
              onDragEnd={() => { dragIdx.current = null; setOver(null); }}
              className={cx(s.thumb, idx === 0 && s.thumbCover, over === idx && dragIdx.current !== idx && s.thumbDrag)}>
              {idx === 0 && <div className={s.coverBadge}>COVER</div>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" draggable={false} />
              <button type="button" className={s.thumbRemove} onClick={e => { e.stopPropagation(); onRemove(idx); }}><X size={10} /></button>
            </div>
          ))}
          {photos.length < 20 && <button type="button" className={s.addThumb} onClick={() => inputRef.current?.click()}><Plus size={16} /></button>}
        </div>
      )}
    </div>
  );
}

/* ─── DocSlot — single document upload (floor plan / title deed) ─────────────── */
function DocSlot({ file, onPick, onClear, title, sub, icon }: {
  file: File | null; onPick: (f: File) => void; onClear: () => void; title: string; sub: string; icon: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input ref={ref} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only"
        onChange={e => { const f = e.target.files?.[0] ?? null; if (f) onPick(f); e.target.value = ''; }} />
      {file ? (
        <div className={s.docFile}>
          <span className={s.docFileIcon}>{icon}</span>
          <span className={s.docFileName}>{file.name}</span>
          <button type="button" className={s.docFileAct} onClick={() => ref.current?.click()}>Replace</button>
          <button type="button" className={s.docFileDel} onClick={onClear}><X size={12} /></button>
        </div>
      ) : (
        <button type="button" className={s.docZone} onClick={() => ref.current?.click()}>
          <span className={s.docZoneIcon}>{icon}</span>
          <span className={s.docZoneTitle}>{title}</span>
          <span className={s.docZoneSub}>{sub}</span>
        </button>
      )}
    </div>
  );
}
