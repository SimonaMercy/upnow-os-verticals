'use client';

/**
 * RP move-in / move-out inspection workspace — the editable surface of the shared
 * InspectionReportView (design spec §6). Save draft / Submit to tenant (locks) /
 * Reopen to edit. The category-report layout itself lives in InspectionReportView,
 * shared read-only with the tenant page.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams, usePathname } from 'next/navigation';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, CheckCircle, Send, RotateCcw, Lock, Plus, X, Printer, Download } from 'lucide-react';
import {
  InspectionDoc, InspectionItem, InspectionCategory, InspectionPriceBookEntry,
  CategoryKey, CanonicalCategoryKey, PriceBookSeedRow,
  CATALOG, CATALOG_BY_KEY, canonicalKey, resolvePriceBookEntry, slug, computeRowTotal, computeInspectionTotals,
} from '@/lib/inspectionCatalog';
import { uploadInspectionItemPhoto, type InspectionPhotoRef } from '@/lib/inspectionPhotos';
import { InspectionReportView, type ReportMeta } from '@/components/contract/InspectionReportView';

type Phase = 'move_in' | 'move_out';
const AED = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ContractMeta {
  property: string; unitNo: string; propertyType: string; floor: string;
  tenantName: string; tenantPhone: string; tenantEmail: string;
}
interface Dates { inspectionDate?: string | null; moveInDate?: string | null; moveOutDate?: string | null; }

export default function CategoryInspectionPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  // Filling / submitting / reopening an inspection is an inspection-management
  // action → a delegated manager needs canManageInspections on this landlord.
  const pathname = usePathname();
  const isManagerView = (pathname ?? '').startsWith('/dashboard/manager');
  // On-site inspector magic-link mode: this same workspace is served at
  // /portal/<token>/contract/<id>/inspection so the inspection manager can FILL
  // the v2 report with no login. Every API call swaps to the token-scoped portal
  // endpoints, dashboard chrome hides, and the counter-sign pad appears in place.
  const portalToken = (pathname ?? '').startsWith('/portal/') ? ((pathname ?? '').split('/')[2] ?? null) : null;
  const { canForRp } = useManagerPermissions();
  const [landlordId, setLandlordId] = useState<number | null>(null);
  const phase = (search.get('type') ?? 'move_in') as Phase;
  const contractId = params?.id;
  // Token-scoped API base for the portal inspector; the RP/manager uses the
  // authenticated /api/contracts routes.
  const apiBase = portalToken ? `/api/portal/${portalToken}/contracts/${contractId}` : `/api/contracts/${contractId}`;

  const [doc, setDoc] = useState<InspectionDoc | null>(null);
  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [dates, setDates] = useState<Dates>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  // The RP's inspection price book, so components added by hand from the restoration
  // list carry the RP's own rates (falls back to the platform seed when unavailable).
  const [priceBook, setPriceBook] = useState<InspectionPriceBookEntry[] | null>(null);
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [compPickerSection, setCompPickerSection] = useState<string | null>(null);
  // Portal inspector counter-sign (the RP side, drawn on site once the customer has
  // signed) — mirrors the legacy workspace's counter-sign step.
  const [counterSig, setCounterSig] = useState<string | null>(null);
  const [countering, setCountering] = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const docRef = useRef<InspectionDoc | null>(null);
  const dateSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const locked = !!submittedAt;
  const tenantSigned = !!doc?.tenantSig || !!doc?.tenantSignedAt;
  const counterSigned = !!doc?.rpCounterSig;
  // Manager may fill/submit/reopen only with canManageInspections on this
  // landlord; RP owners always may. On the portal inspector link the token itself
  // is the authorization. Hides the Save/Submit/Reopen controls and makes the
  // report read-only when not allowed.
  const canEditInsp = !!portalToken || !isManagerView || (landlordId != null && canForRp('canManageInspections', landlordId));

  useEffect(() => {
    if (!contractId) return;
    (async () => {
      setLoading(true);
      try {
        // Portal inspector reads the same category (v2) shape via the token-scoped
        // /inspection/full endpoint; the contract detail is nested under `.contract`.
        const [inspRes, cRes] = await Promise.all([
          fetch(portalToken ? `${apiBase}/inspection/full?type=${phase}` : `${apiBase}/inspection/v2?type=${phase}`, { credentials: 'include' }),
          fetch(apiBase, { credentials: 'include' }),
        ]);
        let loadedDoc: InspectionDoc | null = null;
        if (inspRes.ok) {
          loadedDoc = await inspRes.json();
          setDoc(loadedDoc);
          setSubmittedAt((loadedDoc?.rpSubmittedAt as string | undefined) ?? null);
        } else setError('Could not load the inspection.');
        if (cRes.ok) {
          const raw = await cRes.json();
          const c = portalToken ? (raw.contract ?? raw) : raw;
          setLandlordId(c.landlord?.id ?? null);
          setMeta({
            property: c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
            unitNo: c.unit?.number ?? c.unit?.unitNumber ?? '',
            propertyType: c.unit?.unitType ?? c.unit?.type ?? '',
            floor: c.unit?.floor != null ? String(c.unit.floor) : '',
            // Company tenants: the party name is the company, not the signatory.
            tenantName: c.tenant?.companyName || c.tenant?.name || '',
            tenantPhone: c.tenant?.phone ?? '',
            tenantEmail: c.tenant?.email ?? '',
          });
          // The move-out date the report shows: the inspection's own recorded date
          // (editable, wins when set), else the contract's termination / end date.
          const contractMoveOut = c.termination?.effectiveDate ?? c.terminationEffectiveDate ?? c.endDate ?? null;
          setDates({
            moveInDate: c.startDate ?? null,
            moveOutDate: (loadedDoc?.moveOutDate as string | undefined) ?? contractMoveOut,
          });
        }
      } catch {
        setError('Unexpected error loading the inspection.');
      } finally {
        setLoading(false);
      }
    })();
  }, [contractId, phase]);

  // Load the acting landlord's price book so hand-added components resolve to the
  // RP's own rates (best-effort — resolvePriceBookEntry falls back to the seed).
  // Every actor resolves to the SAME contract's book:
  //   • RP owner   → /inspection-price-book (their own)
  //   • manager    → /manager/inspection-price-book?rp=<landlord> (the mirror)
  //   • inspector  → /portal/<token>/contracts/<id>/inspection-price-book (token)
  useEffect(() => {
    // A manager reads the book scoped to THIS contract's landlord (the RP endpoint
    // 403s for them); wait until the meta fetch has told us which landlord this is.
    if (isManagerView && landlordId == null) return;
    const url = portalToken
      ? `${apiBase}/inspection-price-book?type=${phase}`
      : isManagerView
        ? `/api/manager/inspection-price-book?rp=${landlordId}`
        : '/api/inspection-price-book';
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok && !cancelled) setPriceBook(await res.json());
      } catch { /* seed fallback */ }
    })();
    return () => { cancelled = true; };
  }, [portalToken, isManagerView, landlordId, apiBase, phase]);

  const patchItem = useCallback((sectionId: string, itemId: string, patch: Partial<InspectionItem>) => {
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        categories: d.categories.map((cat) =>
          cat.sectionId !== sectionId ? cat : {
            ...cat,
            items: cat.items.map((it) => {
              if (it.id !== itemId) return it;
              const next = { ...it, ...patch };
              if (!next.totalCostManual) next.totalCostAed = computeRowTotal(next);
              return next;
            }),
          }),
      };
    });
  }, []);

  const setGeneralNotes = useCallback((v: string) => {
    setDoc((d) => (d ? ({ ...d, generalNotes: v }) : d));
  }, []);

  // "Inspected By" — editable override; persists with the report on Save/Submit.
  const setInspectorName = useCallback((v: string) => {
    setDoc((d) => (d ? ({ ...d, inspectorName: v }) : d));
  }, []);

  const persistDoc = useCallback(async (docToSave: InspectionDoc): Promise<boolean> => {
    if (!contractId) return false;
    const res = await fetch(`${apiBase}/inspection`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: phase, data: docToSave, finalize: false }),
    });
    return res.ok;
  }, [contractId, phase, apiBase]);

  // ── Build the move-out list by hand (restoration list) ────────────────────
  // Add a category (standard from the catalog, or a custom one) to the report.
  const addCategory = useCallback((def: { key: CategoryKey; label: string; unitLabel: string; subCategories?: string[] }) => {
    setDoc((d) => {
      if (!d) return d;
      const cats = d.categories ?? [];
      const used = new Set(cats.map((c) => c.sectionId));
      let ord = 0; let sid = `${def.key}:${ord}`;
      while (used.has(sid)) { ord += 1; sid = `${def.key}:${ord}`; }
      const newCat: InspectionCategory = {
        sectionId: sid, key: def.key, label: def.label, unitLabel: def.unitLabel,
        count: 0, subCategories: def.subCategories, nextCloneSeq: 1, nextCustomSeq: 1, items: [],
      };
      return { ...d, categories: [...cats, newCat] };
    });
  }, []);

  // Add a sub-category/component to a category, pricing it from the RP price book
  // (falling back to the platform seed). `seedRow` present → a standard component;
  // absent → a custom row. A custom row may carry an explicit `customPriceAed` so
  // it lands PRICED (frozen on the item) instead of null — otherwise it re-resolves
  // live on every read, which would let later Restoration List edits shift it.
  const addComponent = useCallback((sectionId: string, name: string, seedRow?: PriceBookSeedRow, customPriceAed?: number) => {
    if (!name.trim()) return;
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        categories: d.categories.map((cat) => {
          if (cat.sectionId !== sectionId) return cat;
          const key = cat.key as CategoryKey;
          const resolved = seedRow
            ? resolvePriceBookEntry(priceBook, key, seedRow.subCategory ?? null, seedRow.name, seedRow.variantLabel ?? null)
            : undefined;
          const usedIds = new Set(cat.items.map((i) => i.id));
          let idx = cat.items.length; let id = `${slug(sectionId)}:${slug(name)}:${idx}`;
          while (usedIds.has(id)) { idx += 1; id = `${slug(sectionId)}:${slug(name)}:${idx}`; }
          const item: InspectionItem = {
            id, category: key, sectionId,
            componentName: name.trim(),
            location: cat.items[0]?.location ?? cat.label ?? 'Unit',
            isCustom: !seedRow,
            inCondition: '', outCondition: '',
            quantity: 0, totalCostAed: 0, totalCostManual: false,
            unitOfMeasure: resolved?.unitOfMeasure ?? seedRow?.unitOfMeasure ?? 'item',
            vatMode: resolved?.vatMode ?? 'none',
          };
          if (seedRow?.subCategory) item.subCategory = seedRow.subCategory;
          if (resolved) {
            item.unitCostAed = resolved.unitPriceAed;
            if (resolved.variantLabel != null) item.variantLabel = resolved.variantLabel;
            if (resolved.id != null) item.priceBookEntryId = resolved.id;
          } else if (customPriceAed != null && Number.isFinite(customPriceAed) && customPriceAed >= 0) {
            // Custom component with a hand-entered rate — freeze it on the item.
            item.unitCostAed = customPriceAed;
          }
          return { ...cat, items: [...cat.items, item] };
        }),
      };
    });
  }, [priceBook]);

  const removeComponent = useCallback((sectionId: string, itemId: string) => {
    setDoc((d) => (d ? { ...d, categories: d.categories.map((c) => (c.sectionId !== sectionId ? c : { ...c, items: c.items.filter((i) => i.id !== itemId) })) } : d));
  }, []);

  const removeCategory = useCallback((sectionId: string) => {
    setDoc((d) => (d ? { ...d, categories: d.categories.filter((c) => c.sectionId !== sectionId) } : d));
  }, []);

  const compPickerCat = useMemo(
    () => (compPickerSection ? (doc?.categories.find((c) => c.sectionId === compPickerSection) ?? null) : null),
    [compPickerSection, doc],
  );

  async function handleSave() {
    if (!contractId || !doc) return;
    setSaving(true); setError(null);
    try {
      if (!(await persistDoc(doc))) { setError('Save failed.'); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch { setError('Save failed.'); }
    finally { setSaving(false); }
  }

  // Per-item photos upload immediately (presigned PUT) and auto-persist the doc,
  // so evidence is never lost by forgetting to Save. Only available while unlocked.
  const handleAddItemPhotos = useCallback(async (sectionId: string, itemId: string, files: File[]) => {
    if (!contractId || !files.length) return;
    setUploadingItemId(itemId); setError(null);
    const added: InspectionPhotoRef[] = [];
    for (const f of files) { const r = await uploadInspectionItemPhoto(contractId, itemId, f, { portalToken, type: phase }); if (r) added.push(r); }
    setUploadingItemId(null);
    if (!added.length) { setError('Photo upload failed — please retry.'); return; }
    const base = docRef.current;
    if (!base) return;
    const next: InspectionDoc = {
      ...base,
      categories: base.categories.map((cat) =>
        cat.sectionId !== sectionId ? cat : {
          ...cat,
          items: cat.items.map((it) =>
            it.id !== itemId ? it : { ...it, itemAttachments: [...(it.itemAttachments ?? []), ...added] }),
        }),
    };
    docRef.current = next;
    setDoc(next);
    if (!(await persistDoc(next))) setError('Photo added but the save failed — click Save draft.');
  }, [contractId, persistDoc, portalToken, phase]);

  const handleRemoveItemPhoto = useCallback(async (sectionId: string, itemId: string, photoId: string) => {
    const base = docRef.current;
    if (!base) return;
    const next: InspectionDoc = {
      ...base,
      categories: base.categories.map((cat) =>
        cat.sectionId !== sectionId ? cat : {
          ...cat,
          items: cat.items.map((it) =>
            it.id !== itemId ? it : { ...it, itemAttachments: (it.itemAttachments ?? []).filter((p) => p.id !== photoId) }),
        }),
    };
    docRef.current = next;
    setDoc(next);
    await persistDoc(next);
  }, [persistDoc]);

  async function handleSubmit() {
    if (!contractId || !doc) return;
    setConfirmSubmit(false);
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/inspection`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: phase, data: doc, finalize: true }),
      });
      if (!res.ok) { setError('Submit failed.'); return; }
      setSubmitted(true);
      setSubmittedAt(new Date().toISOString());
    } catch { setError('Submit failed.'); }
    finally { setSubmitting(false); }
  }

  // Reopen is an RP/manager-only action (undo a submission) — never on the portal.
  async function handleReopen() {
    if (!contractId || portalToken) return;
    setReopening(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection/reopen?type=${phase}`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { message?: string }).message ?? 'Reopen failed.');
        return;
      }
      setSubmittedAt(null); setSubmitted(false);
    } catch { setError('Reopen failed.'); }
    finally { setReopening(false); }
  }

  // ── Move-out date: editable until the inspection is approved (counter-signed) ──
  // While the form is a draft the date rides along on the next Save; once the
  // report is submitted (locked) it persists on its own via the date-only endpoint
  // so it can still be corrected right up to counter-signing.
  const handleMoveOutDate = useCallback((v: string) => {
    setDates((d) => ({ ...d, moveOutDate: v || null }));
    setDoc((d) => (d ? { ...d, moveOutDate: v } : d));
    if (!v) return;
    if (dateSaveTimer.current) clearTimeout(dateSaveTimer.current);
    dateSaveTimer.current = setTimeout(async () => {
      // A never-saved draft has no persisted inspection yet — the date-only
      // endpoint would 404; it saves with the rest on the first Save/Submit.
      if (!submittedAt) return;
      try {
        await fetch(`${apiBase}/inspection/move-out-date`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveOutDate: v }),
        });
      } catch { /* best-effort — surfaced on next load */ }
    }, 700);
  }, [apiBase, submittedAt]);
  useEffect(() => () => { if (dateSaveTimer.current) clearTimeout(dateSaveTimer.current); }, []);

  // Portal inspector counter-sign (RP side) — available once the customer has
  // signed and before the inspection is approved.
  async function handleCounterSign() {
    if (!contractId || !counterSig) { setCounterError('Please draw your signature first.'); return; }
    setCountering(true); setCounterError(null);
    try {
      const res = await fetch(`${apiBase}/inspection/counter-sign`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: phase, signatureImage: counterSig, signatoryName: doc?.inspectorName?.trim() || meta?.tenantName || 'Inspection Manager' }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setCounterError((b as { message?: string }).message ?? 'Counter-sign failed.');
        return;
      }
      setDoc((d) => (d ? { ...d, rpCounterSig: counterSig, rpCounterSignedAt: new Date().toISOString() } : d));
    } catch { setCounterError('Counter-sign failed.'); }
    finally { setCountering(false); }
  }

  // On-demand PDF of the v2 report (categories, conditions, costs, signatures).
  async function handleDownloadPdf(openForPrint = false) {
    if (!doc) return;
    setDownloading(true); setError(null);
    try {
      const [{ pdf }, mod] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/contract/InspectionReportV2Pdf'),
      ]);
      const totals = computeInspectionTotals(doc, phase);
      const showMoney = phase === 'move_out' && !portalToken; // inspector portal hides RP money
      const data = {
        doc, phase, ref: `CID-${contractId}`, showMoney, totals,
        meta: {
          property: meta?.property ?? '', unitNo: meta?.unitNo ?? '', propertyType: meta?.propertyType ?? '', floor: meta?.floor ?? '',
          tenantName: meta?.tenantName ?? '', tenantPhone: meta?.tenantPhone ?? '', tenantEmail: meta?.tenantEmail ?? '',
          inspectorName: doc.inspectorName ?? '', inspectorCompany: doc.inspectorCompany ?? '', inspectorRole: doc.inspectorRole ?? 'Property Representative',
        },
        inspectionDate: doc.reportGeneratedDate ?? doc.inspectionDate ?? null,
        moveInDate: doc.moveInDate ?? dates.moveInDate ?? null,
        moveOutDate: (doc.moveOutDate as string | undefined) ?? dates.moveOutDate ?? null,
      };
      const blob = await pdf(<mod.default data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      if (openForPrint) {
        const w = window.open(url, '_blank');
        w?.addEventListener('load', () => { try { w.focus(); w.print(); } catch { /* pop-up blocked */ } });
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = `${phase === 'move_out' ? 'move-out' : 'move-in'}-inspection-CID-${contractId}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setError('Could not generate the PDF.'); }
    finally { setDownloading(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9b9890]"><Loader2 className="animate-spin mr-2" /> Loading inspection…</div>;
  }

  const reportMeta: ReportMeta = {
    property: meta?.property ?? '', unitNo: meta?.unitNo ?? '', propertyType: meta?.propertyType ?? '', floor: meta?.floor ?? '',
    tenantName: meta?.tenantName ?? '', tenantPhone: meta?.tenantPhone ?? '', tenantEmail: meta?.tenantEmail ?? '',
    inspectorName: doc?.inspectorName ?? '', inspectorCompany: doc?.inspectorCompany ?? '', inspectorRole: doc?.inspectorRole ?? 'Property Representative',
  };

  // Back returns to wherever we came from (Operations pipeline when opened from
  // there, via ?from=…), falling back to the lease record.
  const backFrom = search?.get('from') || '';
  const backHref = portalToken
    ? `/portal/${portalToken}/contract/${contractId}`
    : (backFrom || `${isManagerView ? '/dashboard/manager/contracts' : '/rental-provider/dashboard/contracts'}/${contractId}/v2`);
  const backLabel = backFrom.includes('/operations') ? 'Back to operations' : 'Back to contract';
  // The move-out date stays editable until the inspection is approved (counter-signed).
  const canEditMoveOutDate = phase === 'move_out' && canEditInsp && !counterSigned;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-24">
      {/* Top bar — navigation + the always-available Preview / Download (and Reopen
          once submitted). The primary Save draft / Submit actions live at the
          bottom of the page, after the report. */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-[#9b9890] hover:text-[#1a1916] pt-2">
          <ArrowLeft size={15} /> {backLabel}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => handleDownloadPdf(true)} disabled={downloading || !doc}
            className="inline-flex items-center gap-2 rounded-xl border border-[#e8e6e0] text-[#6b6860] text-sm font-semibold px-4 py-2.5 disabled:opacity-60 hover:border-[#c8c6be]">
            <Printer size={16} /> Preview
          </button>
          <button type="button" onClick={() => handleDownloadPdf(false)} disabled={downloading || !doc}
            className="inline-flex items-center gap-2 rounded-xl border border-[#e8e6e0] text-[#6b6860] text-sm font-semibold px-4 py-2.5 disabled:opacity-60 hover:border-[#c8c6be]">
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Download
          </button>
          {canEditInsp && locked && !portalToken && (
            // On the portal the inspector cannot reopen — the submitted report is
            // handed to the customer to sign, then the inspector counter-signs below.
            <button type="button" onClick={handleReopen} disabled={reopening}
              className="inline-flex items-center gap-2 rounded-xl border border-[#e8e6e0] text-[#6b6860] text-sm font-semibold px-4 py-2.5 disabled:opacity-60 hover:border-[#c8c6be]">
              {reopening ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              {reopening ? 'Reopening…' : 'Reopen to edit'}
            </button>
          )}
        </div>
      </div>

      {locked && !counterSigned && (
        <div className="mb-4 rounded-lg bg-[#fef9ec] border border-[#f3e2b8] text-[#8a6d1a] text-sm px-3 py-2 flex items-center gap-2">
          <Lock size={14} className="shrink-0" />
          <span>
            {portalToken
              ? <>Inspection submitted — the customer signs it from their link, then you counter-sign below. The move-out date can still be adjusted until it is approved.</>
              : <>Submitted to the tenant — the report is locked for editing. Choose <strong>Reopen to edit</strong> to make changes (only possible until the tenant signs). The move-out date can still be adjusted until the inspection is approved.</>}
          </span>
        </div>
      )}
      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      {doc && (
        <InspectionReportView
          doc={doc}
          meta={reportMeta}
          phase={phase}
          audience="rp"
          dates={{ inspectionDate: doc.reportGeneratedDate ?? doc.inspectionDate ?? null, moveInDate: doc.moveInDate ?? dates.moveInDate ?? null, moveOutDate: dates.moveOutDate ?? null }}
          editable={!locked && canEditInsp}
          onPatch={patchItem}
          onAddCategory={() => setCatPickerOpen(true)}
          onAddComponent={(sid) => setCompPickerSection(sid)}
          onRemoveComponent={removeComponent}
          onRemoveCategory={removeCategory}
          onAddItemPhotos={handleAddItemPhotos}
          onRemoveItemPhoto={handleRemoveItemPhoto}
          uploadingItemId={uploadingItemId}
          generalNotes={doc.generalNotes ?? ''}
          onGeneralNotes={setGeneralNotes}
          onInspectorName={!locked && canEditInsp ? setInspectorName : undefined}
          onMoveOutDate={canEditMoveOutDate ? handleMoveOutDate : undefined}
          signatures={{ tenantSig: doc.tenantSig ?? null, tenantSignedAt: doc.tenantSignedAt ?? null, rpSig: doc.rpCounterSig ?? null, rpSignedAt: doc.rpCounterSignedAt ?? null }}
          hideSignatures={!!portalToken}
        />
      )}

      {/* Bottom action bar — the primary Save draft (left) + Submit to Tenant (right),
          shown after the report so the RP/inspector acts once they've reviewed it. */}
      {canEditInsp && !locked && doc && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" onClick={handleSave} disabled={saving || submitting}
            className="inline-flex items-center gap-2 rounded-xl border border-[#2e9f82] text-[#2e9f82] text-sm font-semibold px-5 py-2.5 disabled:opacity-60 hover:bg-[#f0faf6]">
            {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <CheckCircle size={16} /> : <Save size={16} />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
          </button>
          <button type="button" onClick={() => setConfirmSubmit(true)} disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-5 py-2.5 disabled:opacity-60 hover:bg-[#27896f]">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {submitting ? 'Submitting…' : 'Submit to Tenant'}
          </button>
        </div>
      )}

      {/* Portal inspector: counter-sign the RP side once the customer has signed. */}
      {portalToken && doc && (
        <div className="mt-6 bg-white rounded-2xl border border-[#e8e6e0] p-5">
          <h3 className="text-sm font-bold text-[#1a1916] mb-3">Inspection Manager Counter-Signature</h3>
          {counterSigned ? (
            <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle size={16} /> This inspection has been counter-signed{doc.rpCounterSignedAt ? ` on ${new Date(doc.rpCounterSignedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}.</p>
          ) : !locked ? (
            <p className="text-sm text-[#9b9890]">Fill and submit the inspection first, then the customer signs and you counter-sign here.</p>
          ) : !tenantSigned ? (
            <p className="text-sm text-[#9b9890]">Submitted — waiting for the customer to sign from their link. You counter-sign once they do.</p>
          ) : (
            <>
              <p className="text-xs text-[#6b6860] mb-2">You are signing as the inspection manager, on behalf of the rental provider. Confirm the condition recorded above, then sign to complete the inspection.</p>
              <SignaturePad value={counterSig} onChange={setCounterSig} />
              {counterError && <p className="text-xs text-red-600 mt-1">{counterError}</p>}
              <button type="button" onClick={handleCounterSign} disabled={!counterSig || countering}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-60">
                {countering ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                {countering ? 'Signing…' : 'Counter-sign inspection'}
              </button>
            </>
          )}
        </div>
      )}

      {catPickerOpen && (
        <AddCategoryPicker
          existingKeys={new Set((doc?.categories ?? []).map((c) => c.key))}
          onAdd={addCategory}
          onClose={() => setCatPickerOpen(false)}
        />
      )}
      {compPickerCat && (
        <AddComponentPicker
          cat={compPickerCat}
          priceBook={priceBook}
          onAdd={(name, seedRow, customPriceAed) => addComponent(compPickerCat.sectionId, name, seedRow, customPriceAed)}
          onClose={() => setCompPickerSection(null)}
        />
      )}
      {confirmSubmit && (
        <ConfirmDialog
          title={`Submit ${phase === 'move_out' ? 'move-out' : 'move-in'} inspection?`}
          body="The customer will be able to review and sign it, and the report is locked from further editing (you can reopen it until they sign)."
          confirmLabel="Submit to Tenant"
          onConfirm={handleSubmit}
          onCancel={() => setConfirmSubmit(false)}
        />
      )}
    </div>
  );
}

/** App-styled confirmation dialog (replaces the native window.confirm) — a centred
 *  card with a jade primary action, dismissable by backdrop / Cancel. */
function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: {
  title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-10 h-10 rounded-full bg-[#f0faf6] text-[#2e9f82] flex items-center justify-center"><Send size={18} /></span>
            <div>
              <h2 className="text-base font-bold text-[#1a1916]">{title}</h2>
              <p className="text-sm text-[#6b6860] mt-1 leading-relaxed">{body}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[#fafaf8] border-t border-[#eceae4]">
          <button type="button" onClick={onCancel}
            className="rounded-xl border border-[#e8e6e0] text-[#6b6860] text-sm font-semibold px-4 py-2 hover:border-[#c8c6be]">Cancel</button>
          <button type="button" onClick={onConfirm}
            className="rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-4 py-2 hover:bg-[#27896f]">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Draw-to-sign pad (portal inspector counter-signature). Emits a PNG data-URL on
 *  each stroke so the parent can enable the Counter-sign button; sizes its backing
 *  store to the rendered box (× DPR) so strokes stay crisp and un-stretched. */
function SignaturePad({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const pos = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); };
  const up = () => { if (drawing.current) { drawing.current = false; onChange(canvasRef.current!.toDataURL('image/png')); } };
  const clear = () => { const c = canvasRef.current!; const ctx = c.getContext('2d')!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); onChange(null); };
  return (
    <div>
      <canvas ref={canvasRef} className="w-full h-40 sm:h-[150px] border border-[#d8d6d0] rounded-lg bg-[#fafaf8] touch-none cursor-crosshair"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <button type="button" onClick={clear} className="text-[11px] text-[#6b6860] mt-1">{value ? 'Clear' : 'Draw your signature above'}</button>
    </div>
  );
}

/* ─── Restoration-list pickers ─────────────────────────────────────────────
 * The move-out inspection starts from the move-in report (or blank). These two
 * modals let the RP/manager add categories & sub-category/components one by one
 * from the standard restoration catalog (or a custom one). */

function ModalShell({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl my-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#eceae4] sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1a1916]">{title}</h2>
            {subtitle && <p className="text-xs text-[#9b9890] mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#9b9890] hover:bg-[#f4f3ef]"><X size={18} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="flex items-center justify-end px-5 py-3 border-t border-[#eceae4] sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f]">Done</button>
        </div>
      </div>
    </div>
  );
}

const CUSTOM_INPUT = 'flex-1 min-w-0 px-3 py-2 rounded-lg border border-[#e8e6e0] text-sm focus:outline-none focus:border-[#2e9f82]';
const CUSTOM_ADD = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#cfe8df] text-sm font-medium text-[#2e9f82] hover:bg-[#f0faf6] disabled:opacity-50';

/** Pick a category to add. Standard categories already in the report are hidden;
 *  a custom category is always available. Stays open so several can be added. */
function AddCategoryPicker({ existingKeys, onAdd, onClose }: {
  existingKeys: Set<string>;
  onAdd: (def: { key: CategoryKey; label: string; unitLabel: string; subCategories?: string[] }) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const available = CATALOG.filter((c) => !existingKeys.has(c.key));

  const addCustom = () => {
    const name = custom.trim();
    if (!name) return;
    onAdd({ key: `custom:${slug(name)}` as CategoryKey, label: name, unitLabel: 'Per Item' });
    setCustom('');
  };

  return (
    <ModalShell title="Add category" subtitle="From the restoration list, or a custom one" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {available.map((c) => {
          const done = added.has(c.key);
          return (
            <button key={c.key} disabled={done}
              onClick={() => { onAdd({ key: c.key, label: c.label, unitLabel: c.unitLabel, subCategories: c.subCategories }); setAdded((s) => new Set(s).add(c.key)); }}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm text-left ${done ? 'border-[#cfe8df] bg-[#f0faf6] text-[#2e9f82]' : 'border-[#e8e6e0] text-[#1a1916] hover:border-[#2e9f82] hover:bg-[#fafaf8]'}`}>
              <span className="truncate">{c.label}</span>
              {done ? <CheckCircle size={15} className="shrink-0" /> : <Plus size={15} className="shrink-0 text-[#9b9890]" />}
            </button>
          );
        })}
        {available.length === 0 && <p className="col-span-2 text-xs text-[#9b9890] px-1 py-2">All standard categories are already in the report — add a custom one below.</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-[#f0efe9] pt-3">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
          placeholder="Custom category name…" className={CUSTOM_INPUT} />
        <button onClick={addCustom} disabled={!custom.trim()} className={CUSTOM_ADD}><Plus size={14} /> Add</button>
      </div>
    </ModalShell>
  );
}

/** Pick a sub-category/component to add to a category. Standard components already
 *  present are hidden; each shows its resolved restoration price. */
function AddComponentPicker({ cat, priceBook, onAdd, onClose }: {
  cat: InspectionCategory;
  priceBook: InspectionPriceBookEntry[] | null;
  onAdd: (name: string, seedRow?: PriceBookSeedRow, customPriceAed?: number) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const canon: CanonicalCategoryKey = canonicalKey(cat.key);

  // The pickable components come from the RP's Restoration List (price book) for
  // this category — NOT the static catalog. The price book is seeded from the
  // platform standard, so it already holds every standard component plus the RP's
  // own additions, each with the RP's own rate. The static catalog is used ONLY
  // as a safety net — when the price book hasn't loaded (null) or has no row for
  // this exact category (a legacy/aliased key, or an empty custom section) — so
  // the picker is never empty. Exact-key match keeps the list in step with
  // pricing, which also resolves on `categoryKey === cat.key`.
  const rows: PriceBookSeedRow[] = useMemo(() => {
    const fromList = (priceBook ?? [])
      .filter((e) => e.isActive && e.categoryKey === cat.key)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((e): PriceBookSeedRow => ({
        name: e.componentName,
        unitOfMeasure: e.unitOfMeasure,
        unitPriceAed: e.unitPriceAed,
        subCategory: e.subCategory ?? undefined,
        variantLabel: e.variantLabel ?? undefined,
      }));
    return fromList.length > 0 ? fromList : (CATALOG_BY_KEY[canon]?.seed ?? []);
  }, [priceBook, cat.key, canon]);

  const usedNames = new Set(cat.items.map((i) => `${i.componentName}|${i.subCategory ?? ''}`));

  const price = (row: PriceBookSeedRow): number | undefined =>
    resolvePriceBookEntry(priceBook, cat.key as CategoryKey, row.subCategory ?? null, row.name, row.variantLabel ?? null)?.unitPriceAed;

  const priceInvalid = customPrice.trim() !== '' && (!Number.isFinite(Number(customPrice)) || Number(customPrice) < 0);
  const addCustom = () => {
    const name = custom.trim();
    if (!name || priceInvalid) return;
    const raw = customPrice.trim();
    onAdd(name, undefined, raw === '' ? undefined : Number(raw));
    setCustom(''); setCustomPrice('');
  };

  return (
    <ModalShell title={`Add to ${cat.label || 'category'}`} subtitle="From the restoration list, or a custom component" onClose={onClose}>
      <div className="space-y-1.5 mb-4 max-h-[46vh] overflow-y-auto">
        {rows.map((row) => {
          const rowKey = `${row.name}|${row.subCategory ?? ''}`;
          // React key includes the variant so two variants of one component
          // (same name+sub) don't collide; `rowKey` drives the added/used dedup.
          const reactKey = `${rowKey}|${row.variantLabel ?? ''}`;
          const done = added.has(rowKey) || usedNames.has(rowKey);
          const p = price(row);
          return (
            <button key={reactKey} disabled={done}
              onClick={() => { onAdd(row.name, row); setAdded((s) => new Set(s).add(rowKey)); }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-sm text-left ${done ? 'border-[#cfe8df] bg-[#f0faf6]' : 'border-[#e8e6e0] hover:border-[#2e9f82] hover:bg-[#fafaf8]'}`}>
              <span className="min-w-0">
                <span className="text-[#1a1916]">{row.name}</span>
                {row.subCategory && <span className="text-xs text-[#9b9890]"> · {row.subCategory}</span>}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {p != null && <span className="text-xs text-[#6b6860] tabular-nums">AED {AED(p)}/{row.unitOfMeasure}</span>}
                {done ? <CheckCircle size={15} className="text-[#2e9f82]" /> : <Plus size={15} className="text-[#9b9890]" />}
              </span>
            </button>
          );
        })}
        {rows.length === 0 && <p className="text-xs text-[#9b9890] px-1 py-2">No standard components for this category — add a custom one below.</p>}
      </div>
      <div className="border-t border-[#f0efe9] pt-3">
        <div className="flex items-center gap-2">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
            placeholder="Custom component name…" className={CUSTOM_INPUT} />
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[11px] text-[#9b9890]">AED</span>
            <input type="number" min={0} step={0.01} value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
              placeholder="Price"
              className="w-20 px-2 py-2 rounded-lg border border-[#e8e6e0] text-sm text-right tabular-nums focus:outline-none focus:border-[#2e9f82]" />
          </div>
          <button onClick={addCustom} disabled={!custom.trim() || priceInvalid} className={CUSTOM_ADD}><Plus size={14} /> Add</button>
        </div>
        <p className="text-[11px] text-[#9b9890] mt-1.5">
          {priceInvalid ? <span className="text-red-600">Enter a valid price (0 or more).</span>
            : 'Set a price so the rate is saved with the report. Leave blank to add without a rate.'}
        </p>
      </div>
    </ModalShell>
  );
}
