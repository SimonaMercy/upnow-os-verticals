'use client';

/**
 * Operations › Long-term leases › Final settlement — Genspark OS rebuild of the
 * end-of-lease settlement worksheet + RENTAL FINAL SETTLEMENT statement.
 * Re-exported unchanged by /dashboard/manager/contracts/[id]/settlement and by
 * /prototype/os/rp/contracts/[id]/settlement (paths are derived from the URL).
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET /api/contracts/:id (property / unit / customer name, landlord id → manager
 *    permission, tenant id → signing link, termination.method === 'direct').
 *  - GET /api/contracts/:id/settlement → apply() (lines, payments, caps, rules,
 *    stamps, refund payout, signatures, statement). Standard rows are prefilled under
 *    empty sections on a draft (utilities, property charges, §5 types) and the
 *    untouched prefills are dropped on save — unchanged.
 *  - PATCH /api/contracts/:id/settlement {depositHeld, notes, moveoutDateOverride, lines} — Save draft.
 *  - PATCH …/settlement (+rpSignature) on a draft, or PATCH …/settlement/sign {rpSignature}
 *    once sent — SignatureBlock (REUSED) "Sign settlement"; signed state shows the
 *    stored rpSignatoryName.
 *  - POST …/settlement/reseed {section} (after a save) — "Re-seed from source" per section.
 *  - PATCH …/settlement/payments {payments[]} — "Save payments"; proof is mandatory per
 *    payment (client guard + scroll to the card, error shown inside the card).
 *  - POST …/settlement/send (after save) — "Send to customer".
 *  - POST …/settlement/unsend — "Reopen to edit" while sent.
 *  - POST …/settlement/paid {allowGaps, refund?} / {allowOutstanding, allowGaps} — refund
 *    payout dialog (method, paid-on date, reference + proof required when a refund is due,
 *    optional on a zero-balance close) and "Close with balance owed"; then stores the
 *    Final Settlement PDF via storeContractPdf (best-effort). Direct-close (customer
 *    vacated) saves the draft first, exactly as before.
 *  - POST /api/portal/generate {purpose:'settlement', signerRole:'tenant'} — customer
 *    no-login signing link (generate, auto-copy, Copy, Open) while sent.
 *  - Evidence uploads (scan modal → POST /api/documents/upload-url → PUT → POST /api/documents,
 *    ownerType tenancy_contract, category payment, 15 MB cap) on charge lines, payments
 *    received and the refund payout; attachment chips link /api/documents/:docId/file;
 *    remove attachment.
 *  - Charge sections §3 Utilities / §4 Property charges / §5 Additional (type select:
 *    Breach / Overstay / Early Termination / Dispute / Admin) / §7 Rent & adjustments:
 *    add amount, description, amount, discount (only when the section cap > 0), net,
 *    remove; one-click configured penalties + administrative charges; discount guard
 *    (≤ line and ≤ section cap %) before save/sign.
 *  - Links: source lease of a bounced-cheque line (…/contracts/:id/v2), move-out report
 *    (…/contracts/:id/inspection/v2?type=move_out), Back (?from=… or the lease record,
 *    "Back to operations" when from Operations).
 *  - Worksheet / Statement toggle; Statement renders RentalFinalSettlementDoc (REUSED);
 *    Download PDF (RentalFinalSettlementPdf via @react-pdf, same object as the statement).
 *  - Maths unchanged: amounts are AED decimals as the API returns them (NOT fils);
 *    rowNet = max(0, amount − discount); balance = round2(deposit − Σnet + Σpayments);
 *    refund threshold ±0.005 exactly as before.
 *  - Manager permission: canSettleDeposits on the acting landlord gates Save / Send /
 *    Reopen / Sign / Mark paid / signing link (RP owners always may).
 *  - Status banners: paid (method / ref / date / proof), agreed, sent; error; "Saved." tick.
 *  - New (read-only, from the same data): settlement progress Flow, deposit / charges /
 *    payments / balance KPIs, "money held" note. A failed settlement load now shows a
 *    retry callout (previously silent).
 */

import { useState, useEffect, useCallback, useRef, createElement } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { useAuth } from '@/contexts/AuthContext';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import {
  ArrowLeft, Plus, Save, Send, Loader2, Banknote, Download, PencilLine, FileText, RefreshCw, Paperclip, X, ExternalLink,
} from 'lucide-react';
import { type TFSContract, type TFSRent } from '@/components/contract/TenantFinalSettlementDoc';
import RentalFinalSettlementDoc, { type RFSData } from '@/components/contract/RentalFinalSettlementDoc';
import { triggerBrowserDownload } from '@/lib/downloadDoc';
import { useDocumentScanner } from '@/components/upnow/DocumentScanModal';
import {
  OsPage, PageHead, ScopeStrip, Card, Kpis, Kpi, Pill, Btn, TableWrap, Seg, Callout, Evid, Flow, Field,
  type Tone,
} from '@/components/os/kit';

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
interface ApiPayment { id?: number; amount: number; method: PayMethod; reference: string | null; receivedOn: string | null; attachments?: LineAttachment[] | null }
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
  refundMethod?: PayMethod | null; refundReference?: string | null; refundPaidOn?: string | null; refundAttachments?: LineAttachment[] | null;
  lines: ApiLine[]; payments: ApiPayment[]; chargesTotal: number; paymentsReceivedTotal: number; balance: number;
  sentAt: string | null; agreedAt: string | null; paidAt: string | null; updatedAt: string | null;
  moveoutDateOverride?: string | null;
  availablePenalties?: { key: string; label: string; amount: number }[];
  adminChargeRules?: { key: string; label: string; amount: number }[];
  discountCaps?: { rent: number | null; penalties: number | null; restoration: number | null; utilities: number | null };
  gaps?: ApiGap[]; blockingGapCount?: number;
  statement?: ApiStatement;
}

interface ContractMeta { property: string; unit: string; tenantName: string; ref: string }
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
interface PayRow { key: string; amount: string; method: PayMethod; reference: string; receivedOn: string; attachments?: LineAttachment[] }

function uid() { return Math.random().toString(36).slice(2, 10); }
function aed(n: number) { return 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 2 }).format(n); }
function fmtDateTime(d: string | null) {
  return d ? new Date(d).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}
const rowNet = (r: Row) => Math.max(0, (Math.max(0, Number(r.amount) || 0)) - Math.max(0, Number(r.discount) || 0));

const STATUS_META: Record<SettlementStatus, { label: string; tone: Tone }> = {
  draft:  { label: 'Draft',            tone: 'neutral' },
  sent:   { label: 'Sent to customer', tone: 'amber' },
  agreed: { label: 'Customer agreed',  tone: 'primary' },
  paid:   { label: 'Refund paid',      tone: 'dark' },
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
      <span className="gx-btn-row" style={{ flex: 1, minWidth: 260, maxWidth: 520 }}>
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="Customer signing link"
          className="gx-inp" style={{ flex: 1, minWidth: 0, height: 28, fontSize: 11 }} />
        <Btn size="sm" variant="primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</Btn>
        <a href={link} target="_blank" rel="noreferrer" className="gx-btn sm"><ExternalLink size={12} aria-hidden /> Open</a>
      </span>
    );
  }
  return (
    <Btn size="sm" variant="amber" onClick={() => void gen()} disabled={state === 'loading'}>
      <Send size={12} aria-hidden /> {state === 'loading' ? 'Generating…' : state === 'error' ? 'Retry' : 'Get customer signing link'}
    </Btn>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettlementPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();
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
  // How the refund was paid out (0260) — shown on the paid banner once closed.
  const [refundInfo, setRefundInfo] = useState<{ method: PayMethod | null; reference: string | null; paidOn: string | null; attachments: LineAttachment[] | null }>({ method: null, reference: null, paidOn: null, attachments: null });
  // "Mark refund paid" dialog draft (only when a refund is actually due).
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundDraft, setRefundDraft] = useState<{ method: PayMethod; reference: string; paidOn: string; attachments: LineAttachment[] }>({ method: 'bank_transfer', reference: '', paidOn: '', attachments: [] });
  const [sig, setSig] = useState<{ rp: string | null; tenant: string | null }>({ rp: null, tenant: null });

  const [isDirect, setIsDirect] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPayments, setSavingPayments] = useState(false);
  // Payments-received problems render INSIDE that card (the page-top banner is
  // off-screen when the RP is working at the bottom of the form).
  const [payError, setPayError] = useState<string | null>(null);
  const payCardRef = useRef<HTMLDivElement | null>(null);
  const [reseeding, setReseeding] = useState<string | null>(null);
  const [acting, setActing] = useState<null | 'send' | 'paid' | 'unsend'>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Settlement fetch failed — shown as a retry callout (the worksheet still renders,
  // exactly as before, so nothing that worked is taken away).
  const [loadFailed, setLoadFailed] = useState(false);

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
    setPayRows((s.payments ?? []).map(p => ({ key: uid(), amount: String(p.amount), method: p.method, reference: p.reference ?? '', receivedOn: p.receivedOn ?? '', attachments: Array.isArray(p.attachments) ? p.attachments : undefined })));
    setStamps({ sentAt: s.sentAt, agreedAt: s.agreedAt, paidAt: s.paidAt });
    setRefundInfo({ method: s.refundMethod ?? null, reference: s.refundReference ?? null, paidOn: s.refundPaidOn ?? null, attachments: s.refundAttachments ?? null });
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
          ref: c.ref ?? '',
        });
        setLandlordId(c.landlord?.id ?? null);
        setTenantId(c.tenant?.id ?? null);
        setIsDirect(c.termination?.method === 'direct');
      }
      if (sRes.ok) {
        const s = await sRes.json() as ApiSettlement;
        if (s) apply(s);
      }
      setLoadFailed(!sRes.ok);
    } catch { setLoadFailed(true); } finally { setLoading(false); }
  }, [contractId, apply]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
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

  // Upload one evidence document (invoice, receipt, transfer slip, photo) against
  // this contract and return the attachment descriptor — shared by the charge
  // lines, the payments-received rows and the refund payout dialog.
  async function uploadEvidence(file: File): Promise<LineAttachment | null> {
    if (!contractId) return null;
    // Photos go through the scan modal first; PDFs pass straight through.
    // Null = the user closed the scanner — abort the upload.
    const scanned = await scan(file);
    if (!scanned) return null;
    file = scanned;
    if (file.size > 15 * 1024 * 1024) { setError('File must be under 15 MB.'); return null; }
    setError(null);
    try {
      // eslint-disable-next-line react-hooks/purity -- runs in an upload handler, never during render
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
      return { name: file.name, fileUrl, s3Key: fileKey, docId: (cj as { id?: number })?.id };
    } catch { setError('Attachment upload failed. Please try again.'); return null; }
  }

  async function attachToLine(key: string, file: File) {
    const att = await uploadEvidence(file);
    if (att) setRows(rs => rs.map(r => r.key === key ? { ...r, attachments: [...(r.attachments ?? []), att] } : r));
  }
  function removeAttachment(key: string, idx: number) {
    setRows(rs => rs.map(r => r.key === key ? { ...r, attachments: (r.attachments ?? []).filter((_, i) => i !== idx) } : r));
  }
  async function attachToPayment(key: string, file: File) {
    const att = await uploadEvidence(file);
    if (att) {
      setPayRows(rs => rs.map(r => r.key === key ? { ...r, attachments: [...(r.attachments ?? []), att] } : r));
      setPayError(null);
    }
  }
  function removePayAttachment(key: string, idx: number) {
    setPayRows(rs => rs.map(r => r.key === key ? { ...r, attachments: (r.attachments ?? []).filter((_, i) => i !== idx) } : r));
  }
  async function attachToRefund(file: File) {
    const att = await uploadEvidence(file);
    if (att) setRefundDraft(d => ({ ...d, attachments: [...d.attachments, att] }));
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
    // Proof is mandatory on every payment received (charges exceeded the deposit
    // — money changed hands outside the ledger). Mirrors the backend guard.
    if (payRows.some(r => Number(r.amount) > 0 && !(r.attachments?.length))) {
      setPayError('Attach proof of payment (receipt / transfer slip) to every payment received — use the paper-clip on each highlighted payment.');
      payCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    setSavingPayments(true); setError(null); setPayError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement/payments`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: payRows.filter(r => Number(r.amount) > 0)
            .map(r => ({ amount: Math.max(0, Number(r.amount) || 0), method: r.method, reference: r.reference.trim() || null, receivedOn: r.receivedOn || null, attachments: r.attachments?.length ? r.attachments : null })),
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setPayError(b?.message ?? 'Failed to save payments'); payCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return false; }
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

  async function markPaid(override?: { allowGaps?: boolean; allowOutstanding?: boolean; refund?: { method: PayMethod; reference: string | null; paidOn: string | null; attachments: LineAttachment[] | null } }) {
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
      setRefundOpen(false);
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
  const sm = STATUS_META[status];
  const refLabel = meta?.ref || rfs?.contract.contractNo || `CID-${contractId}`;
  const placeLine = meta
    ? [meta.property ? `${meta.property}${meta.unit ? ` — Unit ${meta.unit}` : ''}` : (meta.unit ? `Unit ${meta.unit}` : ''), meta.tenantName].filter(Boolean).join(' · ')
    : '';
  const head = (
    <PageHead
      eyebrow="Operations › Long-term leases"
      title={<>Final settlement · {refLabel}</>}
      lede={<>{placeLine ? <>{placeLine}. </> : null}The security deposit held for the customer, what is deducted from it and the refund — the statement the customer reviews and signs before the lease closes.</>}
      actions={<>
        <Btn href={backHref}><ArrowLeft size={13} aria-hidden /> {backLabel}</Btn>
        {!loading && (
          <Seg<'worksheet' | 'statement'> value={view} onChange={setView} label="Settlement view"
            options={[
              { v: 'worksheet', l: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><PencilLine size={12} aria-hidden /> Worksheet</span> },
              { v: 'statement', l: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><FileText size={12} aria-hidden /> Statement</span> },
            ]} />
        )}
        <Btn onClick={() => void downloadSettlementPdf()} disabled={!statement || downloading}>
          {downloading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />} Download PDF
        </Btn>
      </>}
    />
  );

  if (loading) {
    return (
      <OsPage>
        {head}
        <Card pad><div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
          {[70, 45, 60, 35].map((w, i) => <div key={i} className="gx-skel" style={{ height: 14, width: `${w}%` }} />)}
        </div></Card>
      </OsPage>
    );
  }

  const flowCurrent = status === 'draft' ? 0 : status === 'sent' ? 1 : status === 'agreed' ? 2 : 4;
  const balanceLabel = balance > 0 ? 'Net refund to customer' : balance < 0 ? 'Amount payable by customer' : 'Settled in full';
  const attChip = (a: LineAttachment, i: number, onRemove?: () => void) => (
    <span key={i} className="gx-pill outline" style={{ gap: 4 }}>
      <Paperclip size={10} aria-hidden />
      {a.docId
        ? <a href={`/api/documents/${a.docId}/file`} target="_blank" rel="noreferrer" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'underline' }}>{a.name}</a>
        : <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove attachment ${a.name}`} title="Remove attachment"
          style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex' }}><X size={11} aria-hidden /></button>
      )}
    </span>
  );
  const attachBtn = (label: string, onFile: (f: File) => void, title?: string) => (
    <label className="gx-btn xs" title={title} style={{ cursor: 'pointer' }}>
      <Paperclip size={11} aria-hidden /> {label}
      <input type="file" className="hidden" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ''; }} />
    </label>
  );

  return (
    <OsPage>
      {scannerModal}
      {head}

      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Long-term leases' },
        { label: 'Contract', value: refLabel },
        { label: 'Settlement', value: <Pill tone={sm.tone}>{sm.label}</Pill> },
        ...(isDirect ? [{ label: 'Close', value: 'Direct — customer vacated' }] : []),
        ...(!canSettle ? [{ label: 'Access', value: <Pill tone="neutral">View only</Pill> }] : []),
      ]} />

      {loadFailed && (
        <Callout tone="bad" title="Couldn’t load the settlement.">
          The figures below may be incomplete. <Btn size="xs" onClick={() => void load()}>Try again</Btn>
        </Callout>
      )}

      {/* Status banners */}
      {status === 'paid' && (
        <Callout title="Refund paid — settlement closed.">
          Marked paid {fmtDateTime(stamps.paidAt)}.
          {refundInfo.method ? ` Paid by ${METHOD_LABELS[refundInfo.method]}` : ''}
          {refundInfo.reference ? ` · ref ${refundInfo.reference}` : ''}
          {refundInfo.paidOn ? ` · on ${refundInfo.paidOn}` : ''}
          {(refundInfo.attachments?.length ?? 0) > 0 && (
            <div className="gx-chips" style={{ marginTop: 6 }}>{(refundInfo.attachments ?? []).map((a, i) => attChip(a, i))}</div>
          )}
        </Callout>
      )}
      {status === 'agreed' && (
        <Callout title="Customer agreed to the settlement.">Agreed {fmtDateTime(stamps.agreedAt)}. Pay out the refund, then mark it paid.</Callout>
      )}
      {status === 'sent' && (
        <Callout tone="warn" title="Awaiting customer agreement.">
          Sent {fmtDateTime(stamps.sentAt)} — locked for editing until the customer agrees. Reopen to make changes.
          {canSettle && (
            <div className="gx-btn-row" style={{ marginTop: 8 }}>
              <Btn size="sm" variant="amber" onClick={() => void reopenToDraft()} disabled={acting !== null}>
                {acting === 'unsend' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RefreshCw size={12} aria-hidden />} Reopen to edit
              </Btn>
              {/* No-login signing link — the RP shares it (e.g. WhatsApp) so the
                  customer reviews & signs the settlement without an account. */}
              {tenantId != null && contractId && (<>
                <span style={{ fontSize: 11.5 }}>Or send a no-login link to review &amp; sign:</span>
                <CustomerSigningLink tenantId={tenantId} contractId={contractId} />
              </>)}
            </div>
          )}
        </Callout>
      )}
      {error && <Callout tone="bad"><span style={{ whiteSpace: 'pre-line' }}>{error}</span></Callout>}
      {savedTick && !error && <Callout title="Saved.">Your changes are stored on this settlement.</Callout>}

      <div style={{ marginTop: 14 }}>
        <Kpis>
          <Kpi k="Deposit held" v={aed(depositNum)} d="Money held for the customer, not money earned" />
          <Kpi k="Charges (net)" v={aed(sumLines)} d={sumDiscounts > 0 ? `after ${aed(sumDiscounts)} discounts` : 'deducted from the deposit'} />
          <Kpi k="Payments received" v={aed(sumPayments)} d="collected from the customer" />
          <Kpi k={balanceLabel} v={aed(Math.abs(balance))} d={balance < 0 ? 'charges exceed the deposit' : status === 'paid' ? 'closed' : 'to settle'} dark />
        </Kpis>
      </div>

      <Card title="Settlement progress" sub={isDirect ? 'Customer has vacated — the refund can be recorded and the lease closed directly.' : 'Prepare → customer agrees → refund paid'}>
        <div className="gx-pad">
          <Flow current={flowCurrent} steps={[
            { t: 'Draft prepared', s: 'worksheet & signature' },
            { t: 'Sent to customer', s: stamps.sentAt ? fmtDateTime(stamps.sentAt) : 'review & sign' },
            { t: 'Customer agreed', s: stamps.agreedAt ? fmtDateTime(stamps.agreedAt) : 'signed statement' },
            { t: 'Refund paid', s: stamps.paidAt ? fmtDateTime(stamps.paidAt) : 'settlement closed' },
          ]} />
        </div>
      </Card>

      {view === 'worksheet' && (<>
        {/* Deposit + move-out date */}
        <div style={{ marginTop: 14 }}>
          <Card title="Deposit & move-out" sub="Deposits are money held, not money moved — the refund is what is left after the charges below.">
            <div className="gx-pad gx-two">
              <Field label="Security deposit held (AED)" htmlFor="st-deposit">
                <input id="st-deposit" className="gx-inp" type="number" min={0} step="0.01" value={deposit} disabled={locked}
                  onChange={e => setDeposit(e.target.value)} style={{ width: '100%', fontWeight: 700 }} />
              </Field>
              <Field label="Move-out date" htmlFor="st-moveout" hint="Rent accrues to this date. Set it when no termination date is on file.">
                <input id="st-moveout" className="gx-inp" type="date" value={moveOut ? String(moveOut).slice(0, 10) : ''} disabled={locked}
                  onChange={e => setMoveOut(e.target.value)} style={{ width: '100%' }} />
              </Field>
            </div>
          </Card>
        </div>

        {/* CEO sections — add amounts under each */}
        {SECTIONS.map(sec => {
          const secRows = rows.filter(r => sec.cats.includes(r.category));
          const secNet = secRows.reduce((a, r) => a + rowNet(r), 0);
          const cap = capFor(sec);
          const showType = sec.id === 'additional' && !locked;
          const showDisc = !locked && cap > 0;
          const cols = 4 + (showType ? 1 : 0) + (showDisc ? 1 : 0) + (!locked ? 1 : 0);
          const penalties = available.filter(p => !rows.some(r => r.label === p.label));
          const admins = adminRules.filter(p => !rows.some(r => r.label === p.label));
          return (
            <div key={sec.id} style={{ marginTop: 14 }}>
              <TableWrap toolbar={<>
                <span className="gx-pill dark" style={{ minWidth: 22, justifyContent: 'center' }}>§{sec.num}</span>
                <span style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{sec.title}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--ms-ink-3)' }}>{sec.hint}{showDisc ? ` · discount up to ${cap}%` : ''}</span>
                </span>
                <span className="sp" />
                {secNet > 0 && <b style={{ fontVariantNumeric: 'tabular-nums' }}>{aed(secNet)}</b>}
                {!locked && <Btn size="sm" onClick={() => addRow(sec.addCat, sec.addType)}><Plus size={12} aria-hidden /> Add amount</Btn>}
                {!locked && sec.reseed && (
                  <Btn size="sm" onClick={() => void reseed(sec.reseed!)} disabled={reseeding !== null || saving}>
                    {reseeding === sec.reseed ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RefreshCw size={12} aria-hidden />} Re-seed from source
                  </Btn>
                )}
              </>}>
                <table className="gx-tbl">
                  <thead><tr>
                    {showType && <th style={{ width: 130 }}>Type</th>}
                    <th>Description</th>
                    <th className="num" style={{ width: 120 }}>Amount (AED)</th>
                    {showDisc && <th className="num" style={{ width: 100 }}>Discount</th>}
                    <th className="num" style={{ width: 110 }}>Net</th>
                    <th>Evidence</th>
                    {!locked && <th className="act" style={{ width: 90 }}>Action</th>}
                  </tr></thead>
                  <tbody>
                    {secRows.length === 0 && (
                      <tr><td colSpan={cols}><span style={{ color: 'var(--ms-ink-3)' }}>{locked ? 'None.' : 'No amounts yet — use “Add amount”.'}</span></td></tr>
                    )}
                    {secRows.map(r => {
                      const gross = Math.max(0, Number(r.amount) || 0);
                      const disc = Math.max(0, Number(r.discount) || 0);
                      return (
                        <tr key={r.key}>
                          {showType && (
                            <td>
                              <select className="gx-sel" aria-label="Charge type" value={ADDITIONAL_CATS.some(a => a.value === r.category) ? r.category : 'dispute'}
                                onChange={e => updateRow(r.key, { category: e.target.value as LineCategory })} style={{ width: '100%', height: 28 }}>
                                {ADDITIONAL_CATS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                              </select>
                            </td>
                          )}
                          <td className="strong">
                            {locked ? (r.label || '—') : (
                              <input className="gx-inp" type="text" value={r.label} placeholder="Description" aria-label="Description"
                                onChange={e => updateRow(r.key, { label: e.target.value })} style={{ width: '100%', height: 28 }} />
                            )}
                          </td>
                          <td className="num">
                            {locked ? aed(gross) : (
                              <input className="gx-inp" type="number" min={0} step="0.01" value={r.amount} placeholder="0" aria-label={`Amount for ${r.label || 'line'}`}
                                onChange={e => updateRow(r.key, { amount: e.target.value })} style={{ width: 104, height: 28, textAlign: 'right' }} />
                            )}
                          </td>
                          {showDisc && (
                            <td className="num">
                              <input className="gx-inp" type="number" min={0} step="0.01" value={r.discount} placeholder="0" aria-label={`Discount for ${r.label || 'line'}`} title="Discount (AED)"
                                onChange={e => updateRow(r.key, { discount: e.target.value })} style={{ width: 84, height: 28, textAlign: 'right', color: 'var(--ms-amber-text)' }} />
                            </td>
                          )}
                          <td className="num strong">{aed(Math.max(0, gross - disc))}{disc > 0 && <span className="sub">less {aed(disc)}</span>}</td>
                          <td>
                            <div className="gx-chips" style={{ alignItems: 'center' }}>
                              {r.sourceContractId && (
                                <a href={contractHref(r.sourceContractId)} target="_blank" rel="noreferrer" className="gx-btn xs" title="Open the lease that holds this cheque">
                                  <ExternalLink size={10} aria-hidden /> {r.sourceContractNo ?? `contract #${r.sourceContractId}`}
                                </a>
                              )}
                              {r.inspectionContractId && (
                                <a href={moveOutReportHref(r.inspectionContractId)} target="_blank" rel="noreferrer" className="gx-btn xs" title="Open the move-out inspection report">
                                  <ExternalLink size={10} aria-hidden /> Move-out report
                                </a>
                              )}
                              {(r.attachments ?? []).map((a, i) => attChip(a, i, locked ? undefined : () => removeAttachment(r.key, i)))}
                              {!locked && attachBtn('Attach', f => void attachToLine(r.key, f), 'Attach document')}
                              {locked && !r.sourceContractId && !r.inspectionContractId && !(r.attachments?.length) && <span style={{ color: 'var(--ms-ink-3)' }}>—</span>}
                            </div>
                          </td>
                          {!locked && <td className="act"><Btn size="xs" variant="danger" onClick={() => removeRow(r.key)}>Remove</Btn></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* §5 — one-click configured penalties + admin charges */}
                {sec.id === 'additional' && !locked && (penalties.length > 0 || admins.length > 0) && (
                  <div className="gx-pad" style={{ borderTop: '1px solid var(--ms-surface-3)', display: 'grid', gap: 8 }}>
                    {penalties.length > 0 && (
                      <div>
                        <div className="gx-lb">Configured penalties (Settings → Fee Rules)</div>
                        <div className="gx-chips">
                          {penalties.map(p => (
                            <button key={p.key} type="button" className="gx-chip" onClick={() => addPenalty(p.key, p.label, p.amount)}>
                              + {p.label} · AED {p.amount.toLocaleString('en-AE')}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {admins.length > 0 && (
                      <div>
                        <div className="gx-lb">Administrative charges</div>
                        <div className="gx-chips">
                          {admins.map(p => (
                            <button key={p.key} type="button" className="gx-chip" onClick={() => addAdmin(p.label, p.amount)}>
                              + {p.label} · AED {p.amount.toLocaleString('en-AE')}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TableWrap>
            </div>
          );
        })}

        {/* Payments received from the customer */}
        <div ref={payCardRef} style={{ marginTop: 14 }}>
          <TableWrap toolbar={<>
            <span style={{ minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>Payments received</b>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--ms-ink-3)' }}>
                Money the customer pays you — e.g. when penalties or damages exceed the held deposit. Proof of payment (receipt / transfer slip) is required on every payment.
              </span>
            </span>
            <span className="sp" />
            {!payLocked && <Btn size="sm" onClick={addPayRow}><Plus size={12} aria-hidden /> Add payment</Btn>}
            {!payLocked && (
              <Btn size="sm" onClick={() => void savePayments()} disabled={savingPayments || acting !== null}>
                {savingPayments ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Save size={12} aria-hidden />} Save payments
              </Btn>
            )}
          </>}>
            <table className="gx-tbl">
              <thead><tr>
                <th className="num" style={{ width: 130 }}>Amount (AED)</th><th style={{ width: 140 }}>Method</th><th style={{ width: 150 }}>Received on</th>
                <th>Reference</th><th>Proof</th>{!payLocked && <th className="act" style={{ width: 90 }}>Action</th>}
              </tr></thead>
              <tbody>
                {payRows.length === 0 && (
                  <tr><td colSpan={payLocked ? 5 : 6}><span style={{ color: 'var(--ms-ink-3)' }}>{payLocked ? 'No payments recorded.' : 'No payments yet — use “Add payment” if the customer paid you directly.'}</span></td></tr>
                )}
                {payRows.map(r => {
                  const missingProof = !!payError && Number(r.amount) > 0 && !(r.attachments?.length);
                  const bg = missingProof ? { background: 'var(--ms-danger-bg)' } : undefined;
                  return (
                    <tr key={r.key}>
                      <td className="num" style={bg}>
                        <input className="gx-inp" type="number" min={0} step="0.01" value={r.amount} disabled={payLocked} placeholder="0" aria-label="Payment amount (AED)"
                          onChange={e => updatePayRow(r.key, { amount: e.target.value })} style={{ width: 110, height: 28, textAlign: 'right' }} />
                      </td>
                      <td style={bg}>
                        <select className="gx-sel" value={r.method} disabled={payLocked} aria-label="Payment method"
                          onChange={e => updatePayRow(r.key, { method: e.target.value as PayMethod })} style={{ width: '100%', height: 28 }}>
                          {(Object.keys(METHOD_LABELS) as PayMethod[]).map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                        </select>
                      </td>
                      <td style={bg}>
                        <input className="gx-inp" type="date" value={r.receivedOn} disabled={payLocked} aria-label="Received on"
                          onChange={e => updatePayRow(r.key, { receivedOn: e.target.value })} style={{ width: '100%', height: 28 }} />
                      </td>
                      <td style={bg}>
                        <input className="gx-inp" type="text" value={r.reference} disabled={payLocked} placeholder="Cheque no, transfer ref — optional" aria-label="Payment reference"
                          onChange={e => updatePayRow(r.key, { reference: e.target.value })} style={{ width: '100%', height: 28 }} />
                      </td>
                      <td style={bg}>
                        <div className="gx-chips" style={{ alignItems: 'center' }}>
                          {(r.attachments ?? []).map((a, i) => attChip(a, i, payLocked ? undefined : () => removePayAttachment(r.key, i)))}
                          {!payLocked && attachBtn(r.attachments?.length ? 'Attach more' : 'Attach proof', f => void attachToPayment(r.key, f), 'Attach proof of payment (receipt, transfer slip)')}
                          {missingProof && <Pill tone="danger">Proof required</Pill>}
                        </div>
                      </td>
                      {!payLocked && <td className="act" style={bg}><Btn size="xs" variant="danger" onClick={() => removePayRow(r.key)}>Remove</Btn></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {payError && <div className="gx-pad"><Callout tone="bad">{payError}</Callout></div>}
          </TableWrap>
        </div>

        {/* Settlement summary (§6 + §7) + notes */}
        <div className="gx-cols gx-cols-2e" style={{ marginTop: 14 }}>
          <Card title="Settlement summary" sub="§6 + §7 of the final settlement">
            <table className="gx-tbl">
              <tbody>
                <tr><td>Deposit held</td><td className="num strong">{aed(depositNum)}</td></tr>
                <tr><td>Less charges (net of discounts)</td><td className="num strong" style={{ color: 'var(--ms-danger)' }}>− {aed(sumLines)}</td></tr>
                {sumDiscounts > 0 && <tr><td>Discounts applied</td><td className="num" style={{ color: 'var(--ms-amber-text)' }}>{aed(sumDiscounts)}</td></tr>}
                {sumPayments > 0 && <tr><td>Plus payments received</td><td className="num strong" style={{ color: 'var(--ms-primary-dark)' }}>+ {aed(sumPayments)}</td></tr>}
                <tr>
                  <td className="strong" style={{ fontSize: 13 }}>{balanceLabel}</td>
                  <td className="num" style={{ fontSize: 17, fontWeight: 800, color: balance < 0 ? 'var(--ms-danger)' : 'var(--ms-primary-dark)' }}>{aed(Math.abs(balance))}</td>
                </tr>
              </tbody>
            </table>
            {balance < 0 && (
              <div className="gx-pad"><Evid tone="bad">Charges exceed the deposit — record the {aed(Math.abs(balance))} the customer owes under “Payments received”, or close with it kept as a receivable.</Evid></div>
            )}
          </Card>
          <Card title="Notes" sub="Visible to the customer">
            <div className="gx-pad">
              <textarea className="gx-ta" value={notes} disabled={locked} onChange={e => setNotes(e.target.value)} rows={4} aria-label="Settlement notes (visible to the customer)"
                placeholder="Explain the deductions, deposit handling, refund method…" style={{ width: '100%' }} />
            </div>
          </Card>
        </div>

        {/* Settlement signature — signed BY the person operating it (the acting
            manager or the logged-in RP owner), NOT the landlord/POA. Available
            until the settlement is paid, so the RP/manager can sign AFTER the
            customer (signing order is not enforced). */}
        {status !== 'paid' && canSettle && (
          <div style={{ marginTop: 14 }}>
            {sig.rp ? (
              // Who ACTUALLY signed (the stored §9 signatory), never the current viewer.
              <Callout title="Signed.">{statement?.contract?.rpSignatoryName || 'Authorised signatory'}</Callout>
            ) : (
              <Card title="Sign the settlement statement" sub="Add your signature to the final settlement before sending it to the customer.">
                <div className="gx-pad">
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
              </Card>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 14 }}>
          <Card title="Close the settlement" sub={
            status === 'paid' ? 'Settlement complete.'
              : !canSettle ? 'You can view this settlement; settling deposits needs the “Settle deposits” permission for this landlord.'
              : isDirect && status === 'draft' ? 'Customer has vacated — you can record the refund and close the lease directly.'
              : status === 'draft' ? 'Save as you go, then send the statement to the customer to agree and sign.'
              : 'Pay out the refund, then record it here to close the lease.'
          }>
            <div className="gx-pad" style={{ display: 'grid', gap: 12 }}>
              <div className="gx-btn-row">
                {!locked && canSettle && (<>
                  <Btn onClick={() => void save()} disabled={saving || acting !== null}>
                    {saving && acting === null ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Save size={13} aria-hidden />} Save draft
                  </Btn>
                  <Btn variant="primary" onClick={() => void sendToCustomer()} disabled={saving || acting !== null}>
                    {acting === 'send' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Send size={13} aria-hidden />} Send to customer
                  </Btn>
                </>)}
                {canSettle && (status === 'sent' || status === 'agreed' || (isDirect && status === 'draft')) && (<>
                  {/* Closing always opens the payout form: mandatory reference+proof
                      when a refund is due; optional closing record when the deposit
                      was fully applied (balance 0 — e.g. 4,000 held, 4,000 deducted). */}
                  <Btn variant="primary" onClick={() => setRefundOpen(o => !o)} disabled={acting !== null || balance < -0.005}>
                    {acting === 'paid' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Banknote size={13} aria-hidden />}
                    {balance > 0 ? 'Mark refund paid' : 'Mark settled & close'}
                  </Btn>
                  {balance < -0.005 && (<>
                    <span style={{ fontSize: 11.5, color: 'var(--ms-danger)' }}>Record the {aed(Math.abs(balance))} still owed, or:</span>
                    <Btn variant="danger" onClick={() => void markPaid({ allowOutstanding: true, allowGaps: true })} disabled={acting !== null}>
                      Close with balance owed
                    </Btn>
                  </>)}
                </>)}
                {status === 'paid' && <Pill tone="primary">Settlement complete</Pill>}
              </div>

              {canSettle && refundOpen && balance > -0.005 && (status === 'sent' || status === 'agreed' || (isDirect && status === 'draft')) && (
                <div className="gx-card" style={{ boxShadow: 'none', maxWidth: 560 }}>
                  <div className="gx-card-hd">
                    <div>
                      <h3>{balance > 0 ? `Refund payout — ${aed(balance)}` : 'Close settlement — deposit fully applied'}</h3>
                      {balance <= 0 && <div className="sub">The charges consumed the whole deposit — no refund is due. You can still record a reference and attach proof of the closure (optional).</div>}
                    </div>
                  </div>
                  <div className="gx-pad">
                    <div className="gx-two">
                      <Field label="Method" htmlFor="st-ref-method">
                        <select id="st-ref-method" className="gx-sel" value={refundDraft.method} onChange={e => setRefundDraft(d => ({ ...d, method: e.target.value as PayMethod }))} style={{ width: '100%' }}>
                          {(Object.keys(METHOD_LABELS) as PayMethod[]).map(m => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
                        </select>
                      </Field>
                      <Field label="Paid on" htmlFor="st-ref-date">
                        <input id="st-ref-date" className="gx-inp" type="date" value={refundDraft.paidOn} onChange={e => setRefundDraft(d => ({ ...d, paidOn: e.target.value }))} style={{ width: '100%' }} />
                      </Field>
                    </div>
                    <Field label={`Reference — ${balance > 0 ? 'required' : 'optional'}`} htmlFor="st-ref-ref">
                      <input id="st-ref-ref" className="gx-inp" type="text" value={refundDraft.reference} placeholder="Transfer ref, cheque no"
                        onChange={e => setRefundDraft(d => ({ ...d, reference: e.target.value }))} style={{ width: '100%' }} />
                    </Field>
                    <div className="gx-chips" style={{ alignItems: 'center' }}>
                      {attachBtn(`Attach proof of payment${balance > 0 ? ' (required)' : ''}`, f => void attachToRefund(f))}
                      {refundDraft.attachments.map((a, i) => attChip(a, i, () => setRefundDraft(d => ({ ...d, attachments: d.attachments.filter((_, j) => j !== i) }))))}
                    </div>
                    {/* Reference + proof are mandatory only when money is returned —
                        mirrors the backend guard in markSettlementPaid. */}
                    {balance > 0 && (!refundDraft.reference.trim() || refundDraft.attachments.length === 0) && (
                      <div className="gx-hint" style={{ color: 'var(--ms-amber-text)', marginTop: 8 }}>A payment reference and a proof attachment are required to close.</div>
                    )}
                    <div className="gx-btn-row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
                      <Btn onClick={() => setRefundOpen(false)}>Cancel</Btn>
                      <Btn variant="primary" disabled={acting !== null || (balance > 0 && (!refundDraft.reference.trim() || refundDraft.attachments.length === 0))}
                        onClick={() => {
                          // Only persist a payout record when something was actually
                          // entered — a bare zero-balance close stores nothing.
                          const hasPayout = !!refundDraft.reference.trim() || refundDraft.attachments.length > 0 || !!refundDraft.paidOn;
                          void markPaid({
                            allowGaps: true,
                            ...(hasPayout ? { refund: { method: refundDraft.method, reference: refundDraft.reference.trim() || null, paidOn: refundDraft.paidOn || null, attachments: refundDraft.attachments.length ? refundDraft.attachments : null } } : {}),
                          });
                        }}>
                        {acting === 'paid' && <Loader2 size={13} className="animate-spin" aria-hidden />} {balance > 0 ? 'Confirm refund paid' : 'Close settlement'}
                      </Btn>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </>)}

      {/* Statement view — the RENTAL FINAL SETTLEMENT document (9-section CEO form).
          The on-screen design; Download PDF renders the matching vector PDF. */}
      {view === 'statement' && (
        <div style={{ marginTop: 14 }}>
          {rfs ? (
            <RentalFinalSettlementDoc data={rfs} contractHref={contractHref} moveOutReportHref={moveOutReportHref} />
          ) : (
            <Card pad><span style={{ color: 'var(--ms-ink-3)' }}><Loader2 size={14} className="animate-spin" aria-hidden style={{ display: 'inline', marginRight: 6 }} /> Preparing statement…</span></Card>
          )}
        </div>
      )}
    </OsPage>
  );
}
