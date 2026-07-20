'use client';

/**
 * RP move-in / move-out inspection workspace — the editable surface of the shared
 * InspectionReportView (design spec §6). Save draft / Submit to tenant (locks) /
 * Reopen to edit. The category-report layout itself lives in InspectionReportView,
 * shared read-only with the tenant page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, CheckCircle, Send, RotateCcw, Lock } from 'lucide-react';
import {
  InspectionDoc, InspectionItem, computeRowTotal,
} from '@/lib/inspectionCatalog';
import { uploadInspectionItemPhoto } from '@/lib/inspectionPhotos';
import { InspectionReportView, type ReportMeta } from '@/components/contract/InspectionReportView';

type Phase = 'move_in' | 'move_out';

interface ContractMeta {
  property: string; unitNo: string; propertyType: string; floor: string;
  tenantName: string; tenantPhone: string; tenantEmail: string;
}
interface Dates { inspectionDate?: string | null; moveInDate?: string | null; moveOutDate?: string | null; }

export default function CategoryInspectionPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const phase = (search.get('type') ?? 'move_in') as Phase;
  const contractId = params?.id;

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
  const docRef = useRef<InspectionDoc | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const locked = !!submittedAt;

  useEffect(() => {
    if (!contractId) return;
    (async () => {
      setLoading(true);
      try {
        const [inspRes, cRes] = await Promise.all([
          fetch(`/api/contracts/${contractId}/inspection/v2?type=${phase}`, { credentials: 'include' }),
          fetch(`/api/contracts/${contractId}`, { credentials: 'include' }),
        ]);
        if (inspRes.ok) {
          const json = await inspRes.json();
          setDoc(json);
          setSubmittedAt((json?.rpSubmittedAt as string | undefined) ?? null);
        } else setError('Could not load the inspection.');
        if (cRes.ok) {
          const c = await cRes.json();
          setMeta({
            property: c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
            unitNo: c.unit?.number ?? c.unit?.unitNumber ?? '',
            propertyType: c.unit?.unitType ?? '',
            floor: c.unit?.floor != null ? String(c.unit.floor) : '',
            tenantName: c.tenant?.name ?? '',
            tenantPhone: c.tenant?.phone ?? '',
            tenantEmail: c.tenant?.email ?? '',
          });
          setDates({
            moveInDate: c.startDate ?? null,
            moveOutDate: c.termination?.effectiveDate ?? c.terminationEffectiveDate ?? c.endDate ?? null,
          });
        }
      } catch {
        setError('Unexpected error loading the inspection.');
      } finally {
        setLoading(false);
      }
    })();
  }, [contractId, phase]);

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

  const persistDoc = useCallback(async (docToSave: InspectionDoc): Promise<boolean> => {
    if (!contractId) return false;
    const res = await fetch(`/api/contracts/${contractId}/inspection`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: phase, data: docToSave, finalize: false }),
    });
    return res.ok;
  }, [contractId, phase]);

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
    const added = [];
    for (const f of files) { const r = await uploadInspectionItemPhoto(contractId, itemId, f); if (r) added.push(r); }
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
  }, [contractId, persistDoc]);

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
    if (!window.confirm('Submit this inspection to the tenant? They will be able to review and sign it, and the report is locked from editing.')) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection`, {
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

  async function handleReopen() {
    if (!contractId) return;
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

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9b9890]"><Loader2 className="animate-spin mr-2" /> Loading inspection…</div>;
  }

  const reportMeta: ReportMeta = {
    property: meta?.property ?? '', unitNo: meta?.unitNo ?? '', propertyType: meta?.propertyType ?? '', floor: meta?.floor ?? '',
    tenantName: meta?.tenantName ?? '', tenantPhone: meta?.tenantPhone ?? '', tenantEmail: meta?.tenantEmail ?? '',
    inspectorName: doc?.inspectorName ?? '', inspectorCompany: doc?.inspectorCompany ?? '', inspectorRole: doc?.inspectorRole ?? 'Property Representative',
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-24">
      {/* Action bar */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <Link href={`/rental-provider/dashboard/contracts/${contractId}/v2`} className="inline-flex items-center gap-1 text-sm text-[#9b9890] hover:text-[#1a1916]">
          <ArrowLeft size={15} /> Back to contract
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          {locked ? (
            <button type="button" onClick={handleReopen} disabled={reopening}
              className="inline-flex items-center gap-2 rounded-xl border border-[#e8e6e0] text-[#6b6860] text-sm font-semibold px-4 py-2.5 disabled:opacity-60 hover:border-[#c8c6be]">
              {reopening ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              {reopening ? 'Reopening…' : 'Reopen to edit'}
            </button>
          ) : (
            <>
              <button type="button" onClick={handleSave} disabled={saving || submitting}
                className="inline-flex items-center gap-2 rounded-xl border border-[#2e9f82] text-[#2e9f82] text-sm font-semibold px-4 py-2.5 disabled:opacity-60">
                {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <CheckCircle size={16} /> : <Save size={16} />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
              </button>
              <button type="button" onClick={handleSubmit} disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-60">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {submitting ? 'Submitting…' : 'Submit to tenant'}
              </button>
            </>
          )}
        </div>
      </div>

      {locked && (
        <div className="mb-4 rounded-lg bg-[#fef9ec] border border-[#f3e2b8] text-[#8a6d1a] text-sm px-3 py-2 flex items-center gap-2">
          <Lock size={14} className="shrink-0" />
          <span>Submitted to the tenant — the report is locked for editing. Choose <strong>Reopen to edit</strong> to make changes (only possible until the tenant signs).</span>
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
          editable={!locked}
          onPatch={patchItem}
          onAddItemPhotos={handleAddItemPhotos}
          onRemoveItemPhoto={handleRemoveItemPhoto}
          uploadingItemId={uploadingItemId}
          generalNotes={doc.generalNotes ?? ''}
          onGeneralNotes={setGeneralNotes}
        />
      )}
    </div>
  );
}
