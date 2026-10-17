'use client';

/**
 * Operations › Long-term leases › Move-in / move-out inspection — Genspark OS
 * rebuild of the RP inspection workspace (the editable surface of the shared
 * InspectionReportView, design spec §6). Save draft / Submit to the customer
 * (locks) / Reopen to edit / counter-sign. The category-report layout itself lives
 * in InspectionReportView (REUSED unchanged), shared read-only with the customer page.
 *
 * Served by THREE routes, all kept working (paths derived from the URL):
 *  - /rental-provider/dashboard/contracts/:id/inspection/v2 (RP owner)
 *  - /dashboard/manager/contracts/:id/inspection/v2 (re-export; canManageInspections gate)
 *  - /portal/:token/contract/:id/inspection (no-login inspector magic link — no Back
 *    link, token-scoped endpoints, inspector counter-sign pad, money hidden)
 *  (+ /prototype/os/rp/… bridge re-export.)
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET {apiBase}/inspection/v2?type= (portal: {apiBase}/inspection/full?type=) + GET {apiBase}
 *    (contract: landlord id, status, building + community, unit no/type/floor, customer
 *    name/phone/email, move-in = startDate, move-out = doc.moveOutDate ?? termination
 *    effective date ?? endDate). apiBase = /api/contracts/:id or /api/portal/:token/contracts/:id.
 *  - Price book: /api/inspection-price-book (RP) · /api/manager/inspection-price-book?rp=
 *    (manager, waits for landlord id) · {apiBase}/inspection-price-book?type= (portal).
 *  - PATCH {apiBase}/inspection {type, data, finalize:false} — Save draft, and the
 *    auto-persist after every photo add/remove; {finalize:true} — Submit (behind the
 *    confirmation dialog).
 *  - POST /api/contracts/:id/inspection/reopen?type= — Reopen to edit (RP/manager, not portal).
 *  - PATCH {apiBase}/inspection/move-out-date {moveOutDate} — debounced 700 ms, only once
 *    submitted; editable on move-out until counter-signed.
 *  - POST {apiBase}/inspection/counter-sign {type, signatureImage, signatoryName, consent,
 *    clientMeta, geo} — SignatureBlock (REUSED) once the customer has signed.
 *  - Per-item photo upload / remove (uploadInspectionItemPhoto, sequential) and bulk
 *    report photos with progress; general photo remove.
 *  - Restoration list: Add category (catalog minus existing + custom), Add component
 *    (RP price book rows for that exact category, catalog seed fallback, resolved price
 *    shown, custom component with optional frozen price + validation), remove
 *    component / category; row totals via computeRowTotal unless manual.
 *  - General notes, Inspected-by override, move-out date editing.
 *  - Preview overlay (InspectionInline — exactly what the customer sees; Esc / browser
 *    Back close it via useBackClose) with Download; Download PDF (InspectionReportV2Pdf,
 *    money only on RP/manager move-out); hidden Preview once the customer has signed.
 *  - Once the customer has signed: the finished InspectionInline document in place of the
 *    editable workspace, then the counter-signature block.
 *  - Back: ?from=… else Operations record (live lease, keeps ?rp=) or the lease record
 *    (expired / terminated); "Back to operations" / "Back to contract" label.
 *  - Locked notice (portal vs dashboard wording), error banner, loading state.
 *  - Manager permission canManageInspections hides Save / Submit / Reopen / counter-sign
 *    and makes the report read-only (portal token is its own authorisation).
 *  - New (read-only, same data): sign-off Flow, report KPIs (categories, components,
 *    flagged, photos, estimated restoration on the RP move-out copy), a "view only"
 *    note for managers without the inspection permission.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams, useSearchParams, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { ArrowLeft, Save, Loader2, CheckCircle, Send, RotateCcw, Plus, Printer, Download } from 'lucide-react';
import {
  InspectionDoc, InspectionItem, InspectionCategory, InspectionPriceBookEntry,
  CategoryKey, CanonicalCategoryKey, PriceBookSeedRow,
  CATALOG, CATALOG_BY_KEY, canonicalKey, resolvePriceBookEntry, slug, computeRowTotal, computeInspectionTotals,
} from '@/lib/inspectionCatalog';
import { uploadInspectionItemPhoto, type InspectionPhotoRef } from '@/lib/inspectionPhotos';
import { InspectionReportView, type ReportMeta } from '@/components/contract/InspectionReportView';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import { useBackClose } from '@/lib/useSlideOver';
import {
  OsPage, PageHead, ScopeStrip, Card, Kpis, Kpi, Pill, Btn, Callout, Flow, Modal, fmtAed, type Tone,
} from '@/components/os/kit';

// Preview renders the EXACT document the customer reads — the same canvas-
// rasterised report their portal page shows — instead of dumping a blob into a
// new tab behind the browser's print dialog. @react-pdf + pdf.js are
// browser-only, so it loads the same way the customer pages load it.
const InspectionInline = dynamic(() => import('@/components/contract/InspectionInline'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 360, display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--ms-ink-3)' }}>Preparing inspection report…</div>
  ),
});

type Phase = 'move_in' | 'move_out';
const AED = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ContractMeta {
  property: string; unitNo: string; propertyType: string; floor: string;
  tenantName: string; tenantPhone: string; tenantEmail: string;
  /** Contract reference (e.g. CID-…) for the page title. */
  ref: string;
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
  // Lease status, so Back can fall back to the right home when the opener did
  // not pass `from=…`: a live lease is still an Operations row, an ended one
  // (expired / terminated) only exists in the Leases register.
  const [contractStatus, setContractStatus] = useState<string | null>(null);
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
  // Report-level bulk photo upload (all images at once, not per component row).
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState<{ done: number; total: number } | null>(null);
  // The RP's inspection price book, so components added by hand from the restoration
  // list carry the RP's own rates (falls back to the platform seed when unavailable).
  const [priceBook, setPriceBook] = useState<InspectionPriceBookEntry[] | null>(null);
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [compPickerSection, setCompPickerSection] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Preview = read the finished report exactly as the customer will.
  const [previewOpen, setPreviewOpen] = useState(false);
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
          setContractStatus(c.status ?? null);
          setMeta({
            // "Building, Community" — the report names the location the same way
            // on the RP/manager, inspector and customer copies.
            property: [
              c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
              c.property?.community ?? c.unit?.property?.community?.nameEn ?? '',
            ].filter(Boolean).join(', '),
            unitNo: c.unit?.number ?? c.unit?.unitNumber ?? '',
            propertyType: c.unit?.unitType ?? c.unit?.type ?? '',
            floor: c.unit?.floor != null ? String(c.unit.floor) : '',
            // Company tenants: the party name is the company, not the signatory.
            tenantName: c.tenant?.companyName || c.tenant?.name || '',
            tenantPhone: c.tenant?.phone ?? '',
            tenantEmail: c.tenant?.email ?? '',
            ref: c.ref ?? '',
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

  // BULK photo upload for the whole report — walk the unit, then drop the entire
  // camera roll in at once instead of attaching image-by-image to each component
  // row. They land on `doc.photos` (already persisted, re-signed on read and
  // normalised on save by the backend, exactly like per-item attachments).
  const handleAddGeneralPhotos = useCallback(async (files: File[]) => {
    if (!contractId || !files.length) return;
    setUploadingPhotos(true); setError(null);
    const added: InspectionPhotoRef[] = [];
    // Sequential: the presigned-PUT endpoint is per-file, and a walk-through can
    // be 30+ images — firing them all at once stalls on a site connection.
    for (const f of files) {
      const r = await uploadInspectionItemPhoto(contractId, 'general', f, { portalToken, type: phase });
      if (r) added.push(r);
      setPhotoProgress({ done: added.length, total: files.length });
    }
    setUploadingPhotos(false); setPhotoProgress(null);
    if (!added.length) { setError('Photo upload failed — please retry.'); return; }
    if (added.length < files.length) setError(`${files.length - added.length} of ${files.length} photos failed to upload.`);
    const base = docRef.current;
    if (!base) return;
    const next: InspectionDoc = { ...base, photos: [...(base.photos ?? []), ...added] };
    docRef.current = next;
    setDoc(next);
    if (!(await persistDoc(next))) setError('Photos added but the save failed — click Save draft.');
  }, [contractId, persistDoc, portalToken, phase]);

  const handleRemoveGeneralPhoto = useCallback(async (photoId: string) => {
    const base = docRef.current;
    if (!base) return;
    const next: InspectionDoc = { ...base, photos: (base.photos ?? []).filter((p) => p.id !== photoId) };
    docRef.current = next;
    setDoc(next);
    await persistDoc(next);
  }, [persistDoc]);

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
  async function handleCounterSign(p: SignaturePayload) {
    const res = await fetch(`${apiBase}/inspection/counter-sign`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: phase, signatureImage: p.signatureImage, signatoryName: p.signatoryName || doc?.inspectorName?.trim() || meta?.tenantName || 'Inspection Manager', consent: p.consent, clientMeta: p.clientMeta, geo: p.geo }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? 'Counter-sign failed.');
    }
    setDoc((d) => (d ? { ...d, rpCounterSig: p.signatureImage, rpCounterSignedAt: new Date().toISOString() } : d));
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
        // No Status badge: it read "Draft" for everything short of the RP's
        // counter-signature, so a report already submitted to the customer still
        // printed as a draft. The report's real progress is the signature blocks.
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

  // Stable close handlers — the kit Modal re-runs its focus effect whenever
  // onClose changes identity, so inline arrows would steal focus on every render.
  const closeCatPicker = useCallback(() => setCatPickerOpen(false), []);
  const closeCompPicker = useCallback(() => setCompPickerSection(null), []);
  const cancelSubmit = useCallback(() => setConfirmSubmit(false), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);

  const phaseLabel = phase === 'move_out' ? 'Move-out' : 'Move-in';
  const refLabel = meta?.ref || `CID-${contractId}`;
  const titleNode = <>{phaseLabel} inspection · {refLabel}</>;
  const eyebrow = portalToken ? 'Inspection report' : 'Operations › Long-term leases';

  if (loading) {
    return (
      <OsPage>
        <PageHead eyebrow={eyebrow} title={titleNode} lede="Loading the inspection report…" />
        <Card pad><div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
          {[70, 45, 60, 35].map((w, i) => <div key={i} className="gx-skel" style={{ height: 14, width: `${w}%` }} />)}
        </div></Card>
      </OsPage>
    );
  }

  const reportMeta: ReportMeta = {
    property: meta?.property ?? '', unitNo: meta?.unitNo ?? '', propertyType: meta?.propertyType ?? '', floor: meta?.floor ?? '',
    tenantName: meta?.tenantName ?? '', tenantPhone: meta?.tenantPhone ?? '', tenantEmail: meta?.tenantEmail ?? '',
    inspectorName: doc?.inspectorName ?? '', inspectorCompany: doc?.inspectorCompany ?? '', inspectorRole: doc?.inspectorRole ?? 'Property Representative',
  };

  // Back returns to wherever we came from (Operations pipeline when opened from
  // there, via ?from=…). With no opener — a direct link, a refresh, or an entry
  // point that doesn't pass `from` — fall back to where the lease actually
  // lives: Operations while it is running, the Leases record once it has ended
  // (ended leases never enter the Operations worklist).
  const backFrom = search?.get('from') || '';
  const dashBase = isManagerView ? '/dashboard/manager' : '/rental-provider/dashboard';
  const rpScope = search?.get('rp');           // manager sticky-landlord scope
  const isEnded = contractStatus === 'expired' || contractStatus === 'terminated';
  const homeHref = isEnded
    ? `${dashBase}/contracts/${contractId}/v2`
    : `${dashBase}/operations/${contractId}${rpScope ? `?rp=${rpScope}` : ''}`;
  const backHref = portalToken
    ? `/portal/${portalToken}/contract/${contractId}`
    : (backFrom || homeHref);
  const backLabel = (backFrom || homeHref).includes('/operations') ? 'Back to operations' : 'Back to contract';
  // The move-out date stays editable until the inspection is approved (counter-signed).
  const canEditMoveOutDate = phase === 'move_out' && canEditInsp && !counterSigned;

  // Read-only overview figures (same maths the PDF uses).
  const totals = computeInspectionTotals(doc, phase);
  const itemPhotoCount = (doc?.categories ?? []).reduce((n, c) => n + c.items.reduce((m, it) => m + (it.itemAttachments?.length ?? 0), 0), 0);
  const photoCount = (doc?.photos?.length ?? 0) + itemPhotoCount;
  const showMoney = phase === 'move_out' && !portalToken;
  const status: { label: string; tone: Tone } = counterSigned
    ? { label: 'Counter-signed', tone: 'primary' }
    : tenantSigned ? { label: 'Customer signed — counter-sign', tone: 'amber' }
    : locked ? { label: 'Submitted — awaiting customer', tone: 'info' }
    : { label: 'Draft', tone: 'neutral' };
  const flowCurrent = counterSigned ? 4 : tenantSigned ? 3 : locked ? 2 : 0;
  const placeLine = [meta?.property, meta?.unitNo ? `Unit ${meta.unitNo}` : '', meta?.tenantName].filter(Boolean).join(' · ');

  return (
    <OsPage>
      <PageHead
        eyebrow={eyebrow}
        title={titleNode}
        lede={<>{placeLine ? <>{placeLine}. </> : null}{phase === 'move_out'
          ? 'Condition of every room and component at handover back, with photos and restoration costs — the evidence behind any deposit deduction.'
          : 'Condition of every room and component at handover, with photos — the baseline the move-out inspection is compared against.'}</>}
        actions={<>
          {/* The magic link is a standalone page — there is no app behind it to go back to. */}
          {!portalToken && <Btn href={backHref}><ArrowLeft size={13} aria-hidden /> {backLabel}</Btn>}
          {/* Once the customer has signed, the page IS the preview. */}
          {!tenantSigned && (
            <Btn onClick={() => setPreviewOpen(true)} disabled={!doc}><Printer size={13} aria-hidden /> Preview</Btn>
          )}
          <Btn onClick={() => void handleDownloadPdf(false)} disabled={downloading || !doc}>
            {downloading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />} Download PDF
          </Btn>
          {canEditInsp && locked && !portalToken && (
            // On the portal the inspector cannot reopen — the submitted report is
            // handed to the customer to sign, then the inspector counter-signs below.
            <Btn variant="amber" onClick={() => void handleReopen()} disabled={reopening}>
              {reopening ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <RotateCcw size={13} aria-hidden />} {reopening ? 'Reopening…' : 'Reopen to edit'}
            </Btn>
          )}
        </>}
      />

      <ScopeStrip items={[
        ...(portalToken ? [{ label: 'Access', value: 'Inspector link' }] : [
          { label: 'Workspace', value: 'Operations' },
          { label: 'Vertical', value: 'Long-term leases' },
        ]),
        { label: 'Contract', value: refLabel },
        { label: 'Inspection', value: phaseLabel },
        { label: 'Status', value: <Pill tone={status.tone}>{status.label}</Pill> },
        ...(!canEditInsp ? [{ label: 'Access', value: <Pill tone="neutral">View only</Pill> }] : []),
      ]} />

      {/* Only while the report is waiting on the customer — once they have signed
          this notice is stale (Reopen is no longer possible). */}
      {locked && !counterSigned && !tenantSigned && (
        <Callout tone="warn" title="Locked for editing.">
          {portalToken
            ? <>Inspection submitted — the customer signs it from their link, then you counter-sign below. The move-out date can still be adjusted until it is approved.</>
            : <>Submitted to the customer — the report is locked for editing. Choose <strong>Reopen to edit</strong> to make changes (only possible until the customer signs). The move-out date can still be adjusted until the inspection is approved.</>}
        </Callout>
      )}
      {!canEditInsp && !portalToken && (
        <Callout tone="info" title="View only.">Filling, submitting and counter-signing inspections needs the “Manage inspections” permission for this landlord.</Callout>
      )}
      {error && <Callout tone="bad">{error}</Callout>}

      <div style={{ marginTop: 14 }}>
        <Kpis>
          <Kpi k="Categories" v={totals.categories} d="rooms / systems with components" />
          <Kpi k="Components" v={totals.items} d={`${totals.defective} flagged`} />
          <Kpi k="Photos" v={photoCount} d={`${doc?.photos?.length ?? 0} report · ${itemPhotoCount} on components`} />
          {showMoney
            ? <Kpi k="Est. restoration" v={fmtAed(totals.estCostAed, true)} d="from the restoration list" dark />
            : <Kpi k="Sign-off" v={status.label.split(' — ')[0]} d={doc?.rpCounterSignedAt ? `counter-signed ${new Date(doc.rpCounterSignedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'both parties sign'} dark />}
        </Kpis>
      </div>

      <Card title="Sign-off" sub={phase === 'move_in' ? 'The move-in counter-signature activates the tenancy and locks the report.' : 'The signed move-out report is the evidence for the final settlement.'}>
        <div className="gx-pad">
          <Flow current={flowCurrent} steps={[
            { t: 'Fill the report', s: 'conditions, photos, notes' },
            { t: 'Submit to Tenant', s: locked ? 'submitted' : 'locks the report' },
            { t: 'Customer signs', s: doc?.tenantSignedAt ? new Date(doc.tenantSignedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'from their link' },
            { t: 'Counter-sign', s: portalToken ? 'inspection manager' : 'landlord / manager' },
          ]} />
        </div>
      </Card>

      {/* Once the CUSTOMER has signed, the report is final — show the finished
          document exactly as the customer reads it (the same canvas, same
          max-w-3xl width so it rasterises identically). */}
      {doc && tenantSigned && (
        <div style={{ marginTop: 14 }}>
          <div style={{ maxWidth: 768, marginInline: 'auto' }}>
            <InspectionInline
              doc={doc}
              meta={reportMeta}
              phase={phase}
              contractRef={`CID-${contractId}`}
              inspectionDate={doc.reportGeneratedDate ?? doc.inspectionDate ?? null}
              moveInDate={doc.moveInDate ?? dates.moveInDate ?? null}
              moveOutDate={(doc.moveOutDate as string | undefined) ?? dates.moveOutDate ?? null}
            />
          </div>
        </div>
      )}

      {doc && !tenantSigned && (
        <div style={{ marginTop: 14 }}>
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
            photos={doc.photos ?? []}
            onAddPhotos={!locked && canEditInsp ? handleAddGeneralPhotos : undefined}
            onRemovePhoto={!locked && canEditInsp ? handleRemoveGeneralPhoto : undefined}
            photosUploading={uploadingPhotos}
            photosProgress={photoProgress}
            generalNotes={doc.generalNotes ?? ''}
            onGeneralNotes={setGeneralNotes}
            onInspectorName={!locked && canEditInsp ? setInspectorName : undefined}
            onMoveOutDate={canEditMoveOutDate ? handleMoveOutDate : undefined}
            signatures={{ tenantSig: doc.tenantSig ?? null, tenantSignedAt: doc.tenantSignedAt ?? null, rpSig: doc.rpCounterSig ?? null, rpSignedAt: doc.rpCounterSignedAt ?? null }}
            hideSignatures={!!portalToken}
          />
        </div>
      )}

      {/* Primary Save draft + Submit, after the report so the RP/inspector acts
          once they've reviewed it. */}
      {canEditInsp && !locked && doc && (
        <div style={{ marginTop: 14 }}>
          <Card title="Save & submit" sub="Photos save as you add them. Submitting hands the report to the customer to sign and locks it (you can reopen it until they sign).">
            <div className="gx-pad gx-btn-row" style={{ justifyContent: 'space-between' }}>
              <Btn onClick={() => void handleSave()} disabled={saving || submitting}>
                {saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : saved ? <CheckCircle size={13} aria-hidden /> : <Save size={13} aria-hidden />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
              </Btn>
              <Btn variant="primary" onClick={() => setConfirmSubmit(true)} disabled={submitting}>
                {submitting ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Send size={13} aria-hidden />}
                {submitting ? 'Submitting…' : 'Submit to Tenant'}
              </Btn>
            </div>
          </Card>
        </div>
      )}

      {/* Counter-sign the RP side once the customer has signed. Open to the
          on-site inspector (magic link) AND to the landlord / delegated manager in
          the dashboard — the contract page sends them here to "counter-sign in the
          inspection workspace". Move-in counter-signature activates the tenancy
          and locks the report. */}
      {doc && (portalToken || canEditInsp) && (
        <div style={{ marginTop: 14, ...(tenantSigned ? { maxWidth: 768, marginInline: 'auto' } : {}) }}>
          <Card title={portalToken ? 'Inspection Manager Counter-Signature' : 'Your Counter-Signature'}>
            <div className="gx-pad">
              {counterSigned ? (
                <Callout title="Counter-signed.">
                  This inspection has been counter-signed{doc.rpCounterSignedAt ? ` on ${new Date(doc.rpCounterSignedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}.
                </Callout>
              ) : !locked ? (
                <p style={{ color: 'var(--ms-ink-3)', fontSize: 12.5 }}>Fill and submit the inspection first, then the customer signs and you counter-sign here.</p>
              ) : !tenantSigned ? (
                <p style={{ color: 'var(--ms-ink-3)', fontSize: 12.5 }}>Submitted — waiting for the customer to sign from their link. You counter-sign once they do.</p>
              ) : (
                <SignatureBlock
                  // The RP-side signatory is the person inspecting — never the
                  // customer, so `tenantName` is not a fallback here.
                  signerRole={portalToken ? 'Inspector' : (doc.inspectorRole?.trim() || 'Property Representative')}
                  signerName={doc?.inspectorName?.trim() || 'Inspection Manager'}
                  onBehalfOf="the rental provider"
                  defaultName={doc?.inspectorName?.trim() || ''}
                  termsText={`I confirm the condition recorded in this ${phase === 'move_out' ? 'move-out' : 'move-in'} inspection is accurate.`}
                  submitLabel="Sign inspection"
                  alreadySigned={false}
                  onSign={handleCounterSign}
                />
              )}
            </div>
          </Card>
        </div>
      )}

      {catPickerOpen && <AddCategoryPicker
        open
        existingKeys={new Set((doc?.categories ?? []).map((c) => c.key))}
        onAdd={addCategory}
        onClose={closeCatPicker}
      />}
      {compPickerCat && (
        <AddComponentPicker
          cat={compPickerCat}
          priceBook={priceBook}
          onAdd={(name, seedRow, customPriceAed) => addComponent(compPickerCat.sectionId, name, seedRow, customPriceAed)}
          onClose={closeCompPicker}
        />
      )}
      <Modal
        open={confirmSubmit}
        onClose={cancelSubmit}
        width={440}
        title={`Submit ${phase === 'move_out' ? 'move-out' : 'move-in'} inspection?`}
        footer={<>
          <span className="sp" />
          <Btn onClick={cancelSubmit}>Cancel</Btn>
          <Btn variant="primary" onClick={() => void handleSubmit()}><Send size={13} aria-hidden /> Submit to Tenant</Btn>
        </>}
      >
        <p style={{ fontSize: 13, color: 'var(--ms-ink-2)', lineHeight: 1.55 }}>
          The customer will be able to review and sign it, and the report is locked from further editing (you can reopen it until they sign).
        </p>
      </Modal>
      {previewOpen && doc && (
        <InspectionPreviewOverlay
          doc={doc}
          meta={reportMeta}
          phase={phase}
          contractRef={`CID-${contractId}`}
          inspectionDate={doc.reportGeneratedDate ?? doc.inspectionDate ?? null}
          moveInDate={doc.moveInDate ?? dates.moveInDate ?? null}
          moveOutDate={(doc.moveOutDate as string | undefined) ?? dates.moveOutDate ?? null}
          onDownload={() => void handleDownloadPdf(false)}
          downloading={downloading}
          onClose={closePreview}
        />
      )}
    </OsPage>
  );
}

/** Preview = the finished report exactly as the CUSTOMER reads it — the same
 *  canvas-rasterised document their portal page renders, in a full-page sheet
 *  (the customer reads it as a page of its own, `max-w-3xl px-4`, so the canvas
 *  scales to exactly the width theirs does). Shown to the landlord, a delegated
 *  manager and the magic-link inspector alike. Money stays off: this is the
 *  customer's copy — the RP's own copy, with restoration costs, is what Download
 *  produces. */
function InspectionPreviewOverlay({
  doc, meta, phase, contractRef, inspectionDate, moveInDate, moveOutDate, onDownload, downloading, onClose,
}: {
  doc: InspectionDoc; meta: ReportMeta; phase: Phase; contractRef: string;
  inspectionDate: string | null; moveInDate: string | null; moveOutDate: string | null;
  onDownload: () => void; downloading: boolean; onClose: () => void;
}) {
  // Browser Back closes the preview instead of navigating off the workspace.
  const dismiss = useBackClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Inspection preview"
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--ms-surface-2)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--ms-surface)', borderBottom: '1px solid var(--ms-border)' }}>
        <div style={{ maxWidth: 768, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="gx-eyebrow">Preview</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {phase === 'move_out' ? 'Move-out' : 'Move-in'} inspection — {contractRef}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Exactly what the customer sees</div>
          </div>
          <Btn onClick={dismiss}><ArrowLeft size={13} aria-hidden /> Back to workspace</Btn>
          <Btn onClick={onDownload} disabled={downloading}>
            {downloading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />} Download PDF
          </Btn>
        </div>
      </div>
      <div style={{ maxWidth: 768, margin: '0 auto', padding: '32px 16px' }}>
        <InspectionInline
          doc={doc}
          meta={meta}
          phase={phase}
          contractRef={contractRef}
          inspectionDate={inspectionDate}
          moveInDate={moveInDate}
          moveOutDate={moveOutDate}
        />
      </div>
    </div>
  );
}

/* ─── Restoration-list pickers ─────────────────────────────────────────────
 * The move-out inspection starts from the move-in report (or blank). These two
 * modals let the RP/manager add categories & sub-category/components one by one
 * from the standard restoration catalog (or a custom one). Both stay open so
 * several can be added; "Done" closes. */

function PickerModal({ open = true, title, subtitle, onClose, children }: {
  open?: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title={<>{title}{subtitle && <span style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--ms-ink-3)', marginTop: 2 }}>{subtitle}</span>}</>}
      footer={<><span className="sp" /><Btn variant="primary" onClick={onClose}>Done</Btn></>}
    >
      {children}
    </Modal>
  );
}

const pickBtn = (done: boolean): CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left',
  padding: '8px 11px', borderRadius: 8, fontSize: 12.5, cursor: done ? 'default' : 'pointer',
  border: `1px solid ${done ? 'var(--ms-primary-lighter)' : 'var(--ms-border-strong)'}`,
  background: done ? 'var(--ms-tint-pale)' : 'var(--ms-surface)',
});

/** Pick a category to add. Standard categories already in the report are hidden;
 *  a custom category is always available. Stays open so several can be added. */
function AddCategoryPicker({ open, existingKeys, onAdd, onClose }: {
  open: boolean;
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
    <PickerModal open={open} title="Add category" subtitle="From the restoration list, or a custom one" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 7, marginBottom: 14 }}>
        {available.map((c) => {
          const done = added.has(c.key);
          return (
            <button key={c.key} type="button" disabled={done} style={pickBtn(done)}
              onClick={() => { onAdd({ key: c.key, label: c.label, unitLabel: c.unitLabel, subCategories: c.subCategories }); setAdded((s) => new Set(s).add(c.key)); }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
              {done ? <Pill tone="primary">Added</Pill> : <span className="gx-btn xs" aria-hidden>Add</span>}
            </button>
          );
        })}
        {available.length === 0 && <p style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--ms-ink-3)' }}>All standard categories are already in the report — add a custom one below.</p>}
      </div>
      <div className="gx-lb">Custom category</div>
      <div className="gx-btn-row" style={{ flexWrap: 'nowrap' }}>
        <input className="gx-inp" style={{ flex: 1, minWidth: 0 }} value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
          placeholder="Custom category name…" aria-label="Custom category name" />
        <Btn onClick={addCustom} disabled={!custom.trim()}><Plus size={13} aria-hidden /> Add category</Btn>
      </div>
    </PickerModal>
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
    <PickerModal title={`Add to ${cat.label || 'category'}`} subtitle="From the restoration list, or a custom component" onClose={onClose}>
      <div style={{ display: 'grid', gap: 6, marginBottom: 14, maxHeight: '46vh', overflowY: 'auto' }}>
        {rows.map((row) => {
          const rowKey = `${row.name}|${row.subCategory ?? ''}`;
          // React key includes the variant so two variants of one component
          // (same name+sub) don't collide; `rowKey` drives the added/used dedup.
          const reactKey = `${rowKey}|${row.variantLabel ?? ''}`;
          const done = added.has(rowKey) || usedNames.has(rowKey);
          const p = price(row);
          return (
            <button key={reactKey} type="button" disabled={done} style={pickBtn(done)}
              onClick={() => { onAdd(row.name, row); setAdded((s) => new Set(s).add(rowKey)); }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ color: 'var(--ms-ink)' }}>{row.name}</span>
                {row.subCategory && <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}> · {row.subCategory}</span>}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {p != null && <span style={{ fontSize: 11.5, color: 'var(--ms-ink-2)', fontVariantNumeric: 'tabular-nums' }}>AED {AED(p)}/{row.unitOfMeasure}</span>}
                {done ? <Pill tone="primary">Added</Pill> : <span className="gx-btn xs" aria-hidden>Add</span>}
              </span>
            </button>
          );
        })}
        {rows.length === 0 && <p style={{ fontSize: 12, color: 'var(--ms-ink-3)' }}>No standard components for this category — add a custom one below.</p>}
      </div>
      <div className="gx-lb">Custom component</div>
      <div className="gx-btn-row" style={{ flexWrap: 'nowrap' }}>
        <input className="gx-inp" style={{ flex: 1, minWidth: 0 }} value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
          placeholder="Custom component name…" aria-label="Custom component name" />
        <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>AED</span>
        <input className="gx-inp" type="number" min={0} step={0.01} value={customPrice} aria-label="Custom component price (AED)"
          onChange={(e) => setCustomPrice(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
          placeholder="Price" style={{ width: 90, textAlign: 'right' }} />
        <Btn onClick={addCustom} disabled={!custom.trim() || priceInvalid}><Plus size={13} aria-hidden /> Add component</Btn>
      </div>
      <div className="gx-hint" style={{ marginTop: 6 }}>
        {priceInvalid ? <span style={{ color: 'var(--ms-danger)' }}>Enter a valid price (0 or more).</span>
          : 'Set a price so the rate is saved with the report. Leave blank to add without a rate.'}
      </div>
    </PickerModal>
  );
}
