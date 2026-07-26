'use client';

import { useState, useEffect, useCallback, createElement } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { useAuth } from '@/contexts/AuthContext';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Trash2, Save, Send, CheckCircle, Loader2, AlertCircle,
  Wallet, BadgeCheck, Banknote, Coins, Download, PencilLine, FileText, RefreshCw, Paperclip, X, ExternalLink,
} from 'lucide-react';
import { type TFSContract, type TFSRent } from '@/components/contract/TenantFinalSettlementDoc';
import RentalFinalSettlementDoc, { type RFSData } from '@/components/contract/RentalFinalSettlementDoc';
import { triggerBrowserDownload } from '@/lib/downloadDoc';

// ─── Types ──────────────────────────────────────────────────────────────────

type SettlementStatus = 'draft' | 'sent' | 'agreed' | 'paid';
type LineType = 'deduction' | 'due';
type LineCategory = 'rent_due' | 'utility' | 'restoration' | 'penalty_breach' | 'early_termination' | 'overstay' | 'dispute' | 'admin' | 'other';
type PayMethod = 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'online';
type GapSeverity = 'blocking' | 'warning' | 'info';

const METHOD_LABELS: Record<PayMethod, string> = {
  cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', online: 'Online',
};

interface ApiLine {
  id?: number; label: string; amount: number; type: LineType;
  category?: LineCategory; source?: string; discountAmount?: number; discountReason?: string | null;
  paymentId?: number | null; net?: number; meta?: Record<string, unknown> | null;
  sourceContractId?: number; sourceContractNo?: string; inspectionContractId?: number;
}
interface ApiPayment { id?: number; amount: number; method: PayMethod; reference: string | null; receivedOn: string | null }
interface StatementPayRow { description: string; date?: string | null; amount?: number; method?: string | null; chequeNumber?: string | null; mode?: string; status?: string; penalty?: number | null; kind?: string }
interface ApiStatement {
  contract: TFSContract & { landlordName?: string; rpSignatoryName?: string; propertyType?: string | null; contractNo?: string; actualMoveOutDate?: string | null };
  contractSummary: StatementPayRow[];
  paymentHistory?: { label: string; band?: string; contractId?: number; contractNo?: string; startDate?: string | null; endDate?: string | null; rows: StatementPayRow[] }[];
  rent: TFSRent;
}
interface ApiGap { id: string; section: string; severity: GapSeverity; title: string; message: string; amount: number | null; amountKnown: string; heuristic?: boolean }
interface ApiSettlement {
  exists: boolean; id?: number; status: SettlementStatus; depositHeld: number; notes: string | null;
  rpSignature: string | null; tenantSignature: string | null; refundAmount: number | null;
  lines: ApiLine[]; payments: ApiPayment[]; chargesTotal: number; paymentsReceivedTotal: number; balance: number;
  sentAt: string | null; agreedAt: string | null; paidAt: string | null; updatedAt: string | null;
  moveoutDateOverride?: string | null;
  availablePenalties?: { key: string; label: string; amount: number }[];
  adminChargeRules?: { key: string; label: string; amount: number }[];
  discountCaps?: { rent: number | null; penalties: number | null; restoration: number | null; utilities: number | null };
  gaps?: ApiGap[]; blockingGapCount?: number;
  statement?: ApiStatement;
}

interface ContractMeta { property: string; unit: string; tenantName: string }
interface LineAttachment { name: string; fileUrl?: string; s3Key?: string; docId?: number }
interface Row {
  key: string; label: string; amount: string; type: LineType; category: LineCategory;
  source?: string; discount: string; discountReason: string; paymentId?: number | null; meta?: Record<string, unknown> | null;
  prefill?: boolean; attachments?: LineAttachment[]; sourceContractId?: number; sourceContractNo?: string; inspectionContractId?: number;
}

// Standard rows prefilled under a section when it has no entries yet, so the
// worksheet mirrors the final-settlement form (the RP just fills the amounts).
const STD_UTILITIES = ['Electricity / Water', 'Cooling / District Cooling', 'Gas', 'Community Fees', 'Telecommunications'];
const STD_RESTORATION = ['Repairs & Maintenance', 'Cleaning', 'Missing Keys / Remotes'];
interface PayRow { key: string; amount: string; method: PayMethod; reference: string; receivedOn: string }

function uid() { return Math.random().toString(36).slice(2, 10); }
function aed(n: number) { return 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 2 }).format(n); }
function fmtDateTime(d: string | null) {
  return d ? new Date(d).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
const rowNet = (r: Row) => Math.max(0, (Math.max(0, Number(r.amount) || 0)) - Math.max(0, Number(r.discount) || 0));

const STATUS_META: Record<SettlementStatus, { label: string; cls: string }> = {
  draft:  { label: 'Draft',            cls: 'bg-[#f4f3ef] text-[#6b6860]' },
  sent:   { label: 'Sent to customer', cls: 'bg-[#fff7ed] text-[#9a3412]' },
  agreed: { label: 'Customer agreed',  cls: 'bg-[#eef7f3] text-[#1a7a5a]' },
  paid:   { label: 'Refund paid',      cls: 'bg-[#2e9f82] text-white' },
};

// The CEO "RENTAL FINAL SETTLEMENT" sections — RP adds amounts under each.
interface SectionDef {
  id: string; num: number; title: string; hint: string;
  cats: LineCategory[]; addCat: LineCategory; addType: LineType;
  capKey?: 'utilities' | 'restoration' | 'penalties' | 'rent'; reseed?: 'utilities' | 'restoration' | 'penalties' | 'rent';
}
const SECTIONS: SectionDef[] = [
  { id: 'utility',     num: 3, title: 'Outstanding Utility & Service Charges', hint: 'DEWA / cooling / gas / community / telecom', cats: ['utility'], addCat: 'utility', addType: 'due', capKey: 'utilities', reseed: 'utilities' },
  { id: 'restoration', num: 4, title: 'Property Charges', hint: 'repairs, cleaning, missing keys — from the move-out inspection', cats: ['restoration'], addCat: 'restoration', addType: 'deduction', capKey: 'restoration', reseed: 'restoration' },
  { id: 'additional',  num: 5, title: 'Additional Recoverable Charges', hint: 'breach, early termination, overstay, dispute, admin', cats: ['penalty_breach', 'early_termination', 'overstay', 'dispute', 'admin'], addCat: 'dispute', addType: 'deduction', capKey: 'penalties', reseed: 'penalties' },
  { id: 'rent',        num: 7, title: 'Outstanding Rent & Adjustments', hint: 'rent accrued to move-out, plus any other adjustment', cats: ['rent_due', 'other'], addCat: 'other', addType: 'deduction', capKey: 'rent', reseed: 'rent' },
];

const penaltyKeyToCategory = (key: string): LineCategory =>
  key === 'earlyTermination' ? 'early_termination' : key === 'lateMoveout' ? 'overstay' : 'penalty_breach';

// §5 Additional Recoverable Charges — the CEO's fixed types. Each line picks one
// so it lands in the right statement row (a manually-added charge is no longer
// silently filed under "Dispute").
const ADDITIONAL_CATS: { value: LineCategory; label: string }[] = [
  { value: 'penalty_breach', label: 'Breach' },
  { value: 'overstay', label: 'Overstay' },
  { value: 'early_termination', label: 'Early Termination' },
  { value: 'dispute', label: 'Dispute' },
  { value: 'admin', label: 'Admin' },
];


// Generate + copy a no-login magic link the customer uses to review & sign the
// settlement (purpose='settlement'). Shown once the settlement is sent — the
// customer can only load/sign it after that (getSettlementForTenant is null on draft).
function CustomerSigningLink({ tenantId, contractId }: { tenantId: number; contractId: number | string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); };
  const gen = async () => {
    setState('loading');
    try {
      const r = await fetch('/api/portal/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, contractId: Number(contractId), purpose: 'settlement', signerRole: 'tenant' }),
      });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setLink(d.link ?? ''); setState('done');
      if (d.link) { try { await navigator.clipboard.writeText(d.link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }
    } catch { setState('error'); }
  };
  if (state === 'done' && link) {
    return (
      <div className="flex items-center gap-1.5 w-full max-w-lg">
        <input readOnly value={link} onFocus={e => e.currentTarget.select()}
          className="flex-1 text-[11px] px-2 py-1.5 rounded-lg border border-[#fdba74] bg-white text-[#1a1916] min-w-0" />
        <button type="button" onClick={copy} className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#2e9f82] text-white">{copied ? 'Copied ✓' : 'Copy'}</button>
        <a href={link} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-[#e8e6e0] text-[#6b6860] flex items-center gap-1"><ExternalLink size={12} /> Open</a>
      </div>
    );
  }
  return (
    <button type="button" onClick={gen} disabled={state === 'loading'}
      className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-[#9a3412] border border-[#fdba74] rounded-full px-3 py-1.5 hover:bg-[#ffedd5] disabled:opacity-60">
      <Send size={12} /> {state === 'loading' ? 'Generating…' : state === 'error' ? 'Retry' : 'Get customer signing link'}
    </button>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettlementPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const contractId = params?.id;
  // Back goes to wherever we came from (Operations pipeline when opened from there,
  // via ?from=…), falling back to the lease record for a direct/bookmarked visit.
  const from = searchParams?.get('from') || '';
  const backHref = from || ((pathname ?? '').replace(/\/settlement\/?$/, '/v2') || `/rental-provider/dashboard/contracts/${contractId}/v2`);
  const backLabel = from.includes('/operations') ? 'Back to operations' : 'Back to contract';
  // Link any lease in this dashboard context (RP or manager) — e.g. the lease that
  // holds a bounced cheque behind a penalty line.
  const dashBase = (pathname ?? '/rental-provider/dashboard/contracts').replace(/\/contracts\/[^/]+\/settlement.*$/, '');
  const contractHref = (id: number) => `${dashBase}/contracts/${id}/v2`;
  // The move-out inspection report a restoration line was priced from.
  const moveOutReportHref = (id: number) => `${dashBase}/contracts/${id}/inspection/v2?type=move_out`;

  // Final-settlement sign-off is gated by canSettleDeposits for a delegated
  // manager (?rp isn't propagated to this sub-route, so the acting landlord id
  // comes from the contract fetch). RP owners always may.
  const { canForRp } = useManagerPermissions();
  const { user: authUser } = useAuth();
  const isManagerView = (pathname ?? '').startsWith('/dashboard/manager');
  const [landlordId, setLandlordId] = useState<number | null>(null);
  const [tenantId, setTenantId] = useState<number | null>(null);

  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [view, setView] = useState<'worksheet' | 'statement'>('worksheet');
  const [statement, setStatement] = useState<ApiStatement | null>(null);
  const [status, setStatus] = useState<SettlementStatus>('draft');
  const [deposit, setDeposit] = useState('0');
  const [moveOut, setMoveOut] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [available, setAvailable] = useState<{ key: string; label: string; amount: number }[]>([]);
  const [adminRules, setAdminRules] = useState<{ key: string; label: string; amount: number }[]>([]);
  const [caps, setCaps] = useState<ApiSettlement['discountCaps']>({ rent: null, penalties: null, restoration: null, utilities: null });
  const [payRows, setPayRows] = useState<PayRow[]>([]);
  const [stamps, setStamps] = useState<{ sentAt: string | null; agreedAt: string | null; paidAt: string | null }>({ sentAt: null, agreedAt: null, paidAt: null });
  const [sig, setSig] = useState<{ rp: string | null; tenant: string | null }>({ rp: null, tenant: null });

  const [isDirect, setIsDirect] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPayments, setSavingPayments] = useState(false);
  const [reseeding, setReseeding] = useState<string | null>(null);
  const [acting, setActing] = useState<null | 'send' | 'paid' | 'unsend'>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manager may finalize the settlement only with canSettleDeposits on this
  // landlord; RP owners always may. Hides Save/Send/Mark-paid when not allowed.
  const canSettle = !isManagerView || (landlordId != null && canForRp('canSettleDeposits', landlordId));
  const locked = status !== 'draft';
  const payLocked = status === 'paid';

  const apply = useCallback((s: ApiSettlement) => {
    setStatus(s.status);
    setDeposit(String(s.depositHeld ?? 0));
    setMoveOut(s.moveoutDateOverride ?? s.statement?.contract?.actualMoveOutDate ?? '');
    setNotes(s.notes ?? '');
    const mapped: Row[] = (s.lines ?? []).map(l => {
      const rawMeta = (l.meta ?? {}) as Record<string, unknown> & { attachments?: LineAttachment[] };
      const { attachments, ...restMeta } = rawMeta;
      return {
        key: uid(), label: l.label, amount: String(l.amount), type: l.type,
        category: (l.category ?? 'other') as LineCategory, source: l.source,
        discount: l.discountAmount ? String(l.discountAmount) : '', discountReason: l.discountReason ?? '',
        paymentId: l.paymentId ?? null,
        meta: Object.keys(restMeta).length ? restMeta : null,
        attachments: Array.isArray(attachments) ? attachments : undefined,
        sourceContractId: l.sourceContractId,
        sourceContractNo: l.sourceContractNo,
        inspectionContractId: l.inspectionContractId,
      };
    });
    // Prefill each charge section with its standard rows when it's still empty
    // (editable drafts only), so the worksheet mirrors the final-settlement form
    // instead of showing a blank section. Empty prefills are dropped on save.
    const mkPrefill = (label: string, category: LineCategory, type: LineType): Row =>
      ({ key: uid(), label, amount: '', type, category, source: 'manual', discount: '', discountReason: '', prefill: true });
    let rowsToSet = mapped;
    if (s.status === 'draft') {
      const additionalCats: LineCategory[] = ['penalty_breach', 'overstay', 'early_termination', 'dispute', 'admin'];
      const extra: Row[] = [];
      if (!mapped.some(r => r.category === 'utility')) extra.push(...STD_UTILITIES.map(l => mkPrefill(l, 'utility', 'due')));
      if (!mapped.some(r => r.category === 'restoration')) extra.push(...STD_RESTORATION.map(l => mkPrefill(l, 'restoration', 'deduction')));
      if (!additionalCats.some(cat => mapped.some(r => r.category === cat))) extra.push(...ADDITIONAL_CATS.map(a => mkPrefill(a.label, a.value, 'deduction')));
      rowsToSet = [...mapped, ...extra];
    }
    setRows(rowsToSet);
    setAvailable(s.availablePenalties ?? []);
    setAdminRules(s.adminChargeRules ?? []);
    setCaps(s.discountCaps ?? { rent: null, penalties: null, restoration: null, utilities: null });
    setPayRows((s.payments ?? []).map(p => ({ key: uid(), amount: String(p.amount), method: p.method, reference: p.reference ?? '', receivedOn: p.receivedOn ?? '' })));
    setStamps({ sentAt: s.sentAt, agreedAt: s.agreedAt, paidAt: s.paidAt });
    setSig({ rp: s.rpSignature ?? null, tenant: s.tenantSignature ?? null });
    if (s.statement) setStatement(s.statement);
  }, []);

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(`/api/contracts/${contractId}`, { credentials: 'include' }),
        fetch(`/api/contracts/${contractId}/settlement`, { credentials: 'include' }),
      ]);
      if (cRes.ok) {
        const c = await cRes.json();
        setMeta({
          property: c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
          unit: c.unit?.number ?? c.unit?.unitNumber ?? '',
          tenantName: c.tenant?.companyName || c.tenant?.name || '',
        });
        setLandlordId(c.landlord?.id ?? null);
        setTenantId(c.tenant?.id ?? null);
        setIsDirect(c.termination?.method === 'direct');
      }
      if (sRes.ok) {
        const s = await sRes.json() as ApiSettlement;
        if (s) apply(s);
      }
    } finally { setLoading(false); }
  }, [contractId, apply]);

  useEffect(() => { void load(); }, [load]);

  const depositNum = Math.max(0, Number(deposit) || 0);
  const sumLines = rows.reduce((a, r) => a + rowNet(r), 0);
  const sumDiscounts = rows.reduce((a, r) => a + Math.max(0, Number(r.discount) || 0), 0);
  const sumPayments = payRows.reduce((a, r) => a + (Math.max(0, Number(r.amount) || 0)), 0);
  const balance = Math.round((depositNum - sumLines + sumPayments) * 100) / 100;

  const capFor = (sec: SectionDef): number => {
    const v = sec.capKey ? caps?.[sec.capKey] : null;
    return v == null ? 100 : v;
  };

  function addRow(category: LineCategory, type: LineType, label = '', amount = '') {
    setRows(r => [...r, { key: uid(), label, amount, type, category, discount: '', discountReason: '' }]);
  }
  function addPenalty(key: string, label: string, amount: number) {
    setRows(r => [...r, { key: uid(), label, amount: String(amount), type: 'deduction', category: penaltyKeyToCategory(key), source: 'rule', discount: '', discountReason: '' }]);
  }
  function addAdmin(label: string, amount: number) {
    setRows(r => [...r, { key: uid(), label, amount: String(amount), type: 'deduction', category: 'admin', source: 'rule', discount: '', discountReason: '' }]);
  }
  function updateRow(key: string, patch: Partial<Row>) { setRows(r => r.map(x => x.key === key ? { ...x, ...patch } : x)); }
  function removeRow(key: string) { setRows(r => r.filter(x => x.key !== key)); }

  function addPayRow() { setPayRows(r => [...r, { key: uid(), amount: '', method: 'cash', reference: '', receivedOn: '' }]); }
  function updatePayRow(key: string, patch: Partial<PayRow>) { setPayRows(r => r.map(x => x.key === key ? { ...x, ...patch } : x)); }
  function removePayRow(key: string) { setPayRows(r => r.filter(x => x.key !== key)); }

  function linesPayload() {
    return rows
      // keep real lines; drop the untouched utility prefills (label but no amount)
      .filter(r => (r.label.trim() || Number(r.amount) > 0) && !(r.prefill && !(Number(r.amount) > 0)))
      .map(r => {
        const atts = r.attachments?.length ? { attachments: r.attachments } : {};
        const meta = (r.meta || r.attachments?.length) ? { ...(r.meta || {}), ...atts } : null;
        return {
          label: r.label.trim() || 'Adjustment',
          amount: Math.max(0, Number(r.amount) || 0),
          type: r.type,
          category: r.category,
          source: r.source ?? 'manual',
          discountAmount: Math.max(0, Number(r.discount) || 0),
          discountReason: r.discountReason.trim() || null,
          paymentId: r.paymentId ?? null,
          meta,
        };
      });
  }

  // Attach an evidence document (invoice, receipt, photo) to a settlement line.
  async function attachToLine(key: string, file: File) {
    if (!contractId) return;
    if (file.size > 15 * 1024 * 1024) { setError('File must be under 15 MB.'); return; }
    setError(null);
    try {
      const docKey = `settlement_evidence_${Date.now()}`;
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: Number(contractId), documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
      });
      if (!urlRes.ok) throw new Error('upload-url');
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey?: string };
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      const put = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!put.ok) throw new Error('put');
      const created = await fetch('/api/documents', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: Number(contractId), category: 'payment', documentKey: docKey, displayName: file.name, fileUrl, mimeType: file.type || 'application/octet-stream', s3Key: fileKey, storageProvider: 's3' }),
      });
      const cj = created.ok ? await created.json().catch(() => ({})) : {};
      setRows(rs => rs.map(r => r.key === key ? { ...r, attachments: [...(r.attachments ?? []), { name: file.name, fileUrl, s3Key: fileKey, docId: (cj as { id?: number })?.id }] } : r));
    } catch { setError('Attachment upload failed. Please try again.'); }
  }
  function removeAttachment(key: string, idx: number) {
    setRows(rs => rs.map(r => r.key === key ? { ...r, attachments: (r.attachments ?? []).filter((_, i) => i !== idx) } : r));
  }

  // Client-side discount guard mirrors the backend (within the line + within cap).
  function discountError(): string | null {
    for (const r of rows) {
      const d = Math.max(0, Number(r.discount) || 0);
      if (d <= 0) continue;
      const amt = Math.max(0, Number(r.amount) || 0);
      if (d > amt) return `The discount on "${r.label.trim() || 'a line'}" exceeds the charge.`;
      const sec = SECTIONS.find(s => s.cats.includes(r.category));
      const cap = sec ? capFor(sec) : 100;
      if (d > (cap / 100) * amt + 0.005) return `The discount on "${r.label.trim() || 'a line'}" exceeds the ${cap}% limit (Settings → Fee Rules → Settlement Discounts).`;
    }
    return null;
  }

  async function save(): Promise<boolean> {
    if (!contractId) return false;
    const de = discountError();
    if (de) { setError(de); return false; }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositHeld: depositNum, notes: notes.trim() || null, moveoutDateOverride: moveOut || null, lines: linesPayload() }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to save'); return false; }
      const s = await res.json() as ApiSettlement;
      apply(s);
      setSavedTick(true); setTimeout(() => setSavedTick(false), 2500);
      return true;
    } catch { setError('Unexpected error. Please try again.'); return false; }
    finally { setSaving(false); }
  }

  // RP/manager signs the §9 settlement statement (the backend stamps
  // rpSignatoryName from the acting party). Signing order is NOT enforced: in
  // draft we persist the current figures + signature together (as when preparing);
  // once sent/agreed the figures are locked, so we add ONLY the signature — the
  // RP/manager may sign AFTER the customer. Reloads so the signed state + statement
  // pick it up.
  async function signSettlement(p: SignaturePayload) {
    if (!contractId) return;
    let res: Response;
    if (status === 'draft') {
      const de = discountError();
      if (de) throw new Error(de);
      res = await fetch(`/api/contracts/${contractId}/settlement`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositHeld: depositNum, notes: notes.trim() || null, moveoutDateOverride: moveOut || null, lines: linesPayload(), rpSignature: p.signatureImage }),
      });
    } else {
      // Signature-only path — allowed after the settlement has been sent.
      res = await fetch(`/api/contracts/${contractId}/settlement/sign`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpSignature: p.signatureImage }),
      });
    }
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? 'Failed to sign'); }
    apply(await res.json() as ApiSettlement);
  }

  async function reseed(section: 'utilities' | 'restoration' | 'penalties' | 'rent') {
    if (!contractId) return;
    // Re-seed replaces that section's auto lines from source; needs a saved row.
    setReseeding(section); setError(null);
    try {
      if (!rows.length && status === 'draft') { /* fresh draft already seeded live */ }
      const okSave = await save();
      if (!okSave) return;
      const res = await fetch(`/api/contracts/${contractId}/settlement/reseed`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to re-seed'); return; }
      const s = await res.json() as ApiSettlement;
      apply(s);
    } catch { setError('Unexpected error re-seeding.'); }
    finally { setReseeding(null); }
  }

  async function savePayments(opts?: { silent?: boolean }): Promise<boolean> {
    if (!contractId) return false;
    setSavingPayments(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement/payments`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: payRows.filter(r => Number(r.amount) > 0)
            .map(r => ({ amount: Math.max(0, Number(r.amount) || 0), method: r.method, reference: r.reference.trim() || null, receivedOn: r.receivedOn || null })),
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to save payments'); return false; }
      const s = await res.json() as ApiSettlement;
      apply(s);
      if (!opts?.silent) { setSavedTick(true); setTimeout(() => setSavedTick(false), 2500); }
      return true;
    } catch { setError('Unexpected error. Please try again.'); return false; }
    finally { setSavingPayments(false); }
  }

  async function sendToCustomer() {
    setActing('send'); setError(null);
    const ok = await save();
    if (!ok) { setActing(null); return; }
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement/send`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to send'); return; }
      await load();
    } catch { setError('Unexpected error sending settlement'); }
    finally { setActing(null); }
  }

  // Pull a sent settlement back to draft so it's editable again — allowed only
  // until the customer has agreed/signed (the backend blocks unsend once agreed).
  async function reopenToDraft() {
    setActing('unsend'); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement/unsend`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to reopen'); return; }
      await load();
    } catch { setError('Unexpected error reopening settlement'); }
    finally { setActing(null); }
  }

  async function markPaid(override?: { allowGaps?: boolean; allowOutstanding?: boolean }) {
    setActing('paid'); setError(null);
    if (isDirect && status === 'draft') {
      const ok = await save();
      if (!ok) { setActing(null); return; }
    }
    const okPay = await savePayments({ silent: true });
    if (!okPay) { setActing(null); return; }
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement/paid`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override ?? {}),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to mark paid'); return; }
      await load();
      try {
        const rfs = buildRfsData();
        if (rfs) {
          const [{ storeContractPdf }, mod] = await Promise.all([
            import('@/lib/storeContractPdf'),
            import('@/components/contract/RentalFinalSettlementPdf'),
          ]);
          await storeContractPdf({
            contractId: Number(contractId), documentKey: 'final_settlement', category: 'payment', displayName: 'Final Settlement',
            element: createElement(mod.default, { data: rfs }),
          });
        }
      } catch { /* PDF snapshot is best-effort */ }
    } catch { setError('Unexpected error marking paid'); }
    finally { setActing(null); }
  }

  // The RENTAL FINAL SETTLEMENT statement data — the same object the on-screen
  // doc renders — shared by the Statement view, the PDF download and the
  // mark-paid snapshot so all three stay identical.
  function buildRfsData(): RFSData | null {
    if (!statement) return null;
    return {
      contract: {
        landlordName: statement.contract.landlordName,
        rpSignatoryName: statement.contract.rpSignatoryName,
        tenantName: statement.contract.tenantName,
        propertyAddress: statement.contract.propertyAddress,
        unit: statement.contract.unit,
        contractNo: statement.contract.contractNo,
        propertyType: statement.contract.propertyType,
        contractAmount: statement.contract.contractAmount,
        startDate: statement.contract.startDate,
        endDate: statement.contract.endDate,
        actualMoveOutDate: statement.contract.actualMoveOutDate ?? (moveOut || null),
      },
      depositRow: (statement.contractSummary ?? []).find(r => r.kind === 'deposit') ?? null,
      paymentHistory: statement.paymentHistory ?? [],
      lines: rows.filter(r => r.label.trim() || Number(r.amount) > 0)
        .map(r => ({ label: r.label.trim() || 'Adjustment', amount: Math.max(0, Number(r.amount) || 0), net: rowNet(r), category: r.category, type: r.type, inspectionContractId: r.inspectionContractId })),
      depositHeld: depositNum,
      paymentsReceived: payRows.filter(r => Number(r.amount) > 0)
        .map(r => ({ amount: Math.max(0, Number(r.amount) || 0), method: r.method, reference: r.reference.trim() || null, receivedOn: r.receivedOn || null })),
      otherAdjustments: 0,
      settlementDate: stamps.paidAt,
      rpSignature: sig.rp,
      tenantSignature: sig.tenant,
      rpSignedAt: stamps.sentAt ?? stamps.paidAt,
      tenantSignedAt: sig.tenant ? (stamps.agreedAt ?? stamps.paidAt) : null,
    };
  }

  const rfs = buildRfsData();
  const pdfFileName = `Final-settlement-${rfs?.contract.contractNo || `CID-${contractId}`}.pdf`;

  // Download the RENTAL FINAL SETTLEMENT as a proper vector PDF — a real, clean A4
  // document (@react-pdf), consistent on every browser, like the receipts and
  // contracts. This is the SAME <RentalFinalSettlementPdf> stored on mark-paid, so
  // the download and the archived copy always match. (No more window.print.)
  async function downloadSettlementPdf() {
    if (!rfs) return;
    setDownloading(true);
    try {
      const [{ pdf }, mod] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/contract/RentalFinalSettlementPdf'),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(createElement(mod.default, { data: rfs }) as any).toBlob();
      const url = URL.createObjectURL(blob);
      triggerBrowserDownload(url, pdfFileName);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch { setError('Could not generate the settlement PDF. Please try again.'); }
    finally { setDownloading(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin text-[#2e9f82]" size={28} /></div>;
  }

  const sm = STATUS_META[status];

  return (
    <div className={`${view === 'statement' ? 'max-w-5xl' : 'max-w-4xl'} mx-auto px-4 py-8 space-y-5 transition-[max-width]`}>
      {/* Topbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={backHref} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] transition-colors">
          <ArrowLeft size={15} /> {backLabel}
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-[#e8e6e0] p-0.5 text-xs font-semibold">
            <button type="button" onClick={() => setView('worksheet')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${view === 'worksheet' ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'}`}>
              <PencilLine size={13} /> Worksheet
            </button>
            <button type="button" onClick={() => setView('statement')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${view === 'statement' ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'}`}>
              <FileText size={13} /> Statement
            </button>
          </div>
          <button type="button" onClick={downloadSettlementPdf} disabled={!statement || downloading}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-60">
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download PDF
          </button>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sm.cls}`}>{sm.label}</span>
        </div>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-[#1a1916] flex items-center gap-2"><Wallet size={22} className="text-[#2e9f82]" /> Final Settlement</h1>
        {meta && <p className="text-sm text-[#9b9890] mt-0.5">{meta.property}{meta.unit ? ` — Unit ${meta.unit}` : ''}{meta.tenantName ? ` · ${meta.tenantName}` : ''} · Contract #{contractId}</p>}
      </div>

      {/* Status banners */}
      {status === 'paid' && (
        <div className="flex items-start gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3">
          <CheckCircle size={15} className="text-[#2e9f82] shrink-0 mt-0.5" />
          <div><p className="font-semibold text-[#1a7a5a]">Refund paid — settlement closed</p>
            <p className="text-xs text-[#1a7a5a] mt-0.5">Marked paid {fmtDateTime(stamps.paidAt)}.</p></div>
        </div>
      )}
      {status === 'agreed' && (
        <div className="flex items-start gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3">
          <CheckCircle size={15} className="text-[#2e9f82] shrink-0 mt-0.5" />
          <div><p className="font-semibold text-[#1a7a5a]">Customer agreed to the settlement</p>
            <p className="text-xs text-[#1a7a5a] mt-0.5">Agreed {fmtDateTime(stamps.agreedAt)}. Pay out the refund, then mark it paid.</p></div>
        </div>
      )}
      {status === 'sent' && (
        <div className="bg-[#fff7ed] border border-[#fed7aa] rounded-xl px-4 py-3 space-y-2.5">
          <div className="flex items-start gap-3 text-sm">
            <AlertCircle size={15} className="text-[#c2410c] shrink-0 mt-0.5" />
            <div className="flex-1"><p className="font-semibold text-[#9a3412]">Awaiting customer agreement</p>
              <p className="text-xs text-[#c2410c] mt-0.5">Sent {fmtDateTime(stamps.sentAt)} — locked for editing until the customer agrees. Reopen to make changes.</p></div>
            {canSettle && (
              <button onClick={() => void reopenToDraft()} disabled={acting !== null}
                className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-[#9a3412] border border-[#fdba74] rounded-full px-3 py-1.5 hover:bg-[#ffedd5] disabled:opacity-60">
                {acting === 'unsend' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Reopen to edit
              </button>
            )}
          </div>
          {/* No-login signing link — RP shares it (e.g. WhatsApp) so the customer
              reviews & signs the settlement without an account. */}
          {canSettle && tenantId != null && contractId && (
            <div className="flex items-center gap-2 flex-wrap pl-[27px]">
              <span className="text-xs font-medium text-[#9a3412] shrink-0">Or send a no-login link to review &amp; sign:</span>
              <CustomerSigningLink tenantId={tenantId} contractId={contractId} />
            </div>
          )}
        </div>
      )}
      {error && <div className="flex items-start gap-2 text-sm text-[#dc2626] bg-[#fef2f2] rounded-xl px-4 py-3 whitespace-pre-line"><AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}</div>}
      {savedTick && !error && <div className="flex items-center gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3"><CheckCircle size={15} className="text-[#2e9f82]" /> <span className="font-semibold text-[#1a7a5a]">Saved.</span></div>}

      {view === 'worksheet' && (<>
      {/* Deposit + move-out date */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-[#9b9890] uppercase tracking-wide">Security deposit held</label>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#6b6860]">AED</span>
            <input type="number" min={0} step="0.01" value={deposit} disabled={locked} onChange={e => setDeposit(e.target.value)}
              className="flex-1 text-lg font-bold text-[#1a1916] border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
          </div>
        </div>
        <div className="space-y-2">
          <label className="block text-[11px] font-semibold text-[#9b9890] uppercase tracking-wide">Move-out date</label>
          <input type="date" value={moveOut ? String(moveOut).slice(0, 10) : ''} disabled={locked} onChange={e => setMoveOut(e.target.value)}
            className="w-full text-sm font-semibold text-[#1a1916] border border-[#e8e6e0] rounded-xl px-3 py-2.5 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
          <p className="text-[11px] text-[#9b9890]">Rent accrues to this date. Set it when no termination date is on file.</p>
        </div>
      </div>

      {/* CEO sections — add amounts under each (two-up on wider screens) */}
      <div className="grid md:grid-cols-2 gap-4 items-start">
      {SECTIONS.map(sec => {
        const secRows = rows.filter(r => sec.cats.includes(r.category));
        const secNet = secRows.reduce((a, r) => a + rowNet(r), 0);
        const cap = capFor(sec);
        return (
          <div key={sec.id} className="bg-white rounded-2xl border border-[#e8e6e0] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#2e9f82] text-white text-[11px] font-bold">{sec.num}</span>
                {sec.title}
              </h2>
              {secNet > 0 && <span className="text-sm font-bold text-[#1a1916] tabular-nums">{aed(secNet)}</span>}
            </div>
            <p className="text-[11px] text-[#9b9890] -mt-1">{sec.hint}</p>

            {secRows.length > 0 && (
              <div>
                {/* Inline line items — one row each: description · amount · discount · attach · remove */}
                {secRows.map(r => {
                  const gross = Math.max(0, Number(r.amount) || 0);
                  const disc = Math.max(0, Number(r.discount) || 0);
                  return (
                    <div key={r.key} className="border-b border-[#f4f2ee] last:border-b-0 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {sec.id === 'additional' && !locked && (
                          <select value={ADDITIONAL_CATS.some(a => a.value === r.category) ? r.category : 'dispute'}
                            onChange={e => updateRow(r.key, { category: e.target.value as LineCategory })}
                            title="Charge type"
                            className="shrink-0 w-[104px] text-[11px] text-[#6b6860] border border-[#e8e6e0] rounded-lg px-1 py-1 bg-white focus:outline-none focus:border-[#2e9f82]">
                            {ADDITIONAL_CATS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                          </select>
                        )}
                        <input type="text" value={r.label} disabled={locked} placeholder="Description"
                          onChange={e => updateRow(r.key, { label: e.target.value })}
                          className="flex-1 min-w-0 text-[13px] text-[#1a1916] border border-[#e8e6e0] rounded-lg px-2 py-1 focus:outline-none focus:border-[#2e9f82] disabled:border-transparent disabled:bg-transparent disabled:px-0" />
                        <span className="text-[10px] text-[#9b9890]">AED</span>
                        <input type="number" min={0} step="0.01" value={r.amount} disabled={locked} placeholder="0"
                          onChange={e => updateRow(r.key, { amount: e.target.value })}
                          className="w-[80px] text-[13px] text-right text-[#1a1916] border border-[#e8e6e0] rounded-lg px-1.5 py-1 focus:outline-none focus:border-[#2e9f82] disabled:border-transparent disabled:bg-transparent" />
                        {!locked && cap > 0 && (
                          <input type="number" min={0} step="0.01" value={r.discount} placeholder="disc" title="Discount (AED)"
                            onChange={e => updateRow(r.key, { discount: e.target.value })}
                            className="w-[58px] text-xs text-right text-[#b45309] border border-[#e8e6e0] rounded-lg px-1.5 py-1 focus:outline-none focus:border-[#2e9f82]" />
                        )}
                        {!locked && (
                          <label className="text-[#9b9890] hover:text-[#2e9f82] cursor-pointer shrink-0" title="Attach document">
                            <Paperclip size={14} />
                            <input type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void attachToLine(r.key, f); e.currentTarget.value = ''; }} />
                          </label>
                        )}
                        {!locked && <button type="button" onClick={() => removeRow(r.key)} className="text-[#c8c6be] hover:text-[#ef4444] shrink-0" title="Remove"><Trash2 size={14} /></button>}
                      </div>
                      {(disc > 0 || (r.attachments?.length ?? 0) > 0 || !!r.sourceContractId || !!r.inspectionContractId) && (
                        <div className="flex items-center gap-2 flex-wrap pl-1 pt-1">
                          {disc > 0 && <span className="text-[11px] text-[#6b6860]">Net <span className="font-semibold tabular-nums">{aed(Math.max(0, gross - disc))}</span></span>}
                          {r.sourceContractId && (
                            <a href={contractHref(r.sourceContractId)} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2e9f82] hover:underline" title="Open the lease that holds this cheque">
                              <ExternalLink size={10} /> {r.sourceContractNo ?? `contract #${r.sourceContractId}`}
                            </a>
                          )}
                          {r.inspectionContractId && (
                            <a href={moveOutReportHref(r.inspectionContractId)} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2e9f82] hover:underline" title="Open the move-out inspection report">
                              <ExternalLink size={10} /> Move-out report
                            </a>
                          )}
                          {(r.attachments ?? []).map((a, i) => (
                            <span key={i} className="inline-flex items-center gap-1 text-[11px] text-[#4a4842] bg-[#f4f3ef] rounded-full pl-2 pr-1 py-0.5">
                              <Paperclip size={10} className="text-[#9b9890]" />
                              {a.docId
                                ? <a href={`/api/documents/${a.docId}/file`} target="_blank" rel="noreferrer" className="max-w-[120px] truncate hover:underline">{a.name}</a>
                                : <span className="max-w-[120px] truncate">{a.name}</span>}
                              {!locked && <button type="button" onClick={() => removeAttachment(r.key, i)} className="text-[#c8c6be] hover:text-[#ef4444]"><X size={11} /></button>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {!locked && (
              <div className="flex items-center gap-3 pt-0.5 flex-wrap">
                <button type="button" onClick={() => addRow(sec.addCat, sec.addType)} className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:opacity-75"><Plus size={13} /> Add amount</button>
                {sec.reseed && (
                  <button type="button" onClick={() => void reseed(sec.reseed!)} disabled={reseeding !== null || saving}
                    className="flex items-center gap-1.5 text-xs font-medium text-[#6b6860] hover:text-[#2e9f82] disabled:opacity-50">
                    {reseeding === sec.reseed ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Re-seed from source
                  </button>
                )}
              </div>
            )}

            {/* §5 — one-click configured penalties + admin charges */}
            {sec.id === 'additional' && !locked && (available.length > 0 || adminRules.length > 0) && (
              <div className="pt-2 mt-1 border-t border-[#f0ede8] space-y-2">
                {available.filter(p => !rows.some(r => r.label === p.label)).length > 0 && (
                  <div>
                    <p className="text-[11px] text-[#9b9890] mb-1.5">Configured penalties (Settings → Fee Rules):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {available.filter(p => !rows.some(r => r.label === p.label)).map(p => (
                        <button key={p.key} type="button" onClick={() => addPenalty(p.key, p.label, p.amount)}
                          className="flex items-center gap-1 text-[11px] font-medium text-[#6b6860] border border-[#e8e6e0] rounded-full px-2.5 py-1 hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors">
                          <Plus size={11} /> {p.label} · AED {p.amount.toLocaleString('en-AE')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {adminRules.filter(p => !rows.some(r => r.label === p.label)).length > 0 && (
                  <div>
                    <p className="text-[11px] text-[#9b9890] mb-1.5">Administrative charges:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {adminRules.filter(p => !rows.some(r => r.label === p.label)).map(p => (
                        <button key={p.key} type="button" onClick={() => addAdmin(p.label, p.amount)}
                          className="flex items-center gap-1 text-[11px] font-medium text-[#6b6860] border border-[#e8e6e0] rounded-full px-2.5 py-1 hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors">
                          <Plus size={11} /> {p.label} · AED {p.amount.toLocaleString('en-AE')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {secRows.length === 0 && locked && <p className="text-xs text-[#9b9890]">None.</p>}
          </div>
        );
      })}
      </div>

      {/* Payments received from the customer */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5"><Coins size={15} className="text-[#2e9f82]" /> Payments received</h2>
          <span className="text-xs text-[#9b9890]">collected from the customer</span>
        </div>
        <p className="text-xs text-[#9b9890]">Money the customer pays you — e.g. when penalties or damages exceed the held deposit.</p>
        {payRows.length > 0 && (
          <div className="space-y-2">
            {payRows.map(r => (
              <div key={r.key} className="rounded-xl border border-[#eceae4] p-2.5 space-y-2">
                <div className="grid grid-cols-[1fr_140px_150px_auto] gap-2 items-center">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-[#9b9890]">AED</span>
                    <input type="number" min={0} step="0.01" value={r.amount} disabled={payLocked} placeholder="0"
                      onChange={e => updatePayRow(r.key, { amount: e.target.value })}
                      className="w-full text-sm text-[#1a1916] border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
                  </div>
                  <select value={r.method} disabled={payLocked} onChange={e => updatePayRow(r.key, { method: e.target.value as PayMethod })}
                    className="text-xs text-[#6b6860] border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] bg-white">
                    {(Object.keys(METHOD_LABELS) as PayMethod[]).map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                  </select>
                  <input type="date" value={r.receivedOn} disabled={payLocked} onChange={e => updatePayRow(r.key, { receivedOn: e.target.value })}
                    className="text-xs text-[#6b6860] border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] bg-white" />
                  {!payLocked
                    ? <button type="button" onClick={() => removePayRow(r.key)} className="text-[#c8c6be] hover:text-[#ef4444] transition-colors"><Trash2 size={15} /></button>
                    : <span className="w-[15px]" />}
                </div>
                <input type="text" value={r.reference} disabled={payLocked} placeholder="Reference (cheque no, transfer ref) — optional"
                  onChange={e => updatePayRow(r.key, { reference: e.target.value })}
                  className="w-full text-xs text-[#6b6860] border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6]" />
              </div>
            ))}
          </div>
        )}
        {!payLocked && (
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={addPayRow} className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:opacity-75"><Plus size={13} /> Add payment</button>
            <button type="button" onClick={() => void savePayments()} disabled={savingPayments || acting !== null}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#1a1916] border border-[#e8e6e0] rounded-full px-3 py-1.5 hover:bg-[#f4f3ef] disabled:opacity-60 transition-colors">
              {savingPayments ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save payments
            </button>
          </div>
        )}
        {payRows.length === 0 && payLocked && <p className="text-xs text-[#9b9890]">No payments recorded.</p>}
      </div>

      {/* Settlement summary (§6 + §7) */}
      <div className="bg-[#f0faf6] rounded-2xl border border-[#c5e8df] p-5 space-y-2">
        <div className="flex items-center justify-between text-sm"><span className="text-[#6b6860]">Deposit held</span><span className="font-semibold text-[#1a1916] tabular-nums">{aed(depositNum)}</span></div>
        <div className="flex items-center justify-between text-sm"><span className="text-[#6b6860]">Less charges (net of discounts)</span><span className="font-semibold text-[#b91c1c] tabular-nums">− {aed(sumLines)}</span></div>
        {sumDiscounts > 0 && (
          <div className="flex items-center justify-between text-xs"><span className="text-[#9b9890]">Discounts applied</span><span className="font-medium text-[#b45309] tabular-nums">{aed(sumDiscounts)}</span></div>
        )}
        {sumPayments > 0 && (
          <div className="flex items-center justify-between text-sm"><span className="text-[#6b6860]">Plus payments received</span><span className="font-semibold text-[#1a7a5a] tabular-nums">+ {aed(sumPayments)}</span></div>
        )}
        <div className="flex items-center justify-between border-t border-[#c5e8df] pt-2 mt-1">
          <span className="text-sm font-bold text-[#1a7a5a]">
            {balance > 0 ? 'Net refund to customer' : balance < 0 ? 'Amount payable by customer' : 'Settled in full'}
          </span>
          <span className={`text-xl font-bold tabular-nums ${balance < 0 ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'}`}>{aed(Math.abs(balance))}</span>
        </div>
        {balance < 0 && <p className="text-xs text-[#b91c1c]">Charges exceed the deposit — record the {aed(Math.abs(balance))} the customer owes under “Payments received”, or close with it kept as a receivable.</p>}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
        <label className="block text-sm font-semibold text-[#1a1916] mb-2">Notes <span className="text-[#9b9890] font-normal text-xs">visible to the customer</span></label>
        <textarea value={notes} disabled={locked} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Explain the deductions, deposit handling, refund method…"
          className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] resize-none disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
      </div>

      {/* Settlement signature — a final settlement is signed BY the person operating
          it (the acting manager or the logged-in RP owner), NOT the landlord/POA.
          Available until the settlement is paid, so the RP/manager can sign AFTER
          the customer (signing order is not enforced). */}
      {status !== 'paid' && canSettle && (
        sig.rp ? (
          <div className="bg-[#f0faf6] border border-[#c5e8df] rounded-2xl p-4 flex items-center gap-3">
            <BadgeCheck size={18} className="text-[#2e9f82] shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#1a1916]">Signed</p>
              {/* Show who ACTUALLY signed (the stored §9 signatory — the acting
                  manager or RP owner captured at sign time), never the current
                  viewer. Opening as the landlord must not relabel the signer. */}
              <p className="text-xs text-[#6b6860]">{statement?.contract?.rpSignatoryName || 'Authorised signatory'}</p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
            <h3 className="text-sm font-bold text-[#1a1916] mb-1">Sign the settlement statement</h3>
            <p className="text-xs text-[#6b6860] mb-3">Add your signature to the final settlement before sending it to the customer.</p>
            <SignatureBlock
              signerRole="Rental Provider / Property Manager"
              signerName={authUser?.name || ''}
              onBehalfOf={null}
              defaultName={authUser?.name || ''}
              termsText="I have reviewed and approve this final settlement statement."
              submitLabel="Sign settlement"
              alreadySigned={false}
              onSign={signSettlement}
            />
          </div>
        )
      )}

      {/* Actions */}
      {isDirect && status === 'draft' && (
        <p className="text-xs text-[#6b6860]">Customer has vacated — you can record the refund and close the lease directly.</p>
      )}
      <div className="flex flex-wrap items-start justify-end gap-3 pb-10">
        {!locked && canSettle && (
          <>
            <button onClick={() => void save()} disabled={saving || acting !== null}
              className="mr-auto flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-60 transition-colors">
              {saving && acting === null ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save draft
            </button>
            <button onClick={() => void sendToCustomer()} disabled={saving || acting !== null}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
              {acting === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to customer
            </button>
          </>
        )}
        {canSettle && (status === 'sent' || status === 'agreed' || (isDirect && status === 'draft')) && (
          <div className="flex flex-col items-end gap-1.5">
            <button onClick={() => void markPaid({ allowGaps: true })} disabled={acting !== null || balance < -0.005}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-[#1a7a5a] hover:bg-[#155f47] disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
              {acting === 'paid' ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
              {balance > 0 ? 'Mark refund paid' : 'Mark settled & close'}
            </button>
            {balance < -0.005 && (
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-[#b91c1c]">Record the {aed(Math.abs(balance))} still owed, or:</span>
                <button onClick={() => void markPaid({ allowOutstanding: true, allowGaps: true })} disabled={acting !== null}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#b91c1c] border border-[#fecaca] rounded-full px-3 py-1.5 hover:bg-[#fef2f2] disabled:opacity-60">
                  Close with balance owed →
                </button>
              </div>
            )}
          </div>
        )}
        {status === 'paid' && (
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1a7a5a]"><BadgeCheck size={16} /> Settlement complete</div>
        )}
      </div>
      </>)}

      {/* Statement view — the RENTAL FINAL SETTLEMENT document (9-section CEO form).
          The on-screen design; Download PDF renders the matching vector PDF. */}
      {view === 'statement' && (
        rfs ? (
          <RentalFinalSettlementDoc data={rfs} contractHref={contractHref} moveOutReportHref={moveOutReportHref} />
        ) : (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-8 text-center text-sm text-[#9b9890]">
            <Loader2 className="animate-spin inline mr-2" size={16} /> Preparing statement…
          </div>
        )
      )}
    </div>
  );
}
