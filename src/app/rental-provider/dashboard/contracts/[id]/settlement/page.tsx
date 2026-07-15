'use client';

import { useState, useEffect, useCallback, createElement } from 'react';
import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Trash2, Save, Send, CheckCircle, Loader2, AlertCircle,
  Wallet, BadgeCheck, Banknote, Coins, Download, PencilLine, FileText,
} from 'lucide-react';
import { triggerBrowserDownload } from '@/lib/downloadDoc';
import TenantFinalSettlementDoc, { type TFSContract, type TFSRow, type TFSRent } from '@/components/contract/TenantFinalSettlementDoc';

// ─── Types ──────────────────────────────────────────────────────────────────

type SettlementStatus = 'draft' | 'sent' | 'agreed' | 'paid';
type LineType = 'deduction' | 'due';
type PayMethod = 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'online';

const METHOD_LABELS: Record<PayMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  card: 'Card',
  online: 'Online',
};

interface ApiLine { id?: number; label: string; amount: number; type: LineType }
interface ApiPayment { id?: number; amount: number; method: PayMethod; reference: string | null; receivedOn: string | null }
interface ApiStatement { contract: TFSContract; contractSummary: TFSRow[]; rent: TFSRent }
interface ApiSettlement {
  exists: boolean;
  id?: number;
  status: SettlementStatus;
  depositHeld: number;
  notes: string | null;
  rpSignature: string | null;
  tenantSignature: string | null;
  refundAmount: number | null;
  lines: ApiLine[];
  payments: ApiPayment[];
  chargesTotal: number;
  paymentsReceivedTotal: number;
  balance: number;
  sentAt: string | null;
  agreedAt: string | null;
  paidAt: string | null;
  updatedAt: string | null;
  availablePenalties?: { key: string; label: string; amount: number }[];
  statement?: ApiStatement;
}

interface ContractMeta {
  property: string;
  unit: string;
  tenantName: string;
}

interface Row { key: string; label: string; amount: string; type: LineType }
interface PayRow { key: string; amount: string; method: PayMethod; reference: string; receivedOn: string }

function uid() { return Math.random().toString(36).slice(2, 10); }
function aed(n: number) { return 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 2 }).format(n); }
function fmtDateTime(d: string | null) {
  return d ? new Date(d).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

const STATUS_META: Record<SettlementStatus, { label: string; cls: string }> = {
  draft:  { label: 'Draft',           cls: 'bg-[#f4f3ef] text-[#6b6860]' },
  sent:   { label: 'Sent to customer', cls: 'bg-[#fff7ed] text-[#9a3412]' },
  agreed: { label: 'Customer agreed',  cls: 'bg-[#eef7f3] text-[#1a7a5a]' },
  paid:   { label: 'Refund paid',      cls: 'bg-[#2e9f82] text-white' },
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettlementPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const contractId = params?.id;
  // Back goes to the contract page (works even when opened directly — router.back()
  // is a no-op with no history). Keeps the manager vs RP route context.
  const backHref = (pathname ?? '').replace(/\/settlement\/?$/, '/v2') || `/rental-provider/dashboard/contracts/${contractId}/v2`;

  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [view, setView] = useState<'worksheet' | 'statement'>('worksheet');
  const [statement, setStatement] = useState<ApiStatement | null>(null);
  const [status, setStatus] = useState<SettlementStatus>('draft');
  const [deposit, setDeposit] = useState('0');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [available, setAvailable] = useState<{ key: string; label: string; amount: number }[]>([]);
  const [payRows, setPayRows] = useState<PayRow[]>([]);
  const [stamps, setStamps] = useState<{ sentAt: string | null; agreedAt: string | null; paidAt: string | null }>({ sentAt: null, agreedAt: null, paidAt: null });

  const [isDirect, setIsDirect] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPayments, setSavingPayments] = useState(false);
  const [acting, setActing] = useState<null | 'send' | 'paid'>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deposit/deduction figures are editable only as a draft. Once sent to the
  // customer they're shared/agreed and must not change — locked through sent →
  // agreed → paid.
  const locked = status !== 'draft';
  // Payments collected from the tenant happen AFTER agreement, so they stay
  // editable right up until the settlement is closed (marked paid).
  const payLocked = status === 'paid';

  const apply = useCallback((s: ApiSettlement) => {
    setStatus(s.status);
    setDeposit(String(s.depositHeld ?? 0));
    setNotes(s.notes ?? '');
    setRows((s.lines ?? []).map(l => ({ key: uid(), label: l.label, amount: String(l.amount), type: l.type })));
    setAvailable(s.availablePenalties ?? []);
    setPayRows((s.payments ?? []).map(p => ({ key: uid(), amount: String(p.amount), method: p.method, reference: p.reference ?? '', receivedOn: p.receivedOn ?? '' })));
    setStamps({ sentAt: s.sentAt, agreedAt: s.agreedAt, paidAt: s.paidAt });
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
          tenantName: c.tenant?.name ?? '',
        });
        setIsDirect(c.termination?.method === 'direct');
      }
      if (sRes.ok) {
        const s = await sRes.json() as ApiSettlement;
        if (s) apply(s);
      }
    } finally {
      setLoading(false);
    }
  }, [contractId, apply]);

  useEffect(() => { void load(); }, [load]);

  const depositNum = Math.max(0, Number(deposit) || 0);
  const sumLines = rows.reduce((a, r) => a + (Math.max(0, Number(r.amount) || 0)), 0);
  const sumPayments = payRows.reduce((a, r) => a + (Math.max(0, Number(r.amount) || 0)), 0);
  // What's still owed/refundable once deposit, charges AND money collected from
  // the tenant are netted. > 0 refund due, < 0 tenant still owes, 0 settled.
  const balance = Math.round((depositNum - sumLines + sumPayments) * 100) / 100;

  function addRow(type: LineType) { setRows(r => [...r, { key: uid(), label: '', amount: '', type }]); }
  function addPenalty(label: string, amount: number) { setRows(r => [...r, { key: uid(), label, amount: String(amount), type: 'deduction' }]); }
  function updateRow(key: string, patch: Partial<Row>) { setRows(r => r.map(x => x.key === key ? { ...x, ...patch } : x)); }
  function removeRow(key: string) { setRows(r => r.filter(x => x.key !== key)); }

  function addPayRow() { setPayRows(r => [...r, { key: uid(), amount: '', method: 'cash', reference: '', receivedOn: '' }]); }
  function updatePayRow(key: string, patch: Partial<PayRow>) { setPayRows(r => r.map(x => x.key === key ? { ...x, ...patch } : x)); }
  function removePayRow(key: string) { setPayRows(r => r.filter(x => x.key !== key)); }

  async function save(): Promise<boolean> {
    if (!contractId) return false;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositHeld: depositNum,
          notes: notes.trim() || null,
          lines: rows
            .filter(r => r.label.trim() || Number(r.amount) > 0)
            .map(r => ({ label: r.label.trim() || 'Adjustment', amount: Math.max(0, Number(r.amount) || 0), type: r.type })),
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to save'); return false; }
      const s = await res.json() as ApiSettlement;
      apply(s);
      setSavedTick(true); setTimeout(() => setSavedTick(false), 2500);
      return true;
    } catch { setError('Unexpected error. Please try again.'); return false; }
    finally { setSaving(false); }
  }

  async function savePayments(opts?: { silent?: boolean }): Promise<boolean> {
    if (!contractId) return false;
    setSavingPayments(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement/payments`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payments: payRows
            .filter(r => Number(r.amount) > 0)
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

  async function markPaid() {
    setActing('paid'); setError(null);
    // Direct close-out can pay straight from draft — persist any in-progress
    // edits first so the lease isn't closed on stale figures (the send→paid
    // path already saves via sendToCustomer()).
    if (isDirect && status === 'draft') {
      const ok = await save();
      if (!ok) { setActing(null); return; }
    }
    // Flush any in-progress payments-received edits so the close balance check
    // (backend rejects closing while the tenant still owes) sees the latest.
    const okPay = await savePayments({ silent: true });
    if (!okPay) { setActing(null); return; }
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement/paid`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to mark paid'); return; }
      await load();
      // Snapshot the completed settlement as a stored PDF so the contract documents
      // binder shows a real document (best-effort — never block the close-out).
      try {
        const sres = await fetch(`/api/contracts/${contractId}/settlement`, { credentials: 'include' });
        if (sres.ok) {
          const sd = await sres.json() as ApiSettlement;
          const [{ storeContractPdf }, mod] = await Promise.all([
            import('@/lib/storeContractPdf'),
            import('@/components/contract/DepositSettlementPdf'),
          ]);
          await storeContractPdf({
            contractId: Number(contractId), documentKey: 'deposit_settlement', category: 'payment', displayName: 'Deposit Settlement',
            element: createElement(mod.default, { data: {
              ref: `CID-${contractId}`, property: meta?.property ?? '', unit: meta?.unit ?? '', tenantName: meta?.tenantName ?? '',
              depositHeld: sd.depositHeld, lines: sd.lines, chargesTotal: sd.chargesTotal, refundAmount: sd.refundAmount,
              payments: sd.payments, paymentsReceivedTotal: sd.paymentsReceivedTotal, balance: sd.balance,
              paidAt: sd.paidAt, rpSignature: sd.rpSignature, tenantSignature: sd.tenantSignature, notes: sd.notes,
            } }),
          });
        }
      } catch { /* PDF snapshot is best-effort */ }
    } catch { setError('Unexpected error marking paid'); }
    finally { setActing(null); }
  }

  // Clean, watermark-free download of the settlement statement (the same react-pdf
  // document the snapshot uses). The live-fallback download for the binder, plus a
  // download from the settlement page itself. Fetches the latest figures on demand.
  async function downloadSettlementPdf() {
    try {
      const sres = await fetch(`/api/contracts/${contractId}/settlement`, { credentials: 'include' });
      if (!sres.ok) return;
      const sd = await sres.json() as ApiSettlement;
      const [{ pdf }, mod] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/contract/DepositSettlementPdf'),
      ]);
      const pdfData = {
        ref: `CID-${contractId}`, property: meta?.property ?? '', unit: meta?.unit ?? '', tenantName: meta?.tenantName ?? '',
        depositHeld: sd.depositHeld, lines: sd.lines, chargesTotal: sd.chargesTotal, refundAmount: sd.refundAmount,
        payments: sd.payments, paymentsReceivedTotal: sd.paymentsReceivedTotal, balance: sd.balance,
        paidAt: sd.paidAt, rpSignature: sd.rpSignature, tenantSignature: sd.tenantSignature, notes: sd.notes,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(createElement(mod.default, { data: pdfData as any }) as any).toBlob();
      const url = URL.createObjectURL(blob);
      triggerBrowserDownload(url, `Deposit-settlement-CID-${contractId}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch { /* best-effort download */ }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin text-[#2e9f82]" size={28} /></div>;
  }

  const sm = STATUS_META[status];

  return (
    <div className={`${view === 'statement' ? 'max-w-5xl' : 'max-w-2xl'} mx-auto px-4 py-8 space-y-6 transition-[max-width]`}>
      {/* Topbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={backHref} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] transition-colors">
          <ArrowLeft size={15} /> Back to contract
        </Link>
        <div className="flex items-center gap-2">
          {/* Worksheet ⇄ Statement view toggle */}
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
          <button type="button" onClick={downloadSettlementPdf} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]">
            <Download size={13} /> Download PDF
          </button>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sm.cls}`}>{sm.label}</span>
        </div>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-[#1a1916] flex items-center gap-2"><Wallet size={22} className="text-[#2e9f82]" /> Deposit Settlement</h1>
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
        <div className="flex items-start gap-2 text-sm bg-[#fff7ed] border border-[#fed7aa] rounded-xl px-4 py-3">
          <AlertCircle size={15} className="text-[#c2410c] shrink-0 mt-0.5" />
          <div><p className="font-semibold text-[#9a3412]">Awaiting customer agreement</p>
            <p className="text-xs text-[#c2410c] mt-0.5">Sent {fmtDateTime(stamps.sentAt)} — now locked for editing. Mark the refund paid once you’ve settled with the customer.</p></div>
        </div>
      )}
      {error && <div className="flex items-center gap-2 text-sm text-[#dc2626] bg-[#fef2f2] rounded-xl px-4 py-3"><AlertCircle size={15} /> {error}</div>}
      {savedTick && !error && <div className="flex items-center gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3"><CheckCircle size={15} className="text-[#2e9f82]" /> <span className="font-semibold text-[#1a7a5a]">Saved.</span></div>}

      {view === 'worksheet' && (<>
      {/* Deposit */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-2">
        <label className="block text-[11px] font-semibold text-[#9b9890] uppercase tracking-wide">Security deposit held</label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#6b6860]">AED</span>
          <input type="number" min={0} step="0.01" value={deposit} disabled={locked}
            onChange={e => setDeposit(e.target.value)}
            className="flex-1 text-lg font-bold text-[#1a1916] border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
        </div>
      </div>

      {/* Deductions & dues */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1a1916]">Deductions &amp; dues</h2>
          <span className="text-xs text-[#9b9890]">subtracted from the deposit</span>
        </div>

        {rows.length > 0 && (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.key} className="grid grid-cols-[1fr_120px_110px_auto] gap-2 items-center">
                <input type="text" value={r.label} disabled={locked} placeholder="e.g. AC repair, unpaid DEWA"
                  onChange={e => updateRow(r.key, { label: e.target.value })}
                  className="text-sm text-[#1a1916] border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-[#9b9890]">AED</span>
                  <input type="number" min={0} step="0.01" value={r.amount} disabled={locked} placeholder="0"
                    onChange={e => updateRow(r.key, { amount: e.target.value })}
                    className="w-full text-sm text-[#1a1916] border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
                </div>
                <select value={r.type} disabled={locked} onChange={e => updateRow(r.key, { type: e.target.value as LineType })}
                  className="text-xs text-[#6b6860] border border-[#e8e6e0] rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2e9f82] disabled:bg-[#f9f8f6] bg-white">
                  <option value="deduction">Deduction</option>
                  <option value="due">Due</option>
                </select>
                {!locked
                  ? <button type="button" onClick={() => removeRow(r.key)} className="text-[#c8c6be] hover:text-[#ef4444] transition-colors"><Trash2 size={15} /></button>
                  : <span className="w-[15px]" />}
              </div>
            ))}
          </div>
        )}

        {!locked && (
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => addRow('deduction')} className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:opacity-75"><Plus size={13} /> Add deduction</button>
            <button type="button" onClick={() => addRow('due')} className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:opacity-75"><Plus size={13} /> Add due</button>
          </div>
        )}

        {!locked && available.filter(p => !rows.some(r => r.label === p.label)).length > 0 && (
          <div className="pt-2 mt-2 border-t border-[#f0ede8]">
            <p className="text-[11px] text-[#9b9890] mb-1.5">Add a configured penalty (Settings → Rules):</p>
            <div className="flex flex-wrap gap-1.5">
              {available.filter(p => !rows.some(r => r.label === p.label)).map(p => (
                <button key={p.key} type="button" onClick={() => addPenalty(p.label, p.amount)}
                  className="flex items-center gap-1 text-[11px] font-medium text-[#6b6860] border border-[#e8e6e0] rounded-full px-2.5 py-1 hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors">
                  <Plus size={11} /> {p.label} · AED {p.amount.toLocaleString('en-AE')}
                </button>
              ))}
            </div>
          </div>
        )}
        {rows.length === 0 && locked && <p className="text-xs text-[#9b9890]">No deductions — full deposit refunded.</p>}
      </div>

      {/* Payments received from the customer (e.g. when charges exceed the deposit) */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5"><Coins size={15} className="text-[#2e9f82]" /> Payments received</h2>
          <span className="text-xs text-[#9b9890]">collected from the customer</span>
        </div>
        <p className="text-xs text-[#9b9890]">Money the customer pays you — e.g. when an overstay penalty or damages exceed the held deposit.</p>

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
                  <input type="date" value={r.receivedOn} disabled={payLocked}
                    onChange={e => updatePayRow(r.key, { receivedOn: e.target.value })}
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

      {/* Settlement summary */}
      <div className="bg-[#f0faf6] rounded-2xl border border-[#c5e8df] p-5 space-y-2">
        <div className="flex items-center justify-between text-sm"><span className="text-[#6b6860]">Deposit held</span><span className="font-semibold text-[#1a1916] tabular-nums">{aed(depositNum)}</span></div>
        <div className="flex items-center justify-between text-sm"><span className="text-[#6b6860]">Less deductions &amp; dues</span><span className="font-semibold text-[#b91c1c] tabular-nums">− {aed(sumLines)}</span></div>
        {sumPayments > 0 && (
          <div className="flex items-center justify-between text-sm"><span className="text-[#6b6860]">Plus payments received</span><span className="font-semibold text-[#1a7a5a] tabular-nums">+ {aed(sumPayments)}</span></div>
        )}
        <div className="flex items-center justify-between border-t border-[#c5e8df] pt-2 mt-1">
          <span className="text-sm font-bold text-[#1a7a5a]">
            {balance > 0 ? 'Refund due to customer' : balance < 0 ? 'Customer still owes' : 'Settled in full'}
          </span>
          <span className={`text-xl font-bold tabular-nums ${balance < 0 ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'}`}>{aed(Math.abs(balance))}</span>
        </div>
        {balance < 0 && <p className="text-xs text-[#b91c1c]">Charges exceed the deposit — record the {aed(Math.abs(balance))} the customer still owes under “Payments received” before closing.</p>}
        {balance === 0 && sumLines > 0 && <p className="text-xs text-[#1a7a5a]">Fully settled — nothing outstanding either way.</p>}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
        <label className="block text-sm font-semibold text-[#1a1916] mb-2">Notes <span className="text-[#9b9890] font-normal text-xs">visible to the customer</span></label>
        <textarea value={notes} disabled={locked} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Explain the deductions, deposit handling, refund method…"
          className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] resize-none disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
      </div>

      {/* Actions */}
      {isDirect && status === 'draft' && (
        <p className="text-xs text-[#6b6860]">Customer has vacated — you can record the refund and close the lease directly.</p>
      )}
      <div className="flex flex-wrap items-center gap-3 pb-10">
        {!locked && (
          <>
            <button onClick={() => void save()} disabled={saving || acting !== null}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] disabled:opacity-60 transition-colors">
              {saving && acting === null ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save draft
            </button>
            <button onClick={() => void sendToCustomer()} disabled={saving || acting !== null}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors">
              {acting === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to customer
            </button>
          </>
        )}
        {(status === 'sent' || status === 'agreed' || (isDirect && status === 'draft')) && (
          <div className="flex flex-col gap-1">
            <button onClick={() => void markPaid()} disabled={acting !== null || balance < -0.005}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-[#1a7a5a] hover:bg-[#155f47] disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
              {acting === 'paid' ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />}
              {balance > 0 ? 'Mark refund paid' : 'Mark settled & close'}
            </button>
            {balance < -0.005 && <span className="text-xs text-[#b91c1c]">Record the {aed(Math.abs(balance))} still owed before closing.</span>}
          </div>
        )}
        {status === 'paid' && (
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1a7a5a]"><BadgeCheck size={16} /> Settlement complete</div>
        )}
      </div>
      </>)}

      {/* Statement view — the Tenant Final Settlement document, rendered from live data.
          Section 0/1/2 come from the API `statement` block; the deposit / deductions /
          payments / balance reflect the current worksheet edits so the two stay in sync. */}
      {view === 'statement' && (
        statement ? (
          <TenantFinalSettlementDoc data={{
            contract: statement.contract,
            contractSummary: statement.contractSummary,
            rent: statement.rent,
            depositHeld: depositNum,
            lines: rows
              .filter(r => r.label.trim() || Number(r.amount) > 0)
              .map(r => ({ label: r.label.trim() || 'Adjustment', amount: Math.max(0, Number(r.amount) || 0), type: r.type })),
            chargesTotal: sumLines,
            payments: payRows
              .filter(r => Number(r.amount) > 0)
              .map(r => ({ amount: Math.max(0, Number(r.amount) || 0), method: r.method, reference: r.reference.trim() || null, receivedOn: r.receivedOn || null })),
            paymentsReceivedTotal: sumPayments,
            balance,
            notes: notes.trim() || null,
            status,
            settlementDate: stamps.paidAt,
          }}
          links={{
            contract: `/rental-provider/dashboard/contracts/${contractId}/v2`,
            payments: `/rental-provider/dashboard/payments`,
            deposits: `/rental-provider/dashboard/deposits`,
            worksheet: `/rental-provider/dashboard/contracts/${contractId}/settlement`,
          }} />
        ) : (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-8 text-center text-sm text-[#9b9890]">
            <Loader2 className="animate-spin inline mr-2" size={16} /> Preparing statement…
          </div>
        )
      )}
    </div>
  );
}
