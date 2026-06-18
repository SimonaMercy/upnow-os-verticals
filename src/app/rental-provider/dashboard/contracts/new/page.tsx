/**
 * Rental Provider — New Contract wizard (rental-provider/dashboard/contracts/new)
 *
 * Multi-step form for creating a tenancy contract:
 *   Step 1: Select unit + tenant (tenant autocomplete from /contracts/tenants)
 *   Step 2: Contract terms (dates, rent, installments, payment method)
 *   Step 3: Clauses + fees (custom clauses, admin fee, Ejari fee)
 *   Step 4: Review + submit
 *
 * On submit, calls POST /contracts which also auto-creates instalment Payment
 * records if numberOfInstallments > 0. After creation, redirects to /contracts/:id.
 *
 * Searching params: ?unitId=X pre-selects a unit (linked from portfolio page).
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Search, X, ChevronDown, FileText, PlusCircle, Building2, Send } from 'lucide-react';
import { PreferredDayPicker } from '@/components/PreferredDayPicker';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Property {
  id: number;
  buildingName: string;
}

interface Unit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  marketPrice: number | null;
  rentalPrice: number | null;
  securityDeposit: number | null;
  adminFee: number | null;
  ejariFeeFils: number | null;
  commission: number | null;
  availability: 'available' | 'reserved' | 'occupied' | 'maintenance';
  bedrooms: number | null;
  unitType: string;
}

interface Tenant {
  id: number;
  user: { name: string; email: string };
}

interface FormState {
  propertyId: string;
  unitId: string;
  tenantId: string;
  tenantName: string;
  contractStartDate: string;
  contractEndDate: string;
  discountType: 'none' | 'percent' | 'fixed';
  discountValue: string;
  numberOfInstallments: string;
  modeOfPayment: string;
  notes: string;
}

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cheque', label: 'Post-Dated Cheques' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online Payment' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAed(fils: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(fils);
}

function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return '';
  // Work entirely in UTC so a YYYY-MM-DD date doesn't shift a day depending on
  // the viewer's timezone.
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  // subtract 1 day so e.g. 2026-05-01 +12m = 2027-04-30
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Date of cheque i (0-indexed), spaced evenly from startDate by 12/n months each. */
function chequeDate(startDate: string, installments: number, i: number): string {
  if (!startDate || !installments) return '';
  const monthsPerCheque = 12 / installments;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Math.round(i * monthsPerCheque));
  return d.toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
}

function calcDurationLabel(start: string, end: string): string {
  if (!start || !end) return '—';
  const s = new Date(start);
  const e = new Date(end);
  if (e <= s) return 'Invalid range';
  const totalDays = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const months = Math.round(totalDays / 30.44);
  if (months >= 24) return `${(months / 12).toFixed(1).replace('.0', '')} years`;
  if (months >= 12) return `${months} months (1 year)`;
  if (months > 1) return `${months} months`;
  return `${totalDays} days`;
}

const AVAILABILITY_CONFIG: Record<Unit['availability'], { label: string; dot: string; textColor: string; bg: string }> = {
  available:   { label: 'Vacant',      dot: 'bg-emerald-500', textColor: 'text-emerald-700', bg: 'bg-emerald-50' },
  reserved:    { label: 'Reserved',    dot: 'bg-amber-400',   textColor: 'text-amber-700',   bg: 'bg-amber-50' },
  occupied:    { label: 'Occupied',    dot: 'bg-red-500',     textColor: 'text-red-700',     bg: 'bg-red-50' },
  maintenance: { label: 'Maintenance', dot: 'bg-orange-400',  textColor: 'text-orange-700',  bg: 'bg-orange-50' },
};

// ─── Component ────────────────────────────────────────────────────────────────

/** Generate + copy a documents-upload portal link for the selected customer.
 *  A 'documents' link needs only the tenant (no contract yet), so it works
 *  mid-creation — the RP can send it before the contract is even saved. */
function SendDocsLinkButton({ tenantId }: { tenantId: number }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const send = async () => {
    setState('sending');
    try {
      const res = await fetch('/api/portal/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, purpose: 'documents' }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setLink(d.link ?? ''); setState('done');
      if (d.link) { try { await navigator.clipboard.writeText(d.link); setCopied(true); } catch { /* ignore */ } }
    } catch { setState('error'); }
  };
  if (state === 'done' && link) {
    return (
      <div className="mt-2 flex items-center gap-2 max-w-md">
        <input readOnly value={link} onFocus={e => e.currentTarget.select()}
          className="flex-1 text-[11px] px-2 py-1.5 rounded-lg border border-[#e8e6e0] bg-[#fafaf8] text-[#1a1916]" />
        <button type="button"
          onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-[#2e9f82] text-white whitespace-nowrap">{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
    );
  }
  return (
    <button type="button" onClick={send} disabled={state === 'sending'}
      className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-[#2e9f82] text-[#2e9f82] disabled:opacity-60">
      <Send size={12} /> {state === 'sending' ? 'Generating…' : state === 'error' ? 'Retry' : 'Send documents upload link'}
    </button>
  );
}

/** Inline "create a new customer" form for the contract wizard. Creates the
 *  customer (account + tenant profile) and hands the new tenant back so the
 *  wizard can issue a contract to them. Login is email OTP (no password). */
function NewCustomerForm({ postUrl, onCreated, onCancel }: {
  postUrl: string; onCreated: (t: { id: number; name: string }) => void; onCancel: () => void;
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
      const res = await fetch(postUrl, {
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
      <p className="text-[11px] text-[#9b9890]">They&apos;ll sign in with this email via a one-time code — no password needed.</p>
    </div>
  );
}

export default function NewContractPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qUnitId     = searchParams.get('unitId')     ?? '';
  const qTenantId   = searchParams.get('tenantId')   ?? '';
  const qTenantName = searchParams.get('tenantName') ? decodeURIComponent(searchParams.get('tenantName')!) : '';
  const qStartDate  = searchParams.get('startDate')  ?? '';
  const qLeadId     = searchParams.get('leadId')     ?? '';
  const qChequeCount = searchParams.get('chequeCount') ?? '';
  // Context-aware create-customer endpoint: manager (re-export) posts via the
  // manager route + ?rp; the RP posts to the contracts endpoint.
  const pathname = usePathname();
  const isManager = (pathname ?? '').startsWith('/dashboard/manager');
  const rpParam = searchParams.get('rp') ?? '';
  const createTenantUrl = isManager ? `/api/manager/tenants?rp=${rpParam}` : '/api/contracts/tenants';
  const propertiesUrl  = isManager ? '/api/manager/properties' : '/api/properties';
  const tenantsListUrl = isManager ? `/api/manager/tenants/list?rp=${rpParam}` : '/api/contracts/tenants/list';
  const tenantSearchUrl = (q: string) => isManager
    ? `/api/manager/tenants/search?rp=${rpParam}&q=${encodeURIComponent(q)}`
    : `/api/contracts/tenants/search?q=${encodeURIComponent(q)}`;
  const unitsUrl = (pid: string | number) => isManager
    ? `/api/manager/properties/${pid}/units`
    : `/api/properties/${pid}/units`;
  const submitUrl = isManager ? `/api/manager/contracts?rp=${rpParam}` : '/api/contracts';
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  // Live plan brought over from the lead (when available) — drives the prefilled amounts
  // AND the cheque schedule preview, so the contract matches what was issued to the tenant.
  type PlanItem = {
    index: number;
    amountFils: number;
    dueDate: string;
    description?: string;
    type?: 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
  };
  const [planFromLead, setPlanFromLead] = useState<null | {
    rentFils: number;
    securityDepositFils: number;
    adminFeeFils: number;
    ejariFils: number;
    commissionFils: number;
    installmentCount: number;
    discountFils?: number;
    discountType?: 'percent' | 'fixed';
    discountPercent?: number;
    originalRentFils?: number;
    totalAmountFils: number;
    chequeCount: number;
    items: PlanItem[];
    notes?: string | null;
  }>(null);

  // Track whether end date was auto-set so we can re-auto when start changes
  const autoEndDateRef = useRef(true);

  const [preferredStartDays, setPreferredStartDays] = useState<number[]>([]);
  // Installment plans this RP offers (Settings → Rules). Empty = all allowed.
  const [allowedInstallments, setAllowedInstallments] = useState<number[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoaded, setPropertiesLoaded] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [tenantResults, setTenantResults] = useState<Tenant[]>([]);
  const [activeTenants, setActiveTenants] = useState<Tenant[]>([]);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [customClauses, setCustomClauses] = useState<string[]>([]);
  const [clauseInput, setClauseInput] = useState('');

  const tenantDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState<FormState>({
    propertyId: '',
    unitId: '',
    tenantId: qTenantId,
    tenantName: qTenantName,
    contractStartDate: qStartDate,
    contractEndDate: qStartDate ? addMonths(qStartDate, 12) : '',
    discountType: 'none',
    discountValue: '',
    numberOfInstallments: qChequeCount && Number(qChequeCount) > 0 ? String(Math.max(1, Number(qChequeCount) - 1)) : '4',
    modeOfPayment: 'cheque',
    notes: '',
  });

  // Load preferred start days from RP profile (RP only — managers have no RP profile;
  // cheque dates just won't pre-snap to preferred days, which is a non-blocking nicety).
  useEffect(() => {
    if (isManager) return;
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { profile?: { preferredStartDays?: number[] | null; allowedInstallments?: number[] | null } } | null) => {
        if (Array.isArray(data?.profile?.preferredStartDays)) {
          setPreferredStartDays(data!.profile!.preferredStartDays!);
        }
        const allowed = data?.profile?.allowedInstallments;
        if (Array.isArray(allowed) && allowed.length) {
          setAllowedInstallments(allowed);
          // Snap the default plan to one the RP actually offers.
          setForm(f => allowed.includes(Number(f.numberOfInstallments))
            ? f
            : { ...f, numberOfInstallments: String([...allowed].sort((a, b) => a - b)[0]) });
        }
      })
      .catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load properties + tenants on mount; pre-fill if query params present
  useEffect(() => {
    Promise.all([
      fetch(propertiesUrl, { credentials: 'include' }).then(r => r.json()),
      fetch(tenantsListUrl, { credentials: 'include' }).then(r => r.json()),
    ]).then(([propDataRaw, tenantData]) => {
      // Manager properties span all managed landlords — scope to the selected one.
      const propData = (isManager && Array.isArray(propDataRaw) && rpParam)
        ? propDataRaw.filter((p: { rentalProviderId?: number }) => p.rentalProviderId === Number(rpParam))
        : propDataRaw;
      if (Array.isArray(propData)) setProperties(propData);
      setPropertiesLoaded(true);
      if (Array.isArray(tenantData)) {
        setActiveTenants(tenantData);
        // Only try to enrich from list if name wasn't passed via URL
        if (qTenantId && !qTenantName) {
          const found = tenantData.find((t: Tenant) => String(t.id) === qTenantId);
          if (found) {
            setForm(f => ({ ...f, tenantId: String(found.id), tenantName: found.user.name }));
          }
        }
      }
      // Pre-fill unit: find which property owns this unit, set propertyId
      if (qUnitId && Array.isArray(propData)) {
        const pid = propData[0]?.id; // will refine below once units load per property
        // Fetch unit info directly to get its propertyId
        fetch(`/api/listings/units/${qUnitId}`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : null)
          .then((data: { unit?: { propertyId?: number } } | null) => {
            const pid = data?.unit?.propertyId;
            if (pid) setForm(f => ({ ...f, propertyId: String(pid) }));
          })
          .catch(() => undefined);
      }
    }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a leadId is in the URL, fetch the lead and pre-fill from its issued payment plan.
  // This keeps the contract issue page consistent with what the RP issued + the tenant saw.
  useEffect(() => {
    if (!qLeadId) return;
    fetch(`/api/leads/${qLeadId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((lead: null | {
        paymentPlan?: null | {
          rentFils: number; securityDepositFils: number; adminFeeFils: number; ejariFils: number;
          commissionFils: number; installmentCount: number; discountFils?: number;
          discountType?: 'percent' | 'fixed'; discountPercent?: number; originalRentFils?: number;
          totalAmountFils: number; chequeCount: number; items: PlanItem[]; notes?: string | null;
        };
      }) => {
        const p = lead?.paymentPlan;
        if (!p) return;
        setPlanFromLead({
          rentFils: p.rentFils,
          securityDepositFils: p.securityDepositFils,
          adminFeeFils: p.adminFeeFils,
          ejariFils: p.ejariFils,
          commissionFils: p.commissionFils,
          installmentCount: p.installmentCount,
          discountFils: p.discountFils,
          discountType: p.discountType,
          discountPercent: p.discountPercent,
          originalRentFils: p.originalRentFils,
          totalAmountFils: p.totalAmountFils,
          chequeCount: p.chequeCount,
          items: p.items,
          notes: p.notes ?? null,
        });
        // The plan's discount is read-only here (shown from planFromLead); the
        // form's own discount controls stay untouched for the no-lead path.
        setForm(f => ({
          ...f,
          numberOfInstallments: String(p.installmentCount),
        }));
      })
      .catch(() => undefined);
  }, [qLeadId]);

  // Load units when property changes; auto-select unit from query param
  useEffect(() => {
    if (!form.propertyId) { setUnits([]); return; }
    fetch(unitsUrl(form.propertyId), { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setUnits(data);
          // Only auto-select if query param matches a unit in this property
          if (qUnitId && data.some((u: Unit) => String(u.id) === qUnitId)) {
            setForm(f => ({ ...f, unitId: qUnitId }));
          }
        }
      })
      .catch(() => undefined);
    setForm(f => ({ ...f, unitId: '' }));
  }, [form.propertyId, qUnitId]);

  // When start date changes and end date was auto-set, recalculate end date
  const applyStartDate = (newStart: string) => {
    setForm(f => {
      const newEnd = autoEndDateRef.current && newStart ? addMonths(newStart, 12) : f.contractEndDate;
      return { ...f, contractStartDate: newStart, contractEndDate: newEnd };
    });
  };
  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => applyStartDate(e.target.value);

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    autoEndDateRef.current = false; // user manually set end date
    setForm(f => ({ ...f, contractEndDate: e.target.value }));
  };

  // Tenant search with debounce
  const searchTenants = useCallback((q: string) => {
    if (!q || q.length < 2) { setTenantResults([]); return; }
    fetch(tenantSearchUrl(q), { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTenantResults(data); })
      .catch(() => undefined);
  }, []);

  const handleTenantInput = (val: string) => {
    setTenantSearch(val);
    setTenantDropdownOpen(true);
    if (tenantDebounce.current) clearTimeout(tenantDebounce.current);
    tenantDebounce.current = setTimeout(() => searchTenants(val), 300);
    if (!val) setForm(f => ({ ...f, tenantId: '', tenantName: '' }));
  };

  const selectTenant = (t: Tenant) => {
    setForm(f => ({ ...f, tenantId: String(t.id), tenantName: t.user.name }));
    setTenantSearch(`${t.user.name} (${t.user.email})`);
    setTenantDropdownOpen(false);
    setTenantResults([]);
  };

  const set = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm(f => ({ ...f, [field]: e.target.value }));

  // Apply a duration preset (in months) from start date
  const applyPreset = (months: number) => {
    if (!form.contractStartDate) return;
    setForm(f => ({ ...f, contractEndDate: addMonths(f.contractStartDate, months) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.unitId) { setError('Please select a unit.'); return; }
    if (!form.tenantId) { setError('Please select a customer.'); return; }
    if (!form.contractStartDate || !form.contractEndDate) {
      setError('Please fill in contract dates.'); return;
    }
    const selectedUnit = units.find(u => String(u.id) === form.unitId);
    const listedRent = Number(selectedUnit?.rentalPrice ?? selectedUnit?.marketPrice ?? 0);
    if (listedRent <= 0) {
      setError('The selected unit has no rental price set. Please update the unit first.'); return;
    }

    setSubmitting(true);
    try {
      const su = units.find(u => String(u.id) === form.unitId);
      // If the lead has an issued plan, use those amounts so the contract matches.
      // Otherwise compute from the unit defaults.
      const rentFromUnit = Number(su?.rentalPrice ?? su?.marketPrice ?? 0);
      const discRaw = Number(form.discountValue) || 0;
      const discAmt = form.discountType === 'percent' ? Math.round(rentFromUnit * discRaw) / 100
                    : form.discountType === 'fixed'   ? Math.min(discRaw, rentFromUnit)
                    : 0;
      const effectiveRent = planFromLead
        ? planFromLead.rentFils / 100
        : Math.max(0, rentFromUnit - discAmt);

      const body = {
        unitId: Number(form.unitId),
        tenantId: Number(form.tenantId),
        contractStartDate: form.contractStartDate,
        contractEndDate: form.contractEndDate,
        annualRent: effectiveRent,
        // Send listed rent + discount so the contract stores the full breakdown
        // (backend recomputes net = listed − discount). Carry it from the lead
        // plan when present, else from the form's own discount controls.
        ...(planFromLead
          ? (planFromLead.discountFils
              ? {
                  listedRent: (planFromLead.originalRentFils ?? (planFromLead.rentFils + planFromLead.discountFils)) / 100,
                  discountType: planFromLead.discountType ?? 'fixed',
                  discountValue: planFromLead.discountType === 'percent'
                    ? planFromLead.discountPercent
                    : planFromLead.discountFils / 100,
                }
              : {})
          : (form.discountType !== 'none' && discRaw > 0
              ? { listedRent: rentFromUnit, discountType: form.discountType, discountValue: discRaw }
              : {})),
        // The units API serializes numerics as strings ("5600.00") — coerce,
        // or the contracts DTO rejects the whole POST with a 400.
        securityDepositAmount: planFromLead
          ? planFromLead.securityDepositFils / 100
          : su?.securityDeposit != null ? Number(su.securityDeposit) : undefined,
        adminFee: planFromLead
          ? planFromLead.adminFeeFils / 100
          : su?.adminFee != null ? Number(su.adminFee) : undefined,
        ejariFee: planFromLead
          ? planFromLead.ejariFils / 100
          : su?.ejariFeeFils != null ? Number(su.ejariFeeFils) : undefined,
        numberOfInstallments: form.numberOfInstallments ? Number(form.numberOfInstallments) : undefined,
        modeOfPayment: form.modeOfPayment,
        notes: form.notes || undefined,
        customClauses: customClauses.length > 0 ? customClauses : undefined,
        // Pass the source lead so the backend mirrors its payment plan items (extras + deposit)
        // into the contract's payment schedule, exactly matching what the tenant has seen.
        ...(qLeadId && planFromLead ? { leadId: Number(qLeadId) } : {}),
      };

      const res = await fetch(submitUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string })?.message ?? `Server error ${res.status}`);
      }

      const created = await res.json() as { id: number };

      setSuccess(true);
      const doneBase = isManager ? '/dashboard/manager/contracts' : '/rental-provider/dashboard/contracts';
      setTimeout(() => router.push(`${doneBase}/${created.id}/v2`), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Live summary calculations ────────────────────────────────────────────

  const selectedUnit  = units.find(u => String(u.id) === form.unitId);
  // Prefer the lead's issued payment plan as the source of truth (so the contract matches what
  // the RP shared with the tenant). Fall back to the unit defaults when no plan is supplied.
  const listedRent    = planFromLead ? (planFromLead.rentFils + (planFromLead.discountFils ?? 0)) / 100
                                     : Number(selectedUnit?.rentalPrice ?? selectedUnit?.marketPrice ?? 0);
  // Discount comes from the lead's issued plan when present (read-only), else
  // from the form controls. annualRent is always the NET (post-discount) rent.
  const discRaw       = Number(form.discountValue) || 0;
  const discountAmt   = planFromLead
                          ? (planFromLead.originalRentFils
                              ? (planFromLead.originalRentFils - planFromLead.rentFils) / 100
                              : (planFromLead.discountFils ?? 0) / 100)
                          : form.discountType === 'percent' ? Math.round(listedRent * discRaw) / 100
                          : form.discountType === 'fixed'   ? Math.min(discRaw, listedRent)
                          : 0;
  const annualRent    = planFromLead ? planFromLead.rentFils / 100 : Math.max(0, listedRent - discountAmt);
  const secDeposit    = planFromLead ? planFromLead.securityDepositFils / 100 : Number(selectedUnit?.securityDeposit) || 0;
  const adminFee      = planFromLead ? planFromLead.adminFeeFils / 100      : Number(selectedUnit?.adminFee)      || 0;
  const ejariFee      = planFromLead ? planFromLead.ejariFils / 100         : Number(selectedUnit?.ejariFeeFils)  || 0;
  const commission    = planFromLead ? planFromLead.commissionFils / 100    : Number(selectedUnit?.commission)    || 0;
  const installments  = Number(form.numberOfInstallments) || 4;
  const chequeAmount  = installments > 0 ? annualRent / installments : 0;
  const durationLabel = calcDurationLabel(form.contractStartDate, form.contractEndDate);

  // ─── Success screen ───────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f7f6f2]">
        <div className="bg-white rounded-2xl p-10 shadow text-center max-w-sm w-full">
          <div className="w-14 h-14 bg-[#d8f2e8] rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#2e9f82]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#1a1916] mb-2">Contract Created</h2>
          <p className="text-sm text-[#6b6860]">Redirecting to dashboard…</p>
        </div>
      </div>
    );
  }

  // ─── No properties guard ──────────────────────────────────────────────────

  if (propertiesLoaded && properties.length === 0) {
    return (
      <div className="min-h-screen bg-[#f7f6f2] p-4 md:p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Link
              href="/rental-provider/dashboard"
              className="w-9 h-9 rounded-xl bg-white shadow-sm border border-[#e8e6e0] flex items-center justify-center hover:bg-[#f4f3ef] transition-colors"
            >
              <ArrowLeft size={16} className="text-[#1a1916]" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-[#1a1916]">New Tenancy Contract</h1>
              <p className="text-xs text-[#6b6860] mt-0.5">New contracts only — renewals are auto-triggered 90 days before expiry</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-10 shadow-sm text-center max-w-md mx-auto">
            <div className="w-14 h-14 bg-[#f0faf6] rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 size={24} className="text-[#2e9f82]" />
            </div>
            <h2 className="text-lg font-bold text-[#1a1916] mb-2">No Properties Yet</h2>
            <p className="text-sm text-[#6b6860] mb-6">
              You need to list a property and add at least one unit before you can create a tenancy contract.
            </p>
            <Link
              href="/rental-provider/dashboard/portfolio?add=1"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: '#2e9f82' }}
            >
              <PlusCircle size={15} /> List Your First Property
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f7f6f2] p-4 md:p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/rental-provider/dashboard"
            className="w-9 h-9 rounded-xl bg-white shadow-sm border border-[#e8e6e0] flex items-center justify-center hover:bg-[#f4f3ef] transition-colors"
          >
            <ArrowLeft size={16} className="text-[#1a1916]" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[#1a1916]">New Tenancy Contract</h1>
            <p className="text-xs text-[#6b6860] mt-0.5">New contracts only — renewals are auto-triggered 90 days before expiry</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">

          {/* ── Left: Form ── */}
          <form onSubmit={handleSubmit} className="space-y-4" id="contract-form">

            {/* Property & Unit */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm text-[#1a1916]">Property &amp; Unit</h2>
                {form.propertyId ? (
                  <Link href={`/rental-provider/dashboard/units?propertyId=${form.propertyId}`} target="_blank"
                    className="flex items-center gap-1 text-xs text-[#2e9f82] font-medium hover:underline">
                    <PlusCircle size={12} /> Add Unit
                  </Link>
                ) : (
                  <Link href="/rental-provider/dashboard/portfolio?add=1" target="_blank"
                    className="flex items-center gap-1 text-xs text-[#2e9f82] font-medium hover:underline">
                    <PlusCircle size={12} /> List Property First
                  </Link>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Property *</label>
                <div className="relative">
                  <select
                    className="w-full appearance-none rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 pr-9 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]"
                    value={form.propertyId}
                    onChange={set('propertyId')}
                    required
                  >
                    <option value="">Select property…</option>
                    {properties.map(p => (
                      <option key={p.id} value={String(p.id)}>{p.buildingName}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6860]" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Unit *</label>
                {units.length > 0 ? (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {units.map(u => {
                      const cfg = AVAILABILITY_CONFIG[u.availability] ?? AVAILABILITY_CONFIG.available;
                      const isSelected = form.unitId === String(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, unitId: String(u.id) }))}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${
                            isSelected
                              ? 'border-[#2e9f82] bg-[#f0faf6]'
                              : 'border-[#e8e6e0] bg-[#f7f6f2] hover:border-[#c5e8df]'
                          }`}
                        >
                          <div>
                            <span className="block text-sm font-semibold text-[#1a1916]">
                              Unit {u.unitNumber}
                              {u.bedrooms ? ` · ${u.bedrooms}BR` : ''}
                              {u.unitType ? ` · ${u.unitType.charAt(0).toUpperCase() + u.unitType.slice(1)}` : ''}
                            </span>
                            {(u.rentalPrice || u.marketPrice) && (
                              <span className="block text-xs text-[#6b6860] mt-0.5">
                                AED {Number(u.rentalPrice ?? u.marketPrice).toLocaleString()}/yr
                              </span>
                            )}
                          </div>
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.textColor}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 text-sm text-[#9b9890]">
                    {form.propertyId ? 'No units found for this property' : 'Select property first'}
                  </div>
                )}
              </div>
            </div>

            {/* Tenant */}
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-sm text-[#1a1916]">Customer</h2>
                {!qTenantId && (
                  <Link href="/rental-provider/dashboard/tenants" target="_blank"
                    className="flex items-center gap-1 text-xs text-[#2e9f82] font-medium hover:underline">
                    <PlusCircle size={12} /> Add Customer
                  </Link>
                )}
              </div>

              {/* If tenant was passed from lead — show locked card, no search */}
              {qTenantId ? (
                <div className="flex items-center gap-3 rounded-xl border border-[#c5e8df] bg-[#f0faf6] px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-[#2e9f82] flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {form.tenantName ? form.tenantName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase() : '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1a1916] truncate">{form.tenantName || 'Loading…'}</p>
                    <p className="text-[11px] text-[#2e9f82]">Pre-filled from lead</p>
                  </div>
                </div>
              ) : (
                <>
                  <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Search by name or email *</label>
                  <div className="relative">
                    <div className="relative flex items-center">
                      <Search size={14} className="absolute left-3 text-[#9b9890]" />
                      <input
                        type="text"
                        placeholder="Type name or email…"
                        value={tenantSearch}
                        onChange={e => handleTenantInput(e.target.value)}
                        onFocus={() => { if (tenantResults.length > 0) setTenantDropdownOpen(true); }}
                        className="w-full rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] pl-9 pr-9 py-2.5 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]"
                        autoComplete="off"
                      />
                      {tenantSearch && (
                        <button
                          type="button"
                          onClick={() => {
                            setTenantSearch('');
                            setForm(f => ({ ...f, tenantId: '', tenantName: '' }));
                            setTenantResults([]);
                            setTenantDropdownOpen(false);
                          }}
                          className="absolute right-3 text-[#9b9890] hover:text-[#1a1916]"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {tenantDropdownOpen && tenantResults.length > 0 && (
                      <div className="absolute z-20 mt-1 w-full bg-white border border-[#e8e6e0] rounded-xl shadow-lg overflow-hidden">
                        {tenantResults.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => selectTenant(t)}
                            className="w-full text-left px-4 py-2.5 hover:bg-[#f4f3ef] transition-colors"
                          >
                            <span className="block text-sm font-medium text-[#1a1916]">{t.user.name}</span>
                            <span className="block text-xs text-[#6b6860]">{t.user.email}</span>
                          </button>
                        ))}
                      </div>
                    )}
              </div>
              {form.tenantId && (
                <>
                  <p className="mt-2 text-xs text-[#2e9f82] font-medium">✓ {form.tenantName}</p>
                  <SendDocsLinkButton tenantId={Number(form.tenantId)} />
                </>
              )}

              {/* Customer not in the system yet — create one inline */}
              {!form.tenantId && (
                showNewCustomer ? (
                  <NewCustomerForm
                    postUrl={createTenantUrl}
                    onCancel={() => setShowNewCustomer(false)}
                    onCreated={(t) => {
                      setForm(f => ({ ...f, tenantId: String(t.id), tenantName: t.name }));
                      setTenantSearch(t.name);
                      setShowNewCustomer(false);
                      setTenantDropdownOpen(false);
                      setTenantResults([]);
                    }}
                  />
                ) : (
                  <button type="button" onClick={() => setShowNewCustomer(true)}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-[#2e9f82] font-medium hover:underline">
                    <PlusCircle size={13} /> Customer not listed? Create a new customer
                  </button>
                )
              )}

              {/* Active tenants quick list */}
              {!form.tenantId && activeTenants.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] font-medium text-[#9b9890] mb-2">Active customers — click to select</p>
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {activeTenants
                      .filter(t =>
                        !tenantSearch ||
                        t.user.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
                        t.user.email.toLowerCase().includes(tenantSearch.toLowerCase())
                      )
                      .map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => selectTenant(t)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-[#f7f6f2] border border-[#e8e6e0] hover:border-[#2e9f82] hover:bg-[#f0faf6] transition-all text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-[#d8f2e8] flex items-center justify-center text-xs font-bold text-[#2e9f82] shrink-0">
                            {t.user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#1a1916] truncate">{t.user.name}</p>
                            <p className="text-[10px] text-[#9b9890] truncate">{t.user.email}</p>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              )}
                </>
              )}
            </div>

            {/* Rental Period */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="font-semibold text-sm text-[#1a1916]">Rental Period</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Start Date *</label>
                  <PreferredDayPicker
                    value={form.contractStartDate}
                    preferredDays={preferredStartDays}
                    onChange={applyStartDate}
                    placeholder="Pick start date"
                    inputClassName="rounded-xl border-[#e8e6e0] bg-[#f7f6f2] py-2.5 text-sm focus:ring-2 focus:ring-[#2e9f82]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#6b6860] mb-1.5">End Date *</label>
                  <input
                    type="date"
                    value={form.contractEndDate}
                    onChange={handleEndDateChange}
                    required
                    min={form.contractStartDate}
                    className="w-full rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]"
                  />
                </div>
              </div>

              {/* Duration presets */}
              <div>
                <p className="text-xs text-[#9b9890] mb-2">Quick duration (from start date)</p>
                <div className="flex gap-2">
                  {[{ label: '6 Months', months: 6 }, { label: '12 Months', months: 12 }, { label: '24 Months', months: 24 }].map(p => (
                    <button
                      key={p.months}
                      type="button"
                      disabled={!form.contractStartDate}
                      onClick={() => applyPreset(p.months)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#e8e6e0] bg-[#f7f6f2] text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82] hover:bg-[#f0faf6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration indicator */}
              {form.contractStartDate && form.contractEndDate && (
                <div className="flex items-center gap-2 bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-2.5">
                  <span className="text-xs font-medium text-[#6b6860]">Duration:</span>
                  <span className="text-sm font-bold text-[#2e9f82]">{durationLabel}</span>
                </div>
              )}
            </div>

            {/* Financial Terms */}
            <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
              <h2 className="font-semibold text-sm text-[#1a1916]">Financial Terms</h2>

              {!form.unitId ? (
                <p className="text-sm text-[#9b9890]">Select a unit above to see pricing.</p>
              ) : (
                <>
                  {/* Read-only amounts: from the issued plan when present, else unit defaults */}
                  <div className="rounded-xl border border-[#e8e6e0] overflow-hidden">
                    <div className="bg-[#f4f3ef] px-4 py-2 border-b border-[#e8e6e0]">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9b9890]">
                        {planFromLead ? 'Pricing (from issued payment plan)' : 'Unit Pricing'}
                      </p>
                    </div>
                    <div className="divide-y divide-[#f4f3ef]">
                      {/* Annual Rent — show original → discounted when plan has a discount */}
                      <div className="flex justify-between items-center px-4 py-2.5">
                        <span className="text-xs text-[#6b6860]">Annual Rent</span>
                        <span className="text-xs font-semibold text-[#1a1916]">
                          {planFromLead?.originalRentFils ? (
                            <>
                              <span className="line-through text-[#9b9890] mr-1.5">{fmtAed(planFromLead.originalRentFils / 100)}</span>
                              <span className="text-[#16a34a]">{fmtAed(planFromLead.rentFils / 100)}</span>
                              <span className="ml-1 text-[10px] text-[#16a34a] font-normal">
                                ({planFromLead.discountType === 'percent'
                                  ? `${planFromLead.discountPercent}% off`
                                  : `AED ${((planFromLead.discountFils ?? 0) / 100).toLocaleString('en-AE')} off`})
                              </span>
                            </>
                          ) : (
                            annualRent > 0 ? fmtAed(annualRent) : <span className="text-[#c0bdb8]">—</span>
                          )}
                        </span>
                      </div>
                      {([
                        ['Security Deposit',  secDeposit],
                        ['Admin Fee',         adminFee],
                        ['Ejari Fee',         ejariFee],
                        ['Commission',        commission],
                      ] as [string, number][]).map(([label, val]) => (
                        <div key={label} className="flex justify-between items-center px-4 py-2.5">
                          <span className="text-xs text-[#6b6860]">{label}</span>
                          <span className="text-xs font-semibold text-[#1a1916]">
                            {val > 0 ? fmtAed(val) : <span className="text-[#c0bdb8]">—</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Discount input — only when the contract is being created without a lead plan.
                      When the lead's payment plan is in play, its discount is final and read-only. */}
                  {!planFromLead && (
                    <div>
                      <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Discount (optional)</label>
                      <div className="flex gap-2 mb-2">
                        {(['none', 'percent', 'fixed'] as const).map(t => (
                          <button key={t} type="button"
                            onClick={() => setForm(f => ({ ...f, discountType: t, discountValue: t === 'none' ? '' : f.discountValue }))}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                              form.discountType === t
                                ? 'border-[#2e9f82] bg-[#f0faf6] text-[#2e9f82]'
                                : 'border-[#e8e6e0] bg-[#f7f6f2] text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82]'
                            }`}>
                            {t === 'none' ? 'No Discount' : t === 'percent' ? '% Off' : 'Fixed AED'}
                          </button>
                        ))}
                      </div>
                      {form.discountType !== 'none' && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min="0" step={form.discountType === 'percent' ? '0.1' : '1'}
                            value={form.discountValue} onChange={set('discountValue')}
                            placeholder={form.discountType === 'percent' ? 'e.g. 5' : 'e.g. 2000'}
                            className="flex-1 rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]"
                          />
                          <span className="text-xs font-semibold text-[#6b6860]">{form.discountType === 'percent' ? '%' : 'AED'}</span>
                        </div>
                      )}
                      {discountAmt > 0 && listedRent > 0 && (
                        <div className="mt-2 rounded-xl bg-[#f0faf6] border border-[#c5e8df] px-4 py-2.5 space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-[#6b6860]">Listed rent</span>
                            <span className="text-[#9b9890] line-through">{fmtAed(listedRent)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[#6b6860]">Discount</span>
                            <span className="text-[#b91c1c] font-medium">− {fmtAed(discountAmt)} ({((discountAmt / listedRent) * 100).toFixed(1)}%)</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold pt-1 border-t border-[#c5e8df]">
                            <span className="text-[#1a1916]">Contract value</span>
                            <span className="text-[#2e9f82]">{fmtAed(annualRent)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {planFromLead && (
                    <p className="text-[11px] text-[#6b6860] bg-[#f0f9ff] border border-[#bae6fd] rounded-lg px-3 py-2">
                      Discount and pricing come from the issued payment plan. To change them, edit the plan on the lead.
                    </p>
                  )}
                </>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Payment Method</label>
                  <div className="relative">
                    <select value={form.modeOfPayment} onChange={set('modeOfPayment')}
                      className="w-full appearance-none rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 pr-9 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]">
                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6860]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Payments / Year</label>
                  <div className="relative">
                    <select value={form.numberOfInstallments} onChange={set('numberOfInstallments')}
                      className="w-full appearance-none rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 pr-9 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]">
                      {allowedInstallmentPlans(allowedInstallments, [Number(form.numberOfInstallments)]).map(p => (
                        <option key={p.value} value={p.value}>{p.longLabel}</option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6860]" />
                  </div>
                </div>
              </div>

              {/* Cheque schedule — mirrors the lead's issued plan when available (covers bundle, all installments,
                  extras and the security deposit). Falls back to a simple even split when no plan is present. */}
              {planFromLead ? (() => {
                const order: Record<string, number> = { first_bundle: 0, installment: 1, extra_installment: 2, security_deposit: 3 };
                const sorted = planFromLead.items.slice().sort((a, b) => {
                  if (a.dueDate !== b.dueDate) return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
                  return (order[a.type ?? 'installment'] ?? 1) - (order[b.type ?? 'installment'] ?? 1);
                });
                return (
                  <div className="rounded-xl border border-[#e8e6e0] overflow-hidden">
                    <div className="bg-[#f0f9ff] px-4 py-2 border-b border-[#e8e6e0] flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#0369a1]">Cheque Schedule (from issued plan)</span>
                      <span className="text-[10px] text-[#6b6860]">{planFromLead.chequeCount} cheques</span>
                    </div>
                    <div className="grid grid-cols-12 bg-[#f4f3ef] px-4 py-2 border-b border-[#e8e6e0] text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">
                      <span className="col-span-1">#</span>
                      <span className="col-span-6">Description</span>
                      <span className="col-span-2">Due Date</span>
                      <span className="col-span-3 text-right">Amount</span>
                    </div>
                    {sorted.map((it, i) => (
                      <div key={`${it.index}-${i}`} className={`grid grid-cols-12 px-4 py-2.5 items-center ${i < sorted.length - 1 ? 'border-b border-[#f0ede8]' : ''} ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafaf8]'}`}>
                        <span className="col-span-1 text-xs text-[#9b9890]">{i + 1}</span>
                        <span className="col-span-6 text-xs text-[#1a1916] truncate">{it.description ?? `Cheque ${i + 1}`}</span>
                        <span className="col-span-2 text-xs text-[#6b6860]">{it.dueDate}</span>
                        <span className="col-span-3 text-sm font-bold text-[#2e9f82] text-right">{fmtAed(it.amountFils / 100)}</span>
                      </div>
                    ))}
                    <div className="grid grid-cols-12 px-4 py-2.5 bg-[#f0faf6] border-t-2 border-[#c5e8df]">
                      <span className="col-span-9 text-xs font-semibold text-[#1a1916]">Contract Value ({planFromLead.chequeCount} cheques)</span>
                      <span className="col-span-3 text-sm font-bold text-[#1a1916] text-right">{fmtAed(planFromLead.totalAmountFils / 100)}</span>
                    </div>
                  </div>
                );
              })() : annualRent > 0 && (
                <div className="rounded-xl border border-[#e8e6e0] overflow-hidden">
                  <div className="grid grid-cols-4 bg-[#f4f3ef] px-4 py-2 border-b border-[#e8e6e0]">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">#</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">Cheque</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]">Due Date</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] text-right">Amount</span>
                  </div>
                  {Array.from({ length: installments }, (_, i) => (
                    <div
                      key={i}
                      className={`grid grid-cols-4 px-4 py-2.5 items-center ${i < installments - 1 ? 'border-b border-[#f0ede8]' : ''} ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafaf8]'}`}
                    >
                      <span className="text-xs text-[#9b9890]">{i + 1}</span>
                      <span className="text-xs text-[#6b6860]">Cheque {i + 1}</span>
                      <span className="text-xs text-[#6b6860]">
                        {form.contractStartDate
                          ? chequeDate(form.contractStartDate, installments, i)
                          : <span className="text-[#c0bdb8]">Set start date</span>}
                      </span>
                      <span className="text-sm font-bold text-[#2e9f82] text-right">{fmtAed(chequeAmount)}</span>
                    </div>
                  ))}
                  <div className="grid grid-cols-4 px-4 py-2.5 bg-[#f0faf6] border-t-2 border-[#c5e8df]">
                    <span className="col-span-3 text-xs font-semibold text-[#1a1916]">Total ({installments} cheques)</span>
                    <span className="text-sm font-bold text-[#1a1916] text-right">{fmtAed(annualRent)}</span>
                  </div>
                </div>
              )}

              {/* Custom Clauses */}
              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Special Clauses</label>
                <p className="text-[11px] text-[#9b9891] mb-3">Add custom terms or conditions to append to the contract.</p>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={clauseInput}
                    onChange={e => setClauseInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const trimmed = clauseInput.trim();
                        if (trimmed) { setCustomClauses(prev => [...prev, trimmed]); setClauseInput(''); }
                      }
                    }}
                    placeholder="Type a clause and press Enter or click Add…"
                    className="flex-1 rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = clauseInput.trim();
                      if (trimmed) { setCustomClauses(prev => [...prev, trimmed]); setClauseInput(''); }
                    }}
                    className="px-4 py-2.5 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f] transition-colors whitespace-nowrap"
                  >+ Add</button>
                </div>
                {customClauses.length > 0 && (
                  <ol className="space-y-2">
                    {customClauses.map((clause, i) => (
                      <li key={i} className="flex items-start gap-3 bg-[#f7f6f2] border border-[#e8e6e0] rounded-xl px-4 py-2.5">
                        <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[#2e9f82] text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="flex-1 text-sm text-[#1a1916]">{clause}</span>
                        <button
                          type="button"
                          onClick={() => setCustomClauses(prev => prev.filter((_, j) => j !== i))}
                          className="shrink-0 text-[#c0bdb8] hover:text-red-500 transition-colors"
                          aria-label="Remove clause"
                        ><X size={14} /></button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1.5">Notes</label>
                <textarea rows={3} placeholder="Any additional notes…"
                  value={form.notes} onChange={set('notes')}
                  className="w-full rounded-xl border border-[#e8e6e0] bg-[#f7f6f2] px-4 py-2.5 text-sm text-[#1a1916] focus:outline-none focus:ring-2 focus:ring-[#2e9f82] resize-none"
                />
              </div>
            </div>

            {/* Error banner */}
            {error && (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                <X size={15} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Link href="/rental-provider/dashboard"
                className="flex-1 text-center py-3 rounded-xl border border-[#e8e6e0] text-sm font-semibold text-[#6b6860] hover:bg-[#f4f3ef] transition-colors">
                Cancel
              </Link>
              <button type="submit" disabled={submitting}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60"
                style={{ background: '#2e9f82' }}>
                {submitting ? 'Creating…' : 'Create Contract'}
              </button>
            </div>
          </form>

          {/* ── Right: Live Summary Panel ── */}
          <div className="lg:sticky lg:top-6 space-y-4">
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              {/* Panel header */}
              <div className="px-5 py-4 border-b border-[#f0ede8]" style={{ background: '#2e9f82' }}>
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-white/80" />
                  <span className="text-sm font-bold text-white">Contract Summary</span>
                </div>
                {form.contractStartDate && form.contractEndDate && (
                  <p className="text-xs text-white/70 mt-1">{durationLabel}</p>
                )}
              </div>

              <div className="px-5 py-4 space-y-0">
                {/* Unit row */}
                {selectedUnit && (
                  <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                    <span className="text-xs text-[#9b9890]">Unit</span>
                    <span className="text-xs font-semibold text-[#1a1916]">
                      {selectedUnit.unitNumber}
                      {selectedUnit.bedrooms ? ` · ${selectedUnit.bedrooms}BR` : ''}
                    </span>
                  </div>
                )}

                {/* Dates row */}
                {form.contractStartDate && (
                  <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                    <span className="text-xs text-[#9b9890]">Period</span>
                    <span className="text-xs font-semibold text-[#1a1916]">
                      {form.contractStartDate} → {form.contractEndDate || '…'}
                    </span>
                  </div>
                )}

                {/* Annual rent — strike the listed price when a discount applies */}
                <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                  <span className="text-xs text-[#9b9890]">Annual Rent</span>
                  <span className="text-sm font-bold text-[#1a1916]">
                    {annualRent > 0 ? (
                      <>
                        {discountAmt > 0 && (
                          <span className="text-xs font-normal text-[#9b9890] line-through mr-1.5">{fmtAed(listedRent)}</span>
                        )}
                        {fmtAed(annualRent)}
                      </>
                    ) : '—'}
                  </span>
                </div>
                {discountAmt > 0 && (
                  <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                    <span className="text-xs text-[#9b9890]">Discount</span>
                    <span className="text-xs font-semibold text-[#b91c1c]">− {fmtAed(discountAmt)}</span>
                  </div>
                )}

                {/* Per cheque */}
                {annualRent > 0 && (
                  <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                    <span className="text-xs text-[#9b9890]">
                      Per Cheque ({installments}×)
                    </span>
                    <span className="text-xs font-semibold text-[#2e9f82]">
                      {fmtAed(chequeAmount)}
                    </span>
                  </div>
                )}

                {/* Security deposit */}
                <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                  <span className="text-xs text-[#9b9890]">Security Deposit <span className="text-[10px] text-[#b0ada8]">(PDC)</span></span>
                  <span className="text-xs font-semibold text-[#1a1916]">
                    {secDeposit > 0 ? fmtAed(secDeposit) : '—'}
                  </span>
                </div>

              </div>
            </div>

            {/* Tenant badge */}
            {form.tenantId && (
              <div className="bg-white rounded-2xl px-5 py-4 shadow-sm flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#d8f2e8] flex items-center justify-center text-sm font-bold text-[#2e9f82]">
                  {form.tenantName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#1a1916]">{form.tenantName}</p>
                  <p className="text-[10px] text-[#9b9890]">Customer selected</p>
                </div>
              </div>
            )}

            {/* Contract type note */}
            <div className="bg-[#fffbeb] border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">New contract only</p>
              <p className="text-[10px] text-amber-700 leading-relaxed">
                Renewals are automatically offered to customers 90 days before the contract expires, not created manually.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}


