'use client';

/**
 * One AMC contract — the "AMC Details 1a" design (owner, 9 Sep 2026). Shared by
 * the RP page and the manager mirror.
 *
 * Header (identity, actions, fact strip, lineage) · Visits (month strip, the
 * next visit, needs-action rows worked through attended → delivery note →
 * delivery note, history) · right rail: Vendor, Payments, Documents.
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
import { splitVat, typedFromStored, aed2, type VatMode } from '@/lib/vatSplit';
import { AmountWithVat } from '@/components/upnow/VatChoice';
import { AddAmcModal, PaymentPlanEditor, useKinds, ongoingHorizon, accountTag, type AmcContract, type ContractKind, type PayRow, type CategoryOpt } from '@/components/amc/AmcView';

interface VendorInfo {
  email: string | null; phone: string | null; contactName: string | null; contactPhone: string | null;
  category: string | null; tradeLicenceNumber: string | null; tradeLicenceExpiry: string | null; emirates: string | null;
  inviteStatus: string; acceptedAt: string | null; activeContracts: number; since: string | null;
}
interface Contract extends AmcContract {
  vendor?: VendorInfo;
  tasks: { total: number; done: number; pending: number; overdue?: number; quotationsPending?: number };
}
interface Task {
  id: number; title: string; dueDate: string | null; status: string; completedAt: string | null; notes: string | null;
  attendedAt?: string | null; supervisedBy?: string | null; attendedByName?: string | null;
  deliveryNote?: { id: number; fileUrl: string; displayName: string | null } | null;
  inspectedAt?: string | null; inspectedByName?: string | null;
  /** The vendor's quotation for fixes found on the visit — kept with the visit. */
  quotation?: { id: number; fileUrl: string; displayName: string | null } | null;
  quotationAmountAed?: number | null; quotationVatMode?: VatMode; quotationVatAed?: number; quotationNotes?: string | null; quotationAt?: string | null;
  /** pending | approved | declined | completed — "either processed or still pending". */
  quotationStatus?: string | null; quotationStatusAt?: string | null;
}
interface Visit { t: Task; n: number; stages: [boolean, boolean]; done: number; overdueDays: number; state: 'done' | 'overdue' | 'next' | 'upcoming' | 'closed' }
interface InstDoc { id: number; fileUrl: string; displayName: string | null; documentKey: string }
/** 0281 — `bill` is the vendor's bill copy; `proof` is the proof of PAYMENT; `paymentMethod` how it was settled. */
/** 0299 — amountAed is the VAT-INCLUSIVE total; vatAed the VAT inside it. */
interface Inst { id: number | null; seq: number; dueDate: string; amountAed: number | null; vatMode?: VatMode; vatAed?: number; status: string; paidAt: string | null; reference: string | null; notes?: string | null; paymentMethod?: string | null; bill?: InstDoc | null; proof: InstDoc | null;
  /** 0347 — the bill's own dates; `payBy` = when it is actually due (its pay-by date, else the schedule date). */
  billDate?: string | null; billDueDate?: string | null; payBy?: string }
const PAY_METHODS = ['cheque', 'bank_transfer', 'cash', 'card', 'online'] as const;
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
  cancelled: { bg: '#f1f3f1', fg: '#5b615e', label: 'Cancelled' },
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

function StageBars({ stages, tone }: { stages: [boolean, boolean]; tone: 'neutral' | 'red' }) {
  const off = tone === 'red' ? '#e3c6c2' : '#e6e8e6';
  return (
    <div className="flex gap-1 shrink-0" title="Attended & inspected · Delivery note">
      {stages.map((on, i) => <span key={i} className="w-[22px] h-[5px] rounded-full" style={{ background: on ? '#1a7a52' : off }} />)}
    </div>
  );
}

const QUOTE_STATUS: Record<string, { label: string; bg: string; fg: string; hint: string }> = {
  pending:   { label: 'Pending',   bg: '#fdf3e3', fg: '#c47a00', hint: 'Awaiting your decision' },
  approved:  { label: 'Approved',  bg: '#e9effc', fg: '#2a5bd7', hint: 'Go-ahead given — fixes not yet done' },
  declined:  { label: 'Declined',  bg: '#f1f3f1', fg: '#5b615e', hint: 'Not going ahead' },
  completed: { label: 'Completed', bg: '#e7f4ee', fg: '#1a7a52', hint: 'Fixes carried out' },
};
const QUOTE_ORDER = ['pending', 'approved', 'completed', 'declined'] as const;

/** The vendor's quotation for fixes found on the visit — file, amount, note, and whether it was processed. Kept with the visit (owner, 10 Sep). */
function QuotationBlock({ t, n, busy, onSave, onAttach }: { t: Task; n: number; busy: boolean; onSave: (f: File | null, amount: string, vatMode: VatMode) => Promise<void>; onAttach: (f: File) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [vatMode, setVatMode] = useState<VatMode>(t.quotationVatMode ?? 'none');
  const [amount, setAmount] = useState(typedFromStored(t.quotationAmountAed, t.quotationVatAed, t.quotationVatMode ?? 'none'));
  const has = !!(t.quotation || t.quotationAmountAed != null);
  const close = () => { setOpen(false); setFile(null); };
  const stMeta = QUOTE_STATUS[t.quotationStatus ?? 'pending'] ?? QUOTE_STATUS.pending;
  if (!open) return (
    <div className="flex items-center gap-2 flex-wrap text-[11px] mt-2.5 pt-2.5 border-t border-[#eef0ee]">
      <span className="font-bold text-[#5b615e]">Fixes quoted</span>
      {has ? (
        <>
          {/* details only — the status is changed under Payments (owner, 10 Sep) */}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: stMeta.bg, color: stMeta.fg }} title={stMeta.hint}>{stMeta.label}</span>
          {t.quotationAmountAed != null && <span className="font-semibold">{aed(t.quotationAmountAed)}{t.quotationVatAed ? <span className="font-normal text-[#8a8f8c]"> incl. VAT {aed2(t.quotationVatAed)}</span> : null}</span>}
          {t.quotation
            ? <button type="button" onClick={() => openDocViewer({ fileUrl: t.quotation!.fileUrl, caption: `Quotation — Visit ${n}`, documentKey: 'quotation' })} className="font-semibold text-[#1a7a52] underline cursor-pointer">View quotation</button>
            : <label className={`font-bold text-[#c47a00] underline cursor-pointer ${busy ? 'opacity-50' : ''}`}>{busy ? 'Uploading…' : 'Attach quotation'}
                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void onAttach(f); e.target.value = ''; }} />
              </label>}
          <button type="button" onClick={() => setOpen(true)} className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Edit</button>
        </>
      ) : (
        <>
          <span className="text-[#8a8f8c]">none on record</span>
          <button type="button" disabled={busy || !t.attendedAt} title={t.attendedAt ? undefined : 'After attendance'} onClick={() => setOpen(true)} className={btnSm}>Add quotation</button>
        </>
      )}
    </div>
  );
  return (
    <div className="mt-2.5 pt-2.5 border-t border-[#eef0ee]">
      <div className="text-[11px] font-bold text-[#5b615e]">Vendor&apos;s quotation for fixes · Visit {n}</div>
      <div className="flex items-center gap-2 flex-wrap mt-1.5">
        <label className={btnSm + ' inline-block'}>{file ? file.name : t.quotation ? 'Replace file' : 'Choose file'}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        </label>
        <AmountWithVat size="sm" className="w-48" placeholder="Amount (AED)" amount={amount} onAmount={setAmount} mode={vatMode} onMode={setVatMode} />
        <button type="button" disabled={busy || (!file && !amount.trim() && !has)}
          onClick={() => void onSave(file, amount, vatMode).then(close)} className={btnGreenSm}>{busy ? 'Saving…' : 'Save quotation'}</button>
        <button type="button" onClick={close} className="text-[11px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Cancel</button>
      </div>
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
  // 0346 — ongoing: no end date; setting one stops the schedule there.
  const [ongoing, setOngoing] = useState(!!c.ongoing);
  const [accountNumber, setAccountNumber] = useState(c.accountNumber ?? '');
  const [vatMode, setVatMode] = useState<VatMode>(c.vatMode ?? 'none');
  const [annual, setAnnual] = useState(typedFromStored(c.annualValueAed, c.annualVatAed, c.vatMode ?? 'none'));
  // Blank = our 5%; filled = the supplier's own VAT figure. Starts from what is stored so an unchanged save keeps it to the fil.
  const [annualVat, setAnnualVat] = useState(c.annualVatAed ? String(c.annualVatAed) : '');
  const [mode, setMode] = useState(c.modeOfPayment ?? '');
  const [notes, setNotes] = useState(c.notes ?? '');
  // Same fields, same order, same words as the Add form (owner, 12 Sep: "are Add and Edit aligned?").
  const frequency = c.frequency ?? 'annually';
  const [propertyId, setPropertyId] = useState(c.propertyId != null ? String(c.propertyId) : '');
  // 0387 — the one unit of the property this contract / account is for.
  const [unitId, setUnitId] = useState(c.unitId != null ? String(c.unitId) : '');
  const [units, setUnits] = useState<Array<{ id: number; unitNumber: string }>>([]);
  useEffect(() => {
    if (!propertyId) { setUnits([]); return; }
    apiGet<Array<{ id: number; unitNumber: string }>>(rp != null ? `/manager/properties/${propertyId}/units` : `/properties/${propertyId}/units`)
      .then(list => setUnits(Array.isArray(list) ? list.map(u => ({ id: u.id, unitNumber: u.unitNumber })) : [])).catch(() => setUnits([]));
  }, [propertyId, rp]);
  const [props, setProps] = useState<{ id: number; buildingName?: string | null; name?: string | null; rentalProviderId?: number }[]>([]);
  useEffect(() => { apiGet<typeof props>(rp != null ? '/manager/properties' : '/properties').then(list => setProps(rp != null ? list.filter(p => p.rentalProviderId == null || p.rentalProviderId === rp) : list)).catch(() => setProps([])); }, [rp]);
  const { active: kindList, meta: kindOf } = useKinds(base, rp);
  const [kind, setKind] = useState<ContractKind>(c.kind ?? 'service');
  const [categoryLabel, setCategoryLabel] = useState(c.categoryLabel ?? '');
  const [categoryId, setCategoryId] = useState<number | null>(c.expenseCategoryId ?? null);
  const [cats, setCats] = useState<CategoryOpt[]>([]);
  const [newCat, setNewCat] = useState(false);
  useEffect(() => { apiGet<CategoryOpt[]>(scoped(base, rp, '/categories')).then(setCats).catch(() => setCats([])); }, [base, rp]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'w-full text-sm px-3 py-2 border border-[#e6e8e6] rounded-lg bg-white focus:outline-none focus:border-[#1a7a52]';
  const l = 'text-xs font-medium text-[#5b615e] mb-1 block';
  const canBeOngoing = !kindOf(kind).visits;
  async function submit() {
    setError(null);
    if (!(ongoing && canBeOngoing) && !endDate) { setError(canBeOngoing ? 'Set an end date, or tick "Ongoing — no end date".' : 'Set the end date.'); return; }
    setSaving(true);
    try {
      await apiPatch(scoped(base, rp, `/contracts/${c.id}`), {
        startDate: startDate || null, endDate: ongoing && canBeOngoing ? null : endDate || null,
        accountNumber: accountNumber.trim() || null,
        annualValueAed: annual.trim() !== '' ? Number(annual) : null,
        vatMode, annualVatAed: vatMode !== 'none' && annualVat.trim() !== '' ? Number(annualVat) : null,
        modeOfPayment: mode || null, notes: notes.trim() || null,
        propertyId: propertyId ? Number(propertyId) : null,
        unitId: propertyId && unitId ? Number(unitId) : null,
        kind, categoryLabel: categoryLabel.trim() || null, expenseCategoryId: newCat ? null : categoryId,
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
          <div>
            <span className={l}>Category</span>
            <div className="flex flex-wrap gap-1.5">
              {kindList.filter(k => k.isActive !== false || k.key === kind).map(k => (
                <button key={k.key} type="button" onClick={() => setKind(k.key)} title={k.hint}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full border cursor-pointer"
                  style={kind === k.key ? { background: k.fg, color: '#fff', borderColor: k.fg } : { background: '#fff', color: '#5b615e', borderColor: '#e6e8e6' }}>{k.label}</button>
              ))}
            </div>
            <p className="text-[11px] text-[#8a8f8c] mt-1">{kindOf(kind).hint}</p>
          </div>
          <div><span className={l}>Sub-category</span>
            {newCat ? (
              <div className="flex items-center gap-2">
                <input autoFocus className={field} placeholder="New sub-category name" value={categoryLabel} onChange={e => setCategoryLabel(e.target.value)} />
                <button type="button" onClick={() => { setNewCat(false); setCategoryLabel(c.categoryLabel ?? ''); setCategoryId(c.expenseCategoryId ?? null); }} className="text-[11px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer whitespace-nowrap">Pick existing</button>
              </div>
            ) : (
              <select className={field} value={categoryId ?? ''} onChange={e => {
                if (e.target.value === '__new') { setNewCat(true); setCategoryId(null); setCategoryLabel(''); return; }
                const id = e.target.value ? Number(e.target.value) : null; setCategoryId(id); setCategoryLabel(cats.find(x => x.id === id)?.name ?? '');
              }}>
                <option value="">— none —</option>
                {/* Only this kind's categories (owner, 12 Sep: the full list caused confusion); the one already on the contract stays selectable. */}
                {cats.filter(x => (x.isActive || x.id === categoryId) && (x.defaultKind === kind || x.id === categoryId)).map(x => <option key={x.id} value={x.id}>{x.name}{x.isActive ? '' : ' (retired)'}</option>)}
                <option value="__new">+ New sub-category…</option>
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className={l}>{kind === 'head_lease' ? 'Head landlord / authority' : 'Vendor'}</span><div className="text-[13px] font-semibold px-1 py-2 truncate">{c.vendorName}</div></div>
            <div><span className={l}>Property <span className="font-normal text-[#8a8f8c]">— which building</span></span>
              <select className={field} value={propertyId} onChange={e => { setPropertyId(e.target.value); setUnitId(''); }}>
                <option value="">— all / none —</option>
                {props.map(p => <option key={p.id} value={p.id}>{p.buildingName ?? p.name ?? `Property #${p.id}`}</option>)}
              </select>
            </div>
            {propertyId && units.length > 0 && (
              <div><span className={l}>Unit <span className="font-normal text-[#9b9890]">— only when this account is for one unit</span></span>
                <select className={field} value={unitId} onChange={e => setUnitId(e.target.value)}>
                  <option value="">— whole building —</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.unitNumber}</option>)}
                </select>
              </div>
            )}
          </div>
          <div><span className={l}>Account / contract no. <span className="font-normal text-[#8a8f8c]">— tells this vendor&rsquo;s contracts apart</span></span>
            <input className={field} value={accountNumber} onChange={e => setAccountNumber(e.target.value)} maxLength={60} placeholder="e.g. Etisalat account 764506535" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className={l}>Start date</span><input type="date" className={field} value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
            <div><span className={l}>End date</span>
              {ongoing && canBeOngoing
                ? <div className="text-sm px-3 py-2 border border-dashed border-[#d8d6d0] rounded-lg text-[#5b615e] bg-[#fafaf8]">Ongoing — no end date</div>
                : <input type="date" className={field} value={endDate} onChange={e => setEndDate(e.target.value)} />}
              {canBeOngoing && (
                <label className="flex items-center gap-1.5 text-[11px] text-[#5b615e] mt-1 cursor-pointer">
                  <input type="checkbox" checked={ongoing} onChange={e => setOngoing(e.target.checked)} /> Ongoing — no end date
                </label>
              )}
              {c.ongoing && !ongoing && canBeOngoing && <p className="text-[11px] text-[#8a8f8c] mt-1">Unbilled, unpaid rows after the end date are removed.</p>}
            </div>
            {/* Cadence is set once, on the Add form, where it generates the visits and the schedule. Changing it
                here would only relabel the contract — the rows already on record would not move — so it is read-only
                and says where the real change is made (owner, 12 Sep: "if I change, what will happen?"). */}
            <div><span className={l}>{kindOf(kind).schedule === 'bills' ? 'Billing cycle' : kindOf(kind).visits ? 'Visit & payment cadence' : 'Payment cadence'}</span>
              <div className="text-[13px] font-semibold px-1 py-2">{cap(frequency)}<span className="block text-[11px] font-normal text-[#8a8f8c]">Set when the contract was added. {kindOf(kind).visits ? 'Re-date or add visits on the contract page; ' : ''}edit the payment schedule under Payments.</span></div>
            </div>
            <div><span className={l}>{kind === 'policy' ? 'Annual premium (AED)' : kindOf(kind).schedule === 'bills' ? 'Annual value (AED, optional)' : 'Annual value (AED)'}</span><AmountWithVat amount={annual} onAmount={setAnnual} mode={vatMode} onMode={setVatMode} vatOverride={annualVat} onVatOverride={setAnnualVat} /></div>
            <div><span className={l}>Mode of payment</span>
              <select className={field} value={mode} onChange={e => setMode(e.target.value)}>
                <option value="">—</option>
                {['cheque', 'bank_transfer', 'cash', 'card', 'online'].map(m => <option key={m} value={m}>{cap(m)}</option>)}
              </select>
            </div>
            <div><span className={l}>Payments</span><div className="text-[12px] text-[#5b615e] px-1 py-2">{c.ongoing ? 'A year at a time, added automatically' : `${c.numberOfPayments ?? '—'} on the schedule`} · edit them on the contract page</div></div>
          </div>

          <div><span className={l}>Notes</span><textarea rows={3} className={field} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <p className="text-[11px] text-[#8a8f8c]">{kindOf(kind).visits ? 'The visit plan stays as scheduled — edit visits from the Visits card.' : 'No visit plan for this kind — bills and payments are worked on the contract page.'}</p>
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

export function AmcContractDetail({ contractId, base, rp, listHref, detailHrefOf, vendorHrefOf, canEdit = true }: {
  contractId: number;
  /** False for a manager who may only record vendor payments (0319): bills,
   *  spends and installments paid / unpaid stay live; editing, cancelling,
   *  renewing the contract, its schedule, visits and attachments do not. */
  canEdit?: boolean;
  /** '/amc' for the landlord, '/manager/amc' (+ rp) for a manager. */
  base: string; rp?: number | null;
  listHref: string;
  detailHrefOf: (id: number) => string;
  vendorHrefOf?: (spId: number) => string;
}) {
  const cid = contractId;
  const router = useRouter();
  const { meta: kindOf } = useKinds(base, rp);
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
  // 0346 — the year an ongoing contract's bills are shown for; null = this year.
  const [billYear, setBillYear] = useState<string | null>(null);
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payAmount, setPayAmount] = useState('');
  // 0299 — VAT choice on each amount keyed here; pay* remembers what the row opened with, so an untouched row is not re-split.
  const [payVat, setPayVat] = useState<VatMode>('none');
  const [payOpened, setPayOpened] = useState<{ amount: string; vat: VatMode }>({ amount: '', vat: 'none' });
  const [billVat, setBillVat] = useState<VatMode>('none');
  // 0347 — the dates printed on the bill (owner, 30 Sep: issue date and due date are not the same).
  const [billDate, setBillDate] = useState('');
  const [billDueDate, setBillDueDate] = useState('');
  const [spendVat, setSpendVat] = useState<VatMode>('none');
  const [payFile, setPayFile] = useState<File | null>(null);
  const [spendMethod, setSpendMethod] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [fullSchedule, setFullSchedule] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planRows, setPlanRows] = useState<PayRow[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<number | null>(null);
  // 0279 — bills and ad-hoc spend
  const [billingId, setBillingId] = useState<number | null>(null);
  const [billAmount, setBillAmount] = useState('');
  const [billRef, setBillRef] = useState('');
  const [spendOpen, setSpendOpen] = useState(false);
  const [spendDate, setSpendDate] = useState('');
  const [spendAmount, setSpendAmount] = useState('');
  const [spendRef, setSpendRef] = useState('');
  const [spendPaid, setSpendPaid] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [quoteAmount, setQuoteAmount] = useState('');

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
    say(`${list.length} visit${list.length === 1 ? '' : 's'} marked attended & inspected — file each delivery note to complete it.`);
  };
  const uploadNote = async (t: Task, f: File) => {
    setBusy(t.id);
    try {
      const docId = await uploadContractFile(cid, f, `delivery_note_task_${t.id}`, 'report', 'Delivery Note');
      if (docId) await apiPatch(scoped(base, rp, `/tasks/${t.id}/delivery-note`), { documentId: docId });
      load();
    } finally { setBusy(null); }
  };
  /** Processed or still pending — the quotation's status, set from the visit. */
  const setQuotationStatus = async (t: Task, n: number, status: string) => {
    setBusy(t.id);
    try { await apiPatch(scoped(base, rp, `/tasks/${t.id}/quotation`), { status }); load(); say(`Quotation on visit ${n} marked ${QUOTE_STATUS[status]?.label.toLowerCase() ?? status}.`); }
    catch { say('Could not update the quotation status.', 'warn'); }
    finally { setBusy(null); }
  };
  /** 0279 — the bill arrived: its amount (and reference / copy) go on the awaiting row. */
  const enterBill = async (r: Inst, f: File | null) => {
    if (r.id == null) return;
    const v = billAmount.trim();
    if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) { say('Enter the bill amount.', 'warn'); return; }
    if (billDate && billDueDate && billDueDate < billDate) { say('The due date is before the bill date.', 'warn'); return; }
    setPayBusy(true);
    try {
      let proofDocId: number | null = null;
      if (f) proofDocId = await uploadContractFile(cid, f, `sp_bill_inst_${r.id}`, 'payment', billRef.trim() ? `Bill · ${billRef.trim()}` : `Bill · #${r.seq}`);
      await apiPatch(scoped(base, rp, `/installments/${r.id}/bill`), { amountAed: Number(v), vatMode: billVat, reference: billRef.trim() || null, billDocId: proofDocId, billDate: billDate || null, billDueDate: billDueDate || null });
      setBillingId(null); setBillAmount(''); setBillRef(''); setBillDate(''); setBillDueDate(''); load(); say(`Bill #${r.seq} recorded — ${aed2(splitVat(Number(v), billVat).total)}${billVat !== 'none' ? ' incl. VAT' : ''}.`);
    } catch { say('Could not record the bill.', 'warn'); }
    finally { setPayBusy(false); }
  };
  /** 0279 — one spend / extra bill on the contract (ad-hoc kinds, or any other). */
  const recordSpend = async (f: File | null) => {
    const v = spendAmount.trim();
    if (!spendDate) { say('Pick the date.', 'warn'); return; }
    if (spendPaid && (v === '' || !Number.isFinite(Number(v)))) { say('Enter the amount.', 'warn'); return; }
    setPayBusy(true);
    try {
      // The receipt is the proof of PAYMENT when the spend is already paid; a bill copy otherwise.
      let docId: number | null = null;
      if (f) docId = await uploadContractFile(cid, f, `sp_${spendPaid ? 'payment_proof' : 'bill'}_spend_${Date.now()}`, 'payment', spendRef.trim() ? `${spendPaid ? 'Proof of Payment' : 'Bill'} · ${spendRef.trim()}` : (spendPaid ? 'Proof of Payment' : 'Bill'));
      await apiPost<{ id: number }>(scoped(base, rp, `/contracts/${cid}/installments`), {
        dueDate: spendDate, amountAed: v === '' ? null : Number(v), vatMode: spendVat, reference: spendRef.trim() || null,
        paidAt: spendPaid ? spendDate : null, paymentMethod: spendMethod || null,
        proofDocId: spendPaid ? docId : null, billDocId: spendPaid ? null : docId,
      });
      setSpendOpen(false); setSpendAmount(''); setSpendRef(''); load(); say(spendPaid ? 'Spend recorded as paid.' : 'Bill added to the schedule.');
    } catch { say('Could not record it.', 'warn'); }
    finally { setPayBusy(false); }
  };
  /** Discontinue the contract: open visits close, nothing stays pending, no renewal offered. */
  const cancelContract = async () => {
    setCancelBusy(true);
    try { await apiPatch(scoped(base, rp, `/contracts/${cid}/cancel`), { reason: cancelReason.trim() || null }); setCancelOpen(false); load(); say('Contract cancelled — its open visits are closed.'); }
    catch (e) { say((e as Error)?.message || 'Could not cancel the contract.', 'warn'); }
    finally { setCancelBusy(false); }
  };
  /** Change the quoted amount alone (inline, under Payments). */
  const saveQuotationAmount = async (t: Task, n: number) => {
    const v = quoteAmount.trim();
    if (v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)) { say('Enter a valid amount.', 'warn'); return; }
    setBusy(t.id);
    try { await apiPatch(scoped(base, rp, `/tasks/${t.id}/quotation`), { amountAed: v === '' ? null : Number(v), vatMode: t.quotationVatMode ?? 'none' }); setEditingQuoteId(null); load(); say(`Quotation amount on visit ${n} updated.`); }
    catch { say('Could not update the amount.', 'warn'); }
    finally { setBusy(null); }
  };
  /** Attach (or replace) the quotation file alone. */
  const attachQuotationFile = async (t: Task, n: number, f: File) => {
    setBusy(t.id);
    try {
      const docId = await uploadContractFile(cid, f, `quotation_task_${t.id}`, 'report', `Quotation · Visit ${n}`);
      if (!docId) throw new Error('upload');
      await apiPatch(scoped(base, rp, `/tasks/${t.id}/quotation`), { documentId: docId });
      load(); say(`Quotation file attached to visit ${n}.`);
    } catch { say('Could not attach the quotation file.', 'warn'); }
    finally { setBusy(null); }
  };
  /** The vendor's quotation for fixes — file (optional), amount, note — saved on the visit. */
  const saveQuotation = async (t: Task, n: number, f: File | null, amount: string, vatMode: VatMode) => {
    setBusy(t.id);
    try {
      const body: { documentId?: number; amountAed: number | null; vatMode: VatMode } = { amountAed: amount.trim() ? Number(amount) : null, vatMode };
      if (f) { const docId = await uploadContractFile(cid, f, `quotation_task_${t.id}`, 'report', `Quotation · Visit ${n}`); if (docId) body.documentId = docId; }
      await apiPatch(scoped(base, rp, `/tasks/${t.id}/quotation`), body);
      load(); say(`Quotation saved with visit ${n}.`);
    } catch { say('Could not save the quotation.', 'warn'); }
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
      await apiPatch(scoped(base, rp, `/installments/${target.id}/paid`), { reference: payRef.trim() || null, paidAt: payDate || null, proofDocId, paymentMethod: payMethod || null,
        // Untouched amount + VAT choice → send the stored total alone, so the row's exact VAT (a supplier's figure) is kept.
        ...(payAmount.trim() === payOpened.amount && payVat === payOpened.vat
          ? { amountAed: target.amountAed ?? null }
          : { amountAed: payAmount.trim() !== '' && Number.isFinite(Number(payAmount)) ? Number(payAmount) : null, vatMode: payVat }) });
      setPaying(null); setPayRef(''); setPayDate(''); setPayFile(null); load();
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
      await apiPut(scoped(base, rp, `/contracts/${cid}/installments`), { installments: rows.filter(r => r.dueDate).map(r => ({ id: r.id ?? null, dueDate: r.dueDate, amountAed: String(r.amountAed).trim() === '' ? null : Number(r.amountAed) || 0 })) });
      setPlanOpen(false); load(); say('Payment schedule saved.');
    } catch (e) { say((e as Error)?.message || 'Could not save the schedule.', 'warn'); }
    finally { setPlanBusy(false); }
  };
  const openPlanEditor = () => {
    setPlanRows((inst?.installments ?? []).map(r => ({ id: r.id, dueDate: r.dueDate, amountAed: r.amountAed == null ? '' : String(r.amountAed), status: r.status, reference: r.reference, storedAmountAed: r.amountAed, storedVatAed: r.vatAed ?? 0 })));
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
  // A cancelled (discontinued) contract is neither renewable nor cancellable again.
  const cancelled = c.status === 'cancelled';
  const km = kindOf(c.kind);
  // An ongoing contract never runs out, so there is nothing to renew (0346).
  const renewable = c.renewedById == null && !cancelled && !c.ongoing;
  const cancellable = !cancelled && c.renewedById == null;
  const v = c.vendor;
  const category = v?.category ?? (c.serviceCategory ? cap(c.serviceCategory) : null);
  const contactEmail = v?.email ?? null;
  const contactPhone = v?.phone ?? v?.contactPhone ?? null;

  const all: Visit[] = (tasks ?? []).map((t, i) => {
    // Attended (which is the inspection — owner, 15 Sep 2026: "keep one") → delivery note completes the visit.
    const stages: [boolean, boolean] = [!!t.attendedAt, !!t.deliveryNote];
    const due = t.dueDate ? isoDay(t.dueDate) : null;
    // 'closed' = missed (cleared past visit) or cancelled with the contract — neither late nor pending.
    const closed = t.status === 'missed' || t.status === 'cancelled';
    const overdueDays = due && t.status === 'pending' ? daysBetween(due, today) : 0;
    return { t, n: i + 1, stages, done: stages.filter(Boolean).length, overdueDays, state: t.status === 'done' ? 'done' : closed ? 'closed' : overdueDays > 0 ? 'overdue' : 'upcoming' };
  });
  const next = all.find(x => x.state === 'upcoming') ?? null;
  if (next) next.state = 'next';
  const overdue = all.filter(x => x.state === 'overdue');
  const history = all.filter(x => x.state === 'done').sort((a, b) => (b.t.completedAt ?? b.t.attendedAt ?? '').localeCompare(a.t.completedAt ?? a.t.attendedAt ?? ''));
  const attendedCount = all.filter(x => x.stages[0]).length;
  const notesFiled = all.filter(x => x.stages[1]).length;
  // Quotations for fixes attached to visits — open (pending/approved) first, newest first within.
  const quotes = all.filter(x => x.t.quotation || x.t.quotationAmountAed != null)
    .sort((a, b) => Number(['declined', 'completed'].includes(a.t.quotationStatus ?? '')) - Number(['declined', 'completed'].includes(b.t.quotationStatus ?? '')) || (b.t.quotationAt ?? '').localeCompare(a.t.quotationAt ?? ''));
  const openQuotes = quotes.filter(x => !['declined', 'completed'].includes(x.t.quotationStatus ?? 'pending'));
  const toAttend = overdue.filter(x => !x.stages[0]).map(x => x.t);
  const openId = expandedId != null && overdue.some(x => x.t.id === expandedId) ? expandedId : overdue[0]?.t.id ?? null;
  const n = all.length;
  const monthLabels = all.map(x => mon(x.t.dueDate));
  const yearInLabel = new Set(monthLabels.filter(Boolean)).size < monthLabels.filter(Boolean).length;
  const idx = (pred: (x: Visit) => boolean) => { const i = all.findIndex(pred); return i; };
  const firstOverdue = idx(x => x.state === 'overdue'), lastOverdue = all.length - 1 - [...all].reverse().findIndex(x => x.state === 'overdue');
  const firstDone = idx(x => x.state === 'done'), lastDone = all.length - 1 - [...all].reverse().findIndex(x => x.state === 'done');
  const seg = (a: number, b: number) => ({ left: `${((a + 0.5) / n) * 100}%`, width: `${((b - a) / n) * 100}%` });

  const contractDocs = c.documents.filter(d => !/payment/i.test(d.documentKey) && !/^(delivery_note|quotation)_task_/.test(d.documentKey));
  const rows = inst?.installments ?? [];
  const derived = inst?.derived ?? true;
  // 'awaiting' = a bill not yet received (no amount): it is awaited, not overdue.
  // 0347 — overdue from the bill's own due date when it has one, else the schedule date.
  const stateOf = (r: Inst): 'paid' | 'overdue' | 'upcoming' | 'awaiting' => r.status === 'paid' ? 'paid' : r.amountAed == null ? 'awaiting' : (r.payBy ?? r.dueDate) < today ? 'overdue' : 'upcoming';
  const paidRows = rows.filter(r => r.status === 'paid');
  // An ongoing contract's bills, one year at a time (owner, 30 Sep: "we will render year wise"). It opens on this year.
  const billYears = c.ongoing ? [...new Set(rows.map(r => r.dueDate.slice(0, 4)))].sort() : [];
  const yearOn = billYears.length ? (billYear && billYears.includes(billYear) ? billYear : billYears.includes(today.slice(0, 4)) ? today.slice(0, 4) : billYears[billYears.length - 1]) : null;
  const yearRows = yearOn ? rows.filter(r => r.dueDate.slice(0, 4) === yearOn) : rows;
  const overdueRows = rows.filter(r => stateOf(r) === 'overdue');
  const awaitingRows = rows.filter(r => stateOf(r) === 'awaiting');
  const received = paidRows.reduce((n, r) => n + (r.amountAed ?? 0), 0);
  const totalDue = rows.reduce((n, r) => n + (r.amountAed ?? 0), 0);
  // 0299 — the VAT inside those totals.
  const vatPaid = Math.round(paidRows.reduce((n, r) => n + (r.vatAed ?? 0), 0) * 100) / 100;
  const vatTotal = Math.round(rows.reduce((n, r) => n + (r.vatAed ?? 0), 0) * 100) / 100;
  const payWord = c.modeOfPayment === 'cheque' ? 'cheques' : 'payments';
  const lastPaid = [...paidRows].sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? '') || a.seq - b.seq).reverse()[0] ?? null;
  const nextUp = rows.find(r => stateOf(r) === 'upcoming') ?? null;
  const hiddenOverdue = fullSchedule ? 0 : Math.max(0, overdueRows.length - 3);
  const shownRows: Inst[] = fullSchedule ? rows : [
    ...overdueRows.slice(0, 3),
    ...(nextUp ? [nextUp] : []),
    ...awaitingRows.filter(r => r.dueDate.slice(0, 7) <= today.slice(0, 7)).slice(0, 2),
    ...(lastPaid && !overdueRows.slice(0, 3).includes(lastPaid) ? [lastPaid] : []),
  ].sort((a, b) => a.seq - b.seq);
  const contractStart = c.startDate ? isoDay(c.startDate) : '';
  // 0346 — an ongoing contract's plan: this calendar year (next year's is added automatically).
  const contractEnd = c.endDate ? isoDay(c.endDate) : c.ongoing && contractStart ? ongoingHorizon(contractStart) : '';
  const annualStr = c.annualValueAed != null ? String(c.annualValueAed) : '';

  const stageWord = (x: Visit) => !x.stages[0] ? 'awaiting attendance' : 'awaiting delivery note';
  const primaryAction = (x: Visit) => {
    const t = x.t; const b = busy === t.id;
    if (!canEdit) return null;
    if (!x.stages[0]) return <button type="button" disabled={b} onClick={() => { setExpandedId(t.id); setAttendingId(t.id); }} className={btnGreenSm}>Mark attended</button>;
    return (
      <label className={btnFillSm + (b ? ' opacity-50' : '')}>{b ? 'Uploading…' : 'Upload note'}
        <input type="file" accept="image/*,application/pdf" className="hidden" disabled={b} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadNote(t, f); e.target.value = ''; }} />
      </label>
    );
  };
  // Always the person who marked the visit attended; a named supervisor is added after, never in their place.
  const whoAttended = (t: Task) => {
    const by = t.attendedByName ? `by ${t.attendedByName}` : '';
    const sup = t.supervisedBy && t.supervisedBy !== 'self' ? `supervised by ${t.supervisedBy}` : '';
    return [by, sup].filter(Boolean).join(' · ') || '—';
  };

  const dotStyle = (x: Visit): CSSProperties => {
    if (x.state === 'done') return { background: '#1a7a52', border: '2px solid #1a7a52', color: '#fff' };
    if (x.state === 'overdue') return { background: '#fff', border: '2px solid #b42318', boxShadow: all.indexOf(x) === lastOverdue ? '0 0 0 4px #fdecea' : undefined };
    if (x.state === 'next') return { background: '#fff', border: '2px solid #1c1f1d' };
    if (x.state === 'closed') return { background: '#f1f3f1', border: '2px solid #d9ddda', color: '#8a8f8c' };
    return { background: '#fff', border: '2px solid #d9ddda' };
  };

  /** The schedule rows — shared by the rail (service contracts) and the main column (every other kind). */
  const paymentRows = (list: Inst[]) => (
                <div className="mt-3 border-t border-[#eef0ee]">
                  {list.map(r => {
                    const st = stateOf(r);
                    return (
                      <div key={r.seq} className="border-b border-[#f1f3f1]">
                        <div className={`flex justify-between items-center pt-2 ${r.amountAed != null ? 'pb-0.5' : 'pb-2'} text-[11.5px] gap-2 ${st !== 'overdue' ? 'text-[#5b615e]' : ''}`}>
                          <span className="min-w-0 truncate">
                            <span className={st === 'overdue' ? 'text-[#b42318] font-bold' : st === 'awaiting' ? 'text-[#c47a00] font-bold' : ''}>#{r.seq}</span> · {fmtS(r.dueDate)} · {r.amountAed == null ? <span className="text-[#c47a00]">amount on bill</span> : aed(r.amountAed)}{st === 'paid' && r.reference ? ` · ${r.reference}` : ''}
                          </span>
                          {r.bill && <button type="button" onClick={() => openDocViewer({ fileUrl: r.bill!.fileUrl, caption: r.bill!.displayName ?? 'Bill', documentKey: r.bill!.documentKey })} className="text-[10.5px] text-[#5b615e] font-semibold underline cursor-pointer shrink-0" title="The vendor's bill copy">bill</button>}
                          {st === 'paid' && (
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="text-[10.5px] text-[#1a7a52] font-bold">paid{r.paidAt ? ` ${fmtS(r.paidAt)}` : ''}{r.paymentMethod ? ` · ${cap(r.paymentMethod)}` : ''}</span>
                              {r.proof
                                ? <button type="button" onClick={() => openDocViewer({ fileUrl: r.proof!.fileUrl, caption: r.proof!.displayName ?? 'Proof of Payment', documentKey: r.proof!.documentKey })} className="text-[10.5px] text-[#1a7a52] font-bold underline cursor-pointer" title="Proof of payment">proof</button>
                                : <span className="text-[10.5px] text-[#c47a00] font-semibold" title="No proof of payment on file">no proof</span>}
                              <button type="button" onClick={() => void unmarkPaid(r)} className="text-[10px] text-[#8a8f8c] hover:text-[#b42318] cursor-pointer" title="Reopen this installment">undo</button>
                            </span>
                          )}
                          {st === 'awaiting' && (
                            <button type="button" onClick={() => { setBillingId(r.id); setBillAmount(''); setBillRef(''); setBillDate(''); setBillDueDate(''); setBillVat(c.vatMode ?? 'none'); setPaying(null); }}
                              className="text-[10.5px] font-bold px-2 py-[3px] rounded-[5px] border border-[#c47a00] text-[#c47a00] bg-white cursor-pointer shrink-0">
                              {r.dueDate.slice(0, 7) <= today.slice(0, 7) ? 'Enter bill' : 'bill awaited'}
                            </button>
                          )}
                          {/* 0347 — a bill already entered can be corrected (its dates, amount, number) until it is paid. */}
                          {st !== 'paid' && st !== 'awaiting' && km.schedule === 'bills' && r.id != null && (
                            <button type="button" onClick={() => { setBillingId(r.id); setBillAmount(typedFromStored(r.amountAed, r.vatAed ?? 0, r.vatMode ?? 'none')); setBillVat(r.vatMode ?? 'none'); setBillRef(r.reference ?? ''); setBillDate(r.billDate ?? ''); setBillDueDate(r.billDueDate ?? ''); setPaying(null); }}
                              className="text-[10px] text-[#8a8f8c] hover:text-[#1c1f1d] underline cursor-pointer shrink-0">edit bill</button>
                          )}
                          {st !== 'paid' && st !== 'awaiting' && (
                            <button type="button" onClick={() => { setPaying(r); setPayRef(''); setPayDate(today); setPayMethod(c.modeOfPayment && (PAY_METHODS as readonly string[]).includes(c.modeOfPayment) ? c.modeOfPayment : ''); { const vm: VatMode = r.amountAed != null ? (r.vatMode ?? 'none') : (c.vatMode ?? 'none'); const typed = typedFromStored(r.amountAed, r.vatAed, vm); setPayAmount(typed); setPayVat(vm); setPayOpened({ amount: typed, vat: vm }); } setPayFile(null); }}
                              className={`text-[10.5px] font-bold px-2 py-[3px] rounded-[5px] border bg-white cursor-pointer shrink-0 ${st === 'overdue' ? 'border-[#b42318] text-[#b42318]' : 'border-[#d9ddda] text-[#5b615e]'}`}>
                              {st === 'overdue' ? 'Mark paid' : 'upcoming · pay'}
                            </button>
                          )}
                        </div>
                        {r.amountAed != null && (
                          <div className="pb-2 text-[10.5px] text-[#8a8f8c]">
                            {r.vatAed
                              ? <>Before VAT <span className="font-semibold text-[#5b615e]">{aed2(Math.round((r.amountAed - r.vatAed) * 100) / 100)}</span> + VAT <span className="font-semibold text-[#5b615e]">{aed2(r.vatAed)}</span></>
                              : 'No VAT'}
                            {r.billDate && <> · bill dated <span className="font-semibold text-[#5b615e]">{fmtS(r.billDate)}</span></>}
                            {r.billDueDate && <> · <span className={st === 'overdue' ? 'font-bold text-[#b42318]' : 'font-semibold text-[#5b615e]'}>due {fmtS(r.billDueDate)}</span></>}
                          </div>
                        )}
                        {billingId != null && billingId === r.id && (
                          <div className="my-2 p-2 rounded-lg border border-[#f5d9a8] bg-[#fdf8ee]">
                            <div className="text-[11px] font-semibold text-[#5b615e] mb-1.5">Bill #{r.seq} · {fmtS(r.dueDate)} — {r.amountAed != null ? 'correct the bill on record' : 'record the bill as it arrived'}</div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <AmountWithVat size="sm" accent="#c47a00" className="w-48" placeholder="Amount (AED)" autoFocus amount={billAmount} onAmount={setBillAmount} mode={billVat} onMode={setBillVat} />
                              <input value={billRef} onChange={e => setBillRef(e.target.value)} placeholder="Bill / invoice no."
                                className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#c47a00] flex-1 min-w-[120px]" />
                            </div>
                            <div className="flex items-center gap-3 flex-wrap mt-2">
                              <label className="text-[11px] text-[#5b615e] flex items-center gap-1.5">Bill date
                                <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className="text-[12px] px-2 py-1 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#c47a00]" /></label>
                              <label className="text-[11px] text-[#5b615e] flex items-center gap-1.5">Due date
                                <input type="date" value={billDueDate} min={billDate || undefined} onChange={e => setBillDueDate(e.target.value)} className="text-[12px] px-2 py-1 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#c47a00]" /></label>
                              <span className="text-[10.5px] text-[#8a8f8c]">As printed on the bill — overdue counts from its due date.</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mt-2">
                              <label className={btnFillSm + (payBusy ? ' opacity-50' : '')}>{payBusy ? 'Saving…' : 'Attach bill copy & save'}
                                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={payBusy} onChange={e => { const f = e.target.files?.[0]; if (f) void enterBill(r, f); e.target.value = ''; }} />
                              </label>
                              <button type="button" disabled={payBusy} onClick={() => void enterBill(r, null)} className={btnSm}>{r.bill ? 'Save (keep the copy on file)' : 'Save without the copy'}</button>
                              <button type="button" onClick={() => setBillingId(null)} className="text-[11px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
  );

  return (
    <div className="max-w-[1040px] mx-auto px-4 sm:px-7 py-6 pb-10 text-[#1c1f1d]">
      {paying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={() => !payBusy && setPaying(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f3f1]">
              <div>
                <h2 className="text-sm font-bold">Record payment · #{paying.seq}</h2>
                <p className="text-[11.5px] text-[#5b615e] mt-0.5">{c.vendorName}{c.accountNumber ? ` · Acc ${c.accountNumber}` : ''} · due {fmtD(paying.payBy ?? paying.dueDate)}{paying.reference ? ` · bill ${paying.reference}` : ''}</p>
              </div>
              <button type="button" onClick={() => setPaying(null)} className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs font-medium text-[#5b615e] mb-1 block">Amount paid (AED)</span>
                  {/* Untouched, the stored VAT (possibly the supplier's exact figure) is what the split shows and what is kept. */}
                  <AmountWithVat placeholder="0.00" amount={payAmount} onAmount={setPayAmount} mode={payVat} onMode={setPayVat}
                    vatOverride={payAmount.trim() === payOpened.amount && payVat === payOpened.vat && paying.vatAed ? String(paying.vatAed) : undefined} />
                </div>
                <div>
                  <span className="text-xs font-medium text-[#5b615e] mb-1 block">Paid on</span>
                  <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="w-full text-sm px-3 py-2 border border-[#e6e8e6] rounded-lg bg-white focus:outline-none focus:border-[#1a7a52]" />
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-[#5b615e] mb-1.5 block">Paid by</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {PAY_METHODS.map(m => (
                    <button key={m} type="button" onClick={() => setPayMethod(m)}
                      className="text-[11.5px] font-semibold px-2 py-2.5 rounded-lg border cursor-pointer text-center"
                      style={payMethod === m ? { background: '#1a7a52', color: '#fff', borderColor: '#1a7a52' } : { background: '#fff', color: '#5b615e', borderColor: '#e6e8e6' }}>{cap(m)}</button>
                  ))}
                </div>
                {!payMethod && <p className="text-[11px] text-[#c47a00] mt-1">Pick how it was paid.</p>}
              </div>
              <div>
                <span className="text-xs font-medium text-[#5b615e] mb-1 block">{payMethod === 'cheque' ? 'Cheque number · bank' : payMethod === 'bank_transfer' ? 'Transfer reference' : payMethod === 'card' || payMethod === 'online' ? 'Transaction reference' : 'Reference'}</span>
                <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder={payMethod === 'cheque' ? 'e.g. 002915 · ENBD' : payMethod === 'cash' ? 'Receipt no. (optional)' : 'e.g. FT26091012345'} className="w-full text-sm px-3 py-2 border border-[#e6e8e6] rounded-lg bg-white focus:outline-none focus:border-[#1a7a52]" />
              </div>
              <div>
                <span className="text-xs font-medium text-[#5b615e] mb-1 block">Proof of payment <span className="font-normal text-[#8a8f8c]">— cheque copy, transfer receipt</span></span>
                <label className={`flex items-center justify-center gap-2 text-xs border border-dashed rounded-lg px-3 py-4 cursor-pointer ${payFile ? 'border-[#1a7a52] bg-[#e7f4ee] text-[#1a7a52] font-semibold' : 'border-[#d9ddda] text-[#5b615e] hover:bg-[#f6f7f6]'}`}>
                  {payFile ? payFile.name : 'Attach the proof (PDF or photo)'}
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={payBusy} onChange={e => { setPayFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                </label>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[#f1f3f1]">
              <button type="button" onClick={() => setPaying(null)} className={btn}>Cancel</button>
              <div className="flex items-center gap-2">
                {!payFile && <button type="button" disabled={payBusy || !payMethod || payAmount.trim() === ''} onClick={() => void markPaid(paying, null)} className={btn}>Mark paid without proof</button>}
                <button type="button" disabled={payBusy || !payMethod || payAmount.trim() === '' || !payFile} onClick={() => void markPaid(paying, payFile)} className={btnPrimary}>{payBusy ? 'Saving…' : 'Attach proof & mark paid'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editing && <EditAmcModal base={base} rp={rp} c={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); say('Contract updated.'); }} />}
      {planOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={() => setPlanOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f3f1]">
              <h2 className="text-sm font-bold text-[#1c1f1d]">Payment schedule — AMC-{c.id}</h2>
              <button onClick={() => setPlanOpen(false)} className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer" aria-label="Close"><X size={18} /></button>
            </div>
            <div className="px-5 py-4">
              <p className="text-[11.5px] text-[#5b615e] mb-3">Term {fmtD(c.startDate)} → {c.ongoing ? 'ongoing' : fmtD(c.endDate)} · {c.frequency ? cap(c.frequency) : 'no frequency'} · {aed(c.annualValueAed)}/yr{c.annualVatAed ? ` (incl. VAT ${aed2(c.annualVatAed)})` : ''}. Pick a preset or shape the plan by hand — any number of installments, any dates and amounts. Paid installments stay as they are.</p>
              <PaymentPlanEditor ongoing={!!c.ongoing} start={contractStart} end={contractEnd} frequency={c.frequency ?? ''} annualValue={annualStr} rows={planRows} onChange={setPlanRows} dirty={planDirty} setDirty={setPlanDirty} vatInside={(c.vatMode ?? 'none') !== 'none'} />
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
              {accountTag(c) && <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full bg-[#f1f3f1] text-[#5b615e]">{accountTag(c)}</span>}
              <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
              {!km.visits && <span className="text-[10.5px] font-bold px-2 py-[3px] rounded-full" style={{ background: km.bg, color: km.fg }} title={km.hint}>{km.label}</span>}
              {km.visits && overdue.length > 0 && <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#fdecea] text-[#b42318]">{overdue.length} visit{overdue.length === 1 ? '' : 's'} overdue</span>}
              {c.contractType === 'renewal' && <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full bg-[#e9effc] text-[#2a5bd7]">Renewal</span>}
            </div>
            <p className="text-[12px] text-[#5b615e] mt-1">
              {c.propertyName ?? 'All properties'}{c.unitNumber ? <> {c.unitNumber}</> : null}{c.categoryLabel ? <> · {c.categoryLabel}</> : category ? <> · {category}</> : null}
              {vendorHrefOf && <> · <Link href={vendorHrefOf(c.vendorId)} className="text-[#1a7a52] hover:text-[#125a3c] underline">Vendor profile</Link></>}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {canEdit && cancellable && <button type="button" onClick={() => setCancelOpen(o => !o)} className={btn + ' text-[#b42318] border-[#f1c8c4] hover:bg-[#fff8f7]'}>Cancel contract</button>}
            {canEdit && !cancelled && <button type="button" onClick={() => setEditing(true)} className={btn}>Edit</button>}
            {canEdit && renewable && <button type="button" onClick={() => setRenewing(true)} className={btnPrimary}>Renew contract</button>}
          </div>
        </div>
        {cancelOpen && !cancelled && (
          <div className="mt-3 p-3 rounded-lg border border-[#f1c8c4] bg-[#fff8f7]">
            <div className="text-[12px] font-bold text-[#b42318]">Cancel AMC-{c.id} with {c.vendorName}?</div>
            <p className="text-[11.5px] text-[#5b615e] mt-0.5">The contract is marked discontinued: its {all.filter(x => x.state !== 'done' && x.state !== 'closed').length} open visit{all.filter(x => x.state !== 'done' && x.state !== 'closed').length === 1 ? '' : 's'} close, nothing stays pending on the dashboard, and no renewal is offered. Payments already recorded stay on file.</p>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <input value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason (optional) — e.g. vendor replaced, building sold"
                className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#b42318] flex-1 min-w-[220px]" />
              <button type="button" disabled={cancelBusy} onClick={() => void cancelContract()} className="text-[11px] font-bold px-3 py-1.5 rounded-md bg-[#b42318] text-white hover:bg-[#961c12] cursor-pointer disabled:opacity-50">{cancelBusy ? 'Cancelling…' : 'Yes, cancel the contract'}</button>
              <button type="button" onClick={() => setCancelOpen(false)} className="text-[11px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Keep it</button>
            </div>
          </div>
        )}
        {cancelled && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-[#f1f3f1] text-[12px] text-[#5b615e]">
            <b className="text-[#1c1f1d]">Cancelled</b>{c.cancelledAt ? ` on ${fmtD(c.cancelledAt)}` : ''}{c.cancelReason ? ` · ${c.cancelReason}` : ''} — discontinued; open visits were closed and no renewal is offered.
          </div>
        )}
        {/* fact strip */}
        <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_1fr] mt-[18px] border-t border-[#eef0ee] pt-3.5 gap-y-3">
          <div className="sm:pr-[18px] sm:border-r border-[#eef0ee]"><div className={lbl}>PERIOD</div><div className="text-[13px] font-semibold mt-[3px]">{fmtD(c.startDate)} → {c.ongoing ? 'Ongoing' : fmtD(c.endDate)}</div></div>
          {km.visits
            ? <div className="sm:px-[18px] sm:border-r border-[#eef0ee]"><div className={lbl}>INSPECTIONS</div><div className="text-[13px] font-semibold mt-[3px]">{c.frequency ? cap(c.frequency) : 'As scheduled'} · {n} visit{n === 1 ? '' : 's'}</div></div>
            : <div className="sm:px-[18px] sm:border-r border-[#eef0ee]"><div className={lbl}>{km.schedule === 'bills' ? 'BILLS' : km.schedule === 'none' ? 'SPEND' : 'PAYMENTS'}</div><div className="text-[13px] font-semibold mt-[3px]">{km.schedule === 'none' ? `${rows.length} recorded` : `${c.frequency ? cap(c.frequency) : 'As set'} · ${c.ongoing ? 'each year added automatically' : `${rows.length} ${km.schedule === 'bills' ? 'bills' : payWord}`}`}</div></div>}
          <div className="sm:px-[18px]"><div className={lbl}>ANNUAL VALUE</div><div className="text-[13px] font-semibold mt-[3px]">{aed(c.annualValueAed)}</div>{c.annualValueAed != null && (c.annualVatAed ? <div className="text-[10.5px] text-[#8a8f8c] mt-0.5">{aed2(c.annualValueAed - c.annualVatAed)} + VAT {aed2(c.annualVatAed)}</div> : <div className="text-[10.5px] text-[#8a8f8c] mt-0.5">No VAT</div>)}</div>
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
        {km.visits ? ( /* ── visits ── */
        <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5 min-w-0'}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-[14px] font-bold">Visits</h2>
            <span className="text-[11px] text-[#8a8f8c]">
              {(c.tasks.quotationsPending ?? 0) > 0 && <span className="font-bold text-[#c47a00] mr-2">{c.tasks.quotationsPending} quotation{c.tasks.quotationsPending === 1 ? '' : 's'} open</span>}
              A visit completes when attended (which is the inspection) and the delivery note is filed
            </span>
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
                      {x.state === 'done' ? '✓' : x.state === 'closed' ? '–' : x.state === 'overdue' && x.done > 0 ? <span className="w-2 h-2 rounded-full bg-[#b42318]" /> : null}
                    </div>
                    <div className={`text-[10.5px] mt-1.5 truncate ${x.state === 'overdue' ? 'font-bold text-[#b42318]' : x.state === 'next' ? 'font-bold' : x.state === 'done' ? 'font-semibold text-[#1a7a52]' : 'text-[#5b615e]'}`}>{mon(x.t.dueDate, yearInLabel) || `V${x.n}`}</div>
                    <div className={`text-[9.5px] ${x.state === 'overdue' ? 'text-[#b42318]' : 'text-[#8a8f8c]'}`}>{x.state === 'overdue' ? `${x.done}/3` : x.state === 'next' ? 'next' : x.state === 'done' ? 'done' : x.state === 'closed' ? x.t.status : ' '}</div>
                  </button>
                ))}
              </div>
              <div className="flex gap-3.5 text-[10.5px] text-[#8a8f8c] mt-2.5 flex-wrap">
                <span><span className="inline-block w-2 h-2 rounded-full bg-[#1a7a52] align-middle mr-1" />Completed</span>
                <span><span className="inline-block w-2 h-2 rounded-full border-2 border-[#b42318] box-border align-middle mr-1" />Overdue (stages done)</span>
                <span><span className="inline-block w-2 h-2 rounded-full border-2 border-[#d9ddda] box-border align-middle mr-1" />Upcoming</span>
                {all.some(x => x.state === 'closed') && <span><span className="inline-block w-2 h-2 rounded-full bg-[#f1f3f1] border-2 border-[#d9ddda] box-border align-middle mr-1" />Missed / cancelled</span>}
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
                {canEdit && <button type="button" onClick={() => void remind()} disabled={remindBusy} className={btnSm}>{remindBusy ? 'Sending…' : 'Remind vendor'}</button>}
              </div>
            </>
          )}

          {/* needs action */}
          {overdue.length > 0 && (
            <>
              <div className="flex items-center justify-between mt-[22px] gap-2 flex-wrap">
                <div className="text-[12px] font-bold text-[#b42318]">Needs action · {overdue.length}</div>
                {canEdit && toAttend.length > 1 && <button type="button" onClick={() => setBulkAttend(b => !b)} className={btnSm}>Mark all {toAttend.length} attended…</button>}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                      {/* 1 attended & inspected */}
                      <div className="flex gap-2 items-start">
                        {x.stages[0]
                          ? <div className="w-[18px] h-[18px] rounded-full bg-[#1a7a52] text-white text-[10px] font-extrabold grid place-items-center shrink-0">✓</div>
                          : <div className="w-[18px] h-[18px] rounded-full border-2 border-[#1c1f1d] box-border text-[10px] font-extrabold grid place-items-center shrink-0">1</div>}
                        <div className="min-w-0">
                          <div className="text-[11.5px] font-bold">Attended &amp; inspected</div>
                          {x.stages[0]
                            ? <div className="text-[10.5px] text-[#5b615e]">{fmtS(t.attendedAt)} · {whoAttended(t)}</div>
                            : attendingId === t.id
                              ? <div className="mt-1"><AttendChooser busy={b} onPick={who => void attend(t, who)} onCancel={() => setAttendingId(null)} /></div>
                              : canEdit ? <button type="button" disabled={b} onClick={() => setAttendingId(t.id)} className={btnFillSm + ' mt-1'}>Mark attended</button> : <div className="text-[10.5px] text-[#5b615e]">Awaiting attendance</div>}
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
                              ? canEdit ? <label className={btnFillSm + ' mt-1 inline-block' + (b ? ' opacity-50' : '')}>{b ? 'Uploading…' : 'Upload note'}
                                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={b} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadNote(t, f); e.target.value = ''; }} />
                                </label> : <div className="text-[10.5px] text-[#5b615e]">Delivery note awaited</div>
                              : <div className="text-[10.5px] text-[#5b615e]">After attendance · completes the visit</div>}
                        </div>
                      </div>
                    </div>
                    <QuotationBlock key={`q-${t.id}-${t.quotationAt ?? ''}-${t.quotationStatus ?? ''}`} t={t} n={x.n} busy={b} onSave={(f, a, vm) => saveQuotation(t, x.n, f, a, vm)} onAttach={f => attachQuotationFile(t, x.n, f)} />
                    {t.notes && <p className="text-[11px] text-[#5b615e] italic mt-2">{t.notes}</p>}
                  </div>
                );
                return (
                  <div key={t.id} role="button" tabIndex={0} onClick={() => setExpandedId(t.id)} onKeyDown={e => { if (e.key === 'Enter') setExpandedId(t.id); }}
                    className="border border-[#f1c8c4] bg-[#fff8f7] rounded-[10px] px-4 py-2.5 mt-2 flex items-center gap-3 flex-wrap cursor-pointer hover:border-[#e3a9a3]">
                    <div className="text-[12.5px] font-bold flex-1 whitespace-nowrap">Visit {x.n} · due {fmtD(t.dueDate)}</div>
                    <StageBars stages={x.stages} tone="red" />
                    <div className="text-[11px] text-[#b42318] font-semibold whitespace-nowrap text-right">{x.overdueDays} days overdue</div>
                    <span className="text-[11px] text-[#b9bdba] whitespace-nowrap" title="Available after attendance">Report</span>
                    <span onClick={e => e.stopPropagation()}>{primaryAction(x)}</span>
                  </div>
                );
              })}
            </>
          )}

          {/* history */}
          <div className="flex items-center justify-between mt-[22px] gap-2 flex-wrap">
            <div className="text-[12px] font-bold">History · {history.length}</div>
            <div className="text-[11px] text-[#8a8f8c]">Attended &amp; inspected · delivery note filed</div>
          </div>
          {history.length === 0 ? (
            <div className="border border-dashed border-[#d9ddda] rounded-[10px] px-4 py-2.5 mt-2 flex items-center gap-3.5 text-[#8a8f8c] flex-wrap">
              <div className="text-[12px] flex-1">Completed visits list here with <b className="text-[#5b615e]">Attended &amp; inspected · Delivery note</b> dates</div>
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
                      <b className="text-[#1a7a52]">Attended &amp; inspected</b> {fmtS(t.attendedAt)} {whoAttended(t)}
                      {t.deliveryNote && <> · <b className="text-[#1a7a52]">Delivery note</b> filed</>}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#8a8f8c] mt-0.5">Marked done {t.completedAt ? fmtS(t.completedAt) : ''} — before inspection tracking; no attendance or delivery note on record.</div>
                  )}
                  {t.attendedAt && <QuotationBlock key={`q-${t.id}-${t.quotationAt ?? ''}-${t.quotationStatus ?? ''}`} t={t} n={x.n} busy={busy === t.id} onSave={(f, a, vm) => saveQuotation(t, x.n, f, a, vm)} onAttach={f => attachQuotationFile(t, x.n, f)} />}
                </div>
                {t.deliveryNote
                  ? <button type="button" onClick={() => openDocViewer({ fileUrl: t.deliveryNote!.fileUrl, caption: `Delivery note — Visit ${x.n}`, documentKey: 'delivery_note' })} className="text-[11px] font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer">Delivery note</button>
                  : <span className="text-[11px] font-semibold text-[#b9bdba]">Delivery note</span>}
              </div>
            );
          })}
        </div>
        ) : ( /* ── schedule (0279): every kind without visits works its bills and payments here ── */
        <div className={card + ' px-4 sm:px-[22px] pt-[18px] pb-5 min-w-0'}>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-[14px] font-bold">{km.schedule === 'bills' ? 'Bills' : km.schedule === 'none' ? 'Spend' : 'Payments'}</h2>
            <span className="text-[11px] text-[#8a8f8c]">{km.hint}</span>
          </div>
          {billYears.length > 0 && (
            <div className="flex items-center gap-1.5 mt-4 flex-wrap">
              {billYears.map(y => { const inYear = rows.filter(r => r.dueDate.slice(0, 4) === y); return (
                <button key={y} type="button" onClick={() => setBillYear(y)}
                  className="text-[11px] px-3 py-1.5 rounded-full font-semibold transition-colors cursor-pointer"
                  style={yearOn === y ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e', border: '1px solid #e6e8e6' }}>
                  {y} · {inYear.filter(r => r.status === 'paid').length} of {inYear.length} paid
                </button>
              ); })}
              <span className="text-[11px] text-[#8a8f8c] ml-auto">Paid in {yearOn}: <b className="text-[#1c1f1d]">{aed2(yearRows.filter(r => r.status === 'paid').reduce((n, r) => n + (r.amountAed ?? 0), 0))}</b></span>
            </div>
          )}
          {/* One year's months at a time for an ongoing contract (owner, 30 Sep) — never an endless strip. */}
          {yearRows.length > 0 && (
            <>
              <div className="relative grid gap-1 mt-4" style={{ gridTemplateColumns: `repeat(${Math.min(yearRows.length, 24)}, minmax(0, 1fr))` }}>
                {yearRows.slice(0, 24).map(r => { const st = stateOf(r); return (
                  <div key={r.seq} className="text-center min-w-0" title={`#${r.seq} · ${fmtS(r.dueDate)} · ${st}`}>
                    <div className="w-5 h-5 rounded-full mx-auto grid place-items-center text-[10px] font-extrabold" style={st === 'paid' ? { background: '#1a7a52', border: '2px solid #1a7a52', color: '#fff' } : st === 'overdue' ? { background: '#fff', border: '2px solid #b42318' } : st === 'awaiting' ? { background: '#fdf3e3', border: '2px solid #f5d9a8' } : { background: '#fff', border: '2px solid #d9ddda' }}>{st === 'paid' ? '✓' : st === 'awaiting' ? '?' : ''}</div>
                    <div className={`text-[10.5px] mt-1.5 truncate ${st === 'overdue' ? 'font-bold text-[#b42318]' : st === 'awaiting' ? 'font-bold text-[#c47a00]' : st === 'paid' ? 'font-semibold text-[#1a7a52]' : 'text-[#5b615e]'}`}>{mon(r.dueDate, true)}</div>
                  </div>
                ); })}
              </div>
              <div className="flex gap-3.5 text-[10.5px] text-[#8a8f8c] mt-2.5 flex-wrap">
                <span><span className="inline-block w-2 h-2 rounded-full bg-[#1a7a52] align-middle mr-1" />Paid</span>
                <span><span className="inline-block w-2 h-2 rounded-full border-2 border-[#b42318] box-border align-middle mr-1" />Overdue</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-[#fdf3e3] border-2 border-[#f5d9a8] box-border align-middle mr-1" />Bill awaited</span>
                <span><span className="inline-block w-2 h-2 rounded-full border-2 border-[#d9ddda] box-border align-middle mr-1" />Upcoming</span>
              </div>
            </>
          )}
          {derived && rows.length === 0 && km.schedule !== 'none' && <p className="text-[12px] text-[#8a8f8c] mt-4">No schedule yet — set it up in the Payments card.</p>}
          {km.schedule === 'none' && rows.length === 0 && !spendOpen && <p className="text-[12px] text-[#8a8f8c] mt-4">Nothing recorded yet. Each spend goes on here with its amount and receipt.</p>}
          {!derived && yearRows.length > 0 && paymentRows(yearRows)}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {!spendOpen && <button type="button" onClick={() => { setSpendOpen(true); setSpendDate(today); setSpendPaid(km.schedule === 'none'); }} className={btnGreenSm}>{km.schedule === 'none' ? '+ Record a spend' : '+ Add a bill'}</button>}
            {canEdit && !derived && km.schedule !== 'none' && <button type="button" onClick={openPlanEditor} className="text-[11px] font-semibold text-[#5b615e] hover:text-[#1c1f1d] cursor-pointer">Edit schedule</button>}
          </div>
          {spendOpen && (
            <div className="mt-2 p-2.5 rounded-lg border border-[#e6e8e6] bg-[#f6f7f6]">
              <div className="text-[11px] font-semibold text-[#5b615e] mb-1.5">{km.schedule === 'none' ? 'Record a spend' : 'Add a bill to the schedule'}</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" value={spendDate} onChange={e => setSpendDate(e.target.value)} className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52]" />
                <AmountWithVat size="sm" className="w-48" placeholder="Amount (AED)" amount={spendAmount} onAmount={setSpendAmount} mode={spendVat} onMode={setSpendVat} />
                <input value={spendRef} onChange={e => setSpendRef(e.target.value)} placeholder="Reference / what for" className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52] flex-1 min-w-[140px]" />
                <label className="text-[11px] text-[#5b615e] flex items-center gap-1"><input type="checkbox" checked={spendPaid} onChange={e => setSpendPaid(e.target.checked)} /> already paid</label>
                {spendPaid && <select value={spendMethod} onChange={e => setSpendMethod(e.target.value)} className="text-[12px] px-2.5 py-1.5 border border-[#e6e8e6] rounded-md bg-white focus:outline-none focus:border-[#1a7a52]" title="Paid by which method">
                  <option value="">{c.modeOfPayment ? `${cap(c.modeOfPayment)} (contract)` : 'Method…'}</option>
                  {PAY_METHODS.map(m => <option key={m} value={m}>{cap(m)}</option>)}
                </select>}
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                <label className={btnFillSm + (payBusy ? ' opacity-50' : '')}>{payBusy ? 'Saving…' : spendPaid ? 'Attach proof of payment & save' : 'Attach bill copy & save'}
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={payBusy} onChange={e => { const f = e.target.files?.[0]; if (f) void recordSpend(f); e.target.value = ''; }} />
                </label>
                <button type="button" disabled={payBusy} onClick={() => void recordSpend(null)} className={btnSm}>Save without receipt</button>
                <button type="button" onClick={() => setSpendOpen(false)} className="text-[11px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Cancel</button>
              </div>
            </div>
          )}
        </div>
        )}

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
              {canEdit && <button type="button" onClick={() => void remind()} disabled={remindBusy} className={btnSm + ' flex-1'}>{remindBusy ? '…' : 'Remind'}</button>}
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
                  {rows.length > 0 && <button type="button" disabled={planBusy} onClick={() => void savePlan(rows.map(r => ({ dueDate: r.dueDate, amountAed: r.amountAed == null ? '' : String(r.amountAed) })))} className={btnFillSm}>{planBusy ? 'Saving…' : `Set up ${rows.length} ${payWord}`}</button>}
                  <button type="button" disabled={!contractStart} onClick={() => { setPlanRows(rows.map(r => ({ dueDate: r.dueDate, amountAed: r.amountAed == null ? '' : String(r.amountAed) }))); setPlanDirty(false); setPlanOpen(true); }} className={btnSm}>Customise…</button>
                </div>
                {!contractStart && <p className="text-[10.5px] text-[#b45309] mt-1.5">Set the contract period with Edit first.</p>}
              </div>
            ) : (
              <>
                <div className="flex gap-[2px] mt-2.5">
                  {rows.map(r => { const st = stateOf(r); return <span key={r.seq} className="flex-1 h-1.5 rounded-[2px]" title={`#${r.seq} · ${fmtS(r.dueDate)} · ${st}`} style={{ background: st === 'paid' ? '#1a7a52' : st === 'overdue' ? '#b42318' : st === 'awaiting' ? '#f5d9a8' : '#eef0ee' }} />; })}
                </div>
                <div className="text-[10.5px] text-[#8a8f8c] mt-1.5">{aed(received)} paid{vatPaid ? ` (VAT ${aed2(vatPaid)})` : ''} · {aed(Math.max(0, totalDue - received))} remaining{vatTotal - vatPaid > 0 ? ` (VAT ${aed2(Math.round((vatTotal - vatPaid) * 100) / 100)})` : ''}{awaitingRows.length ? ` · ${awaitingRows.length} bill${awaitingRows.length === 1 ? '' : 's'} awaited` : ''}{c.modeOfPayment ? ` · ${cap(c.modeOfPayment)}` : ''}</div>
                {km.visits && paymentRows(shownRows)}
                {km.visits && <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                  {rows.length > 1 && (
                    <button type="button" onClick={() => setFullSchedule(f => !f)} className="text-[11px] font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer">
                      {fullSchedule ? 'Fewer rows' : `Full schedule · ${rows.length} ${payWord}${hiddenOverdue ? ` · ${hiddenOverdue} more overdue` : ''}`}
                    </button>
                  )}
                  {canEdit && <button type="button" onClick={openPlanEditor} className="text-[11px] font-semibold text-[#5b615e] hover:text-[#1c1f1d] cursor-pointer ml-auto">Edit schedule</button>}
                </div>}
              </>
            )}
            {/* quotations for fixes — only when at least one is attached to a visit (owner, 10 Sep) */}
            {quotes.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-[#eef0ee]">
                <div className="flex justify-between items-baseline">
                  <div className="text-[12px] font-bold">Quotations</div>
                  <div className="text-[11px] text-[#8a8f8c]">{openQuotes.length ? `${openQuotes.length} open · ${aed(openQuotes.reduce((n, x) => n + (x.t.quotationAmountAed ?? 0), 0))}` : 'all processed'}</div>
                </div>
                {quotes.map(x => {
                  const t = x.t; const st = t.quotationStatus ?? 'pending'; const m = QUOTE_STATUS[st] ?? QUOTE_STATUS.pending;
                  return (
                    <div key={t.id} className="py-2.5 border-b border-[#f1f3f1]">
                      <div className="flex justify-between items-center gap-2">
                        <button type="button" onClick={() => setExpandedId(t.id)} className="text-[12px] font-bold text-[#1c1f1d] hover:text-[#1a7a52] cursor-pointer whitespace-nowrap">Visit {x.n}<span className="font-medium text-[#8a8f8c]"> · {fmtS(t.dueDate)}</span></button>
                        <select value={st} disabled={busy === t.id} onChange={e => void setQuotationStatus(t, x.n, e.target.value)} title={m.hint}
                          className="text-[10.5px] font-bold px-2 py-[3px] pr-6 rounded-full border-0 cursor-pointer appearance-none bg-no-repeat disabled:opacity-50"
                          style={{ background: `${m.bg} url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='${encodeURIComponent(m.fg)}' stroke-width='1.5'/></svg>") no-repeat right 8px center`, color: m.fg }}>
                          {QUOTE_ORDER.map(k => <option key={k} value={k}>{QUOTE_STATUS[k].label}</option>)}
                        </select>
                      </div>
                      <div className="flex justify-between items-baseline gap-2 mt-1">
                        {editingQuoteId === t.id
                          ? <span className="flex items-center gap-1.5">
                              <span className="text-[11px] text-[#8a8f8c]">AED</span>
                              <input autoFocus value={quoteAmount} onChange={e => setQuoteAmount(e.target.value)} inputMode="decimal" disabled={busy === t.id}
                                onKeyDown={e => { if (e.key === 'Enter') void saveQuotationAmount(t, x.n); if (e.key === 'Escape') setEditingQuoteId(null); }}
                                className="text-[12px] font-semibold px-2 py-1 border border-[#1a7a52] rounded-md bg-white focus:outline-none w-28" />
                              <button type="button" disabled={busy === t.id} onClick={() => void saveQuotationAmount(t, x.n)} className={btnFillSm}>{busy === t.id ? '…' : 'Save'}</button>
                              <button type="button" onClick={() => setEditingQuoteId(null)} className="text-[10.5px] text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer">Cancel</button>
                            </span>
                          : <button type="button" title="Click to change the amount" onClick={() => { setEditingQuoteId(t.id); setQuoteAmount(typedFromStored(t.quotationAmountAed, t.quotationVatAed, t.quotationVatMode ?? 'none')); }}
                              className="text-[12px] font-semibold text-[#1c1f1d] hover:text-[#1a7a52] cursor-pointer border-b border-dashed border-[#c9cdca]">
                              {t.quotationAmountAed != null ? aed(t.quotationAmountAed) : <span className="text-[#c47a00] font-bold">Add amount</span>}
                            </button>}
                        {t.quotation
                          ? <button type="button" onClick={() => openDocViewer({ fileUrl: t.quotation!.fileUrl, caption: `Quotation — Visit ${x.n}`, documentKey: 'quotation' })} className="text-[10.5px] font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer whitespace-nowrap">View quotation</button>
                          : <label className={`text-[10.5px] font-bold px-2 py-[3px] rounded-[5px] border border-[#c47a00] text-[#c47a00] bg-white cursor-pointer whitespace-nowrap ${busy === t.id ? 'opacity-50' : ''}`}>{busy === t.id ? 'Uploading…' : 'Attach quotation'}
                              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy === t.id} onChange={e => { const f = e.target.files?.[0]; if (f) void attachQuotationFile(t, x.n, f); e.target.value = ''; }} />
                            </label>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* documents */}
          <div className={card + ' px-[18px] py-4'}>
            <div className="flex justify-between items-baseline">
              <div className="text-[13px] font-bold">Documents</div>
              {canEdit && <label className={`text-[11px] font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer ${docBusy ? 'opacity-50' : ''}`}>{docBusy ? 'Uploading…' : '+ Attach'}
                <input type="file" accept="image/*,application/pdf" className="hidden" disabled={docBusy} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadContractDoc(f); e.target.value = ''; }} />
              </label>}
            </div>
            <div className="mt-1.5">
              {contractDocs.length === 0 && <div className="flex justify-between items-center py-[9px] border-b border-[#f1f3f1] text-[11.5px] text-[#8a8f8c]"><span>Contract attachment</span><span className="text-[10.5px]">none filed</span></div>}
              {contractDocs.map(d => (
                <div key={d.id} className="flex justify-between items-center py-[9px] border-b border-[#f1f3f1] text-[11.5px] gap-2">
                  <span className="min-w-0 truncate">{d.displayName ?? cap(d.documentKey)}</span>
                  <button type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? d.documentKey, documentKey: d.documentKey })} className="font-semibold text-[#1a7a52] hover:text-[#125a3c] cursor-pointer shrink-0">View</button>
                </div>
              ))}
              {km.visits && <>
                <div className="flex justify-between items-center py-[9px] border-b border-[#f1f3f1] text-[11.5px] text-[#8a8f8c]"><span>Delivery notes · {notesFiled} of {n}</span><span className="text-[10.5px]">on visits</span></div>
                <div className="flex justify-between items-center py-[9px] text-[11.5px] text-[#8a8f8c]"><span>Attended &amp; inspected · {attendedCount} of {n}</span><span className="text-[10.5px]">on visits</span></div>
              </>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
