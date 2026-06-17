/**
 * RP — Edit Tenancy Contract.
 *
 * Mirrors the new-contract wizard's layout (rental-provider/dashboard/contracts/new)
 * but operates on an EXISTING contract: prefills every term, keeps the unit &
 * customer fixed (read-only), and lets the RP edit the FULL financial terms
 * (rent, deposit, admin/Ejari fee, payment method, installments) + dates,
 * clauses and notes. Saves via PATCH /contracts/:id (audited, no re-sign). The
 * cheque schedule is a live preview only — editing does not regenerate the
 * stored payment rows, so recorded cheques are preserved.
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Building2, User, Plus, X, Info } from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cheque', label: 'Post-Dated Cheques' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online Payment' },
];

function fmtAed(aed: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(aed);
}
function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function chequeDate(startDate: string, installments: number, i: number): string {
  if (!startDate || !installments) return '';
  const monthsPerCheque = 12 / installments;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Math.round(i * monthsPerCheque));
  return d.toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric' });
}
function calcDurationLabel(start: string, end: string): string {
  if (!start || !end) return '—';
  const s = new Date(start), e = new Date(end);
  if (e <= s) return 'Invalid range';
  const totalDays = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const months = Math.round(totalDays / 30.44);
  if (months >= 24) return `${(months / 12).toFixed(1).replace('.0', '')} years`;
  if (months >= 12) return `${months} months (1 year)`;
  if (months > 1) return `${months} months`;
  return `${totalDays} days`;
}

interface ContractDetail {
  ref?: string;
  status?: string | null;
  startDate: string | null;
  endDate: string | null;
  annualRent: number | null;
  listedRent: number | null;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  discountAmount: number | null;
  securityDepositAmount: number | null;
  adminFeeFils: number | null;
  ejariFeeFils: number | null;
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  customClauses?: string[] | null;
  notes?: string | null;
  tenant?: { name?: string | null } | null;
  unit?: { number?: string | null; name?: string | null } | null;
  property?: { buildingName?: string | null } | null;
}

const toDateInput = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
const numStr = (v: number | null | undefined) => (v == null ? '' : String(v));

const cardCls = 'bg-white rounded-2xl p-5 shadow-sm space-y-4';
const labelCls = 'block text-xs font-medium text-[#6b6860] mb-1.5';
const inputCls = 'w-full rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]';

export default function EditContractPage() {
  const router = useRouter();
  const params = useParams();
  const id = Number(Array.isArray(params.id) ? params.id[0] : params.id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ ref?: string; status?: string | null; tenant?: string | null; unit?: string | null; building?: string | null }>({});

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [listedRent, setListedRent] = useState('');
  const [discountType, setDiscountType] = useState<'none' | 'percent' | 'fixed'>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [securityDeposit, setSecurityDeposit] = useState('');
  const [adminFee, setAdminFee] = useState('');
  const [ejariFee, setEjariFee] = useState('');
  const [installments, setInstallments] = useState('1');
  const [modeOfPayment, setModeOfPayment] = useState('cheque');
  const [clauses, setClauses] = useState<string[]>([]);
  const [clauseInput, setClauseInput] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiGet<ContractDetail>(`/contracts/${id}`)
      .then((c) => {
        if (cancelled) return;
        setStartDate(toDateInput(c.startDate));
        setEndDate(toDateInput(c.endDate));
        setListedRent(numStr(c.listedRent ?? c.annualRent));
        setDiscountType(c.discountType ?? 'none');
        setDiscountValue(c.discountValue != null ? String(c.discountValue) : '');
        setSecurityDeposit(numStr(c.securityDepositAmount));
        setAdminFee(numStr(c.adminFeeFils));
        setEjariFee(numStr(c.ejariFeeFils));
        setInstallments(c.numberOfInstallments ? String(c.numberOfInstallments) : '1');
        setModeOfPayment(c.modeOfPayment || 'cheque');
        setClauses(Array.isArray(c.customClauses) ? c.customClauses : []);
        setNotes(c.notes ?? '');
        setMeta({
          ref: c.ref ?? `CID-${id}`,
          status: c.status ?? null,
          tenant: c.tenant?.name ?? null,
          unit: c.unit?.number ? `Unit ${c.unit.number}${c.unit.name ? ` · ${c.unit.name}` : ''}` : (c.unit?.name ?? null),
          building: c.property?.buildingName ?? null,
        });
      })
      .catch(() => { if (!cancelled) setError('Could not load this contract.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const applyStartDate = (v: string) => {
    setStartDate(v);
    // Re-anchor a 12-month term off the new start unless an end is already set far off.
    if (!endDate) setEndDate(addMonths(v, 12));
  };
  const applyPreset = (months: number) => { if (startDate) setEndDate(addMonths(startDate, months)); };

  const addClause = () => {
    const v = clauseInput.trim();
    if (!v) return;
    setClauses((c) => [...c, v]);
    setClauseInput('');
  };

  // listedRent − discount = rentNum (the NET rent = contract value). The cheque
  // split and contract value both key off the net, never the listed price.
  const listedNum = Number(listedRent) || 0;
  const discRaw = Number(discountValue) || 0;
  const discountAmt = discountType === 'percent' ? Math.round(listedNum * discRaw) / 100
                    : discountType === 'fixed'   ? Math.min(discRaw, listedNum)
                    : 0;
  const rentNum = Math.max(0, listedNum - discountAmt);
  const inst = Number(installments) || 1;
  const chequeAmount = inst > 0 ? rentNum / inst : 0;
  const durationLabel = calcDurationLabel(startDate, endDate);

  const save = async () => {
    setError(null);
    if (!startDate || !endDate) { setError('Start and end dates are required.'); return; }
    if (new Date(startDate) >= new Date(endDate)) { setError('End date must be after the start date.'); return; }
    if (listedNum <= 0) { setError('Listed rent must be greater than zero.'); return; }
    if (rentNum <= 0) { setError('The discount cannot be equal to or greater than the rent.'); return; }
    setSaving(true);
    try {
      const opt = (v: string) => (v.trim() === '' ? undefined : Number(v));
      await apiPatch(`/contracts/${id}`, {
        contractStartDate: startDate,
        contractEndDate: endDate,
        // Send listed rent + discount; the backend recomputes net annual rent =
        // contract value = listed − discount. discountType:null clears a discount.
        listedRent: listedNum,
        discountType: discountType === 'none' ? null : discountType,
        discountValue: discountType === 'none' ? 0 : discRaw,
        securityDepositAmount: opt(securityDeposit),
        adminFee: opt(adminFee),
        ejariFee: opt(ejariFee),
        numberOfInstallments: Number(installments),
        modeOfPayment,
        customClauses: clauses,
        notes: notes.trim(),
      });
      router.push(`/rental-provider/dashboard/contracts/${id}/v2`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the contract.');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f6f2] p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()}
            className="w-9 h-9 rounded-xl bg-white shadow-sm border border-[#e8e6e0] flex items-center justify-center hover:bg-[#f4f3ef]">
            <ArrowLeft size={16} className="text-[#1a1916]" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-[#1a1916]">Edit Tenancy Contract</h1>
            <p className="text-xs text-[#6b6860] mt-0.5">
              {meta.ref ?? `CID-${id}`}{meta.status ? ` · ${meta.status}` : ''} — editing terms is recorded in the audit log and does not require re-signing.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl p-10 shadow-sm text-center text-sm text-[#9b9890]">Loading contract…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
            {/* Left: form */}
            <div className="space-y-4">
              {/* Property & Unit (read-only) */}
              <div className={cardCls}>
                <h2 className="font-semibold text-sm text-[#1a1916]">Property &amp; Unit</h2>
                <div className="flex items-center gap-3 rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-3">
                  <div className="w-9 h-9 rounded-lg bg-[#d8f2e8] flex items-center justify-center text-[#2e9f82] shrink-0">
                    <Building2 size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1a1916] truncate">{meta.unit ?? '—'}</p>
                    <p className="text-xs text-[#6b6860] truncate">{meta.building ?? '—'}</p>
                  </div>
                  <span className="ml-auto text-[10px] font-medium text-[#9b9890] uppercase tracking-wide">Fixed</span>
                </div>
              </div>

              {/* Customer (read-only) */}
              <div className={cardCls}>
                <h2 className="font-semibold text-sm text-[#1a1916]">Customer</h2>
                <div className="flex items-center gap-3 rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-[#d8f2e8] flex items-center justify-center text-[#2e9f82] shrink-0">
                    <User size={18} />
                  </div>
                  <p className="text-sm font-semibold text-[#1a1916] truncate">{meta.tenant ?? '—'}</p>
                  <span className="ml-auto text-[10px] font-medium text-[#9b9890] uppercase tracking-wide">Fixed</span>
                </div>
              </div>

              {/* Rental Period */}
              <div className={cardCls}>
                <h2 className="font-semibold text-sm text-[#1a1916]">Rental Period</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Start Date *</label>
                    <input type="date" value={startDate} onChange={(e) => applyStartDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>End Date *</label>
                    <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-[#9b9890] mb-2">Quick duration (from start date)</p>
                  <div className="flex gap-2">
                    {[{ label: '6 Months', months: 6 }, { label: '12 Months', months: 12 }, { label: '24 Months', months: 24 }].map((p) => (
                      <button key={p.months} type="button" disabled={!startDate} onClick={() => applyPreset(p.months)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#e8e6e0] bg-[#f7f6f2] text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82] hover:bg-[#f0faf6] disabled:opacity-40 disabled:cursor-not-allowed">
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                {startDate && endDate && (
                  <div className="flex items-center gap-2 bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-2.5">
                    <span className="text-xs font-medium text-[#6b6860]">Duration:</span>
                    <span className="text-sm font-bold text-[#2e9f82]">{durationLabel}</span>
                  </div>
                )}
              </div>

              {/* Financial Terms (editable) */}
              <div className={cardCls}>
                <h2 className="font-semibold text-sm text-[#1a1916]">Financial Terms</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Listed Rent (AED) *</label>
                    <input type="number" min={0} value={listedRent} onChange={(e) => setListedRent(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Security Deposit (AED)</label>
                    <input type="number" min={0} value={securityDeposit} onChange={(e) => setSecurityDeposit(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Admin Fee (AED)</label>
                    <input type="number" min={0} value={adminFee} onChange={(e) => setAdminFee(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Ejari Fee (AED)</label>
                    <input type="number" min={0} value={ejariFee} onChange={(e) => setEjariFee(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Payment Method</label>
                    <div className="relative">
                      <select value={modeOfPayment} onChange={(e) => setModeOfPayment(e.target.value)} className={`${inputCls} appearance-none pr-9`}>
                        {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6860]" />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Payments / Year</label>
                    <div className="relative">
                      <select value={installments} onChange={(e) => setInstallments(e.target.value)} className={`${inputCls} appearance-none pr-9`}>
                        <option value="1">1 — Annual</option>
                        <option value="2">2 — Semi-annual</option>
                        <option value="3">3 — Quarterly (3)</option>
                        <option value="4">4 — Quarterly</option>
                        <option value="6">6 — Bi-monthly</option>
                        <option value="12">12 — Monthly</option>
                      </select>
                      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6860]" />
                    </div>
                  </div>
                </div>

                {/* Discount (rent line only) → live Listed → Discount → Net breakdown */}
                <div className="rounded-xl border border-[#e8e6e0] bg-[#fbfaf7] px-4 py-3">
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <label className="text-xs font-medium text-[#6b6860]">Discount (optional)</label>
                    <div className="flex gap-1.5">
                      {(['none', 'percent', 'fixed'] as const).map((t) => (
                        <button key={t} type="button"
                          onClick={() => { setDiscountType(t); if (t === 'none') setDiscountValue(''); }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                            discountType === t
                              ? 'border-[#2e9f82] bg-[#f0faf6] text-[#2e9f82]'
                              : 'border-[#e8e6e0] bg-white text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82]'
                          }`}>
                          {t === 'none' ? 'None' : t === 'percent' ? '% Off' : 'Fixed AED'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {discountType !== 'none' && (
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} step={discountType === 'percent' ? 0.1 : 1}
                        value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
                        placeholder={discountType === 'percent' ? 'e.g. 5' : 'e.g. 2000'}
                        className={inputCls} />
                      <span className="text-xs font-semibold text-[#6b6860]">{discountType === 'percent' ? '%' : 'AED'}</span>
                    </div>
                  )}
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#6b6860]">Listed rent</span>
                      <span className={discountAmt > 0 ? 'text-[#9b9890] line-through' : 'text-[#1a1916] font-semibold'}>{listedNum > 0 ? fmtAed(listedNum) : '—'}</span>
                    </div>
                    {discountAmt > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[#6b6860]">Discount</span>
                        <span className="text-[#b91c1c] font-medium">− {fmtAed(discountAmt)} ({listedNum > 0 ? ((discountAmt / listedNum) * 100).toFixed(1) : '0'}%)</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold pt-1 border-t border-[#e8e6e0]">
                      <span className="text-[#1a1916]">Annual rent / Contract value</span>
                      <span className="text-[#2e9f82]">{rentNum > 0 ? fmtAed(rentNum) : '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Cheque schedule preview (even split — preview only) */}
                {rentNum > 0 && (
                  <div className="rounded-xl border border-[#e8e6e0] overflow-hidden">
                    <div className="grid grid-cols-4 bg-[#f4f3ef] px-4 py-2 border-b border-[#e8e6e0]">
                      {['#', 'Cheque', 'Due Date', 'Amount'].map((h, i) => (
                        <span key={h} className={`text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] ${i === 3 ? 'text-right' : ''}`}>{h}</span>
                      ))}
                    </div>
                    {Array.from({ length: inst }, (_, i) => (
                      <div key={i} className={`grid grid-cols-4 px-4 py-2.5 items-center ${i < inst - 1 ? 'border-b border-[#f0ede8]' : ''} ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafaf8]'}`}>
                        <span className="text-xs text-[#9b9890]">{i + 1}</span>
                        <span className="text-xs text-[#6b6860]">Cheque {i + 1}</span>
                        <span className="text-xs text-[#6b6860]">{startDate ? chequeDate(startDate, inst, i) : '—'}</span>
                        <span className="text-sm font-bold text-[#2e9f82] text-right">{fmtAed(chequeAmount)}</span>
                      </div>
                    ))}
                    <div className="grid grid-cols-4 px-4 py-2.5 bg-[#f0faf6] border-t-2 border-[#c5e8df]">
                      <span className="col-span-3 text-xs font-semibold text-[#1a1916]">Total ({inst} cheque{inst === 1 ? '' : 's'})</span>
                      <span className="text-sm font-bold text-[#1a1916] text-right">{fmtAed(rentNum)}</span>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-2 rounded-lg bg-[#f4f7f5] px-3 py-2.5 text-xs text-[#6b6860]">
                  <Info className="h-4 w-4 shrink-0 text-[#2e9f82]" />
                  Saving regenerates the cheque schedule to match these terms — as long as no cheque has been recorded yet (cleared/bounced). If any payment is already recorded, the existing cheques are kept and you can adjust them on the contract page.
                </div>
              </div>

              {/* Clauses & Notes */}
              <div className={cardCls}>
                <h2 className="font-semibold text-sm text-[#1a1916]">Clauses &amp; Notes</h2>
                <div>
                  <label className={labelCls}>Custom clauses</label>
                  <div className="flex gap-2">
                    <input value={clauseInput} onChange={(e) => setClauseInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addClause(); } }}
                      placeholder="Add a clause and press Enter" className={inputCls} />
                    <button type="button" onClick={addClause}
                      className="shrink-0 inline-flex items-center gap-1 px-3 rounded-xl bg-[#e6f7f1] text-[#2e9f82] text-sm font-semibold">
                      <Plus size={14} /> Add
                    </button>
                  </div>
                  {clauses.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {clauses.map((cl, i) => (
                        <li key={i} className="flex items-start gap-2 rounded-lg bg-[#f7f6f2] border border-[#e8e6e0] px-3 py-2 text-sm text-[#1a1916]">
                          <span className="flex-1">{cl}</span>
                          <button type="button" onClick={() => setClauses((c) => c.filter((_, j) => j !== i))} className="text-[#9b9890] hover:text-[#b91c1c]">
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Notes</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl bg-[#fee2e2] px-4 py-2.5 text-sm text-[#b91c1c]">
                  <Info className="h-4 w-4 shrink-0" /> {error}
                </div>
              )}
            </div>

            {/* Right: summary + save */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3 lg:sticky lg:top-6">
              <h2 className="font-semibold text-sm text-[#1a1916]">Summary</h2>
              {([
                ...(discountAmt > 0
                  ? ([['Listed rent', fmtAed(listedNum)], ['Discount', `− ${fmtAed(discountAmt)}`]] as [string, string][])
                  : []),
                [discountAmt > 0 ? 'Annual rent (net)' : 'Annual rent', rentNum > 0 ? fmtAed(rentNum) : '—'],
                ['Security deposit', securityDeposit ? fmtAed(Number(securityDeposit)) : '—'],
                ['Admin fee', adminFee ? fmtAed(Number(adminFee)) : '—'],
                ['Ejari fee', ejariFee ? fmtAed(Number(ejariFee)) : '—'],
                ['Payments / year', String(inst)],
                ['Per cheque', rentNum > 0 ? fmtAed(chequeAmount) : '—'],
                ['Duration', durationLabel],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-[#6b6860]">{k}</span>
                  <span className="font-semibold text-[#1a1916]">{v}</span>
                </div>
              ))}
              <button type="button" onClick={save} disabled={saving}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold py-2.5 hover:bg-[#267a65] disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <Link href={`/rental-provider/dashboard/contracts/${id}/v2`}
                className="block text-center text-xs text-[#6b6860] hover:underline">
                Cancel
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
