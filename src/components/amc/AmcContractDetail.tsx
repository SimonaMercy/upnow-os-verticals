'use client';

/**
 * One AMC contract — the "AMC Details 1a" design (owner, 9 Sep 2026). Shared by
 * the RP page and the manager mirror.
 *
 * Header (identity, actions, fact strip, lineage) · Visits (month strip, the
 * next visit, needs-action rows worked through attended → delivery note →
 * inspected, history) · right rail: Vendor, Payments, Documents.
 *
 * Payments: the platform holds the contract's TERMS (value, count, mode) and the
 * proofs filed against it — not a per-installment ledger yet. The schedule shown
 * is derived from those terms and proofs clear installments in order; the card
 * says so. A real payables schedule is the next backlog item.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { openDocViewer } from '@/lib/docViewer';
import { AddAmcModal, PaymentPlanEditor, type AmcContract, type PayRow } from '@/components/amc/AmcView';

interface VendorInfo {
  email: string | null; phone: string | null; contactName: string | null; contactPhone: string | null;
  category: string | null; tradeLicenceNumber: string | null; tradeLicenceExpiry: string | null; emirates: string | null;
  inviteStatus: string; acceptedAt: string | null; activeContracts: number; since: string | null;
}
interface Contract extends AmcContract {
  vendor?: VendorInfo;
  tasks: { total: number; done: number; pending: number; overdue?: number };
}
interface Task {
  id: number; title: string; dueDate: string | null; status: string; completedAt: string | null; notes: string | null;
  attendedAt?: string | null; supervisedBy?: string | null; attendedByName?: string | null;
  deliveryNote?: { id: number; fileUrl: string; displayName: string | null } | null;
  inspectedAt?: string | null; inspectedByName?: string | null;
}
interface Visit { t: Task; n: number; stages: [boolean, boolean, boolean]; done: number; overdueDays: number; state: 'done' | 'overdue' | 'next' | 'upcoming' }
interface Inst { id: number | null; seq: number; dueDate: string; amountAed: number; status: string; paidAt: string | null; reference: string | null; notes?: string | null; proof: { id: number; fileUrl: string; displayName: string | null; documentKey: string } | null }
interface InstPayload { derived: boolean; defaultCount: number; installments: Inst[] }

const DAY = 86_400_000;
const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtS = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short' }) : '—';
const mon = (d?: string | null, withYear = false) => d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, month: 'short', ...(withYear ? { year: '2-digit' } : {}) }) : '';
const aed = (n?: number | null) => n != null ? `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2 })}` : '—';
const cap = (s?: string | null) => s ? s.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()) : '';
const isoDay = (d: string) => d.slice(0, 10);
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || 'V';
const scoped = (base: string, rp: number | null | undefined, path: string) =>
  rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;

const STATUS_META: Record<string, { bg: string; fg: string; label: string }> = {
  active: { bg: '#e7f4ee', fg: '#1a7a52', label: 'Active' },
  expiring: { bg: '#fdf3e3', fg: '#c47a00', label: 'Expiring soon' },
  expired: { bg: '#fdecea', fg: '#b42318', label: 'Expired' },
  unknown: { bg: '#f1f3f1', fg: '#5b615e', label: 'No expiry' },
};

const card = 'bg-white border border-[#e6e8e6] rounded-[14px]';
const btn = 'text-[12px] font-semibold px-3 py-2 rounded-lg border border-[#d9ddda] bg-white text-[#1c1f1d] hover:bg-[#f6f7f6] cursor-pointer disabled:opacity-40 disabled:cursor-default';
const btnPrimary = 'text-[12px] font-semibold px-3 py-2 rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50';
const btnSm = 'text-[11px] font-semibold px-2.5 py-[5px] rounded-md border border-[#d9ddda] bg-white text-[#1c1f1d] hover:bg-[#f6f7f6] cursor-pointer disabled:opacity-40 disabled:cursor-default';
const btnGreenSm = 'text-[11px] font-bold px-2.5 py-[5px] rounded-md border border-[#1a7a52] bg-white text-[#1a7a52] hover:bg-[#e7f4ee] cursor-pointer disabled:opacity-50';
const btnFillSm = 'text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50';
const lbl = 'text-[10px] font-bold tracking-[.08em] text-[#8a8f8c]';

/** Upload one file against the contract and register it. Returns the document id. */
async function uploadContractFile(cid: number, f: File, documentKey: string, category: string, displayName: string): Promise<number | null> {
  const urlRes = await fetch('/api/documents/upload-url', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerType: 'service_provider_contract', ownerId: cid, documentKey, originalName: f.name, mimeType: f.type }),
  });
  if (!urlRes.ok) return null;
  const { uploadUrl, fileUrl, fileKey } = await urlRes.json();
  const target = (() => { try { const u = new URL(uploadUrl); return u.pathname.startsWith('/api/') ? u.pathname + u.search : uploadUrl; } catch { return uploadUrl; } })();
  await fetch(target, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
  const saveRes = await fetch('/api/documents', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerType: 'service_provider_contract', ownerId: cid, documentKey, category, displayName, fileUrl, mimeType: f.type, s3Key: fileKey }),
  });
  const doc = await saveRes.json().catch(() => null);
  return doc?.id ?? null;
}

function StageBars({ stages, tone }: { stages: [boolean, boolean, boolean]; tone: 'neutral' | 'red' }) {
  const off = tone === 'red' ? '#e3c6c2' : '#e6e8e6';
  return (
    <div className="flex gap-1 shrink-0" title="Attended · Delivery note · Inspected">
      {stages.map((on, i) => <span key={i} className="w-[22px] h-[5px] rounded-full" style={{ background: on ? '#1a7a52' : off }} />)}
    </div>
  );
}

/** Who attended — the manager personally, or a named supervisor. No browser dialogs. */
function AttendChooser({ busy, onPick, onCancel, label }: { busy: boolean; onPick: (who: string) => void; onCancel: () => void; label?: string }) {
  const [name, setName] = useState('');
  return (
    <div className="flex items-center gap-2 flex-wrap p-2 rounded-lg border border-[#e6e8e6] bg-white">
      {label && <span className="text-[11px] font-semibold text-[#5b615e] w-full">{label}</span>}
      <button type="button" disabled={busy} onClick={() => onPick('self')} className={btnFillSm}>I attended myself</button>
      <span className="text-[11px] text-[#8a8f8c]">or</span>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Who supervised for you?"
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onPick(name.trim()); }}
        className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52] w-48" />
      <button type="button" disabled={busy || !name.trim()} onClick={() => onPick(name.trim())} className={btnGreenSm}>Save supervisor</button>
      <button type="button" onClick={onCancel} className="text-[11px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Cancel</button>
    </div>
  );
}

/** Edit the terms on record. The maintenance plan is not regenerated here. */
function EditAmcModal({ base, rp, c, onClose, onSaved }: { base: string; rp?: number | null; c: Contract; onClose: () => void; onSaved: () => void }) {
  const [startDate, setStartDate] = useState(c.startDate ? isoDay(c.startDate) : '');
  const [endDate, setEndDate] = useState(c.endDate ? isoDay(c.endDate) : '');
  const [annual, setAnnual] = useState(c.annualValueAed != null ? String(c.annualValueAed) : '');
  const [mode, setMode] = useState(c.modeOfPayment ?? '');
  const [notes, setNotes] = useState(c.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'w-full text-sm px-3 py-2 border border-[#e6e8e6] rounded-lg bg-white focus:outline-none focus:border-[#1a7a52]';
  const l = 'text-xs font-medium text-[#5b615e] mb-1 block';
  async function submit() {
    setError(null); setSaving(true);
    try {
      await apiPatch(scoped(base, rp, `/contracts/${c.id}`), {
        startDate: startDate || null, endDate: endDate || null,
        annualValueAed: annual.trim() !== '' ? Number(annual) : null,
        modeOfPayment: mode || null, notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) { setError((e as Error)?.message || 'Could not save the changes.'); }
    finally { setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f3f1]">
          <h2 className="text-sm font-bold text-[#1c1f1d]">Edit AMC-{c.id} — {c.vendorName}</h2>
          <button onClick={onClose} className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><span className={l}>Start</span><input type="date" className={field} value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
            <div><span className={l}>End</span><input type="date" className={field} value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
          </div>
          <div><span className={l}>Annual value (AED)</span><input type="number" min="0" step="0.01" className={field} value={annual} onChange={e => setAnnual(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className={l}>Payments</span><div className="text-[12px] text-[#5b615e] px-1 py-2">{c.numberOfPayments ?? '—'} on the schedule · edit them in the Payments card</div></div>
            <div><span className={l}>Mode of payment</span>
              <select className={field} value={mode} onChange={e => setMode(e.target.value)}>
                <option value="">—</option>
                {['cheque', 'bank_transfer', 'cash', 'card', 'online'].map(m => <option key={m} value={m}>{cap(m)}</option>)}
              </select>
            </div>
          </div>
          <div><span className={l}>Notes</span><textarea rows={3} className={field} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <p className="text-[11px] text-[#8a8f8c]">The visit plan stays as scheduled — edit visits from the Visits card.</p>
          {error && <p className="text-xs text-[#b42318]">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#f1f3f1]">
          <button onClick={onClose} className={btn}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

export function AmcContractDetail({ contractId, base, rp, listHref, detailHrefOf, vendorHrefOf }: {
  contractId: number;
  /** '/amc' for the landlord, '/manager/amc' (+ rp) for a manager. */
  base: string; rp?: number | null;
  listHref: string;
  detailHrefOf: (id: number) => string;
  vendorHrefOf?: (spId: number) => string;
}) {
  const cid = contractId;
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [attendingId, setAttendingId] = useState<number | null>(null);
  const [bulkAttend, setBulkAttend] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [editing, setEditing] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [remindBusy, setRemindBusy] = useState(false);
  const [inst, setInst] = useState<InstPayload | null>(null);
  const [paying, setPaying] = useState<Inst | null>(null);
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [fullSchedule, setFullSchedule] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planRows, setPlanRows] = useState<PayRow[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);

  const say = (text: string, tone: 'ok' | 'warn' = 'ok') => { setNotice({ text, tone }); window.setTimeout(() => setNotice(n => (n?.text === text ? null : n)), 6000); };

  const load = useCallback(() => {
    Promise.all([
      apiGet<Contract[]>(scoped(base, rp, '/contracts')),
      apiGet<Task[]>(scoped(base, rp, `/contracts/${cid}/tasks`)).catch(() => []),
      apiGet<InstPayload>(scoped(base, rp, `/contracts/${cid}/installments`)).catch(() => null),
    ]).then(([cs, ts, ins]) => {
      setContracts(Array.isArray(cs) ? cs : []);
      setTasks(Array.isArray(ts) ? ts : []);
      setInst(ins && Array.isArray(ins.installments) ? ins : { derived: true, defaultCount: 1, installments: [] });
    }).catch(() => setErr('Could not load this contract.'));
  }, [base, rp, cid]);
  useEffect(() => { load(); }, [load]);

  // ── the inspection pipeline, worked here ──
  const attend = async (t: Task, who: string) => {
    setBusy(t.id);
    try { await apiPatch(scoped(base, rp, `/tasks/${t.id}/attend`), { supervisedBy: who }); setAttendingId(null); load(); }
    finally { setBusy(null); }
  };
  const attendAll = async (list: Task[], who: string) => {
    setBulkAttend(false);
    for (const t of list) { setBusy(t.id); try { await apiPatch(scoped(base, rp, `/tasks/${t.id}/attend`), { supervisedBy: who }); } catch { /* keep going */ } }
    setBusy(null); load();
    say(`${list.length} visit${list.length === 1 ? '' : 's'} marked attended — upload each delivery note next.`);
  };
  const uploadNote = async (t: Task, f: File) => {
    setBusy(t.id);
    try {
      const docId = await uploadContractFile(cid, f, `delivery_note_task_${t.id}`, 'report', 'Delivery Note');
      if (docId) await apiPatch(scoped(base, rp, `/tasks/${t.id}/delivery-note`), { documentId: docId });
      load();
    } finally { setBusy(null); }
  };
  const inspect = async (t: Task) => {
    setBusy(t.id);
    try { await apiPatch(scoped(base, rp, `/tasks/${t.id}/inspect`), {}); load(); }
    finally { setBusy(null); }
  };
  const remind = async () => {
    setRemindBusy(true);
    try {
      const r = await apiPost<{ sent: boolean; reason: string | null; overdue: number }>(scoped(base, rp, `/contracts/${cid}/remind`), {});
      if (r.sent) say(`Reminder emailed to the vendor${r.overdue ? ` — ${r.overdue} overdue visit${r.overdue === 1 ? '' : 's'} listed` : ''}.`);
      else say(r.reason === 'no_email' ? 'The vendor has no email on file — use Call instead.' : 'Email is not enabled on this environment — reach the vendor by phone or email from the Vendor card.', 'warn');
    } catch { say('Could not send the reminder.', 'warn'); }
    finally { setRemindBusy(false); }
  };
  /** Mark one installment paid — reference, date, and (normally) the proof uploaded against the contract. */
  const markPaid = async (target: Inst, f: File | null) => {
    if (target.id == null) return;
    setPayBusy(true);
    try {
      let proofDocId: number | null = null;
      if (f) proofDocId = await uploadContractFile(cid, f, `sp_payment_proof_inst_${target.id}`, 'payment', payRef.trim() ? `Proof of Payment · ${payRef.trim()}` : `Proof of Payment · #${target.seq}`);
      await apiPatch(scoped(base, rp, `/installments/${target.id}/paid`), { reference: payRef.trim() || null, paidAt: payDate || null, proofDocId });
      setPaying(null); setPayRef(''); setPayDate(''); load();
      say(`Installment #${target.seq} marked paid${f ? ' with proof' : ''}.`);
    } catch { say('Could not mark the installment paid.', 'warn'); }
    finally { setPayBusy(false); }
  };
  const unmarkPaid = async (target: Inst) => {
    if (target.id == null) return;
    try { await apiPatch(scoped(base, rp, `/installments/${target.id}/unpaid`), {}); load(); } catch { say('Could not reopen the installment.', 'warn'); }
  };
  /** Persist a schedule (set-up from the preview, or the edited plan). */
  const savePlan = async (rows: PayRow[]) => {
    setPlanBusy(true);
    try {
      await apiPut(scoped(base, rp, `/contracts/${cid}/installments`), { installments: rows.filter(r => r.dueDate).map(r => ({ id: r.id ?? null, dueDate: r.dueDate, amountAed: Number(r.amountAed) || 0 })) });
      setPlanOpen(false); load(); say('Payment schedule saved.');
    } catch (e) { say((e as Error)?.message || 'Could not save the schedule.', 'warn'); }
    finally { setPlanBusy(false); }
  };
  const openPlanEditor = () => {
    setPlanRows((inst?.installments ?? []).map(r => ({ id: r.id, dueDate: r.dueDate, amountAed: String(r.amountAed), status: r.status, reference: r.reference })));
    setPlanDirty(true); setPlanOpen(true);
  };
  const uploadContractDoc = async (f: File) => {
    setDocBusy(true);
    try {
      const existing = contracts?.find(x => x.id === cid)?.documents.filter(d => /^sp_contract/.test(d.documentKey)).length ?? 0;
      await uploadContractFile(cid, f, existing === 0 ? 'sp_contract' : `sp_contract_${existing + 1}`, 'contract', existing === 0 ? 'Contract Attachment' : `Contract Attachment ${existing + 1}`);
      load();
    } finally { setDocBusy(false); }
  };

  const c = contracts?.find(x => x.id === cid) ?? null;
  if (!c) return (
    <div className="max-w-[1040px] mx-auto px-7 py-6">
      <Link href={listHref} className="text-[12px] text-[#5b615e] hover:text-[#1c1f1d]">← AMC Contracts</Link>
      <p className="text-sm text-[#8a8f8c] mt-6">{err ?? (contracts == null ? 'Loading…' : 'Contract not found.')}</p>
    </div>
  );

  // ── derived ──
  const today = todayIso();
  const st = STATUS_META[c.status] ?? STATUS_META.unknown;
  const renews = c.renewalOfId != null ? contracts!.find(x => x.id === c.renewalOfId) : null;
  const renewedBy = c.renewedById != null ? contracts!.find(x => x.id === c.renewedById) : null;
  // Renew is offered on any contract not yet renewed (owner, 9 Sep) — the dialog prefills the next term.
  const renewable = c.renewedById == null;
  const v = c.vendor;
  const category = v?.category ?? (c.serviceCategory ? cap(c.serviceCategory) : null);
  const contactEmail = v?.email ?? null;
  const contactPhone = v?.phone ?? v?.contactPhone ?? null;

  const all: Visit[] = (tasks ?? []).map((t, i) => {
    const stages: [boolean, boolean, boolean] = [!!t.attendedAt, !!t.deliveryNote, !!t.inspectedAt];
    const due = t.dueDate ? isoDay(t.dueDate) : null;
    const overdueDays = due && t.status !== 'done' ? daysBetween(due, today) : 0;
    return { t, n: i + 1, stages, done: stages.filter(Boolean).length, overdueDays, state: t.status === 'done' ? 'done' : overdueDays > 0 ? 'overdue' : 'upcoming' };
  });
  const next = all.find(x => x.state === 'upcoming') ?? null;
  if (next) next.state = 'next';
  const overdue = all.filter(x => x.state === 'overdue');
  const history = all.filter(x => x.state === 'done').sort((a, b) => (b.t.inspectedAt ?? b.t.completedAt ?? '').localeCompare(a.t.inspectedAt ?? a.t.completedAt ?? ''));
  const notesFiled = all.filter(x => x.stages[1]).length;
  const inspected = all.filter(x => x.stages[2]).length;
  const toAttend = overdue.filter(x => !x.stages[0]).map(x => x.t);
  const openId = expandedId != null && overdue.some(x => x.t.id === expandedId) ? expandedId : overdue[0]?.t.id ?? null;
  const n = all.length;
  const monthLabels = all.map(x => mon(x.t.dueDate));
  const yearInLabel = new Set(monthLabels.filter(Boolean)).size < monthLabels.filter(Boolean).length;
  const idx = (pred: (x: Visit) => boolean) => { const i = all.findIndex(pred); return i; };
  const firstOverdue = idx(x => x.state === 'overdue'), lastOverdue = all.length - 1 - [...all].reverse().findIndex(x => x.state === 'overdue');
  const firstDone = idx(x => x.state === 'done'), lastDone = all.length - 1 - [...all].reverse().findIndex(x => x.state === 'done');
  const seg = (a: number, b: number) => ({ left: `${((a + 0.5) / n) * 100}%`, width: `${((b - a) / n) * 100}%` });

  const contractDocs = c.documents.filter(d => !/payment/i.test(d.documentKey) && !/^delivery_note_task_/.test(d.documentKey));
  const rows = inst?.installments ?? [];
  const derived = inst?.derived ?? true;
  const stateOf = (r: Inst): 'paid' | 'overdue' | 'upcoming' => r.status === 'paid' ? 'paid' : r.dueDate < today ? 'overdue' : 'upcoming';
  const paidRows = rows.filter(r => r.status === 'paid');
  const overdueRows = rows.filter(r => stateOf(r) === 'overdue');
  const received = paidRows.reduce((n, r) => n + r.amountAed, 0);
  const totalDue = rows.reduce((n, r) => n + r.amountAed, 0);
  const payWord = c.modeOfPayment === 'cheque' ? 'cheques' : 'payments';
  const lastPaid = [...paidRows].sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? '') || a.seq - b.seq).reverse()[0] ?? null;
  const nextUp = rows.find(r => stateOf(r) === 'upcoming') ?? null;
  const hiddenOverdue = fullSchedule ? 0 : Math.max(0, overdueRows.length - 3);
  const shownRows: Inst[] = fullSchedule ? rows : [
    ...overdueRows.slice(0, 3),
    ...(nextUp ? [nextUp] : []),
    ...(lastPaid && !overdueRows.slice(0, 3).includes(lastPaid) ? [lastPaid] : []),
  ].sort((a, b) => a.seq - b.seq);
  const contractStart = c.startDate ? isoDay(c.startDate) : '';
  const contractEnd = c.endDate ? isoDay(c.endDate) : '';
  const annualStr = c.annualValueAed != null ? String(c.annualValueAed) : '';

  const stageWord = (x: Visit) => !x.stages[0] ? 'awaiting attendance' : !x.stages[1] ? 'awaiting delivery note' : 'awaiting inspection';
  const primaryAction = (x: Visit) => {
    const t = x.t; const b = busy === t.id;
    if (!x.stages[0]) return <button type="button" disabled={b} onClick={() => { setExpandedId(t.id); setAttendingId(t.id); }} className={btnGreenSm}>Mark attended</button>;
    if (!x.stages[1]) return (
      <label className={btnFillSm + (b ? ' opacity-50' : '')}>{b ? 'Uploading…' : 'Upload note'}
        <input type="file" accept="image/*,application/pdf" className="hidden" disabled={b} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadNote(t, f); e.target.value = ''; }} />
      </label>
    );
    return <button type="button" disabled={b} onClick={() => inspect(t)} className={btnFillSm}>Mark inspected</button>;
  };
  const whoAttended = (t: Task) => t.supervisedBy === 'self' ? (t.attendedByName ?? 'personally') : (t.supervisedBy ?? '—');

  const dotStyle = (x: Visit): CSSProperties => {
    if (x.state === 'done') return { background: '#1a7a52', border: '2px solid #1a7a52', color: '#fff' };
    if (x.state === 'overdue') return { background: '#fff', border: '2px solid #b42318', boxShadow: all.indexOf(x) === lastOverdue ? '0 0 0 4px #fdecea' : undefined };
    if (x.state === 'next') return { background: '#fff', border: '2px solid #1c1f1d' };
    return { background: '#fff', border: '2px solid #d9ddda' };
  };

  return (
    <div className="max-w-[1040px] mx-auto px-4 sm:px-7 py-6 pb-10 text-[#1c1f1d]">
      {editing && <EditAmcModal base={base} rp={rp} c={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); say('Contract updated.'); }} />}
      {planOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={() => setPlanOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f3f1]">
              <h2 className="text-sm font-bold text-[#1c1f1d]">Payment schedule — AMC-{c.id}</h2>
              <button onClick={() => setPlanOpen(false)} className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="px-5 py-4">
              <p className="text-[11.5px] text-[#5b615e] mb-3">Term {fmtD(c.startDate)} → {fmtD(c.endDate)} · {c.frequency ? cap(c.frequency) : 'no frequency'} · {aed(c.annualValueAed)}/yr. Pick a preset or shape the plan by hand — any number of installments, any dates and amounts. Paid installments stay as they are.</p>
              <PaymentPlanEditor start={contractStart} end={contractEnd} frequency={c.frequency ?? ''} annualValue={annualStr} rows={planRows} onChange={setPlanRows} dirty={planDirty} setDirty={setPlanDirty} />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#f1f3f1]">
              <button onClick={() => setPlanOpen(false)} className={btn}>Cancel</button>
              <button onClick={() => void savePlan(planRows)} disabled={planBusy || !planRows.length} className={btnPrimary}>{planBusy ? 'Saving…' : 'Save schedule'}</button>
            </div>
          </div>
        </div>
      )}
      {renewing && <AddAmcModal base={base} rp={rp} propertiesUrl={rp != null ? '/manager/properties' : '/properties'} existingContracts={contracts ?? []} renewFrom={c}
        onClose={() => setRenewing(false)} onSaved={() => { setRenewing(false); load(); say('Renewed — the new contract is on the list and this one now shows "Renewed by".'); }} />}

      {/* ── header ── */}
      <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5'}>
        <div className="flex items-start gap-3.5 flex-wrap">
          <button type="button" onClick={() => router.push(listHref)} aria-label="Back to AMC Contracts"
            className="w-10 h-10 rounded-full border border-[#e6e8e6] grid place-items-center text-[#5b615e] hover:bg-[#f6f7f6] shrink-0 cursor-pointer">
            <ArrowLeft size={16} />
          </button>
          <div className="w-10 h-10 rounded-[10px] bg-[#e7f4ee] grid place-items-center text-[#1a7a52] font-extrabold text-[13px] shrink-0">AMC</div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-[#8a8f8c]"><Link href={listHref} className="hover:underline">AMC Contracts</Link> › AMC-{c.id}</p>
            <div className="flex items-center gap-2.5 flex-wrap mt-0.5">
              <h1 className="text-[19px] font-bold tracking-[-.01em] leading-tight">{c.vendorName}</h1>
              <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              {overdue.length > 0 && <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#fdecea] text-[#b42318]">{overdue.length} visit{overdue.length === 1 ? '' : 's'} overdue</span>}
              {c.contractType === 'renewal' && <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#e9effc] text-[#2a5bd7]">Renewal</span>}
            </div>
            <p className="text-[12px] text-[#5b615e] mt-1">
              {c.propertyName ?? 'All properties'}{category ? <> · {category}</> : null}
              {vendorHrefOf && <> · <Link href={vendorHrefOf(c.vendorId)} className="text-[#1a7a52] hover:text-[#125a3c] underline">Vendor profile</Link></>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setEditing(true)} className={btn}>Edit</button>
            {renewable && <button type="button" onClick={() => setRenewing(true)} className={btnPrimary}>Renew contract</button>}
          </div>
        </div>
        {/* fact strip */}
        <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_1fr] mt-[18px] border-t border-[#eef0ee] pt-3.5 gap-y-3">
          <div className="sm:pr-[18px] sm:border-r border-[#eef0ee]"><div className={lbl}>PERIOD</div><div className="text-[13px] font-semibold mt-[3px]">{fmtD(c.startDate)} → {fmtD(c.endDate)}</div></div>
          <div className="sm:px-[18px] sm:border-r border-[#eef0ee]"><div className={lbl}>INSPECTIONS</div><div className="text-[13px] font-semibold mt-[3px]">{c.frequency ? cap(c.frequency) : 'As scheduled'} · {n} visit{n === 1 ? '' : 's'}</div></div>
          <div className="sm:px-[18px]"><div className={lbl}>ANNUAL VALUE</div><div className="text-[13px] font-semibold mt-[3px]">{aed(c.annualValueAed)}</div></div>
        </div>
        {/* lineage rail */}
        {(renews || renewedBy || c.notes) && (
          <div className="mt-3 flex items-center gap-2 flex-wrap text-[11.5px]">
            {renews && <Link href={detailHrefOf(renews.id)} className="px-2.5 py-1 rounded-full bg-[#e9effc] text-[#2a5bd7] font-semibold hover:underline">↩ Renewal of AMC-{renews.id} · {fmtD(renews.startDate)} – {fmtD(renews.endDate)}{renews.annualValueAed != null ? ` · ${aed(renews.annualValueAed)}` : ''}</Link>}
            {renewedBy && <Link href={detailHrefOf(renewedBy.id)} className="px-2.5 py-1 rounded-full bg-[#e7f4ee] text-[#1a7a52] font-semibold hover:underline">Renewed by AMC-{renewedBy.id} · {fmtD(renewedBy.startDate)} – {fmtD(renewedBy.endDate)} ↗</Link>}
            {c.notes && <span className="text-[#5b615e] italic">{c.notes}</span>}
          </div>
        )}
        {notice && (
          <div className={`mt-3 text-[12px] font-semibold px-3 py-2 rounded-lg ${notice.tone === 'ok' ? 'bg-[#e7f4ee] text-[#1a7a52]' : 'bg-[#fdf3e3] text-[#c47a00]'}`}>{notice.text}</div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 mt-5 items-start">
        {/* ── visits ── */}
        <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5 min-w-0'}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-[14px] font-bold">Visits</h2>
            <span className="text-[11px] text-[#8a8f8c]">A visit completes when attended, delivery note filed, and inspected</span>
          </div>

          {n > 0 ? (
            <>
              <div className="relative grid gap-1 mt-4" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
                <div className="absolute top-[9px] h-[2px] bg-[#eef0ee]" style={{ left: `${(0.5 / n) * 100}%`, right: `${(0.5 / n) * 100}%` }} />
                {firstDone >= 0 && lastDone > firstDone && <div className="absolute top-[9px] h-[2px] bg-[#1a7a52]" style={seg(firstDone, lastDone)} />}
                {firstOverdue >= 0 && lastOverdue > firstOverdue && <div className="absolute top-[9px] h-[2px] bg-[#b42318]" style={seg(firstOverdue, lastOverdue)} />}
                {all.map(x => (
                  <button key={x.t.id} type="button" className="text-center relative min-w-0 cursor-pointer" title={`Visit ${x.n} · due ${fmtD(x.t.dueDate)}`}
                    onClick={() => { if (x.state === 'overdue') setExpandedId(x.t.id); }}>
                    <div className="w-5 h-5 rounded-full mx-auto grid place-items-center text-[10px] font-extrabold" style={dotStyle(x)}>
                      {x.state === 'done' ? '✓' : x.state === 'overdue' && x.done > 0 ? <span className="w-2 h-2 rounded-full bg-[#b42318]" /> : null}
                    </div>
                    <div className={`text-[10.5px] mt-1.5 truncate ${x.state === 'overdue' ? 'font-bold text-[#b42318]' : x.state === 'next' ? 'font-bold' : x.state === 'done' ? 'font-semibold text-[#1a7a52]' : 'text-[#5b615e]'}`}>{mon(x.t.dueDate, yearInLabel) || `V${x.n}`}</div>
                    <div className={`text-[9.5px] ${x.state === 'overdue' ? 'text-[#b42318]' : 'text-[#8a8f8c]'}`}>{x.state === 'overdue' ? `${x.done}/3` : x.state === 'next' ? 'next' : x.state === 'done' ? 'done' : ' '}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-3.5 text-[10.5px] text-[#8a8f8c] mt-2.5 flex-wrap">
                <span><span className="inline-block w-2 h-2 rounded-full bg-[#1a7a52] align-middle mr-1" />Completed</span>
                <span><span className="inline-block w-2 h-2 rounded-full border-2 border-[#b42318] box-border align-middle mr-1" />Overdue (stages done)</span>
                <span><span className="inline-block w-2 h-2 rounded-full border-2 border-[#d9ddda] box-border align-middle mr-1" />Upcoming</span>
              </div>
            </>
          ) : <p className="text-[12px] text-[#8a8f8c] mt-4">No visits scheduled on this contract.</p>}

          {/* next */}
          {next && (
            <>
              <div className="text-[12px] font-bold mt-5">Next · Visit {next.n}</div>
              <div className="border border-[#e6e8e6] rounded-[10px] px-4 py-2.5 mt-2 flex items-center gap-3 flex-wrap">
                <div className="text-[12.5px] font-bold flex-1 whitespace-nowrap">Due {fmtD(next.t.dueDate)}{next.t.dueDate && <span className="font-medium text-[#8a8f8c]"> · {daysBetween(today, isoDay(next.t.dueDate)) === 0 ? 'today' : `in ${daysBetween(today, isoDay(next.t.dueDate))} days`}</span>}</div>
                <StageBars stages={next.stages} tone="neutral" />
                <span className="text-[11px] text-[#b9bdba] whitespace-nowrap" title="Available after inspection">Report</span>
                <button type="button" onClick={() => void remind()} disabled={remindBusy} className={btnSm}>{remindBusy ? 'Sending…' : 'Remind vendor'}</button>
              </div>
            </>
          )}

          {/* needs action */}
          {overdue.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-[22px] gap-2 flex-wrap">
                <div className="text-[12px] font-bold text-[#b42318]">Needs action · {overdue.length}</div>
                {toAttend.length > 1 && <button type="button" onClick={() => setBulkAttend(b => !b)} className={btnSm}>Mark all {toAttend.length} attended…</button>}
              </div>
              {bulkAttend && <div className="mt-2"><AttendChooser busy={busy != null} label={`Applies to visits ${toAttend.map(t => all.find(x => x.t.id === t.id)?.n).join(', ')}`} onPick={who => void attendAll(toAttend, who)} onCancel={() => setBulkAttend(false)} /></div>}
              {overdue.map(x => {
                const t = x.t; const b = busy === t.id;
                if (t.id === openId) return (
                  <div key={t.id} className="border border-[#f1c8c4] bg-[#fff8f7] rounded-[10px] px-4 py-3.5 mt-2.5">
                    <div className="flex justify-between items-baseline gap-2 flex-wrap">
                      <div className="text-[13px] font-bold">Visit {x.n} · due {fmtD(t.dueDate)}{b && <Loader2 size={12} className="inline ml-2 animate-spin text-[#8a8f8c]" />}</div>
                      <div className="text-[11px] text-[#b42318] font-semibold">{x.overdueDays} days overdue · {stageWord(x)}</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
                      {/* 1 attended */}
                      <div className="flex gap-2 items-start">
                        {x.stages[0]
                          ? <div className="w-[18px] h-[18px] rounded-full bg-[#1a7a52] text-white text-[10px] font-extrabold grid place-items-center shrink-0">✓</div>
                          : <div className="w-[18px] h-[18px] rounded-full border-2 border-[#1c1f1d] box-border text-[10px] font-extrabold grid place-items-center shrink-0">1</div>}
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-bold">Attended</div>
                          {x.stages[0]
                            ? <div className="text-[10.5px] text-[#5b615e]">{fmtS(t.attendedAt)} · {whoAttended(t)}</div>
                            : attendingId === t.id
                              ? <div className="mt-1"><AttendChooser busy={b} onPick={who => void attend(t, who)} onCancel={() => setAttendingId(null)} /></div>
                              : <button type="button" disabled={b} onClick={() => setAttendingId(t.id)} className={btnFillSm + ' mt-1'}>Mark attended</button>}
                        </div>
                      </div>
                      {/* 2 delivery note */}
                      <div className={`flex gap-2 items-start ${x.stages[0] ? '' : 'opacity-45'}`}>
                        {x.stages[1]
                          ? <div className="w-[18px] h-[18px] rounded-full bg-[#1a7a52] text-white text-[10px] font-extrabold grid place-items-center shrink-0">✓</div>
                          : <div className={`w-[18px] h-[18px] rounded-full border-2 box-border text-[10px] font-extrabold grid place-items-center shrink-0 ${x.stages[0] ? 'border-[#1c1f1d]' : 'border-[#8a8f8c]'}`}>2</div>}
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-bold">Delivery note</div>
                          {x.stages[1]
                            ? <button type="button" onClick={() => openDocViewer({ fileUrl: t.deliveryNote!.fileUrl, caption: `Delivery note — Visit ${x.n}`, documentKey: 'delivery_note' })} className="text-[10.5px] font-semibold text-[#1a7a52] underline cursor-pointer">View note</button>
                            : x.stages[0]
                              ? <label className={btnFillSm + ' mt-1 inline-block' + (b ? ' opacity-50' : '')}>{b ? 'Uploading…' : 'Upload note'}
                                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={b} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadNote(t, f); e.target.value = ''; }} />
                                </label>
                              : <div className="text-[10.5px] text-[#5b615e]">After attendance</div>}
                        </div>
                      </div>
                      {/* 3 inspected */}
                      <div className={`flex gap-2 items-start ${x.stages[0] && x.stages[1] ? '' : 'opacity-45'}`}>
                        <div className="w-[18px] h-[18px] rounded-full border-2 border-[#8a8f8c] box-border text-[10px] font-extrabold grid place-items-center shrink-0">3</div>
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-bold">Inspected</div>
                          {x.stages[0] && x.stages[1]
                            ? <button type="button" disabled={b} onClick={() => inspect(t)} className={btnFillSm + ' mt-1'}>Mark inspected</button>
                            : <div className="text-[10.5px] text-[#5b615e]">After delivery note · completes the visit</div>}
                        </div>
                      </div>
                    </div>
                    {t.notes && <p className="text-[11px] text-[#5b615e] italic mt-2">{t.notes}</p>}
                  </div>
                );
                return (
                  <div key={t.id} role="button" tabIndex={0} onClick={() => setExpandedId(t.id)} onKeyDown={e => { if (e.key === 'Enter') setExpandedId(t.id); }}
                    className="border border-[#f1c8c4] bg-[#fff8f7] rounded-[10px] px-4 py-2.5 mt-2 flex items-center gap-3 flex-wrap cursor-pointer hover:border-[#e3a9a3]">
                    <div className="text-[12.5px] font-bold flex-1 whitespace-nowrap">Visit {x.n} · due {fmtD(t.dueDate)}</div>
                    <StageBars stages={x.stages} tone="red" />
                    <div className="text-[11px] text-[#b42318] font-semibold whitespace-nowrap text-right">{x.overdueDays} days overdue</div>
                    <span className="text-[11px] text-[#b9bdba] whitespace-nowrap" title="Available after inspection">Report</span>
                    <span onClick={e => e.stopPropagation()}>{primaryAction(x)}</span>
                  </div>
                );
              })}
            </>
          )}

          {/* history */}
          <div className="flex items-center justify-between mt-[22px] gap-2 flex-wrap">
            <div className="text-[12px] font-bold">History · {history.length}</div>
            <div className="text-[11px] text-[#8a8f8c]">Visits with all three stages done</div>
          </div>
          {history.length === 0 ? (
            <div className="border border-dashed border-[#d9ddda] rounded-[10px] px-4 py-2.5 mt-2 flex items-center gap-3.5 text-[#8a8f8c] flex-wrap">
              <div className="text-[12px] flex-1">Completed visits list here with <b className="text-[#5b615e]">Attended · Delivery note · Inspected</b> dates</div>
              <span className="text-[11px] font-semibold text-[#b9bdba]">Delivery note</span>
            </div>
          ) : history.map(x => {
            const t = x.t;
            return (
              <div key={t.id} className="border border-[#e6e8e6] rounded-[10px] px-4 py-2.5 mt-2 flex items-center gap-3.5 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-bold">Visit {x.n} · due {fmtD(t.dueDate)}</div>
                  {t.attendedAt || t.inspectedAt ? (
                    <div className="text-[11px] text-[#5b615e] mt-0.5">
                      <b className="text-[#1a7a52]">Attended</b> {fmtS(t.attendedAt)} · {whoAttended(t)}
                      {t.deliveryNote && <> · <b className="text-[#1a7a52]">Delivery note</b> filed</>}
                      {t.inspectedAt && <> · <b className="text-[#1a7a52]">Inspected</b> {fmtS(t.inspectedAt)}{t.inspectedByName ? ` by ${t.inspectedByName}` : ''}</>}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#8a8f8c] mt-0.5">Marked done {t.completedAt ? fmtS(t.completedAt) : ''} — before inspection tracking; no attendance or delivery note on record.</div>
                  )}
                </div>
                {t.deliveryNote
                  ? <button type="button" onClick={() => openDocViewer({ fileUrl: t.deliveryNote!.fileUrl, caption: `Delivery note — Visit ${x.n}`, documentKey: 'delivery_note' })} className="text-[11px] font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer">Delivery note</button>
                  : <span className="text-[11px] font-semibold text-[#b9bdba]">Delivery note</span>}
              </div>
            );
          })}
        </div>

        {/* ── right rail ── */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* vendor */}
          <div className={card + ' px-[18px] py-4'}>
            <div className="flex justify-between items-baseline">
              <div className="text-[13px] font-bold">Vendor</div>
              {vendorHrefOf && <Link href={vendorHrefOf(c.vendorId)} className="text-[11px] font-semibold text-[#1a7a52] hover:text-[#125a3c]">Profile</Link>}
            </div>
            <div className="flex gap-2.5 items-center mt-2.5">
              <div className="w-[34px] h-[34px] rounded-lg bg-[#f1f3f1] grid place-items-center text-[11px] font-extrabold text-[#5b615e] shrink-0">{initials(c.vendorName)}</div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold truncate">{c.vendorName}</div>
                <div className="text-[10.5px] text-[#8a8f8c] truncate">{[category, v?.emirates].filter(Boolean).join(' · ') || (v?.inviteStatus === 'accepted' ? 'On UpNow' : 'Your record')}</div>
              </div>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11.5px] mt-3 border-t border-[#eef0ee] pt-2.5">
              <span className="text-[#8a8f8c]">Contact</span><span className="min-w-0 truncate">{v?.contactName ?? '—'}</span>
              <span className="text-[#8a8f8c]">Phone</span>
              {contactPhone ? <a href={`tel:${contactPhone}`} className="font-semibold text-[#1a7a52] no-underline truncate">{contactPhone}</a> : <span>—</span>}
              <span className="text-[#8a8f8c]">Email</span>
              {contactEmail ? <a href={`mailto:${contactEmail}`} className="font-semibold text-[#1a7a52] no-underline truncate">{contactEmail}</a> : <span>—</span>}
              <span className="text-[#8a8f8c]">Trade licence</span>
              <span className="min-w-0 truncate">{v?.tradeLicenceExpiry
                ? (isoDay(v.tradeLicenceExpiry) < today ? <span className="text-[#b42318] font-semibold">Expired {fmtD(v.tradeLicenceExpiry)}</span> : <>Valid · exp {fmtD(v.tradeLicenceExpiry)}</>)
                : v?.tradeLicenceNumber ? v.tradeLicenceNumber : '—'}</span>
              <span className="text-[#8a8f8c]">Contracts</span>
              <span>{v ? `${v.activeContracts} active${v.since ? ` · since ${new Date(v.since).getUTCFullYear()}` : ''}` : '—'}</span>
            </div>
            <div className="flex gap-1.5 mt-3">
              {contactPhone ? <a href={`tel:${contactPhone}`} className={btnSm + ' flex-1 text-center no-underline'}>Call</a> : <button type="button" disabled className={btnSm + ' flex-1'} title="No phone on file">Call</button>}
              {contactEmail ? <a href={`mailto:${contactEmail}`} className={btnSm + ' flex-1 text-center no-underline'}>Email</a> : <button type="button" disabled className={btnSm + ' flex-1'} title="No email on file">Email</button>}
              <button type="button" onClick={() => void remind()} disabled={remindBusy} className={btnSm + ' flex-1'}>{remindBusy ? '…' : 'Remind'}</button>
            </div>
          </div>

          {/* payments */}
          <div className={card + ' px-[18px] py-4'}>
            <div className="flex justify-between items-baseline">
              <div className="text-[13px] font-bold">Payments</div>
              <div className="text-[11px] text-[#8a8f8c]">{derived ? 'not set up' : `${paidRows.length} / ${rows.length} paid`}</div>
            </div>
            {derived ? (
              <div className="mt-2.5">
                <p className="text-[11.5px] text-[#5b615e]">No payment schedule yet. Terms on record: {c.frequency ? cap(c.frequency) : 'no frequency'}{c.modeOfPayment ? ` · ${cap(c.modeOfPayment)}` : ''}{c.annualValueAed != null ? ` · ${aed(c.annualValueAed)}/yr` : ' · value not set'}.</p>
                {rows.length > 0 && <p className="text-[10.5px] text-[#8a8f8c] mt-1">Suggested from the terms: {rows.length} {payWord}{rows[0]?.amountAed ? ` of ${aed(rows[0].amountAed)}` : ''}, first due {fmtS(rows[0]?.dueDate)}.</p>}
                <div className="flex gap-1.5 mt-2.5 flex-wrap">
                  {rows.length > 0 && <button type="button" disabled={planBusy} onClick={() => void savePlan(rows.map(r => ({ dueDate: r.dueDate, amountAed: String(r.amountAed) })))} className={btnFillSm}>{planBusy ? 'Saving…' : `Set up ${rows.length} ${payWord}`}</button>}
                  <button type="button" disabled={!contractStart} onClick={() => { setPlanRows(rows.map(r => ({ dueDate: r.dueDate, amountAed: String(r.amountAed) }))); setPlanDirty(false); setPlanOpen(true); }} className={btnSm}>Customise…</button>
                </div>
                {!contractStart && <p className="text-[10.5px] text-[#b45309] mt-1.5">Set the contract period with Edit first.</p>}
              </div>
            ) : (
              <>
                <div className="flex gap-[2px] mt-2.5">
                  {rows.map(r => { const st = stateOf(r); return <span key={r.seq} className="flex-1 h-1.5 rounded-[2px]" title={`#${r.seq} · ${fmtS(r.dueDate)} · ${st}`} style={{ background: st === 'paid' ? '#1a7a52' : st === 'overdue' ? '#b42318' : '#eef0ee' }} />; })}
                </div>
                <div className="text-[10.5px] text-[#8a8f8c] mt-1.5">{aed(received)} received · {aed(Math.max(0, totalDue - received))} remaining{c.modeOfPayment ? ` · ${cap(c.modeOfPayment)}` : ''}</div>
                <div className="mt-3 border-t border-[#eef0ee]">
                  {shownRows.map(r => {
                    const st = stateOf(r);
                    return (
                      <div key={r.seq}>
                        <div className={`flex justify-between items-center py-2 border-b border-[#f1f3f1] text-[11.5px] gap-2 ${st !== 'overdue' ? 'text-[#5b615e]' : ''}`}>
                          <span className="min-w-0 truncate">
                            <span className={st === 'overdue' ? 'text-[#b42318] font-bold' : ''}>#{r.seq}</span> · {fmtS(r.dueDate)} · {aed(r.amountAed)}{st === 'paid' && r.reference ? ` · ${r.reference}` : ''}
                          </span>
                          {st === 'paid' && (
                            <span className="flex items-center gap-2 shrink-0">
                              {r.proof
                                ? <button type="button" onClick={() => openDocViewer({ fileUrl: r.proof!.fileUrl, caption: r.proof!.displayName ?? 'Proof of Payment', documentKey: r.proof!.documentKey })} className="text-[10.5px] text-[#1a7a52] font-bold cursor-pointer">paid · proof</button>
                                : <span className="text-[10.5px] text-[#1a7a52] font-bold">paid{r.paidAt ? ` ${fmtS(r.paidAt)}` : ''}</span>}
                              <button type="button" onClick={() => void unmarkPaid(r)} className="text-[10px] text-[#8a8f8c] hover:text-[#b42318] cursor-pointer" title="Reopen this installment">undo</button>
                            </span>
                          )}
                          {st !== 'paid' && (
                            <button type="button" onClick={() => { setPaying(r); setPayRef(''); setPayDate(today); }}
                              className={`text-[10.5px] font-bold px-2 py-[3px] rounded-[5px] border bg-white cursor-pointer shrink-0 ${st === 'overdue' ? 'border-[#b42318] text-[#b42318]' : 'border-[#d9ddda] text-[#5b615e]'}`}>
                              {st === 'overdue' ? 'Mark paid' : 'upcoming · pay'}
                            </button>
                          )}
                        </div>
                        {paying?.id === r.id && (
                          <div className="my-2 p-2 rounded-lg border border-[#e6e8e6] bg-[#f6f7f6]">
                            <div className="text-[11px] font-semibold text-[#5b615e] mb-1.5">Installment #{r.seq} · {aed(r.amountAed)} — record the payment</div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder={c.modeOfPayment === 'cheque' ? 'Cheque no. · bank' : 'Reference'}
                                className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52] flex-1 min-w-[120px]" />
                              <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52]" />
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mt-2">
                              <label className={btnFillSm + (payBusy ? ' opacity-50' : '')}>{payBusy ? 'Saving…' : 'Attach proof & mark paid'}
                                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={payBusy} onChange={e => { const f = e.target.files?.[0]; if (f) void markPaid(r, f); e.target.value = ''; }} />
                              </label>
                              <button type="button" disabled={payBusy} onClick={() => void markPaid(r, null)} className={btnSm}>Mark paid without proof</button>
                              <button type="button" onClick={() => setPaying(null)} className="text-[11px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                  {rows.length > 1 && (
                    <button type="button" onClick={() => setFullSchedule(f => !f)} className="text-[11px] font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer">
                      {fullSchedule ? 'Fewer rows' : `Full schedule · ${rows.length} ${payWord}${hiddenOverdue ? ` · ${hiddenOverdue} more overdue` : ''}`}
                    </button>
                  )}
                  <button type="button" onClick={openPlanEditor} className="text-[11px] font-semibold text-[#5b615e] hover:text-[#1c1f1d] cursor-pointer ml-auto">Edit schedule</button>
                </div>
              </>
            )}
          </div>

          {/* documents */}
          <div className={card + ' px-[18px] py-4'}>
            <div className="flex justify-between items-baseline">
              <div className="text-[13px] font-bold">Documents</div>
              <label className={`text-[11px] font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer ${docBusy ? 'opacity-50' : ''}`}>{docBusy ? 'Uploading…' : '+ Attach'}
                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={docBusy} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadContractDoc(f); e.target.value = ''; }} />
              </label>
            </div>
            <div className="mt-1.5">
              {contractDocs.length === 0 && <div className="flex justify-between items-center py-[9px] border-b border-[#f1f3f1] text-[11.5px] text-[#8a8f8c]"><span>Contract attachment</span><span className="text-[10.5px]">none filed</span></div>}
              {contractDocs.map(d => (
                <div key={d.id} className="flex justify-between items-center py-[9px] border-b border-[#f1f3f1] text-[11.5px] gap-2">
                  <span className="min-w-0 truncate">{d.displayName ?? cap(d.documentKey)}</span>
                  <button type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? d.documentKey, documentKey: d.documentKey })} className="font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer shrink-0">View</button>
                </div>
              ))}
              <div className="flex justify-between items-center py-[9px] border-b border-[#f1f3f1] text-[11.5px] text-[#8a8f8c]"><span>Delivery notes · {notesFiled} of {n}</span><span className="text-[10.5px]">on visits</span></div>
              <div className="flex justify-between items-center py-[9px] text-[11.5px] text-[#8a8f8c]"><span>Inspected · {inspected} of {n}</span><span className="text-[10.5px]">on visits</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
