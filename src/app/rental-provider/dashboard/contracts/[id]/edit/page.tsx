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
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Building2, User, Plus, X, Info, Search, PlusCircle, Check, Lock } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';

interface Tenant {
  id: number;
  user: { name: string; email: string };
}

/** Inline "create a new customer" form — mirrors the new-contract wizard.
 *  `createTenantUrl` is context-aware: RP posts to /contracts/tenants, a manager
 *  posts to /manager/tenants?rp=<landlord> so the customer lands under the
 *  managed landlord (not the manager). */
function NewCustomerForm({ createTenantUrl, onCreated, onCancel }: {
  createTenantUrl: string; onCreated: (t: { id: number; name: string }) => void; onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [entityType, setEntityType] = useState<'individual' | 'company'>('individual');
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const field = 'w-full rounded-xl border border-[#e8e6e0] bg-white px-3 py-2 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]';
  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    if (!email.trim()) { setErr('Email is required'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(createTenantUrl, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(), phone: phone.trim() || undefined,
          entityType, companyName: entityType === 'company' ? (companyName.trim() || undefined) : undefined,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? 'Could not create customer'); }
      const d = await res.json();
      onCreated({ id: d.tenantId, name: d.name ?? name.trim() });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to create customer'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-3 rounded-xl border border-[#e8e6e0] bg-[#fafaf8] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[#1a1916]">New customer</p>
        <button type="button" onClick={onCancel} className="text-xs text-[#9b9890] hover:text-[#1a1916]">Cancel</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className={field} />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" className={field} />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" className={field} />
        <select value={entityType} onChange={e => setEntityType(e.target.value as 'individual' | 'company')} className={field}>
          <option value="individual">Individual</option>
          <option value="company">Company</option>
        </select>
        {entityType === 'company' && (
          <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Company name" className={`${field} col-span-2`} />
        )}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button type="button" onClick={submit} disabled={busy}
        className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-[#2e9f82] text-white disabled:opacity-60">
        {busy ? 'Creating…' : 'Create customer'}
      </button>
    </div>
  );
}

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
  return d.toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
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
  /** Actual fee payment rows — the source of truth the Fees section displays. */
  fees?: { paymentType: string | null; amount: number }[];
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  customClauses?: string[] | null;
  notes?: string | null;
  tenant?: { id?: number | null; name?: string | null } | null;
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

  // Context-aware scoping — this page is reused by the manager route
  // (/dashboard/manager/contracts/[id]/edit) via re-export. The contract load +
  // PATCH save are already manager-capable on the backend (resolveContractActor
  // accepts an authorised manager, no ?rp needed). Only the customer picker
  // (tenant list / search / create) + RP-profile read are RP-only, so for a
  // manager they must go through the /manager/tenants/*?rp=<landlord> proxy.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isManager = (pathname ?? '').startsWith('/dashboard/manager');
  const rpParam = searchParams.get('rp') ?? '';
  const contractsBase = isManager ? '/dashboard/manager/contracts' : '/rental-provider/dashboard/contracts';
  const tenantsListPath = isManager ? `/manager/tenants/list?rp=${rpParam}` : '/contracts/tenants/list';
  const tenantSearchPath = (q: string) => isManager
    ? `/manager/tenants/search?rp=${rpParam}&q=${encodeURIComponent(q)}`
    : `/contracts/tenants/search?q=${encodeURIComponent(q)}`;
  // POST goes through the raw /api proxy (NewCustomerForm uses fetch).
  const createTenantUrl = isManager ? `/api/manager/tenants?rp=${rpParam}` : '/api/contracts/tenants';

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
  // Rent VAT rate on this contract (commercial/industrial = 5%; residential exempt).
  // Read-only here — the backend recomputes it from the RP's fee rules on save.
  const [rentVatRate, setRentVatRate] = useState(0);
  // Installment plans this RP offers (Settings → Rules). Empty = all allowed.
  const [allowedInstallments, setAllowedInstallments] = useState<number[]>([]);
  const [modeOfPayment, setModeOfPayment] = useState('cheque');
  const [clauses, setClauses] = useState<string[]>([]);
  const [clauseInput, setClauseInput] = useState('');
  const [notes, setNotes] = useState('');
  // Agreement Addendum — attach the unit's layout addendum onto this (possibly
  // already-issued) contract; the draft-only file upload can't reach issued leases.
  const [addendums, setAddendums] = useState<{ id: number; name: string | null }[]>([]);
  const [addendumBusy, setAddendumBusy] = useState(false);
  const [addendumErr, setAddendumErr] = useState<string | null>(null);
  const [addendumRefresh, setAddendumRefresh] = useState(0);

  // Customer (tenant) — editable only before the contract is signed.
  const [tenantId, setTenantId] = useState('');
  const [originalTenantId, setOriginalTenantId] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [customerEditable, setCustomerEditable] = useState(false);
  // Signed lock — once any party has really signed (method 'online' / 'paper'),
  // the whole contract is read-only. Imported / paper leases recorded only as
  // "signed on file" stay editable. Mirrors the backend PATCH /contracts/:id guard.
  const [signedLocked, setSignedLocked] = useState(false);
  const [changingCustomer, setChangingCustomer] = useState(false);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantResults, setTenantResults] = useState<Tenant[]>([]);
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [activeTenants, setActiveTenants] = useState<Tenant[]>([]);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // Signature-derived gates (mirror the backend rules):
    //  • Customer can be reassigned only before ANY signature exists.
    //  • Terms are fully locked once a party has really signed (non-on_file);
    //    imported "signed on file" leases stay editable for data correction.
    apiGet<{ role: string; method?: string }[]>(`/contracts/${id}/signatures`)
      .then((sigs) => {
        if (cancelled) return;
        const rows = Array.isArray(sigs) ? sigs : [];
        setCustomerEditable(rows.length === 0);
        setSignedLocked(rows.some((s) => s.method != null && s.method !== 'on_file'));
      })
      .catch(() => { if (!cancelled) { setCustomerEditable(false); setSignedLocked(false); } });
    apiGet<Tenant[]>(tenantsListPath)
      .then((rows) => { if (!cancelled) setActiveTenants(Array.isArray(rows) ? rows : []); })
      .catch(() => undefined);
    // Allowed installment plans come from the RP profile — managers have no RP
    // profile, so they just fall back to the full set (a non-blocking nicety).
    if (!isManager) {
      apiGet<{ profile?: { allowedInstallments?: number[] | null } }>(`/profiles/rental-provider/me`)
        .then((d) => { if (!cancelled && Array.isArray(d?.profile?.allowedInstallments)) setAllowedInstallments(d!.profile!.allowedInstallments!); })
        .catch(() => undefined);
    }
    apiGet<ContractDetail>(`/contracts/${id}`)
      .then((c) => {
        if (cancelled) return;
        setTenantId(c.tenant?.id != null ? String(c.tenant.id) : '');
        setOriginalTenantId(c.tenant?.id != null ? String(c.tenant.id) : '');
        setTenantName(c.tenant?.name ?? '');
        setStartDate(toDateInput(c.startDate));
        setEndDate(toDateInput(c.endDate));
        setListedRent(numStr(c.listedRent ?? c.annualRent));
        setRentVatRate(Number((c as { rentVatRate?: number | null }).rentVatRate) || 0);
        setDiscountType(c.discountType ?? 'none');
        setDiscountValue(c.discountValue != null ? String(c.discountValue) : '');
        setSecurityDeposit(numStr(c.securityDepositAmount));
        // Prefill from the actual fee rows (what the Fees section shows) so the
        // form round-trips; fall back to the legacy column only when no row exists.
        const adminRow = (c.fees ?? []).find((f) => f.paymentType === 'admin_fee');
        const ejariRow = (c.fees ?? []).find((f) => f.paymentType === 'ejari_fee');
        setAdminFee(adminRow ? numStr(adminRow.amount) : numStr(c.adminFeeFils));
        setEjariFee(ejariRow ? numStr(ejariRow.amount) : numStr(c.ejariFeeFils));
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

  // Load any addendum currently attached to this contract.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiGet<{ id: number; name: string | null }[]>(`/contracts/${id}/addendums`)
      .then((a) => { if (!cancelled) setAddendums(Array.isArray(a) ? a : []); })
      .catch(() => { if (!cancelled) setAddendums([]); });
    return () => { cancelled = true; };
  }, [id, addendumRefresh]);

  const attachAddendum = async () => {
    setAddendumBusy(true); setAddendumErr(null);
    try {
      await apiPost(`/contracts/${id}/addendums/from-layout`);
      setAddendumRefresh((n) => n + 1);
    } catch (e) {
      setAddendumErr(e instanceof Error ? e.message : 'Failed to attach addendum');
    } finally { setAddendumBusy(false); }
  };

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

  // Customer search (debounced) + select, mirroring the new-contract wizard.
  const handleTenantInput = (val: string) => {
    setTenantSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!val.trim()) { setTenantResults([]); setTenantDropdownOpen(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const rows = await apiGet<Tenant[]>(tenantSearchPath(val));
        setTenantResults(Array.isArray(rows) ? rows : []);
        setTenantDropdownOpen(true);
      } catch { setTenantResults([]); }
    }, 300);
  };
  const selectTenant = (t: Tenant) => {
    setTenantId(String(t.id));
    setTenantName(t.user.name);
    setTenantSearch('');
    setTenantResults([]);
    setTenantDropdownOpen(false);
    setShowNewCustomer(false);
    setChangingCustomer(false);
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
  // Rent VAT (commercial/industrial) is collected as SEPARATE VAT cheque(s), so the
  // rent cheques stay NET. Shown here so the edit form reflects the tax.
  const rentVat = rentVatRate > 0 ? Math.round(rentNum * rentVatRate) / 100 : 0;
  const chequeVat = inst > 0 ? Math.round((rentVat / inst) * 100) / 100 : 0;
  const durationLabel = calcDurationLabel(startDate, endDate);

  const save = async () => {
    setError(null);
    if (signedLocked) { setError('This contract has been signed and can no longer be edited.'); return; }
    if (!startDate || !endDate) { setError('Start and end dates are required.'); return; }
    if (new Date(startDate) >= new Date(endDate)) { setError('End date must be after the start date.'); return; }
    if (listedNum <= 0) { setError('Listed rent must be greater than zero.'); return; }
    if (rentNum <= 0) { setError('The discount cannot be equal to or greater than the rent.'); return; }
    setSaving(true);
    try {
      const opt = (v: string) => (v.trim() === '' ? undefined : Number(v));
      await apiPatch(`/contracts/${id}`, {
        // Reassign the customer only when it's editable (unsigned) and set.
        tenantId: customerEditable && tenantId ? Number(tenantId) : undefined,
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
      router.push(`${contractsBase}/${id}/v2`);
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
              {meta.ref ?? `CID-${id}`}{meta.status ? ` · ${meta.status}` : ''}
              {signedLocked
                ? ' — signed, so its terms are locked.'
                : ' — editing terms is recorded in the audit log and does not require re-signing.'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl p-10 shadow-sm text-center text-sm text-[#9b9890]">Loading contract…</div>
        ) : signedLocked ? (
          // Signed → read-only. The Edit affordance is hidden across the app, but
          // a deep link still lands here, so show a clear locked notice instead of
          // a form that the backend would reject on save.
          <div className="bg-white rounded-2xl p-8 shadow-sm max-w-xl mx-auto text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#f4f3ef] flex items-center justify-center mx-auto mb-4 text-[#6b6860]">
              <Lock size={20} />
            </div>
            <h2 className="text-base font-bold text-[#1a1916]">Contract is signed</h2>
            <p className="text-sm text-[#6b6860] mt-2">
              {meta.ref ?? `CID-${id}`} has been signed, so its terms are locked and can no longer be edited.
              Editing after signing would no longer match the executed agreement.
            </p>
            <Link href={`${contractsBase}/${id}/v2`}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-4 py-2.5 hover:bg-[#267a65]">
              <ArrowLeft size={14} /> Back to contract
            </Link>
          </div>
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

              {/* Customer — editable only before the contract is signed */}
              <div className={cardCls}>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-sm text-[#1a1916]">Customer</h2>
                  {customerEditable && !changingCustomer && (
                    <button type="button" onClick={() => setChangingCustomer(true)}
                      className="text-xs text-[#2e9f82] font-medium hover:underline">Change</button>
                  )}
                </div>

                {!customerEditable ? (
                  <>
                    <div className="flex items-center gap-3 rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-3">
                      <div className="w-9 h-9 rounded-full bg-[#d8f2e8] flex items-center justify-center text-[#2e9f82] shrink-0">
                        <User size={18} />
                      </div>
                      <p className="text-sm font-semibold text-[#1a1916] truncate">{tenantName || meta.tenant || '—'}</p>
                      <span className="ml-auto text-[10px] font-medium text-[#9b9890] uppercase tracking-wide">Fixed</span>
                    </div>
                    <p className="text-[11px] text-[#9b9890] mt-1.5">The customer can only be changed before the contract is signed.</p>
                  </>
                ) : !changingCustomer ? (
                  // Neutral until the customer is actually changed; green confirms a switch.
                  tenantId !== originalTenantId ? (
                    <div className="flex items-center gap-3 rounded-xl border border-[#c5e8df] bg-[#f0faf6] px-4 py-3">
                      <div className="w-9 h-9 rounded-full bg-[#2e9f82] flex items-center justify-center text-white shrink-0">
                        <Check size={18} />
                      </div>
                      <p className="text-sm font-semibold text-[#1a1916] truncate">{tenantName || meta.tenant || '—'}</p>
                      <span className="ml-auto text-[10px] font-medium text-[#2e9f82] uppercase tracking-wide">Changed</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-3">
                      <div className="w-9 h-9 rounded-full bg-[#d8f2e8] flex items-center justify-center text-[#2e9f82] shrink-0">
                        <User size={18} />
                      </div>
                      <p className="text-sm font-semibold text-[#1a1916] truncate">{tenantName || meta.tenant || '—'}</p>
                    </div>
                  )
                ) : (
                  <>
                    <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Search by name or email</label>
                    <div className="relative">
                      <div className="relative flex items-center">
                        <Search size={14} className="absolute left-3 text-[#9b9890]" />
                        <input type="text" placeholder="Type name or email…" value={tenantSearch}
                          onChange={e => handleTenantInput(e.target.value)}
                          onFocus={() => { if (tenantResults.length > 0) setTenantDropdownOpen(true); }}
                          className="w-full rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] pl-9 pr-9 py-2.5 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]"
                          autoComplete="off" />
                        {tenantSearch && (
                          <button type="button" onClick={() => { setTenantSearch(''); setTenantResults([]); setTenantDropdownOpen(false); }}
                            className="absolute right-3 text-[#9b9890] hover:text-[#1a1916]"><X size={14} /></button>
                        )}
                      </div>
                      {tenantDropdownOpen && tenantResults.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-[#e8e6e0] rounded-xl shadow-lg overflow-hidden">
                          {tenantResults.map(t => (
                            <button key={t.id} type="button" onClick={() => selectTenant(t)}
                              className="w-full text-left px-4 py-2.5 hover:bg-[#f4f3ef] transition-colors">
                              <span className="block text-sm font-medium text-[#1a1916]">{t.user.name}</span>
                              <span className="block text-xs text-[#6b6860]">{t.user.email}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <p className="mt-2 text-xs text-[#2e9f82] font-medium">✓ {tenantName || '—'}</p>

                    {showNewCustomer ? (
                      <NewCustomerForm createTenantUrl={createTenantUrl} onCancel={() => setShowNewCustomer(false)}
                        onCreated={(t) => selectTenant({ id: t.id, user: { name: t.name, email: '' } })} />
                    ) : (
                      <button type="button" onClick={() => setShowNewCustomer(true)}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-[#2e9f82] font-medium hover:underline">
                        <PlusCircle size={13} /> Customer not listed? Create a new customer
                      </button>
                    )}

                    {activeTenants.length > 0 && !(tenantDropdownOpen && tenantResults.length > 0) && (
                      <div className="mt-4">
                        <p className="text-[11px] font-medium text-[#9b9890] mb-2">Active customers — click to select</p>
                        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                          {activeTenants
                            .filter(t => !tenantSearch || t.user.name.toLowerCase().includes(tenantSearch.toLowerCase()) || t.user.email.toLowerCase().includes(tenantSearch.toLowerCase()))
                            .map(t => (
                              <button key={t.id} type="button" onClick={() => selectTenant(t)}
                                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-[#f7f6f2] border border-[#e8e6e0] hover:border-[#2e9f82] hover:bg-[#f0faf6] transition-all text-left">
                                <div className="w-7 h-7 rounded-full bg-[#d8f2e8] flex items-center justify-center text-xs font-bold text-[#2e9f82] shrink-0">{t.user.name.charAt(0).toUpperCase()}</div>
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-[#1a1916] truncate">{t.user.name}</p>
                                  <p className="text-[10px] text-[#9b9890] truncate">{t.user.email}</p>
                                </div>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                    <button type="button" onClick={() => setChangingCustomer(false)}
                      className="mt-3 text-xs text-[#6b6860] hover:underline">Done</button>
                  </>
                )}
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
                    <label className={labelCls}>Contract Registration Fee (AED)</label>
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
                        {allowedInstallmentPlans(allowedInstallments, [Number(installments)]).map((p) => (
                          <option key={p.value} value={p.value}>{p.longLabel}</option>
                        ))}
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
                    {rentVat > 0 && (
                      <>
                        <div className="flex justify-between text-xs pt-1">
                          <span className="text-[#6b6860]">VAT on rent ({rentVatRate}%) · separate cheque</span>
                          <span className="text-[#1a1916] font-medium">{fmtAed(rentVat)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[#6b6860]">Total incl. VAT</span>
                          <span className="text-[#1a1916] font-semibold">{fmtAed(rentNum + rentVat)}</span>
                        </div>
                      </>
                    )}
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
                    {rentVat > 0 && (
                      <div className="grid grid-cols-4 px-4 py-2 bg-[#fdf7ea] border-t border-[#e7d8a8]">
                        <span className="col-span-3 text-xs font-medium text-[#8a6d1f]">+ Rent VAT ({rentVatRate}%) — collected as separate cheque{inst === 1 ? '' : 's'}</span>
                        <span className="text-xs font-bold text-[#8a6d1f] text-right">{fmtAed(rentVat)}</span>
                      </div>
                    )}
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

              {/* Agreement Addendum */}
              <div className={cardCls}>
                <h2 className="font-semibold text-sm text-[#1a1916]">Agreement Addendum</h2>
                {addendums.length > 0 ? (
                  <ul className="space-y-1.5">
                    {addendums.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 rounded-lg bg-[#e6f7f1] border border-[#bfe9da] px-3 py-2 text-sm text-[#1a1916]">
                        <Check size={14} className="shrink-0 text-[#2e9f82]" />
                        <span className="flex-1">{a.name || 'Agreement Addendum'}</span>
                        <span className="text-xs font-semibold text-[#2e9f82]">Attached</span>
                      </li>
                    ))}
                  </ul>
                ) : (meta.status === 'terminated' || meta.status === 'expired') ? (
                  <p className="text-sm text-[#6b6860]">No addendum attached.</p>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-sm text-[#6b6860]">
                      Attach this plan’s Agreement Addendum so it appears on the tenancy agreement. Works on issued and active contracts.
                    </p>
                    {addendumErr && (
                      <div className="flex items-center gap-2 rounded-xl bg-[#fee2e2] px-4 py-2.5 text-sm text-[#b91c1c]">
                        <Info className="h-4 w-4 shrink-0" /> {addendumErr}
                      </div>
                    )}
                    <button type="button" onClick={attachAddendum} disabled={addendumBusy}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#e6f7f1] text-[#2e9f82] text-sm font-semibold px-4 py-2.5 hover:bg-[#d4f0e6] disabled:opacity-50">
                      <Plus size={14} /> {addendumBusy ? 'Attaching…' : 'Attach Agreement Addendum'}
                    </button>
                  </div>
                )}
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
                ...(rentVat > 0 ? ([[`VAT on rent (${rentVatRate}%)`, fmtAed(rentVat)]] as [string, string][]) : []),
                ['Security deposit', securityDeposit ? fmtAed(Number(securityDeposit)) : '—'],
                ['Admin fee', adminFee ? fmtAed(Number(adminFee)) : '—'],
                ['Contract Registration Fee', ejariFee ? fmtAed(Number(ejariFee)) : '—'],
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
              <Link href={`${contractsBase}/${id}/v2`}
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
