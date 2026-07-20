'use client';

/**
 * RP → Customers → customer summary.
 * GET /api/contracts/tenants/:id → profile/KYC + financials + every lease the
 * customer holds with the RP + their KYC documents.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, User, FileText, ExternalLink, Mail, Phone, IdCard,
  Globe, Calendar, Building2, AlertTriangle, TrendingUp, ShieldCheck, Pencil, History,
  Upload, Check, Eye, Loader2, X, Landmark, StickyNote, Plus, Send, Users, Minus,
} from 'lucide-react';
import { CustomerForm } from '@/components/upnow/CustomerForm';
import { docLabel } from '@/lib/docLabel';
import { openDocViewer } from '@/lib/docViewer';
import { DocumentReaderModal, type ReaderSlot } from '@/components/upnow/DocumentReaderModal';
import { KycUploadModal, type UploadSlot } from '@/components/upnow/KycUploadModal';
import { putKycSlot } from '@/lib/kycSlotUpload';
import { DocsLinkButton } from '@/components/upnow/DocsLinkButton';
import { getOccupantDocs, deriveOccupantCount, docNeedsExpiry, RESIDENTIAL_RENTAL_DOCS, type DocReq } from '@/lib/docRequirements';

type Lease = {
  id: number; ref: string; contractType: string | null; status: string | null;
  contractActive: boolean; ejariStatus: string | null;
  startDate: string | null; endDate: string | null; annualRent: number;
  listedRent: number | null; discountType: 'percent' | 'fixed' | null; discountValue: number | null; discountAmount: number | null;
  securityDeposit: number; collected: number; outstanding: number;
  // depositHeld = own deposit, or the amount carried forward from the chain's
  // first lease on a renewal; depositSourceId = which contract actually holds it.
  depositHeld: number; depositSourceId: number | null;
  isCurrent: boolean;
  unit: { id: number | null; number: string | null; name: string | null };
  property: { id: number | null; buildingName: string | null };
};
type Doc = {
  id: number; documentKey: string; displayName: string | null; category: string | null;
  status: string | null; fileUrl: string | null; mimeType?: string | null; issueDate: string | null;
  expiryDate: string | null; createdAt: string | null;
  ownerType?: string | null; ownerId?: number | null; leaseId?: number | null;
};
type Financials = {
  totalActiveRent: number; securityDepositHeld: number;
  totalBilled: number; totalCollected: number; totalOutstanding: number; vatCollected: number;
};
// One entry in the customer's running notes journal — aggregated across every
// lease the customer holds (sequence-wise), each tagged with its tenancy.
type Note = {
  id: number; body: string; authorName: string | null;
  authorRole: 'rental_provider' | 'manager' | null; createdAt: string;
  leaseId: number; leaseRef: string; unitLabel: string | null;
};
type CustomerDetail = {
  customer: {
    id: number; name: string | null; firstName: string | null; lastName: string | null;
    email: string | null; phone: string | null; emiratesId: string | null;
    nationality: string | null; gender: string | null; dateOfBirth: string | null;
    entityType: string | null; companyName: string | null; tradeLicenseNumber: string | null;
    tradeLicenseAuthority: string | null;
  };
  summary: { totalLeases: number; activeLeases: number; totalActiveRent: number; documentCount: number };
  financials: Financials;
  leases: Lease[];
  notes?: Note[];
  documents: Doc[];
};

const fmtAed = (n: number | null | undefined) => `AED ${Number(n ?? 0).toLocaleString('en-AE')}`;
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function monthYear(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
// Notes timestamp: "12 Jun 2026" for the journal stream.
function fmtNoteDate(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' });
}
const noteInitials = (name: string | null | undefined): string =>
  (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '–';
function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(`${dob.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}
function renewalDays(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date();
  return Math.round((end - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000);
}
function leaseBadge(l: Lease, currentOfUnit?: Lease, isLatestHistory = false): { label: string; cls: string } {
  if (!l.isCurrent) {
    // Only the MOST RECENT lease in the chain is the live one when a renewal is
    // pending signature — older renewed leases are plain history.
    if (isLatestHistory && l.contractActive && currentOfUnit && (currentOfUnit.status ?? '').toLowerCase() === 'pending')
      return { label: 'Active · renewal pending', cls: 'bg-[#d8f2e8] text-[#1a7a5a]' };
    return { label: 'Renewed', cls: 'bg-[#f4f3ef] text-[#6b6860]' };
  }
  if ((l.status ?? '').toLowerCase() === 'terminated') return { label: 'Terminated', cls: 'bg-[#fee2e2] text-[#b91c1c]' };
  if (l.contractActive) return { label: 'Active', cls: 'bg-[#d8f2e8] text-[#1a7a5a]' };
  return { label: (l.status ?? 'Inactive').replace(/^./, c => c.toUpperCase()), cls: 'bg-[#f4f3ef] text-[#6b6860]' };
}
const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
// KYC = the customer's own identity / licensing rows. Everything else (payment
// proofs, deposit receipts, lease paperwork) is the lease/contract paperwork,
// surfaced contract-wise via the "History Documents" reader.
const KYC_KEY_RE = /emirates|passport|visa|trade_license|moa|poa|labour|establishment/;
const isKycDoc = (d: Doc) =>
  (d.ownerType ?? 'customer') === 'customer' &&
  (d.category === 'identity' || d.category === 'license' || KYC_KEY_RE.test(d.documentKey));
// Additional-occupant identity docs (occupant 2..N) hang off the customer with
// `occupant_<n>_*` keys. They get their own section, not the primary KYC card —
// otherwise they'd land in "extra" KYC docs as view-only rows with no upload.
const isOccupantDoc = (d: Doc) => /^occupant_\d+_/.test(d.documentKey ?? '');
// Optional residential supporting docs (Employment / Salary Certificate, Bank
// Statement / Pay Slip, Marriage Certificate). None are required — they get their
// own "Supporting Documents" card so an admin can backfill them; otherwise they
// only appear view-only under "History Documents". (Individual customers only.)
const SUPPORTING_DOCS = RESIDENTIAL_RENTAL_DOCS;
// Tolerant key match — a "Replace" can append a `_<timestamp>` suffix.
const supportingReqFor = (key: string) => SUPPORTING_DOCS.find(r => new RegExp(`^${r.key}(_|$)`).test(key));
const isSupportingDoc = (d: Doc) =>
  (d.ownerType ?? 'customer') === 'customer' && !!supportingReqFor(d.documentKey ?? '');

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // This page is re-exported for the manager portal. A manager has no RP profile,
  // so they scope via /manager + a ?rp=<landlord> query (the contracts endpoint
  // is RP-only; the manager endpoint resolves the landlord behind the scenes).
  const isManager = (pathname ?? '').startsWith('/dashboard/manager');
  const rpParam = searchParams.get('rp');
  const listHref = isManager ? '/dashboard/manager/tenants' : '/rental-provider/dashboard/tenants';
  const detailUrl = isManager
    ? `/api/manager/tenants/${params?.id}?rp=${rpParam ?? ''}`
    : `/api/contracts/tenants/${params?.id}`;
  const editUrl = isManager
    ? `/api/manager/tenants/${params?.id}?rp=${rpParam ?? ''}`
    : `/api/contracts/tenants/${params?.id}`;
  // Contract "View" links must stay inside whichever portal we're rendered in.
  // Managers scope the (RP-only) contract page via /manager + ?rp=<landlord>.
  const contractHref = (leaseId: number | string) => isManager
    ? `/dashboard/manager/contracts/${leaseId}/v2?rp=${rpParam ?? ''}`
    : `/rental-provider/dashboard/contracts/${leaseId}/v2`;
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // The shared document reader (sidebar list + gallery preview) — same popup the
  // Property / Unit views use. Drives KYC "View" / "View All" and the lease-doc
  // "History Documents" preview.
  const [reader, setReader] = useState<{ title: string; summary?: string; slots: ReaderSlot[]; initialKey?: string } | null>(null);
  const [showDeposits, setShowDeposits] = useState(false);
  // Occupant count has no DB column — it's derived from the uploaded `occupant_N_*`
  // doc keys. The admin can bump it up here to reveal more upload slots for a
  // backfill; the override never drops below the derived count (those docs exist).
  const [occupantOverride, setOccupantOverride] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!params?.id) return;
    setLoading(true);
    fetch(detailUrl, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(r.status === 403 ? 'This customer has no contracts with this landlord.' : `Error ${r.status}`); return r.json() as Promise<CustomerDetail>; })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [detailUrl, params?.id]);
  useEffect(() => { load(); }, [load]);

  // KYC upload popup (set to the requirement being acted on).
  const [uploadDoc, setUploadDoc] = useState<{ title: string; slots: UploadSlot[] } | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  // Single-doc requirements (Passport, Visa, …) upload directly via a file
  // picker — no slot popup; only the two-sided Emirates ID uses the modal.
  const [directBusy, setDirectBusy] = useState<string | null>(null);
  const [directErr, setDirectErr] = useState<Record<string, string>>({});
  const directFileRef = useRef<HTMLInputElement>(null);
  const directSlot = useRef<UploadSlot | null>(null);

  const pickDirect = (slot: UploadSlot) => { directSlot.current = slot; directFileRef.current?.click(); };
  const onDirectFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slot = directSlot.current;
    e.target.value = '';
    if (!file || !slot || !params?.id) return;
    setDirectErr(p => { const n = { ...p }; delete n[slot.canonicalKey]; return n; });
    setDirectBusy(slot.canonicalKey);
    try {
      await putKycSlot({ ownerType: 'customer', ownerId: Number(params.id), canonicalKey: slot.canonicalKey, category: slot.category, displayName: slot.label, file, existingDocId: slot.existing?.id ?? null, existingKey: slot.existing?.documentKey ?? null });
      load();
    } catch (err) {
      setDirectErr(p => ({ ...p, [slot.canonicalKey]: err instanceof Error ? err.message : 'Upload failed. Try again.' }));
    } finally {
      setDirectBusy(null);
    }
  };

  // ── Lease-notes composer (append to a chosen lease's shared journal) ──
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteLeaseId, setNoteLeaseId] = useState<number | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const submitNote = async () => {
    const text = noteDraft.trim();
    if (!text || noteLeaseId == null) return;
    setNoteBusy(true);
    setNoteErr(null);
    try {
      // Notes are anchored on the renewal-chain root server-side, so any lease in
      // the chain is a valid target — the backend resolves the shared journal.
      // Manager acts on the landlord-scoped endpoint (?rp=) via /api/manager/*.
      const res = await fetch(
        isManager ? `/api/manager/contracts/${noteLeaseId}/notes?rp=${rpParam ?? ''}` : `/api/contracts/${noteLeaseId}/notes`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error(res.status === 403 ? 'You do not have permission to add notes.' : `Error ${res.status}`);
      setNoteDraft(''); setNoteOpen(false);
      load(); // reload so the note comes back with its resolved lease/unit label
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setNoteBusy(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-[#9b9890]">Loading customer…</div>;
  if (error || !data) {
    return (
      <div className="p-6">
        <button onClick={() => router.push(listHref)} className="text-sm text-[#2e9f82] font-medium flex items-center gap-1 mb-4"><ArrowLeft size={14} /> Back to Customers</button>
        <p className="text-sm text-[#b91c1c]">{error ?? 'Customer not found'}</p>
      </div>
    );
  }

  const c = data.customer;
  const fin = data.financials;
  const notes = data.notes ?? [];
  const isCompany = c.entityType === 'company';
  // Company customers are identified by their company name, individuals by person name.
  const displayName = isCompany && c.companyName ? c.companyName : (c.name ?? '—');
  // "Customer since" — derived from the earliest lease start on record (their
  // first tenancy with this RP); omitted when there are no dated leases yet.
  const customerSince = monthYear(
    data.leases.map(l => l.startDate).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))[0],
  );
  const kycDocs = data.documents.filter(d => isKycDoc(d) && !isOccupantDoc(d));
  // ── Additional occupants (people living with the primary customer) ──
  // Their identity docs hang off the customer with occupant_<n>_* keys; the count
  // is derived from those keys (no DB column) and can be bumped up to backfill.
  // The override is clamped to never hide an occupant that already has docs.
  const occupantDocs = data.documents.filter(d => (d.ownerType ?? 'customer') === 'customer' && isOccupantDoc(d));
  const derivedOccupants = deriveOccupantCount(data.documents.map(d => d.documentKey)); // ≥1, primary = occupant 1
  const totalOccupants = Math.max(occupantOverride ?? derivedOccupants, derivedOccupants, 1);
  const occupantGroups: { idx: number; reqs: DocReq[] }[] = (() => {
    const reqs = getOccupantDocs(totalOccupants); // identity docs for occupants 2..N
    const out: { idx: number; reqs: DocReq[] }[] = [];
    for (let i = 2; i <= totalOccupants; i++) out.push({ idx: i, reqs: reqs.filter(r => r.key.startsWith(`occupant_${i}_`)) });
    return out;
  })();
  // Tolerant match (an in-place "Replace" can append a `_<timestamp>` suffix).
  const findOccupantDoc = (key: string) => occupantDocs.find(d => new RegExp(`^${key}(_|$)`).test(d.documentKey));
  // ── Optional supporting documents (residential individuals) ──
  // Employment letter / bank statement / marriage certificate — optional backfill
  // slots so an admin can attach them. Not shown for companies (their supporting
  // pack is the trade-license / MOA already in Company KYC).
  const showSupporting = !isCompany;
  const supportingDocsList = data.documents.filter(isSupportingDoc);
  const findSupportingDoc = (key: string) => supportingDocsList.find(d => new RegExp(`^${key}(_|$)`).test(d.documentKey));
  // KYC checklist (RP view): the identity docs this customer should have on
  // file. Missing ones get an inline upload affordance. Mirrors the customer
  // requirements in the backend document-requirements matrix.
  // Match the slot's base key whether or not the upload carries a `_<timestamp>`
  // (or `_front`/`_back`) suffix — RP-side uploads and "Replace" append one, so a
  // strict `===` would leave the suffixed copy unmatched and re-listed as a
  // phantom duplicate under "extra" docs.
  const keyMatcher = (base: string) => (k: string) =>
    new RegExp(`^${base}(_|$)`).test(k);
  const isEidKey = (k: string) => /^emirates_id(_|$)/.test(k);
  const KYC_REQS: { key: string; label: string; category: string; required: boolean; match: (k: string) => boolean }[] = isCompany
    ? [
        { key: 'trade_license', label: 'Trade License', category: 'license', required: true, match: keyMatcher('trade_license') },
        { key: 'moa', label: 'Memorandum of Association (MOA)', category: 'compliance', required: false, match: keyMatcher('moa') },
        { key: 'emirates_id', label: 'Authorised Signatory Emirates ID', category: 'identity', required: true, match: isEidKey },
        { key: 'passport', label: 'Passport', category: 'identity', required: false, match: keyMatcher('passport') },
        { key: 'visa', label: 'UAE Visa / Residency', category: 'identity', required: false, match: k => /visa/.test(k) },
      ]
    : [
        { key: 'emirates_id', label: 'Emirates ID', category: 'identity', required: true, match: isEidKey },
        { key: 'passport', label: 'Passport', category: 'identity', required: true, match: keyMatcher('passport') },
        { key: 'visa', label: 'UAE Visa / Residency', category: 'identity', required: false, match: k => /visa/.test(k) },
      ];
  // Emirates ID counts as complete only with BOTH sides (front + back) — or a
  // single combined scan — matching the Operations KYC gate. A front-only (or
  // back-only) upload is a PARTIAL state, not "done", so the slot doesn't read as
  // satisfied just because one image is on file. Every other slot is satisfied by
  // any one matching upload.
  const isEidFront = (k: string) => /^emirates_id_front(_|$)/.test(k);
  const isEidBack = (k: string) => /^emirates_id_back(_|$)/.test(k);
  const isEidCombined = (k: string) => isEidKey(k) && !isEidFront(k) && !isEidBack(k);
  const kycChecklist = KYC_REQS.map(req => {
    const docs = kycDocs.filter(d => req.match(d.documentKey));
    let satisfied = docs.length > 0;
    let partialHint: string | null = null;
    if (req.key === 'emirates_id') {
      const front = docs.some(d => isEidFront(d.documentKey));
      const back = docs.some(d => isEidBack(d.documentKey));
      const combined = docs.some(d => isEidCombined(d.documentKey));
      satisfied = combined || (front && back);
      if (!satisfied && docs.length > 0) partialHint = front ? 'Back side required' : 'Front side required';
    }
    return { req, docs, satisfied, partialHint };
  });
  const matchedKycIds = new Set(kycChecklist.flatMap(x => x.docs.map(d => d.id)));
  const extraKycDocs = kycDocs.filter(d => !matchedKycIds.has(d.id)); // KYC docs outside the standard checklist
  const kycUploadedCount = kycChecklist.filter(x => x.satisfied).length;
  const kycViewable = kycDocs.filter(d => d.fileUrl);
  // Lease/contract paperwork (non-KYC) — shown contract-wise in "History Documents".
  // Optional supporting docs have their own card (for individuals), so exclude them.
  const otherDocsCount = data.documents.filter(d => !isKycDoc(d) && !(showSupporting && isSupportingDoc(d))).length;

  // ── Document reader slots (shared sidebar + gallery popup) ──
  const toReaderFile = (d: Doc) => ({ id: d.id, name: docLabel(d, data.documents), url: d.fileUrl as string, mimeType: d.mimeType });
  // KYC slots = one row per requirement (uploaded → its files; missing → empty,
  // so the list mirrors the on-page checklist) plus any extra KYC docs.
  const kycSlots: ReaderSlot[] = [
    ...kycChecklist.map(({ req, docs }) => ({ key: req.key, label: req.label, files: docs.filter(d => d.fileUrl).map(toReaderFile) })),
    ...extraKycDocs.filter(d => d.fileUrl).map(d => ({ key: `extra-${d.id}`, label: docLabel(d, data.documents), files: [toReaderFile(d)] })),
  ];
  const openKycReader = (initialKey?: string) => setReader({
    title: isCompany ? 'Company KYC' : 'KYC documents',
    summary: `${kycUploadedCount} of ${KYC_REQS.length} on file`,
    slots: kycSlots, initialKey,
  });
  // History slots = lease/contract paperwork grouped per contract (newest first),
  // then customer-level documents with no lease link.
  const leaseGroupLabel = (l: Lease) => {
    const span = [monthYear(l.startDate), monthYear(l.endDate)].filter(Boolean).join(' – ');
    return `${l.ref}${l.unit.number ? ` · Unit ${l.unit.number}` : ''}${span ? ` · ${span}` : ''}`;
  };
  const historySlots: ReaderSlot[] = (() => {
    const docs = data.documents.filter(d => !isKycDoc(d) && !(showSupporting && isSupportingDoc(d)) && d.fileUrl);
    const byLease = new Map(data.leases.map(l => [l.id, l]));
    const orderedLeases = [...data.leases].sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
    const out: ReaderSlot[] = [];
    for (const l of orderedLeases) {
      const group = leaseGroupLabel(l);
      for (const d of docs.filter(x => x.leaseId === l.id)) {
        out.push({ key: `doc-${d.id}`, label: docLabel(d, data.documents), group, files: [toReaderFile(d)] });
      }
    }
    for (const d of docs.filter(x => x.leaseId == null || !byLease.has(x.leaseId))) {
      out.push({ key: `doc-${d.id}`, label: docLabel(d, data.documents), group: 'Customer & general', files: [toReaderFile(d)] });
    }
    return out;
  })();
  const openHistoryReader = () => setReader({ title: 'Lease documents', summary: `${otherDocsCount} document${otherDocsCount !== 1 ? 's' : ''} across all leases`, slots: historySlots });
  const slotDoc = (d?: Doc): UploadSlot['existing'] => d ? { id: d.id, documentKey: d.documentKey, fileUrl: d.fileUrl, mimeType: d.mimeType, expiryDate: d.expiryDate } : null;
  // Upload slots for a requirement — Emirates ID is two-sided (Front + Back),
  // everything else is a single slot.
  const slotsFor = (req: typeof KYC_REQS[number], docs: Doc[]): UploadSlot[] => {
    if (req.key === 'emirates_id') {
      const front = docs.find(d => d.documentKey === 'emirates_id' || d.documentKey === 'emirates_id_front');
      const back = docs.find(d => /^emirates_id_(back|2)$/.test(d.documentKey) || /^emirates_id_\d{6,}$/.test(d.documentKey));
      return [
        { label: 'Front side', canonicalKey: 'emirates_id_front', category: 'identity', existing: slotDoc(front) },
        { label: 'Back side', canonicalKey: 'emirates_id_back', category: 'identity', existing: slotDoc(back) },
      ];
    }
    return [{ label: req.label, canonicalKey: req.key, category: req.category, existing: slotDoc(docs[0]) }];
  };
  // Per unit, the lease whose deposit the RP actually holds (mirrors the
  // backend securityDepositHeld rule): prefer in-force leases, latest start
  // among equals — a pending renewal child must not hide the parent's deposit.
  const depositHolders = (() => {
    const byUnit = new Map<number, Lease>();
    for (const l of data.leases) {
      if (['terminated', 'cancelled'].includes((l.status ?? '').toLowerCase())) continue;
      const uid = l.unit.id ?? -l.id;
      const cur = byUnit.get(uid);
      if (!cur) { byUnit.set(uid, l); continue; }
      const better = l.contractActive === cur.contractActive
        ? String(l.startDate ?? '') > String(cur.startDate ?? '')
        : l.contractActive;
      if (better) byUnit.set(uid, l);
    }
    return [...byUnit.values()].filter(l => l.depositHeld > 0);
  })();
  const plural = (n: number, w: string) => `${n} ${w}${n !== 1 ? 's' : ''}`;
  // ── Needs-attention items — each phrased as a chip with the suggested action ──
  const actions: string[] = [];
  const unitOf = (l: Lease) => l.unit.number ? `Unit ${l.unit.number}` : (l.unit.name ?? 'unit');
  for (const l of data.leases) {
    if (!l.isCurrent) continue; // skip already-renewed (superseded) history
    if ((l.outstanding ?? 0) > 0) actions.push(`${fmtAed(l.outstanding)} outstanding on ${unitOf(l)} · record payment`);
    const d = renewalDays(l.endDate);
    if (d !== null && d < 0) actions.push(`Lease ${l.ref} expired ${plural(Math.abs(d), 'day')} ago · renew`);
    else if (d !== null && d <= 90) actions.push(`Renewal in ${plural(d, 'day')} · propose terms`);
  }
  for (const d of data.documents.filter(d => d.status === 'pending')) actions.push(`${docLabel(d, data.documents)} pending review`);
  if (kycDocs.length === 0) actions.push('Upload KYC documents');
  if (!c.emiratesId) actions.push('Add Emirates ID');
  if (!c.phone) actions.push('Add phone number');
  // Nationality / gender / DOB are personal attributes — only prompt for them on
  // individuals. Companies are licensed entities (no person details apply).
  if (!isCompany) {
    if (!c.nationality) actions.push('Add nationality');
    if (!c.gender) actions.push('Add gender');
    if (!c.dateOfBirth) actions.push('Add date of birth');
  }

  // Collected / Outstanding are scoped to the active (in-force) lease(s) only —
  // matching the Rent figure — so each card describes the same current tenancy
  // rather than mixing in years of renewed/terminated history.
  const activeStatLeases = data.leases.filter(l => l.isCurrent && l.contractActive);
  const collectedActive = activeStatLeases.reduce((s, l) => s + (l.collected ?? 0), 0);
  const outstandingActive = activeStatLeases.reduce((s, l) => s + (l.outstanding ?? 0), 0);
  const billedActive = collectedActive + outstandingActive;
  const outstandingUnits = activeStatLeases.filter(l => (l.outstanding ?? 0) > 0)
    .map(l => l.unit.number ? `Unit ${l.unit.number}` : (l.unit.name ?? '—'));
  // Headline financial cards — Outstanding leads (and highlights) since it's the
  // thing needing attention; then money in, money held, and the running rent.
  const STATS: Array<{ label: string; value: string; sub: string; danger: boolean; onClick?: () => void }> = [
    { label: 'Outstanding', value: fmtAed(outstandingActive),
      sub: outstandingUnits.length === 0 ? 'all clear' : outstandingUnits.length === 1 ? outstandingUnits[0] : plural(outstandingUnits.length, 'unit'),
      danger: outstandingActive > 0 },
    { label: 'Collected', value: fmtAed(collectedActive), sub: `of ${billedActive.toLocaleString('en-AE')}`, danger: false },
    // Deposits last; clickable to see the per-unit breakdown when any are held.
    { label: 'Deposits Held', value: fmtAed(fin.securityDepositHeld), sub: plural(depositHolders.length, 'unit'), danger: false,
      onClick: depositHolders.length > 0 ? () => setShowDeposits(true) : undefined },
  ];
  const profile: { icon: typeof Mail; label: string; value: string | null }[] = [
    { icon: Mail, label: 'Email', value: c.email },
    { icon: Phone, label: 'Phone', value: c.phone },
    { icon: IdCard, label: 'Emirates ID', value: c.emiratesId },
    // Personal attributes are shown for individuals only; companies surface
    // their licensing details instead.
    ...(!isCompany ? [
      { icon: Globe, label: 'Nationality', value: c.nationality },
      { icon: User, label: 'Gender', value: c.gender ? c.gender.replace(/^./, x => x.toUpperCase()) : null },
      { icon: Calendar, label: 'DOB', value: c.dateOfBirth ? `${fmtDate(c.dateOfBirth)}${ageFromDob(c.dateOfBirth) != null ? ` · ${ageFromDob(c.dateOfBirth)} yrs` : ''}` : null },
    ] : [
      { icon: Building2, label: 'Company', value: c.companyName },
      { icon: IdCard, label: 'Trade license', value: c.tradeLicenseNumber },
      { icon: Landmark, label: 'License authority', value: c.tradeLicenseAuthority },
    ]),
  ];
  // Rent progression — grouped PER UNIT so each unit's renewal chain is its own
  // timeline (mixing units interleaves dates and produces nonsensical deltas).
  const progressionByUnit = (() => {
    const byUnit = new Map<number, { unitLabel: string; leases: Lease[] }>();
    for (const l of data.leases) {
      if (!l.startDate) continue;
      const uid = l.unit.id ?? -l.id;
      const g = byUnit.get(uid) ?? { unitLabel: l.unit.number ? `Unit ${l.unit.number}` : (l.unit.name ?? '—'), leases: [] };
      g.leases.push(l);
      byUnit.set(uid, g);
    }
    return [...byUnit.values()]
      .map(g => ({ ...g, leases: g.leases.sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime()) }))
      .filter(g => g.leases.length > 1); // a single lease has no progression to show
  })();
  const hasProgression = progressionByUnit.length > 0;

  // ── Header derived bits ──
  const initials = (c.name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
  // Current (in-force) leases up top; renewed / superseded / terminated rows go to History.
  const currentLeases = data.leases.filter(l => l.isCurrent);
  const pastLeases = data.leases.filter(l => !l.isCurrent);
  // The latest-start NON-current lease per unit — the only history row that can be
  // "Active · renewal pending"; the rest are simply renewed history.
  const latestHistoryIds = (() => {
    const byUnit = new Map<number, Lease>();
    for (const l of data.leases) {
      if (l.isCurrent) continue;
      const uid = l.unit.id ?? -l.id;
      const cur = byUnit.get(uid);
      if (!cur || String(l.startDate ?? '') > String(cur.startDate ?? '')) byUnit.set(uid, l);
    }
    return new Set([...byUnit.values()].map(l => l.id));
  })();

  // One lease row, shared by the Current and History tables.
  const leaseRow = (l: Lease) => {
    const d = l.isCurrent ? renewalDays(l.endDate) : null;
    const renewalRed = d !== null && d <= 30;
    const badge = leaseBadge(l, data.leases.find(o => o.isCurrent && (o.unit.id ?? -o.id) === (l.unit.id ?? -l.id)), latestHistoryIds.has(l.id));
    return (
      <tr key={l.id} className={`border-b border-[#e8e6e0] hover:bg-[#f4f3ef] ${l.isCurrent ? 'text-[#1a1916]' : 'text-[#9b9890]'}`}>
        <td className="px-4 py-3.5 font-medium">{l.ref}</td>
        <td className="px-4 py-3.5">{l.unit.number ? `Unit ${l.unit.number}` : (l.unit.name ?? '—')}</td>
        <td className="px-4 py-3.5 text-[#6b6860]">{l.property.buildingName ?? '—'}</td>
        <td className="px-4 py-3.5 text-[#6b6860]">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
        <td className="px-4 py-3.5 font-medium">
          {(l.discountAmount ?? 0) > 0 && l.listedRent != null && (
            <span className="text-xs font-normal text-[#9b9890] line-through mr-1.5">{fmtAed(l.listedRent)}</span>
          )}
          {fmtAed(l.annualRent)}
          {(l.discountAmount ?? 0) > 0 && (
            <span className="block text-[10px] font-normal text-[#b91c1c]">− {fmtAed(l.discountAmount!)} discount</span>
          )}
        </td>
        <td className="px-4 py-3.5">
          {!l.isCurrent ? <span className="text-[#9b9890]">—</span>
            : d === null ? <span className="text-[#9b9890]">—</span>
            : <span className={`text-xs font-medium ${renewalRed ? 'text-[#b91c1c]' : d <= 90 ? 'text-amber-600' : 'text-[#6b6860]'}`}>{d > 0 ? `${d}d` : `expired ${Math.abs(d)}d`}</span>}
        </td>
        <td className="px-4 py-3.5"><span className={`inline-flex rounded-full text-xs font-medium px-2.5 py-0.5 ${badge.cls}`}>{badge.label}</span></td>
        <td className="px-4 py-3.5">
          <Link href={contractHref(l.id)} className="text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">View <ExternalLink size={12} /></Link>
        </td>
      </tr>
    );
  };
  const LEASE_COLS = ['Ref', 'Unit', 'Property', 'Period', 'Annual Rent', 'Renewal', 'Status', ''];

  return (
    <div className="p-6">
      {/* Needs attention — pinned to the top so action items are seen first */}
      {actions.length > 0 && (
        <div className="rounded-2xl border-t-[3px] border-[#dc2626] bg-[#fef2f2] shadow-sm px-5 py-4 mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[#b91c1c] mr-1">Needs attention</span>
            {actions.map((a, i) => (
              <span key={i} className="inline-flex items-center bg-white border border-[#fecaca] text-[#b91c1c] text-xs font-medium rounded-full px-3 py-1.5">{a}</span>
            ))}
          </div>
        </div>
      )}

      {/* Identity card */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
        <div className="flex items-start gap-3.5 flex-wrap">
          <button onClick={() => router.push(listHref)} aria-label="Back to Customers"
            className="w-9 h-9 mt-0.5 rounded-full border border-[#e8e6e0] flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef] shrink-0 cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div className="w-12 h-12 rounded-2xl bg-[#d8f2e8] flex items-center justify-center text-[#2e9f82] font-semibold text-sm shrink-0">
            {isCompany ? <Building2 size={22} /> : initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[#9b9890] flex items-center gap-1.5 flex-wrap">
              <Link href={listHref} className="hover:underline">Customers</Link>
              <span className="text-[#c4c1b8]">›</span>
              <span className="truncate max-w-[200px]">{displayName}</span>
            </p>
            <h1 className="text-[22px] leading-tight font-bold text-[#1a1916] mt-0.5">{displayName}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <span className={`inline-flex rounded-full text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 ${isCompany ? 'bg-[#f3ecdd] text-[#7a5a2e]' : 'bg-[#eef2fb] text-[#3b5bb5]'}`}>
                {isCompany ? 'Company' : 'Individual'}
              </span>
              {customerSince && <span className="text-xs text-[#9b9890]">Customer since {customerSince}</span>}
            </div>
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-full border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] shrink-0 cursor-pointer">
              <Pencil size={14} /> Edit
            </button>
          )}
        </div>

        {/* Profile / KYC strip */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 pt-4 border-t border-[#eeece6]">
          {profile.map((f, i) => (
            <div key={i} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{f.label}</div>
              <div className={`text-sm break-words mt-1 ${f.value ? 'text-[#1a1916] font-medium' : 'text-[#b91c1c] font-semibold'}`}>{f.value ?? 'Missing'}</div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 mb-6">
          <h2 className="text-base font-bold text-[#1a1916] mb-3">Edit customer</h2>
          <CustomerForm
            mode="edit"
            method="PATCH"
            submitUrl={editUrl}
            initial={{
              firstName: c.firstName, lastName: c.lastName, name: c.name, email: c.email, phone: c.phone,
              emiratesIdNumber: c.emiratesId, nationality: c.nationality, gender: c.gender,
              dateOfBirth: c.dateOfBirth, entityType: c.entityType, companyName: c.companyName,
              tradeLicenseNumber: c.tradeLicenseNumber, tradeLicenseAuthority: c.tradeLicenseAuthority,
            }}
            onCancel={() => setEditing(false)}
            onDone={() => { setEditing(false); load(); }}
          />
        </div>
      )}

      {/* Headline financial bar — one card, segmented, gold top accent */}
      <div className="rounded-2xl bg-white shadow-sm border-t-[3px] border-[#e3b542] overflow-hidden mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-x divide-[#eeece6]">
          {STATS.map((s, i) => (
            <div
              key={i}
              className={`px-5 py-4 ${s.danger ? 'bg-[#fdf3e6]' : ''} ${s.onClick ? 'cursor-pointer hover:bg-[#faf9f7] transition-colors' : ''}`}
              onClick={s.onClick}
              role={s.onClick ? 'button' : undefined}
              title={s.onClick ? 'View deposit breakdown' : undefined}
            >
              <div className={`text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1 ${s.danger ? 'text-[#b45309]' : 'text-[#9b9890]'}`}>
                {s.label}
                {s.onClick && <ExternalLink size={11} className="text-[#2e9f82]" />}
              </div>
              <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                <span className={`font-bold text-xl ${s.danger ? 'text-[#b45309]' : 'text-[#1a1916]'}`}>{s.value}</span>
                <span className="text-xs text-[#9b9890]">{s.sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Security deposits held — opened from the "Deposits Held" stat above. */}
      {showDeposits && depositHolders.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowDeposits(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#e8e6e0]">
              <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2">
                <ShieldCheck size={16} className="text-[#2e9f82]" /> Security deposits held — {fmtAed(fin.securityDepositHeld)}
              </h3>
              <button type="button" onClick={() => setShowDeposits(false)} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <p className="text-xs text-[#9b9890] mb-3">You hold these on the customer&apos;s behalf — refundable at move-out after the settlement.</p>
              <div className="space-y-2">
                {depositHolders.map(l => {
                  // Carried deposit: the cheque/receipt and the editable record live
                  // on the chain's first lease, not this renewal — resolve to it.
                  const srcId = l.depositSourceId ?? l.id;
                  const proofs = data.documents.filter(d => d.leaseId === srcId && d.fileUrl &&
                    (d.ownerType === 'security_deposit' || /deposit|cheque/i.test(`${d.documentKey} ${d.displayName ?? ''}`)));
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-[#e8e6e0] rounded-xl px-4 py-2.5">
                      <span className="text-sm font-semibold text-[#1a1916]">{fmtAed(l.depositHeld)}</span>
                      <span className="inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 bg-[#fff7e0] text-[#9a6b00]">Owed back to customer</span>
                      {l.depositSourceId && (
                        <span className="inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 bg-[#eef2fb] text-[#3b5bb5]">Carried from CID-{l.depositSourceId}</span>
                      )}
                      <span className="text-xs text-[#6b6860]">
                        {l.unit.number ? `Unit ${l.unit.number}` : (l.unit.name ?? '—')}{l.property.buildingName ? ` · ${l.property.buildingName}` : ''} · {l.ref} · {fmtDate(l.startDate)} → {fmtDate(l.endDate)}
                      </span>
                      {proofs.length > 0 ? proofs.map(d => (
                        <button key={d.id} type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName || prettyKey(d.documentKey), mimeType: d.mimeType })}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2e9f82] bg-[#eef9f4] border border-[#cfe9df] rounded-full px-2 py-0.5 hover:underline cursor-pointer">
                          <FileText size={11} /> {d.displayName || prettyKey(d.documentKey)}
                        </button>
                      )) : (
                        <span className="text-[11px] font-medium text-[#9a6b00]">No cheque / transfer receipt on file</span>
                      )}
                      <Link href={contractHref(l.id)} className="ml-auto text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">
                        View lease <ExternalLink size={11} />
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active leases — History opens in a popup from this header */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm mb-6">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2">
            <FileText size={16} className="text-[#2e9f82]" /> Active Leases ({data.summary.activeLeases})
            <span className="text-xs font-normal text-[#9b9890]">· {plural(data.summary.totalLeases, 'lease')} total</span>
          </h2>
          {pastLeases.length > 0 && (
            <button type="button" onClick={() => setShowHistoryModal(true)}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] cursor-pointer">
              <History size={14} /> History ({pastLeases.length})
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[920px] text-sm">
            <thead><tr className="bg-[#f4f3ef]">
              {LEASE_COLS.map(h => (
                <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {currentLeases.map(leaseRow)}
              {currentLeases.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-[#9b9890]">No active lease for this customer.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* KYC documents (wider, left) + Rent progression (narrow, right) */}
      <div className={`grid gap-6 mb-6 items-start ${hasProgression ? 'lg:grid-cols-[2fr_1fr]' : ''}`}>
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {/* Hidden picker for single-doc requirements (Passport, Visa, …) */}
        <input ref={directFileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={onDirectFile} />
        <div className="flex items-center gap-x-2.5 gap-y-2 flex-wrap px-4 py-3.5 border-b border-[#eeece6]">
          <span className="w-7 h-7 rounded-lg bg-[#eef9f4] text-[#2e9f82] flex items-center justify-center shrink-0"><FileText size={15} /></span>
          <h2 className="text-sm font-bold text-[#1a1916]">
            {isCompany ? 'Company KYC' : 'KYC documents'} <span className="font-normal text-[#9b9890]">({kycUploadedCount}/{KYC_REQS.length})</span>
          </h2>
          <div className="flex-1 min-w-[12px]" />
          {otherDocsCount > 0 && (
            <button
              type="button"
              onClick={openHistoryReader}
              title="Contract-wise history of all lease documents (contracts, Contract Registration, cheques, receipts), grouped per lease"
              className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] cursor-pointer"
            >
              <History size={13} /> History Documents ({otherDocsCount})
            </button>
          )}
          {kycViewable.length > 0 && (
            <button
              type="button"
              onClick={() => openKycReader()}
              title="Preview every KYC document on file together in one viewer"
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:underline cursor-pointer"
            >
              <Eye size={14} /> View All
            </button>
          )}
          {/* Standalone (no-lease) document-upload link for this customer:
              generate → open / copy → send by email. */}
          <DocsLinkButton tenantId={Number(params.id)} label="Request documents" />
        </div>
        <div className="p-2 max-h-[480px] overflow-y-auto">
          {kycChecklist.map(({ req, docs, satisfied, partialHint }) => {
            const hasAnyFile = docs.length > 0;
            const uploaded = satisfied;                 // "done" = the slot's requirement is fully met
            const partial = hasAnyFile && !satisfied;   // e.g. Emirates ID front on file but back missing
            const hasFile = docs.some(d => d.fileUrl);
            const pending = hasAnyFile && docs[0].status === 'pending';
            const twoSided = req.key === 'emirates_id';
            const busy = directBusy === req.key;
            // Emirates ID (two-sided) and any doc that carries an expiry — trade
            // license, passport, visa — open the slot popup so the RP can record
            // the expiry date. Non-expiring docs (MOA) still pick a file directly.
            const onUpload = twoSided || docNeedsExpiry(req.key)
              ? () => setUploadDoc({ title: req.label, slots: slotsFor(req, docs) })
              : () => pickDirect(slotsFor(req, docs)[0]);
            return (
              <div key={req.key} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#fafdfb]">
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${uploaded ? 'bg-[#eef9f4] text-[#1a7a5a]' : partial ? 'bg-[#fdf3e7] text-[#b07415]' : 'bg-[#f4f3ef] text-[#9b9890]'}`}>
                  {uploaded ? <Check size={16} /> : partial ? <AlertTriangle size={16} /> : <FileText size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-[#1a1916] truncate">{req.label}</div>
                  <div className="text-[11px] font-semibold mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                    {uploaded ? (
                      <>
                        {pending && <span className="text-[#b91c1c]">Pending review</span>}
                        {docs[0].expiryDate && <span className="text-[#1a7a5a]">exp {fmtDate(docs[0].expiryDate)}</span>}
                        <span className="text-[#1a7a5a]">{docs.length} file{docs.length !== 1 ? 's' : ''} on record</span>
                      </>
                    ) : partial ? (
                      <>
                        <span className="text-[#b07415]">{partialHint}{req.required ? ' · required' : ''}</span>
                        <span className="text-[#9b9890]">{docs.length} of 2 sides on file</span>
                      </>
                    ) : (
                      <span className="text-[#b07415]">Not uploaded{req.required ? ' · required' : ' · optional'}</span>
                    )}
                  </div>
                  {directErr[req.key] && <p className="text-xs mt-1 text-[#b91c1c] flex items-center gap-1"><AlertTriangle size={11} /> {directErr[req.key]}</p>}
                </div>
                {hasFile && (
                  <button type="button" onClick={() => openKycReader(req.key)}
                    className="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] cursor-pointer">
                    <Eye size={13} /> View
                  </button>
                )}
                <button type="button" onClick={onUpload} disabled={busy}
                  className={`shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 cursor-pointer ${uploaded ? 'border border-[#e8e6e0] bg-white text-[#1a1916] hover:bg-[#f4f3ef]' : 'border border-[#2e9f82] bg-[#2e9f82] text-white hover:bg-[#267a65]'}`}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {uploaded ? 'Replace' : partial ? 'Add side' : 'Upload'}
                </button>
              </div>
            );
          })}

          {/* KYC docs outside the standard checklist (e.g. labour card) — still listed */}
          {extraKycDocs.map(d => (
            <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#fafdfb]">
              <span className="w-9 h-9 rounded-lg bg-[#eef9f4] text-[#1a7a5a] flex items-center justify-center shrink-0"><Check size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-[#1a1916] truncate">{docLabel(d, data.documents)}</div>
                <div className="text-[11px] font-semibold mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                  {d.status === 'pending' && <span className="text-[#b91c1c]">Pending review</span>}
                  {d.expiryDate && <span className="text-[#1a7a5a]">exp {fmtDate(d.expiryDate)}</span>}
                  {!d.expiryDate && d.status !== 'pending' && <span className="text-[#1a7a5a]">On record</span>}
                </div>
              </div>
              {d.fileUrl && (
                <button type="button" onClick={() => openKycReader(`extra-${d.id}`)}
                  className="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] cursor-pointer">
                  <Eye size={13} /> View
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Rent progression — one vertical timeline per unit (right column) */}
      {hasProgression && (
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-[#1a1916] mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-[#2e9f82]" /> Rent progression</h2>
          <div className="space-y-5 max-h-[460px] overflow-y-auto pr-1">
            {progressionByUnit.map(g => (
              <div key={g.unitLabel}>
                {progressionByUnit.length > 1 && <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9b9890] mb-2">{g.unitLabel}</div>}
                <div className="flex flex-col">
                  {g.leases.map((l, i) => {
                    const prev = i > 0 ? g.leases[i - 1].annualRent : null;
                    const delta = prev != null ? l.annualRent - prev : 0;
                    return (
                      <div key={l.id} className="flex flex-col">
                        <div className="rounded-xl border border-[#e8e6e0] px-3 py-2">
                          <div className="text-[11px] text-[#9b9890]">{fmtDate(l.startDate)}</div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-[#1a1916]">{fmtAed(l.annualRent)}</span>
                            {prev != null && delta !== 0 && (
                              <span className={`text-[11px] font-medium ${delta > 0 ? 'text-[#1a7a5a]' : 'text-[#b91c1c]'}`}>
                                {delta > 0 ? '▲' : '▼'} {fmtAed(Math.abs(delta))} ({Math.round((delta / (prev || 1)) * 100)}%)
                              </span>
                            )}
                            {prev != null && delta === 0 && <span className="text-[11px] text-[#9b9890]">no change</span>}
                          </div>
                          {(l.discountAmount ?? 0) > 0 && l.listedRent != null && (
                            <div className="text-[10px] text-[#b91c1c] mt-0.5">listed {fmtAed(l.listedRent)} · −{fmtAed(l.discountAmount!)} off</div>
                          )}
                        </div>
                        {i < g.leases.length - 1 && <span className="text-[#c4c1b8] text-center text-xs py-0.5">↓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>

      {/* Additional occupants — other people living in the unit alongside the
          primary customer. Their identity docs hang off the customer record
          (occupant_N_* keys); the count is derived from the uploaded docs and can
          be bumped up here so an admin can backfill each occupant's documents. */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="flex items-center gap-x-2.5 gap-y-2 flex-wrap px-5 py-4 border-b border-[#eeece6]">
          <span className="w-7 h-7 rounded-lg bg-[#eef9f4] text-[#2e9f82] flex items-center justify-center shrink-0"><Users size={15} /></span>
          <h2 className="text-sm font-bold text-[#1a1916]">
            Additional Occupants <span className="font-normal text-[#9b9890]">({occupantGroups.length})</span>
          </h2>
          <div className="flex-1 min-w-[12px]" />
          {/* Stepper — total occupants including the primary (occupant 1) */}
          <div className="inline-flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9b9890]">Occupants</span>
            <div className="inline-flex items-center rounded-full border border-[#e8e6e0] bg-white overflow-hidden">
              <button type="button" aria-label="Remove an occupant"
                onClick={() => setOccupantOverride(Math.max(derivedOccupants, 1, totalOccupants - 1))}
                disabled={totalOccupants <= Math.max(derivedOccupants, 1)}
                title={totalOccupants <= Math.max(derivedOccupants, 1) ? 'An occupant with documents on file cannot be removed here' : 'Remove the last (empty) occupant'}
                className="w-8 h-8 flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                <Minus size={14} />
              </button>
              <span className="min-w-[2.25rem] text-center text-sm font-semibold text-[#1a1916] tabular-nums">{totalOccupants}</span>
              <button type="button" aria-label="Add an occupant"
                onClick={() => setOccupantOverride(Math.min(12, totalOccupants + 1))}
                disabled={totalOccupants >= 12}
                className="w-8 h-8 flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-2.5 text-[11px] text-[#9b9890] border-b border-[#f1efe9]">
          The primary customer is occupant 1 (their KYC is shown above). Use + to add the people living with them, then upload each occupant&apos;s identity documents.
        </div>

        {occupantGroups.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#f4f3ef] text-[#9b9890] flex items-center justify-center mx-auto"><Users size={20} /></div>
            <p className="text-sm text-[#6b6860] font-medium mt-3">No additional occupants</p>
            <p className="text-xs text-[#9b9890] mt-1">Press + above to add an occupant, then upload their Emirates ID, passport and visa.</p>
          </div>
        ) : (
          <div className="p-2 divide-y divide-[#f1efe9]">
            {occupantGroups.map(({ idx, reqs }) => (
              <div key={idx} className="px-1.5 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#6b6860] mb-1 px-2">Occupant {idx}</div>
                {reqs.map(req => {
                  const existing = findOccupantDoc(req.key);
                  const uploaded = !!existing;
                  const busy = directBusy === req.key;
                  const occSlot: UploadSlot = { label: req.label, canonicalKey: req.key, category: req.category, existing: slotDoc(existing) };
                  // Occupant identity docs (EID / passport / visa) carry an expiry —
                  // open the popup to capture it; anything else picks a file directly.
                  const onUpload = docNeedsExpiry(req.key)
                    ? () => setUploadDoc({ title: req.label, slots: [occSlot] })
                    : () => pickDirect(occSlot);
                  return (
                    <div key={req.key} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[#fafdfb]">
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${uploaded ? 'bg-[#eef9f4] text-[#1a7a5a]' : 'bg-[#f4f3ef] text-[#9b9890]'}`}>
                        {uploaded ? <Check size={16} /> : <FileText size={16} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold text-[#1a1916] truncate">{req.label.replace(/^Occupant \d+ — /, '')}</div>
                        <div className="text-[11px] font-semibold mt-0.5">
                          {uploaded
                            ? <span className="text-[#1a7a5a]">{existing!.status === 'pending' ? 'Pending review' : 'On record'}</span>
                            : <span className="text-[#b07415]">Not uploaded · optional</span>}
                        </div>
                        {directErr[req.key] && <p className="text-xs mt-1 text-[#b91c1c] flex items-center gap-1"><AlertTriangle size={11} /> {directErr[req.key]}</p>}
                      </div>
                      {uploaded && existing!.fileUrl && (
                        <button type="button" onClick={() => openDocViewer({ fileUrl: existing!.fileUrl, caption: req.label, mimeType: existing!.mimeType })}
                          className="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] cursor-pointer">
                          <Eye size={13} /> View
                        </button>
                      )}
                      <button type="button" onClick={onUpload} disabled={busy}
                        className={`shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 cursor-pointer ${uploaded ? 'border border-[#e8e6e0] bg-white text-[#1a1916] hover:bg-[#f4f3ef]' : 'border border-[#2e9f82] bg-[#2e9f82] text-white hover:bg-[#267a65]'}`}>
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                        {uploaded ? 'Replace' : 'Upload'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Supporting documents (optional) — Employment / Salary Certificate, Bank
          Statement / Pay Slip, Marriage Certificate. None are required; this card
          just gives an admin a place to backfill them. Individuals only — a
          company's supporting pack is the trade-license / MOA in Company KYC. */}
      {showSupporting && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
          <div className="flex items-center gap-x-2.5 gap-y-2 flex-wrap px-5 py-4 border-b border-[#eeece6]">
            <span className="w-7 h-7 rounded-lg bg-[#eef9f4] text-[#2e9f82] flex items-center justify-center shrink-0"><FileText size={15} /></span>
            <h2 className="text-sm font-bold text-[#1a1916]">
              Supporting Documents <span className="font-normal text-[#9b9890]">· optional</span>
            </h2>
          </div>
          <div className="px-5 py-2.5 text-[11px] text-[#9b9890] border-b border-[#f1efe9]">
            Optional documents that strengthen the file — none are required to complete the tenancy.
          </div>
          <div className="p-2">
            {SUPPORTING_DOCS.map(req => {
              const existing = findSupportingDoc(req.key);
              const uploaded = !!existing;
              const busy = directBusy === req.key;
              const onUpload = () => pickDirect({ label: req.label, canonicalKey: req.key, category: req.category, existing: slotDoc(existing) });
              return (
                <div key={req.key} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#fafdfb]">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${uploaded ? 'bg-[#eef9f4] text-[#1a7a5a]' : 'bg-[#f4f3ef] text-[#9b9890]'}`}>
                    {uploaded ? <Check size={16} /> : <FileText size={16} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-[#1a1916] truncate">{req.label}</div>
                    <div className="text-[11px] font-semibold mt-0.5">
                      {uploaded
                        ? <span className="text-[#1a7a5a]">{existing!.status === 'pending' ? 'Pending review' : 'On record'}</span>
                        : <span className="text-[#9b9890]">{req.hint ?? 'Not uploaded'}</span>}
                    </div>
                    {directErr[req.key] && <p className="text-xs mt-1 text-[#b91c1c] flex items-center gap-1"><AlertTriangle size={11} /> {directErr[req.key]}</p>}
                  </div>
                  {uploaded && existing!.fileUrl && (
                    <button type="button" onClick={() => openDocViewer({ fileUrl: existing!.fileUrl, caption: req.label, mimeType: existing!.mimeType })}
                      className="shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] cursor-pointer">
                      <Eye size={13} /> View
                    </button>
                  )}
                  <button type="button" onClick={onUpload} disabled={busy}
                    className={`shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 cursor-pointer ${uploaded ? 'border border-[#e8e6e0] bg-white text-[#1a1916] hover:bg-[#f4f3ef]' : 'border border-[#2e9f82] bg-[#2e9f82] text-white hover:bg-[#267a65]'}`}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {uploaded ? 'Replace' : 'Upload'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lease notes — the running operational journal across EVERY lease this
          customer holds, in one chronological stream so the next person picking
          up the account can see, in sequence, what is going on. */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#eeece6]">
          <h2 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2">
            <StickyNote size={16} className="text-[#2e9f82]" /> Lease notes <span className="font-normal text-[#9b9890]">({notes.length})</span>
          </h2>
          {data.leases.length > 0 && (
            <button type="button"
              onClick={() => { setNoteErr(null); setNoteLeaseId(prev => prev ?? (currentLeases[0]?.id ?? data.leases[0]?.id ?? null)); setNoteOpen(o => !o); }}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#cfe9df] bg-[#eef9f4] text-[#1a7a5a] hover:bg-[#d8f2e8] cursor-pointer">
              <Plus size={14} /> Add note
            </button>
          )}
        </div>

        {/* Composer */}
        {noteOpen && (
          <div className="px-5 py-4 border-b border-[#eeece6] bg-[#fbfcfb]">
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-[#9b9890]">Lease</label>
              <select
                value={noteLeaseId ?? ''}
                onChange={e => setNoteLeaseId(Number(e.target.value))}
                className="text-xs font-medium text-[#1a1916] border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 bg-white cursor-pointer focus:outline-none focus:border-[#2e9f82]">
                {data.leases.map(l => (
                  <option key={l.id} value={l.id}>
                    {(l.unit.number ? `Unit ${l.unit.number}` : (l.unit.name ?? 'Unit')) + ` · ${l.ref}`}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-[#9b9890]">Shared across this tenancy&apos;s renewals.</span>
            </div>
            <textarea
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              rows={3}
              placeholder="What's going on with this lease? (e.g. payment arrangement, renewal intent, signatory change…)"
              className="w-full text-sm text-[#1a1916] border border-[#e8e6e0] rounded-xl px-3.5 py-2.5 resize-y focus:outline-none focus:border-[#2e9f82] placeholder:text-[#b3b0a8]"
            />
            {noteErr && <p className="text-xs mt-1.5 text-[#b91c1c] flex items-center gap-1"><AlertTriangle size={11} /> {noteErr}</p>}
            <div className="flex items-center justify-end gap-2 mt-2.5">
              <button type="button" onClick={() => { setNoteOpen(false); setNoteDraft(''); setNoteErr(null); }}
                className="text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] cursor-pointer">Cancel</button>
              <button type="button" onClick={submitNote} disabled={noteBusy || !noteDraft.trim() || noteLeaseId == null}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-50 cursor-pointer">
                {noteBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Save note
              </button>
            </div>
          </div>
        )}

        {/* Journal */}
        {notes.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#f4f3ef] text-[#9b9890] flex items-center justify-center mx-auto"><StickyNote size={20} /></div>
            <p className="text-sm text-[#6b6860] font-medium mt-3">No notes yet</p>
            <p className="text-xs text-[#9b9890] mt-1">Keep a running log of what&apos;s happening on each lease — payment arrangements, renewals, signatory changes.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#f1efe9]">
            {notes.map(n => {
              const isMgr = n.authorRole === 'manager';
              return (
                <div key={n.id} className="flex gap-3.5 px-5 py-4">
                  <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${isMgr ? 'bg-[#eef2fb] text-[#3b5bb5]' : 'bg-[#d8f2e8] text-[#1a7a5a]'}`}>
                    {noteInitials(n.authorName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#1a1916]">{n.authorName ?? 'Unknown'}</span>
                      {isMgr && <span className="inline-flex rounded text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-[#eef2fb] text-[#3b5bb5]">Manager</span>}
                      <Link href={contractHref(n.leaseId)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6b6860] bg-[#f4f3ef] hover:bg-[#eceae4] rounded px-1.5 py-0.5">
                        {n.unitLabel ? `${n.unitLabel} · ` : ''}{n.leaseRef}
                      </Link>
                      <span className="ml-auto text-[11px] text-[#9b9890]">{fmtNoteDate(n.createdAt)}</span>
                    </div>
                    <p className="text-sm text-[#5a564e] leading-relaxed mt-1 whitespace-pre-wrap break-words">{n.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Document reader — shared sidebar-list + gallery-preview popup (the same
          reader the Property / Unit views use). Drives KYC "View" / "View All"
          and the lease-doc "History Documents" preview. */}
      {reader && (
        <DocumentReaderModal
          title={reader.title}
          summary={reader.summary}
          slots={reader.slots}
          initialKey={reader.initialKey}
          onClose={() => setReader(null)}
        />
      )}

      {/* KYC upload popup — Front / Back slots for two-sided docs */}
      {uploadDoc && params?.id && (
        <KycUploadModal
          title={`Upload ${uploadDoc.title}`}
          ownerId={Number(params.id)}
          slots={uploadDoc.slots}
          onClose={() => setUploadDoc(null)}
          onChanged={load}
        />
      )}

      {/* Lease history popup */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowHistoryModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#e8e6e0]">
              <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2"><History size={16} className="text-[#6b6860]" /> Lease history ({pastLeases.length})</h3>
              <button type="button" onClick={() => setShowHistoryModal(false)} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="bg-[#f4f3ef]">
                  {LEASE_COLS.map(h => (<th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>))}
                </tr></thead>
                <tbody>{pastLeases.map(leaseRow)}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
