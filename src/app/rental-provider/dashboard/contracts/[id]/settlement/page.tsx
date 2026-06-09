'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Trash2, Save, Send, CheckCircle, Loader2, AlertCircle,
  Wallet, BadgeCheck, Banknote,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type SettlementStatus = 'draft' | 'sent' | 'agreed' | 'paid';
type LineType = 'deduction' | 'due';

interface ApiLine { id?: number; label: string; amount: number; type: LineType }
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
  sentAt: string | null;
  agreedAt: string | null;
  paidAt: string | null;
  updatedAt: string | null;
}

interface ContractMeta {
  property: string;
  unit: string;
  tenantName: string;
}

interface Row { key: string; label: string; amount: string; type: LineType }

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
  const router = useRouter();
  const contractId = params?.id;

  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [status, setStatus] = useState<SettlementStatus>('draft');
  const [deposit, setDeposit] = useState('0');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [stamps, setStamps] = useState<{ sentAt: string | null; agreedAt: string | null; paidAt: string | null }>({ sentAt: null, agreedAt: null, paidAt: null });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<null | 'send' | 'paid'>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = status === 'agreed' || status === 'paid';

  const apply = useCallback((s: ApiSettlement) => {
    setStatus(s.status);
    setDeposit(String(s.depositHeld ?? 0));
    setNotes(s.notes ?? '');
    setRows((s.lines ?? []).map(l => ({ key: uid(), label: l.label, amount: String(l.amount), type: l.type })));
    setStamps({ sentAt: s.sentAt, agreedAt: s.agreedAt, paidAt: s.paidAt });
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
  const refund = Math.round((depositNum - sumLines) * 100) / 100;

  function addRow(type: LineType) { setRows(r => [...r, { key: uid(), label: '', amount: '', type }]); }
  function updateRow(key: string, patch: Partial<Row>) { setRows(r => r.map(x => x.key === key ? { ...x, ...patch } : x)); }
  function removeRow(key: string) { setRows(r => r.filter(x => x.key !== key)); }

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
    try {
      const res = await fetch(`/api/contracts/${contractId}/settlement/paid`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b?.message ?? 'Failed to mark paid'); return; }
      await load();
    } catch { setError('Unexpected error marking paid'); }
    finally { setActing(null); }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin text-[#2e9f82]" size={28} /></div>;
  }

  const sm = STATUS_META[status];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Topbar */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] transition-colors">
          <ArrowLeft size={15} /> Back to contract
        </button>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sm.cls}`}>{sm.label}</span>
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
            <p className="text-xs text-[#c2410c] mt-0.5">Sent {fmtDateTime(stamps.sentAt)}. You can still edit and re-send, or mark the refund paid.</p></div>
        </div>
      )}
      {error && <div className="flex items-center gap-2 text-sm text-[#dc2626] bg-[#fef2f2] rounded-xl px-4 py-3"><AlertCircle size={15} /> {error}</div>}
      {savedTick && !error && <div className="flex items-center gap-2 text-sm bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3"><CheckCircle size={15} className="text-[#2e9f82]" /> <span className="font-semibold text-[#1a7a5a]">Saved.</span></div>}

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
        {rows.length === 0 && locked && <p className="text-xs text-[#9b9890]">No deductions — full deposit refunded.</p>}
      </div>

      {/* Refund summary */}
      <div className="bg-[#f0faf6] rounded-2xl border border-[#c5e8df] p-5 space-y-2">
        <div className="flex items-center justify-between text-sm"><span className="text-[#6b6860]">Deposit held</span><span className="font-semibold text-[#1a1916] tabular-nums">{aed(depositNum)}</span></div>
        <div className="flex items-center justify-between text-sm"><span className="text-[#6b6860]">Less deductions &amp; dues</span><span className="font-semibold text-[#b91c1c] tabular-nums">− {aed(sumLines)}</span></div>
        <div className="flex items-center justify-between border-t border-[#c5e8df] pt-2 mt-1">
          <span className="text-sm font-bold text-[#1a7a5a]">Net refund to customer</span>
          <span className={`text-xl font-bold tabular-nums ${refund < 0 ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'}`}>{aed(refund)}</span>
        </div>
        {refund < 0 && <p className="text-xs text-[#b91c1c]">Deductions exceed the deposit — the customer owes the difference.</p>}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
        <label className="block text-sm font-semibold text-[#1a1916] mb-2">Notes <span className="text-[#9b9890] font-normal text-xs">visible to the customer</span></label>
        <textarea value={notes} disabled={locked} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Explain the deductions, deposit handling, refund method…"
          className="w-full text-sm border border-[#e8e6e0] rounded-xl px-3 py-2 focus:outline-none focus:border-[#2e9f82] resize-none disabled:bg-[#f9f8f6] disabled:text-[#6b6860]" />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pb-10">
        {!locked && (
          <>
            <button onClick={() => void save()} disabled={saving || acting !== null}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold border border-[#e8e6e0] text-[#1a1916] hover:bg-[#f4f3ef] disabled:opacity-60 transition-colors">
              {saving && acting === null ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save draft
            </button>
            <button onClick={() => void sendToCustomer()} disabled={saving || acting !== null}
              className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-[#2e9f82] hover:bg-[#267a65] disabled:opacity-60 transition-colors">
              {acting === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {status === 'sent' ? 'Re-send to customer' : 'Send to customer'}
            </button>
          </>
        )}
        {(status === 'sent' || status === 'agreed') && (
          <button onClick={() => void markPaid()} disabled={acting !== null}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-[#1a7a5a] hover:bg-[#155f47] disabled:opacity-60 transition-colors">
            {acting === 'paid' ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />} Mark refund paid
          </button>
        )}
        {status === 'paid' && (
          <div className="flex items-center gap-2 text-sm font-semibold text-[#1a7a5a]"><BadgeCheck size={16} /> Settlement complete</div>
        )}
      </div>
    </div>
  );
}
