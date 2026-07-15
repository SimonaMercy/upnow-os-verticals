/**
 * Customer — Unified Document Hub (dashboard/customer/documents)
 *
 * CID-328-FE: Central upload hub for ALL tenant documents.
 *
 * Section A — Identity & KYC (always shown):
 *   Emirates ID, Passport, UAE Visa, Employment Letter
 *
 * Section B — Rental Application Documents (shown when tenant has an active
 *   lead or tenancy, dynamically typed by unit category):
 *   Residential → bank statement
 *   Commercial  → trade licence + financial docs
 *   Industrial  → trade + business licences + financial docs
 *
 * Section C — Additional Documents (always shown):
 *   Free-form attachments; also surfaces any landlord-requested docs
 *   (status=pending) that don't belong to Section A or B.
 *
 * Upload flow (2-step presigned S3):
 *   1. POST /documents/upload-url  → { uploadUrl, fileUrl, fileKey }
 *   2. PUT <uploadUrl> with file bytes
 *   3. POST /documents (or PATCH /documents/:id for re-upload)
 */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  UploadCloud, CheckCircle2, AlertTriangle, ExternalLink, Loader2,
  Clock, X, ShieldCheck, Home, Paperclip, ChevronRight, CheckCircle, Zap,
} from 'lucide-react';
import { openDocViewer } from '@/lib/docViewer';
import { useAuth } from '@/contexts/AuthContext';
import {
  KYC_DOCS, KYC_DOC_KEYS, getRentalSectionDocs,
  COMMERCIAL_TYPES, INDUSTRIAL_TYPES, docNeedsExpiry,
} from '@/lib/docRequirements';
import type { DocReq } from '@/lib/docRequirements';
import { DocExpiryField } from '@/components/upnow/DocExpiryField';

// yyyy-mm-dd for a native date input, tolerant of full ISO timestamps.
const toDateInput = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

// ─── Types ────────────────────────────────────────────────────────────────────

interface MyDoc {
  id: number;
  documentKey: string;
  category: string;
  fileUrl?: string;
  status?: string;
  displayName?: string | null;
  notes?: string | null;
  documentNumber?: string | null;
  expiryDate?: string | null;
}

const UTILITY_KEY = 'utility_proof_of_payment';

interface ViewingUnit {
  unitType?: string | null;
}

interface ViewingItem {
  status: string;
  outcome?: string | null;
  unit: ViewingUnit | null;
  lead?: { id: number; stage: string } | null;
}

interface DirectLeadItem {
  id: number;
  stage: string;
  unit: { unitType?: string | null } | null;
}


// ─── DocRow ───────────────────────────────────────────────────────────────────

function DocRow({
  req,
  docRecord,
  uploading,
  onUpload,
  onSaveExpiry,
}: {
  req: DocReq;
  docRecord: MyDoc | undefined;
  uploading: boolean;
  onUpload: (req: DocReq, file: File, existingId?: number, expiryDate?: string | null) => void;
  onSaveExpiry: (docId: number, expiryDate: string) => Promise<void>;
}) {
  const uploaded   = !!docRecord && docRecord.status !== 'pending';
  const isRejected = docRecord?.status === 'rejected';
  const isApproved = docRecord?.status === 'complete' || docRecord?.status === 'processed';
  const isPending  = uploaded && !isRejected && !isApproved;
  const needsUpload = !uploaded || isRejected;
  // Identity / licence docs carry an expiry the customer records here.
  const needsExpiry = docNeedsExpiry(req.key);
  const [expiry, setExpiry] = useState(toDateInput(docRecord?.expiryDate));
  const [savingExpiry, setSavingExpiry] = useState(false);
  // Hold a file picked before its expiry is entered so the upload can't go out
  // without the date (identity / licence docs).
  const [staged, setStaged] = useState<File | null>(null);
  const onExpiryChange = async (v: string) => {
    setExpiry(v);
    if (docRecord?.id != null) { setSavingExpiry(true); try { await onSaveExpiry(docRecord.id, v); } finally { setSavingExpiry(false); } }
  };
  const onPick = (f: File) => {
    if (!needsExpiry || expiry) { onUpload(req, f, docRecord?.id, needsExpiry ? (expiry || null) : undefined); return; }
    setStaged(f);
  };

  return (
    <div className={[
      'rounded-xl px-4 py-3 flex items-start gap-3',
      isRejected   ? 'bg-[#fff1f2] border-l-4 border-l-[#ef4444] border border-[#fecaca]'
      : needsUpload && req.required ? 'bg-[#fffbeb] border-l-4 border-l-[#f59e0b] border border-[#fde68a]'
      : isPending  ? 'bg-[#eff6ff] border border-[#bfdbfe]'
      : isApproved ? 'bg-[#f0faf6] border border-[#bbf7d0]'
      : 'bg-[#f9f8f6] border border-[#e8e6e0] opacity-75',
    ].join(' ')}>

      {/* Status icon */}
      <div className="mt-0.5 shrink-0">
        {isRejected   && <div className="w-6 h-6 rounded-full bg-[#fee2e2] flex items-center justify-center"><AlertTriangle size={12} className="text-[#ef4444]" /></div>}
        {isApproved   && <div className="w-6 h-6 rounded-full bg-[#dcfce7] flex items-center justify-center"><CheckCircle2 size={13} className="text-[#16a34a]" /></div>}
        {isPending    && <div className="w-6 h-6 rounded-full bg-[#dbeafe] flex items-center justify-center"><Clock size={12} className="text-[#2563eb]" /></div>}
        {!uploaded && req.required  && <div className="w-6 h-6 rounded-full bg-[#fef3c7] flex items-center justify-center"><UploadCloud size={12} className="text-[#d97706]" /></div>}
        {!uploaded && !req.required && <div className="w-6 h-6 rounded-full bg-[#f4f3ef] flex items-center justify-center"><UploadCloud size={12} className="text-[#c5c3bc]" /></div>}
      </div>

      {/* Label + status text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-sm font-semibold ${isRejected ? 'text-[#991b1b]' : needsUpload && req.required ? 'text-[#92400e]' : isApproved ? 'text-[#166534]' : 'text-[#1a1916]'}`}>
            {req.label}
          </p>
          {!uploaded && req.required  && <span className="text-[10px] font-bold uppercase tracking-wide text-[#d97706] bg-[#fef3c7] px-1.5 py-0.5 rounded">Required</span>}
          {!uploaded && !req.required && <span className="text-[10px] text-[#9b9890]">Optional</span>}
        </div>
        {isRejected && (
          <p className="text-xs text-[#ef4444] font-medium mt-0.5">
            Rejected — re-upload required
            {docRecord?.notes && <span className="font-normal text-[#6b6860]"> · {docRecord.notes}</span>}
          </p>
        )}
        {isPending  && <p className="text-xs text-[#6b6860] mt-0.5">Uploaded · awaiting review</p>}
        {isApproved && <p className="text-xs text-[#16a34a] font-medium mt-0.5">Approved ✓</p>}
        {needsUpload && !isRejected && req.hint && <p className="text-xs text-[#9b9890] mt-0.5">{req.hint}</p>}
        {needsExpiry && staged ? (
          <div className="mt-2 rounded-lg bg-[#fffbeb] border border-[#fde68a] p-2.5">
            <p className="text-xs font-semibold text-[#92400e]">“{staged.name}” selected — enter the document’s expiry date to finish uploading.</p>
            <DocExpiryField value={expiry} onChange={setExpiry} className="mt-1.5" />
            <div className="flex items-center gap-2 mt-2">
              <button type="button" disabled={!expiry || uploading}
                onClick={() => { onUpload(req, staged, docRecord?.id, expiry || null); setStaged(null); }}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white ${expiry ? 'bg-[#2e9f82] hover:bg-[#267a65] cursor-pointer' : 'bg-[#c5c3bc] cursor-not-allowed'} disabled:opacity-60`}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />} Upload document
              </button>
              <button type="button" onClick={() => setStaged(null)} className="text-xs font-medium text-[#6b6860] hover:underline cursor-pointer">Cancel</button>
            </div>
          </div>
        ) : needsExpiry ? (
          <DocExpiryField value={expiry} onChange={onExpiryChange} saving={savingExpiry} className="mt-1.5" />
        ) : null}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        {uploaded && docRecord?.fileUrl && !isRejected && (
          <button type="button"
            onClick={() => openDocViewer({ fileUrl: docRecord.fileUrl, caption: req.label })}
            className="flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline cursor-pointer">
            <ExternalLink size={12} /> View
          </button>
        )}
        <label className={[
          'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer text-white transition-opacity',
          uploading ? 'opacity-50 pointer-events-none' : '',
          isRejected ? 'bg-[#ef4444] hover:bg-[#dc2626]'
            : needsUpload && req.required ? 'bg-[#f59e0b] hover:bg-[#d97706]'
            : 'bg-[#9b9890] hover:bg-[#6b6860]',
        ].join(' ')}>
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
          {isRejected ? 'Re-upload' : uploaded ? 'Replace' : 'Upload'}
          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = '';
            }} />
        </label>
      </div>
    </div>
  );
}

// ─── SectionCard ──────────────────────────────────────────────────────────────

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  badge,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-3 border-b border-[#f4f3ef] bg-[#fafaf8]">
        <div className="w-8 h-8 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0">
          <Icon size={16} className="text-[#2e9f82]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#1a1916]">{title}</p>
          <p className="text-xs text-[#9b9890] mt-0.5">{subtitle}</p>
        </div>
        {badge}
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CustomerDocumentsPage() {
  const { user } = useAuth();
  const [docs, setDocs]                   = useState<MyDoc[] | null>(null);
  const [tenantProfileId, setTenantPId]   = useState<number | null>(null);
  const [loading, setLoading]             = useState(true);
  const [activeUnitType, setActiveUnitType] = useState<string | null | undefined>(undefined);
  const [hasEjariRegistered, setHasEjariRegistered] = useState(false);


  // Utility section
  const [utilityAccountNum, setDewaAccountNum]     = useState('');
  const [utilityDocId, setDewaDocId]               = useState<number | null>(null);
  const [utilityDocUrl, setDewaDocUrl]             = useState<string | null>(null);
  const [utilityUploading, setDewaUploading]       = useState(false);
  const [utilityAccountSaving, setDewaAccountSaving] = useState(false);
  const [utilityAccountSaved, setDewaAccountSaved] = useState(false);
  const [utilityError, setDewaError]               = useState<string | null>(null);

  // Per-key upload tracking
  const [docUploading, setDocUploading]   = useState<string | null>(null);
  const [uploadError, setUploadError]     = useState<string | null>(null);

  // Free-form (Section C) attach state
  const [showAttach, setShowAttach]       = useState(false);
  const [attachLabel, setAttachLabel]     = useState('');
  const [attachFile, setAttachFile]       = useState<File | null>(null);
  const [attaching, setAttaching]         = useState(false);
  const [attachError, setAttachError]     = useState<string | null>(null);
  const attachInputRef                    = useRef<HTMLInputElement>(null);

  const reloadDocs = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/documents/my', { credentials: 'include' }).then(r => r.ok ? r.json() : Promise.reject()),
      Promise.all([
        fetch('/api/leads/my-viewings',     { credentials: 'include' }).then(r => r.ok ? r.json() : []),
        fetch('/api/leads/my-applications', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      ]),
      fetch('/api/contracts/tenant', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ])
      .then(([docsData, [viewingsRaw, applicationsRaw], contractsRaw]) => {
        const contracts: { ejariStatus?: string }[] = Array.isArray(contractsRaw) ? contractsRaw : [];
        setHasEjariRegistered(contracts.some(c => c.ejariStatus === 'registered'));
        setTenantPId(docsData.tenantProfileId ?? null);
        const allDocs: MyDoc[] = docsData.documents ?? [];
        setDocs(allDocs);

        const dewaDoc = allDocs.find((d: MyDoc) => d.documentKey === UTILITY_KEY);
        if (dewaDoc) {
          setDewaDocId(dewaDoc.id);
          setDewaDocUrl(dewaDoc.fileUrl ?? null);
          setDewaAccountNum(dewaDoc.documentNumber ?? '');
        }

        // Pick unit type from first active lead/viewing
        const viewings: ViewingItem[]   = Array.isArray(viewingsRaw) ? viewingsRaw : [];
        const leads: DirectLeadItem[]   = Array.isArray(applicationsRaw) ? applicationsRaw : [];

        const activeViewing = viewings.find(v =>
          !['cancelled'].includes(v.status) && v.outcome !== 'not_interested' && v.unit?.unitType,
        );
        const activeLead = leads.find(l => !['rejected'].includes(l.stage) && l.unit?.unitType);

        setActiveUnitType(
          activeViewing?.unit?.unitType ?? activeLead?.unit?.unitType ?? null,
        );
      })
      .catch(() => { setDocs([]); setActiveUnitType(null); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reloadDocs(); }, [reloadDocs]);

  // ── Utility: update account number only (proof already uploaded) ────────────

  async function saveUtilityAccountNum() {
    if (!utilityDocId) return;
    setDewaError(null);
    setDewaAccountSaving(true);
    try {
      await fetch(`/api/documents/${utilityDocId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentNumber: utilityAccountNum.trim() || null }),
      });
      setDewaAccountSaved(true);
      setTimeout(() => setDewaAccountSaved(false), 3000);
    } catch {
      setDewaError('Could not save account number. Please try again.');
    } finally {
      setDewaAccountSaving(false);
    }
  }

  // ── Utility: upload proof of payment ─────────────────────────────────────────

  async function handleUtilityUpload(file: File) {
    if (!tenantProfileId) return;
    setDewaError(null);
    setDewaUploading(true);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantProfileId,
          documentKey: UTILITY_KEY, originalName: file.name, mimeType: file.type,
        }),
      });
      if (!urlRes.ok) { setDewaError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };

      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
        catch { return uploadUrl; }
      })();

      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setDewaError('File upload failed'); return; }

      let docRes: Response;
      if (utilityDocId) {
        docRes = await fetch(`/api/documents/${utilityDocId}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey, documentNumber: utilityAccountNum.trim() || null }),
        });
      } else {
        docRes = await fetch('/api/documents', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerType: 'customer', ownerId: tenantProfileId,
            documentKey: UTILITY_KEY, category: 'payment',
            displayName: 'Utility Proof of Payment',
            fileUrl, mimeType: file.type, s3Key: fileKey,
            documentNumber: utilityAccountNum.trim() || null,
          }),
        });
      }
      if (!docRes.ok) {
        const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
        setDewaError(Array.isArray(b.message) ? b.message[0] : (b.message ?? 'Failed to save document'));
        return;
      }
      reloadDocs();
    } catch { setDewaError('Unexpected error during upload'); }
    finally { setDewaUploading(false); }
  }

  // ── Upload handler (required + landlord-requested docs) ───────────────────

  async function saveDocExpiry(docId: number, expiryDate: string) {
    await fetch(`/api/documents/${docId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiryDate: expiryDate || null }),
    });
    reloadDocs();
  }

  async function handleUpload(req: DocReq, file: File, existingDocId?: number, expiryDate?: string | null) {
    if (!tenantProfileId) return;
    setDocUploading(req.key);
    setUploadError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantProfileId,
          documentKey: req.key, originalName: file.name, mimeType: file.type,
        }),
      });
      if (!urlRes.ok) { setUploadError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };

      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
        catch { return uploadUrl; }
      })();

      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setUploadError('File upload failed'); return; }

      let docRes: Response;
      const expiryPatch = expiryDate !== undefined ? { expiryDate } : {};
      if (existingDocId) {
        docRes = await fetch(`/api/documents/${existingDocId}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey, ...expiryPatch }),
        });
      } else {
        docRes = await fetch('/api/documents', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerType: 'customer', ownerId: tenantProfileId,
            documentKey: req.key, category: req.category,
            displayName: req.label, fileUrl, mimeType: file.type, s3Key: fileKey, ...expiryPatch,
          }),
        });
      }
      if (!docRes.ok) {
        const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
        setUploadError(Array.isArray(b.message) ? b.message[0] : (b.message ?? 'Failed to save'));
        return;
      }
      reloadDocs();
    } catch { setUploadError('Unexpected error during upload'); }
    finally { setDocUploading(null); }
  }

  // ── Free-form upload handler (Section C) ──────────────────────────────────

  async function handleFreeUpload() {
    if (!attachFile || !tenantProfileId) return;
    setAttaching(true);
    setAttachError(null);
    const docKey = `tenant_doc_${Date.now()}`;
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantProfileId,
          documentKey: docKey, mimeType: attachFile.type || 'application/octet-stream',
          originalName: attachFile.name,
        }),
      });
      if (!urlRes.ok) { setAttachError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };

      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
        catch { return uploadUrl; }
      })();

      const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': attachFile.type || 'application/octet-stream' }, body: attachFile });
      if (!putRes.ok) { setAttachError('File upload failed'); return; }

      const docRes = await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer', ownerId: tenantProfileId,
          category: 'identity', documentKey: docKey,
          displayName: attachLabel.trim() || attachFile.name,
          fileUrl, mimeType: attachFile.type || 'application/octet-stream',
          isVisibleToTenant: true,
        }),
      });
      if (!docRes.ok) { setAttachError('Failed to record document'); return; }

      setAttachFile(null);
      setAttachLabel('');
      setShowAttach(false);
      if (attachInputRef.current) attachInputRef.current.value = '';
      reloadDocs();
    } catch { setAttachError('Unexpected error'); }
    finally { setAttaching(false); }
  }

  // ── Derived data ─────────────────────────────────────────────────────────

  const uploadedByKey = new Map((docs ?? []).filter(d => d.status !== 'pending').map(d => [d.documentKey, d]));
  const pendingByKey  = new Map((docs ?? []).filter(d => d.status === 'pending').map(d => [d.documentKey, d]));

  const rentalDocs    = activeUnitType !== undefined ? getRentalSectionDocs(activeUnitType) : [];
  const hasRentalSection = activeUnitType !== null && activeUnitType !== undefined;

  // Keys owned by Section A + B + D; everything else goes to Section C
  const ownedKeys = new Set([...KYC_DOCS.map(d => d.key), ...rentalDocs.map(d => d.key), UTILITY_KEY]);
  const extraDocs = (docs ?? []).filter(d => !ownedKeys.has(d.documentKey));

  // Summary counts for stat strip
  const kycUploaded    = KYC_DOCS.filter(d => d.required && uploadedByKey.has(d.key) && uploadedByKey.get(d.key)?.status !== 'rejected').length;
  const kycRequired    = KYC_DOCS.filter(d => d.required).length;
  const rentalUploaded = rentalDocs.filter(d => d.required && uploadedByKey.has(d.key) && uploadedByKey.get(d.key)?.status !== 'rejected').length;
  const rentalRequired = rentalDocs.filter(d => d.required).length;
  const extraCount     = extraDocs.filter(d => d.status !== 'pending').length;

  const anyRejected    = (docs ?? []).some(d => d.status === 'rejected');
  const anyPending     = (docs ?? []).some(d => d.status === 'pending' && !ownedKeys.has(d.documentKey));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">My Documents</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">
            Manage your identity and rental application documents.
          </p>
        </div>
        {anyRejected && (
          <span className="shrink-0 mt-1 text-xs font-bold px-3 py-1.5 rounded-full bg-[#fee2e2] text-[#b91c1c]">
            Action needed
          </span>
        )}
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-[#e8e6e0] rounded-2xl px-4 py-3.5">
          <p className="text-xs text-[#6b6860]">KYC Documents</p>
          <p className={`text-2xl font-bold mt-0.5 ${kycUploaded < kycRequired ? 'text-[#d97706]' : 'text-[#2e9f82]'}`}>
            {loading ? '…' : `${kycUploaded}/${kycRequired}`}
          </p>
        </div>
        <div className="bg-white border border-[#e8e6e0] rounded-2xl px-4 py-3.5">
          <p className="text-xs text-[#6b6860]">Rental Documents</p>
          <p className={`text-2xl font-bold mt-0.5 ${!hasRentalSection ? 'text-[#c0bdb8]' : rentalUploaded < rentalRequired ? 'text-[#d97706]' : 'text-[#2e9f82]'}`}>
            {loading ? '…' : !hasRentalSection ? '—' : `${rentalUploaded}/${rentalRequired}`}
          </p>
        </div>
        <div className="bg-white border border-[#e8e6e0] rounded-2xl px-4 py-3.5">
          <p className="text-xs text-[#6b6860]">Additional</p>
          <p className="text-2xl font-bold mt-0.5 text-[#1a1916]">
            {loading ? '…' : extraCount}
          </p>
        </div>
      </div>

      {uploadError && (
        <div className="rounded-xl p-3 text-sm bg-[#fff1f2] border border-[#fecaca] text-[#b91c1c]">
          {uploadError}
        </div>
      )}

      {/* ── Section A: Identity & KYC ─────────────────────────────────────── */}
      <SectionCard
        icon={ShieldCheck}
        title="Identity & KYC"
        subtitle="Required for all customers regardless of property type"
        badge={
          loading ? <Loader2 size={14} className="animate-spin text-[#9b9890]" /> :
          kycUploaded === kycRequired
            ? <span className="text-xs font-semibold text-[#16a34a] bg-[#dcfce7] px-2.5 py-1 rounded-full">Complete ✓</span>
            : <span className="text-xs font-semibold text-[#92400e] bg-[#fef3c7] px-2.5 py-1 rounded-full">{kycUploaded}/{kycRequired} uploaded</span>
        }
      >
        {loading ? (
          <p className="text-sm text-[#9b9890] text-center py-4">Loading…</p>
        ) : (
          KYC_DOCS.map(req => {
            const docRecord = uploadedByKey.get(req.key) ?? pendingByKey.get(req.key);
            return (
              <DocRow
                key={req.key}
                req={req}
                docRecord={docRecord}
                uploading={docUploading === req.key}
                onUpload={handleUpload}
                onSaveExpiry={saveDocExpiry}
              />
            );
          })
        )}
      </SectionCard>

      {/* ── Section B: Rental Application Documents (conditional) ────────── */}
      {!loading && hasRentalSection && rentalDocs.length > 0 && (
        <SectionCard
          icon={Home}
          title="Rental Application Documents"
          subtitle={`Required for your current ${COMMERCIAL_TYPES.includes(activeUnitType ?? '') ? 'commercial' : INDUSTRIAL_TYPES.includes(activeUnitType ?? '') ? 'industrial' : 'residential'} rental application`}
          badge={
            rentalUploaded === rentalRequired
              ? <span className="text-xs font-semibold text-[#16a34a] bg-[#dcfce7] px-2.5 py-1 rounded-full">Complete ✓</span>
              : <span className="text-xs font-semibold text-[#92400e] bg-[#fef3c7] px-2.5 py-1 rounded-full">{rentalUploaded}/{rentalRequired} uploaded</span>
          }
        >
          {rentalDocs.map(req => {
            const docRecord = uploadedByKey.get(req.key) ?? pendingByKey.get(req.key);
            return (
              <DocRow
                key={req.key}
                req={req}
                docRecord={docRecord}
                uploading={docUploading === req.key}
                onUpload={handleUpload}
                onSaveExpiry={saveDocExpiry}
              />
            );
          })}
        </SectionCard>
      )}

      {/* ── Section D: Utility Setup — only after Ejari is registered ───────── */}
      {hasEjariRegistered && <SectionCard
        icon={Zap}
        title="Utility Setup"
        subtitle="Required after Contract Registration — provide your utility account number and proof of payment"
        badge={
          utilityDocId && utilityAccountNum
            ? <span className="text-xs font-semibold text-[#16a34a] bg-[#dcfce7] px-2.5 py-1 rounded-full">Submitted ✓</span>
            : utilityDocId
            ? <span className="text-xs font-semibold text-[#92400e] bg-[#fef3c7] px-2.5 py-1 rounded-full">Account no. missing</span>
            : undefined
        }
      >
        {/* Utility account number */}
        <div className="rounded-xl px-4 py-4 bg-[#f9f8f6] border border-[#e8e6e0] space-y-3">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-[#2e9f82] shrink-0" />
            <p className="text-sm font-semibold text-[#1a1916]">Utility Account Number</p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={utilityAccountNum}
              onChange={e => setDewaAccountNum(e.target.value)}
              placeholder="e.g. 1234567890"
              className="flex-1 border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm font-mono text-[#1a1916] bg-white focus:outline-none focus:border-[#2e9f82] transition-colors"
            />
            {utilityDocId && (
              <button
                type="button"
                onClick={saveUtilityAccountNum}
                disabled={utilityAccountSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors shrink-0"
              >
                {utilityAccountSaving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          {utilityAccountSaved && (
            <p className="text-xs text-[#2e9f82] flex items-center gap-1">
              <CheckCircle size={12} /> Account number saved.
            </p>
          )}
          {!utilityDocId && (
            <p className="text-[11px] text-[#9b9890]">Upload the proof of payment below — account number will be saved together.</p>
          )}
        </div>

        {/* Proof of payment upload */}
        <div className={[
          'rounded-xl px-4 py-3 flex items-start gap-3',
          utilityDocId ? 'bg-[#eff6ff] border border-[#bfdbfe]' : 'bg-[#fffbeb] border-l-4 border-l-[#f59e0b] border border-[#fde68a]',
        ].join(' ')}>
          <div className="mt-0.5 shrink-0">
            {utilityDocId
              ? <div className="w-6 h-6 rounded-full bg-[#dbeafe] flex items-center justify-center"><Clock size={12} className="text-[#2563eb]" /></div>
              : <div className="w-6 h-6 rounded-full bg-[#fef3c7] flex items-center justify-center"><UploadCloud size={12} className="text-[#d97706]" /></div>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={`text-sm font-semibold ${utilityDocId ? 'text-[#1a1916]' : 'text-[#92400e]'}`}>Proof of Payment</p>
              {!utilityDocId && <span className="text-[10px] font-bold uppercase tracking-wide text-[#d97706] bg-[#fef3c7] px-1.5 py-0.5 rounded">Required</span>}
            </div>
            {utilityDocId
              ? <p className="text-xs text-[#6b6860] mt-0.5">Uploaded · awaiting review</p>
              : <p className="text-xs text-[#9b9890] mt-0.5">Utility connection letter or latest payment receipt (PDF or image)</p>
            }
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            {utilityDocId && utilityDocUrl && (
              <button type="button"
                onClick={() => openDocViewer({ fileUrl: utilityDocUrl, caption: 'Proof of Payment' })}
                className="flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline cursor-pointer">
                <ExternalLink size={12} /> View
              </button>
            )}
            <label className={[
              'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer text-white transition-opacity',
              utilityUploading ? 'opacity-50 pointer-events-none' : '',
              utilityDocId ? 'bg-[#9b9890] hover:bg-[#6b6860]' : 'bg-[#f59e0b] hover:bg-[#d97706]',
            ].join(' ')}>
              {utilityUploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
              {utilityDocId ? 'Replace' : 'Upload'}
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUtilityUpload(f); e.target.value = ''; }} />
            </label>
          </div>
        </div>

        {utilityError && (
          <p className="text-xs text-[#dc2626] bg-[#fef2f2] rounded-lg px-3 py-2">{utilityError}</p>
        )}
      </SectionCard>}

      {/* ── Section C: Additional Documents ──────────────────────────────── */}
      <SectionCard
        icon={Paperclip}
        title="Additional Documents"
        subtitle="Attach any other documents for your landlord or record-keeping"
        badge={
          anyPending
            ? <span className="text-xs font-semibold text-[#f97316] bg-[#fff7ed] px-2.5 py-1 rounded-full">Requested</span>
            : extraCount > 0
            ? <span className="text-xs text-[#6b6860]">{extraCount} file{extraCount !== 1 ? 's' : ''}</span>
            : undefined
        }
      >
        {/* Landlord-requested docs with no file yet */}
        {(docs ?? []).filter(d => d.status === 'pending' && !ownedKeys.has(d.documentKey)).map(doc => {
          const label = doc.displayName ?? doc.documentKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const fakeReq: DocReq = { key: doc.documentKey, label, category: 'contract', required: true };
          return (
            <div key={doc.id}
              className="rounded-xl px-4 py-3 flex items-start gap-3 bg-[#fff7ed] border-l-4 border-l-[#f97316] border border-[#fed7aa]">
              <div className="mt-0.5 shrink-0">
                <div className="w-6 h-6 rounded-full bg-[#ffedd5] flex items-center justify-center"><UploadCloud size={12} className="text-[#f97316]" /></div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#9a3412]">{label}</p>
                <p className="text-xs font-semibold text-[#f97316] mt-0.5">Requested by landlord — upload required</p>
                {doc.notes && <p className="text-xs text-[#9b9890] mt-0.5">{doc.notes}</p>}
              </div>
              <label className={[
                'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer text-white bg-[#f97316] hover:bg-[#ea6b00] transition-opacity mt-0.5',
                docUploading === doc.documentKey ? 'opacity-50 pointer-events-none' : '',
              ].join(' ')}>
                {docUploading === doc.documentKey ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                Upload
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(fakeReq, f, doc.id); e.target.value = ''; }} />
              </label>
            </div>
          );
        })}

        {/* Already-uploaded extra docs */}
        {extraDocs.filter(d => d.status !== 'pending').map(doc => {
          const isRejected = doc.status === 'rejected';
          const isApproved = doc.status === 'processed' || doc.status === 'complete';
          const isPending  = !isRejected && !isApproved;
          const label = doc.displayName ?? doc.documentKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const fakeReq: DocReq = { key: doc.documentKey, label, category: 'identity', required: false };
          return (
            <div key={doc.id}
              className={[
                'rounded-xl px-4 py-3 flex items-start gap-3',
                isRejected ? 'bg-[#fff1f2] border-l-4 border-l-[#ef4444] border border-[#fecaca]'
                : isApproved ? 'bg-[#f0faf6] border border-[#bbf7d0]'
                : 'bg-[#eff6ff] border border-[#bfdbfe]',
              ].join(' ')}>
              <div className="mt-0.5 shrink-0">
                {isRejected && <div className="w-6 h-6 rounded-full bg-[#fee2e2] flex items-center justify-center"><AlertTriangle size={12} className="text-[#ef4444]" /></div>}
                {isApproved && <div className="w-6 h-6 rounded-full bg-[#dcfce7] flex items-center justify-center"><CheckCircle2 size={13} className="text-[#16a34a]" /></div>}
                {isPending  && <div className="w-6 h-6 rounded-full bg-[#dbeafe] flex items-center justify-center"><Clock size={12} className="text-[#2563eb]" /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-semibold ${isRejected ? 'text-[#991b1b]' : isApproved ? 'text-[#166534]' : 'text-[#1a1916]'}`}>{label}</p>
                  <span className="text-[10px] text-[#9b9890]">Additional</span>
                </div>
                {isRejected && <p className="text-xs text-[#ef4444] font-medium mt-0.5">Rejected — re-upload required{doc.notes && <span className="font-normal text-[#6b6860]"> · {doc.notes}</span>}</p>}
                {isPending  && <p className="text-xs text-[#6b6860] mt-0.5">Uploaded · awaiting review</p>}
                {isApproved && <p className="text-xs text-[#16a34a] font-medium mt-0.5">Approved ✓</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                {doc.fileUrl && !isRejected && (
                  <button type="button"
                    onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: label })}
                    className="flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline cursor-pointer">
                    <ExternalLink size={12} /> View
                  </button>
                )}
                <label className={[
                  'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer text-white transition-opacity',
                  docUploading === doc.documentKey ? 'opacity-50 pointer-events-none' : '',
                  isRejected ? 'bg-[#ef4444] hover:bg-[#dc2626]' : 'bg-[#9b9890] hover:bg-[#6b6860]',
                ].join(' ')}>
                  {docUploading === doc.documentKey ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                  {isRejected ? 'Re-upload' : 'Replace'}
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(fakeReq, f, doc.id); e.target.value = ''; }} />
                </label>
              </div>
            </div>
          );
        })}

        {/* Empty state when no extra docs yet */}
        {!loading && extraDocs.length === 0 && (docs ?? []).filter(d => d.status === 'pending' && !ownedKeys.has(d.documentKey)).length === 0 && (
          <p className="text-sm text-[#b0ada8] text-center py-3">No additional documents yet.</p>
        )}

        {/* Attach form */}
        <div className="pt-2 border-t border-[#f4f3ef]">
          {!showAttach ? (
            <button
              onClick={() => setShowAttach(true)}
              className="flex items-center gap-2 text-sm font-semibold text-[#2e9f82] hover:opacity-75 transition-opacity">
              <UploadCloud size={14} /> Attach a document
            </button>
          ) : (
            <div className="space-y-3 bg-[#f7f6f2] rounded-xl px-4 py-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-[#1a1916] uppercase tracking-wide">Attach document</p>
                <button
                  onClick={() => { setShowAttach(false); setAttachFile(null); setAttachLabel(''); setAttachError(null); }}
                  className="text-[#9b9890] hover:text-[#1a1916]">
                  <X size={15} />
                </button>
              </div>
              <input
                type="text"
                value={attachLabel}
                onChange={e => setAttachLabel(e.target.value)}
                placeholder="Document name (e.g. Utility Bill)"
                className="w-full text-sm px-3 py-2.5 border border-[#e8e6e0] rounded-xl bg-white focus:border-[#2e9f82] focus:outline-none"
              />
              <input
                ref={attachInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={e => setAttachFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-[#6b6860] file:mr-3 file:text-xs file:font-semibold file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-[#f0faf6] file:text-[#2e9f82] hover:file:bg-[#e0f5ee] cursor-pointer"
              />
              {attachError && <p className="text-xs text-red-600">{attachError}</p>}
              <button
                onClick={handleFreeUpload}
                disabled={!attachFile || attaching}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
                style={{ background: '#2e9f82' }}>
                {attaching ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                {attaching ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Back to spaces */}
      <div className="pb-4">
        <a
          href="/dashboard/customer/spaces"
          className="inline-flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#2e9f82] transition-colors">
          <ChevronRight size={14} className="rotate-180" /> Back to My Spaces
        </a>
      </div>

    </div>
  );
}
