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
  Globe, Calendar, Building2, AlertTriangle, TrendingUp, ShieldCheck, Files, Pencil, History,
  Upload, Check, Eye, Loader2, X,
} from 'lucide-react';
import { CustomerForm } from '@/components/upnow/CustomerForm';
import { CustomerDocsModal } from '@/components/upnow/CustomerDocsModal';
import { docLabel } from '@/lib/docLabel';
import { DocPreviewModal } from '@/components/upnow/DocPreviewModal';
import { KycUploadModal, type UploadSlot } from '@/components/upnow/KycUploadModal';
import { putKycSlot } from '@/lib/kycSlotUpload';

type Lease = {
  id: number; ref: string; contractType: string | null; status: string | null;
  contractActive: boolean; ejariStatus: string | null;
  startDate: string | null; endDate: string | null; annualRent: number;
  securityDeposit: number; collected: number; outstanding: number;
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
type CustomerDetail = {
  customer: {
    id: number; name: string | null; firstName: string | null; lastName: string | null;
    email: string | null; phone: string | null; emiratesId: string | null;
    nationality: string | null; gender: string | null; dateOfBirth: string | null;
    entityType: string | null; companyName: string | null; tradeLicenseNumber: string | null;
  };
  summary: { totalLeases: number; activeLeases: number; totalActiveRent: number; documentCount: number };
  financials: Financials;
  leases: Lease[];
  documents: Doc[];
};

const fmtAed = (n: number | null | undefined) => `AED ${Number(n ?? 0).toLocaleString('en-AE')}`;
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
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
// proofs, deposit receipts, lease paperwork) lives in the all-documents popup
// (shared CustomerDocsModal module).
const KYC_KEY_RE = /emirates|passport|visa|trade_license|moa|poa|labour|establishment/;
const isKycDoc = (d: Doc) =>
  (d.ownerType ?? 'customer') === 'customer' &&
  (d.category === 'identity' || d.category === 'license' || KYC_KEY_RE.test(d.documentKey));

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
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [showDeposits, setShowDeposits] = useState(false);

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

  // KYC preview / upload popups (set to the requirement being acted on).
  const [previewDoc, setPreviewDoc] = useState<{ title: string; docs: Doc[] } | null>(null);
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
  const isCompany = c.entityType === 'company';
  // Company customers are identified by their company name, individuals by person name.
  const displayName = isCompany && c.companyName ? c.companyName : (c.name ?? '—');
  const kycDocs = data.documents.filter(isKycDoc);
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
        { key: 'moa', label: 'Memorandum of Association (MOA)', category: 'compliance', required: true, match: keyMatcher('moa') },
        { key: 'emirates_id', label: 'Authorised Signatory Emirates ID', category: 'identity', required: true, match: isEidKey },
        { key: 'passport', label: 'Passport', category: 'identity', required: false, match: keyMatcher('passport') },
        { key: 'visa', label: 'UAE Visa / Residency', category: 'identity', required: false, match: k => /visa/.test(k) },
      ]
    : [
        { key: 'emirates_id', label: 'Emirates ID', category: 'identity', required: true, match: isEidKey },
        { key: 'passport', label: 'Passport', category: 'identity', required: true, match: keyMatcher('passport') },
        { key: 'visa', label: 'UAE Visa / Residency', category: 'identity', required: false, match: k => /visa/.test(k) },
      ];
  const kycChecklist = KYC_REQS.map(req => ({ req, docs: kycDocs.filter(d => req.match(d.documentKey)) }));
  const matchedKycIds = new Set(kycChecklist.flatMap(x => x.docs.map(d => d.id)));
  const extraKycDocs = kycDocs.filter(d => !matchedKycIds.has(d.id)); // KYC docs outside the standard checklist
  const kycUploadedCount = kycChecklist.filter(x => x.docs.length > 0).length;
  const otherDocsCount = data.documents.filter(d => !isKycDoc(d)).length; // non-KYC (shown in the popup, grouped by lease)
  const slotDoc = (d?: Doc): UploadSlot['existing'] => d ? { id: d.id, documentKey: d.documentKey, fileUrl: d.fileUrl, mimeType: d.mimeType } : null;
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
    return [...byUnit.values()].filter(l => l.securityDeposit > 0);
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
  if (!c.nationality) actions.push('Add nationality');
  if (!c.gender) actions.push('Add gender');
  if (!c.dateOfBirth) actions.push('Add date of birth');

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
    { icon: Globe, label: 'Nationality', value: c.nationality },
    { icon: User, label: 'Gender', value: c.gender ? c.gender.replace(/^./, x => x.toUpperCase()) : null },
    { icon: Calendar, label: 'DOB', value: c.dateOfBirth ? `${fmtDate(c.dateOfBirth)}${ageFromDob(c.dateOfBirth) != null ? ` · ${ageFromDob(c.dateOfBirth)} yrs` : ''}` : null },
    ...(isCompany ? [
      { icon: Building2, label: 'Company', value: c.companyName },
      { icon: IdCard, label: 'Trade license', value: c.tradeLicenseNumber },
    ] : []),
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
        <td className="px-4 py-3.5 font-medium">{fmtAed(l.annualRent)}</td>
        <td className="px-4 py-3.5">
          {!l.isCurrent ? <span className="text-[#9b9890]">—</span>
            : d === null ? <span className="text-[#9b9890]">—</span>
            : <span className={`text-xs font-medium ${renewalRed ? 'text-[#b91c1c]' : d <= 90 ? 'text-amber-600' : 'text-[#6b6860]'}`}>{d > 0 ? `${d}d` : `expired ${Math.abs(d)}d`}</span>}
        </td>
        <td className="px-4 py-3.5"><span className={`inline-flex rounded-full text-xs font-medium px-2.5 py-0.5 ${badge.cls}`}>{badge.label}</span></td>
        <td className="px-4 py-3.5">
          <Link href={`/rental-provider/dashboard/contracts/${l.id}/v2`} className="text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">View <ExternalLink size={12} /></Link>
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

      {/* Header card */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => router.push(listHref)} aria-label="Back to Customers"
            className="w-9 h-9 rounded-full border border-[#e8e6e0] flex items-center justify-center text-[#6b6860] hover:bg-[#f4f3ef] shrink-0 cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div className="w-11 h-11 rounded-full bg-[#d8f2e8] flex items-center justify-center text-[#2e9f82] font-semibold text-sm shrink-0">
            {isCompany ? <Building2 size={20} /> : initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-[#1a1916]">{displayName}</h1>
            <p className="text-xs text-[#6b6860] mt-1 flex items-center gap-1.5 flex-wrap">
              <Link href={listHref} className="hover:underline">Customers</Link>
              <span className="text-[#c4c1b8]">›</span>
              <span className="truncate max-w-[160px]">{displayName}</span>
            </p>
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-full border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] shrink-0 cursor-pointer">
              <Pencil size={14} /> Edit
            </button>
          )}
        </div>

        {/* Profile / KYC strip */}
        <div className="mt-4 border border-[#e8e6e0] rounded-xl px-4 py-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3">
          {profile.map((f, i) => (
            <div key={i} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-medium">{f.label}</div>
              <div className={`text-sm break-words mt-0.5 ${f.value ? 'text-[#1a1916] font-medium' : 'text-[#b91c1c] font-semibold'}`}>{f.value ?? 'Missing'}</div>
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
                  const proofs = data.documents.filter(d => d.leaseId === l.id && d.fileUrl &&
                    (d.ownerType === 'security_deposit' || /deposit|cheque/i.test(`${d.documentKey} ${d.displayName ?? ''}`)));
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-[#e8e6e0] rounded-xl px-4 py-2.5">
                      <span className="text-sm font-semibold text-[#1a1916]">{fmtAed(l.securityDeposit)}</span>
                      <span className="inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 bg-[#fff7e0] text-[#9a6b00]">Owed back to customer</span>
                      <span className="text-xs text-[#6b6860]">
                        {l.unit.number ? `Unit ${l.unit.number}` : (l.unit.name ?? '—')}{l.property.buildingName ? ` · ${l.property.buildingName}` : ''} · {l.ref} · {fmtDate(l.startDate)} → {fmtDate(l.endDate)}
                      </span>
                      {proofs.length > 0 ? proofs.map(d => (
                        <a key={d.id} href={d.fileUrl!} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2e9f82] bg-[#eef9f4] border border-[#cfe9df] rounded-full px-2 py-0.5 hover:underline">
                          <FileText size={11} /> {d.displayName || prettyKey(d.documentKey)}
                        </a>
                      )) : (
                        <span className="text-[11px] font-medium text-[#9a6b00]">No cheque / transfer receipt on file</span>
                      )}
                      <Link href={`/rental-provider/dashboard/contracts/${l.id}/v2`} className="ml-auto text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">
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
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        {/* Hidden picker for single-doc requirements (Passport, Visa, …) */}
        <input ref={directFileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={onDirectFile} />
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2"><FileText size={16} className="text-[#2e9f82]" /> KYC documents ({kycUploadedCount}/{KYC_REQS.length})</h2>
          {otherDocsCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllDocs(true)}
              className="text-sm text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Files size={14} /> All Documents ({otherDocsCount})
            </button>
          )}
        </div>
        <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
          {kycChecklist.map(({ req, docs }) => {
            const uploaded = docs.length > 0;
            return (
              <div key={req.key} className={`border rounded-xl p-3.5 flex items-center gap-3 ${uploaded ? 'border-[#e8e6e0]' : req.required ? 'border-[#fecaca] bg-[#fef9f9]' : 'border-[#e8e6e0]'}`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${uploaded ? 'bg-[#d8f2e8] text-[#1a7a5a]' : req.required ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#f4f3ef] text-[#9b9890]'}`}>
                  {uploaded ? <Check size={16} /> : <FileText size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[#1a1916]">{req.label}</span>
                    <span className={`inline-flex rounded-full text-[10px] font-semibold uppercase px-2 py-0.5 ${req.required ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#f4f3ef] text-[#9b9890]'}`}>{req.required ? 'Required' : 'Optional'}</span>
                  </div>
                  {uploaded ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                      {docs[0].status === 'pending' && <span className="inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 bg-[#fee2e2] text-[#b91c1c]">Pending review</span>}
                      {docs[0].expiryDate && <span className="text-[11px] text-[#9b9890]">exp {fmtDate(docs[0].expiryDate)}</span>}
                      {docs.length > 1 && <span className="text-[11px] text-[#9b9890]">{docs.length} files</span>}
                    </div>
                  ) : (
                    <p className={`text-xs mt-1 ${req.required ? 'text-[#b91c1c] font-medium' : 'text-[#9b9890]'}`}>Not uploaded</p>
                  )}
                  {directErr[req.key] && <p className="text-xs mt-1 text-[#b91c1c] flex items-center gap-1"><AlertTriangle size={11} /> {directErr[req.key]}</p>}
                </div>
                {/* Right-aligned actions: View sits next to Add / replace */}
                {uploaded && docs.some(d => d.fileUrl) && (
                  <button type="button" onClick={() => setPreviewDoc({ title: req.label, docs })}
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] cursor-pointer">
                    <Eye size={13} /> View
                  </button>
                )}
                {(() => {
                  const twoSided = req.key === 'emirates_id';
                  const busy = directBusy === req.key;
                  // Emirates ID opens the Front/Back slot popup; everything else picks a file directly.
                  const onClick = twoSided
                    ? () => setUploadDoc({ title: req.label, slots: slotsFor(req, docs) })
                    : () => pickDirect(slotsFor(req, docs)[0]);
                  return (
                    <button type="button" onClick={onClick} disabled={busy}
                      className={`shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full disabled:opacity-50 cursor-pointer ${uploaded ? 'border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef]' : 'bg-[#2e9f82] text-white hover:bg-[#267a65]'}`}>
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                      {uploaded ? 'Add / replace' : 'Upload'}
                    </button>
                  );
                })()}
              </div>
            );
          })}

          {/* KYC docs outside the standard checklist (e.g. labour card) — still listed */}
          {extraKycDocs.map(d => (
            <div key={d.id} className="border border-[#e8e6e0] rounded-xl p-3.5 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#d8f2e8] text-[#1a7a5a] flex items-center justify-center shrink-0"><Check size={16} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-[#1a1916]">{docLabel(d, data.documents)}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                  {d.status === 'pending' && <span className="inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 bg-[#fee2e2] text-[#b91c1c]">Pending review</span>}
                  {d.expiryDate && <span className="text-[11px] text-[#9b9890]">exp {fmtDate(d.expiryDate)}</span>}
                  {d.fileUrl && <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-0.5">View <ExternalLink size={10} /></a>}
                </div>
              </div>
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

      {/* All-documents popup — shared module (also used on the contract page) */}
      {showAllDocs && (
        <CustomerDocsModal
          documents={data.documents}
          tenantName={c.name}
          leases={data.leases.map(l => ({ id: l.id, ref: l.ref, startDate: l.startDate, endDate: l.endDate }))}
          excludeKyc
          onClose={() => setShowAllDocs(false)}
        />
      )}

      {/* KYC preview popup — shows both sides together */}
      {previewDoc && (
        <DocPreviewModal
          title={previewDoc.title}
          docs={previewDoc.docs.map(d => ({ id: d.id, fileUrl: d.fileUrl, mimeType: d.mimeType, caption: docLabel(d, data.documents).replace(/^Emirates ID\s*[—-]\s*/, '') || previewDoc.title }))}
          onClose={() => setPreviewDoc(null)}
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
