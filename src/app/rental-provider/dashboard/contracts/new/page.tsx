/**
 * Operations › Long-term leases › New tenancy contract — the Genspark wizard
 * (steps left · form centre · live contract summary right).
 *
 * Reused by the manager route (/dashboard/manager/contracts/new re-exports this
 * default export inside ManagerPermissionGate "Create Contracts"). It detects the
 * /dashboard/manager path + ?rp=<landlord> and scopes every fetch to that landlord.
 *
 * Parity with previous page (single-scroll form + summary column; original backed up
 * to the session scratchpad as contracts-new.orig.tsx):
 *  Query params (all still read)
 *   [x] ?unitId=      → GET /api/listings/units/:id → its propertyId preselects the property, then the unit
 *   [x] ?tenantId=    → customer locked ("Pre-filled from lead" when ?leadId= is present, else "Chosen customer"); name enriched from the tenant list when
 *   [x] ?tenantName=    ?tenantName= is absent
 *   [x] ?startDate=   → start date + auto 12-month end date
 *   [x] ?leadId=      → GET /api/leads/:id → issued paymentPlan drives rent / discount / deposit / fees /
 *                       instalments / schedule (read-only), and `leadId` is sent on create
 *   [x] ?chequeCount= → default instalments = chequeCount − 1 (min 1)
 *   [x] ?rp=          → manager scope (below)
 *  Data / API (unchanged endpoints + payloads)
 *   [x] GET  /api/profiles/rental-provider/me  | manager: /api/manager/landlord-profile?rp=
 *            → preferredStartDays (start-date picker), preferredChequeDays (schedule dates),
 *              allowedInstallments (plan picker + snap default), rentVatMode (shown in the summary)
 *   [x] GET  /api/properties | manager: /api/manager/properties (filtered to rentalProviderId = rp)
 *   [x] GET  /api/contracts/tenants/list | manager: /api/manager/tenants/list?rp=   → active customers list
 *   [x] GET  /api/contracts/tenants/search?q= | manager: /api/manager/tenants/search?rp=&q= (300 ms debounce, ≥ 2 chars)
 *   [x] POST /api/contracts/tenants | manager: /api/manager/tenants?rp=   → inline "Create a new customer"
 *   [x] GET  /api/properties/:pid/units | manager: /api/manager/properties/:pid/units
 *   [x] POST /api/contracts | manager: /api/manager/contracts?rp=   → same body: unitId, tenantId, dates,
 *            annualRent (net), listedRent/discountType/discountValue (from plan or form), securityDepositAmount,
 *            adminFee / ejariFee / commission (blank = omitted), numberOfInstallments, modeOfPayment, notes,
 *            customClauses, leadId (only with a lead plan)
 *   [x] DocsLinkButton "Request documents" for the chosen customer (shared request picker)
 *  Fields / behaviour
 *   [x] Property select · unit list with availability pill · "Add unit" (units?propertyId=, new tab) /
 *       "List property first" (portfolio?add=1, new tab)
 *   [x] Customer search + dropdown + clear · active-customers quick list (filtered by search) · "Add customer"
 *       (tenants page, new tab) · inline new-customer form (name, email, phone, individual/company + company name)
 *   [x] Start date (PreferredDayPicker on the RP's start days) · end date (min = start) · auto 12-month end until
 *       the end is edited by hand · 6 / 12 / 24-month presets · duration label
 *   [x] Pricing (issued plan or unit) with strike-through discount · discount none / % / fixed (no-lead only) ·
 *       one-off fees editable (no-lead) or read-only (lead), prefilled only while blank · payment method ·
 *       payments / year (allowedInstallmentPlans) · SegregatedPlanView schedule (same maths: even split,
 *       buildInstallmentDueDates snapped to cheque days, separate 5% VAT line, deposit, fees)
 *   [x] Special clauses (Enter or Add, remove each) · notes
 *   [x] Validation on create: unit, customer, dates, unit rental price > 0 · error banner
 *   [x] Success → "Contract created" → Operations pipeline /operations/:id (manager: /dashboard/manager/operations/:id)
 *   [x] No-properties guard → "List your first property" (portfolio?add=1)
 *   [x] "New contract only — renewals are auto-offered 90 days before expiry" note
 *  Added (Genspark): step list, live summary on every step, "Preview & create" checklist from the real
 *  form state, validation jumps to the failing step, load errors with retry.
 *  Changed on purpose:
 *   - VAT preview uses isRentVatable(unitType, property.spaceCategory) — the single VAT chokepoint that
 *     mirrors the backend (identical result to the old unit-type-only check except in a non-mixed-use
 *     building, where the property category now wins exactly as it does on the server).
 *   - Bedrooms are shown only for residential unit types (isResidentialUnitType).
 *   - Cancel / back goes to /dashboard/manager/contracts for a manager (was the RP dashboard for both).
 *   - No <form> element: Enter in a field no longer submits the contract by accident.
 */
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { DocsLinkButton } from '@/components/upnow/DocsLinkButton';
import { PreferredDayPicker } from '@/components/PreferredDayPicker';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { buildInstallmentDueDates } from '@/lib/installmentDates';
import { SegregatedPlanView } from '@/components/upnow/SegregatedPlanView';
import { buildSegregatedPlan, segRowsFromCustomerPlan, type SegPaymentInput } from '@/lib/segregatedPlan';
import { effectiveSpaceCategory, isRentVatable, isResidentialUnitType } from '@/lib/unitTaxonomy';
import { tenantDisplayName } from '@/lib/tenantName';
import {
  Btn, Callout, Card, Checklist, EmptyRow, ErrorRow, Evid, Field, KV, OsPage, PageHead, Pill, ScopeStrip,
  SkeletonRows, TableWrap, Thumb, fmtAed, fmtDate, humanize, type Tone,
} from '@/components/os/kit';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Property {
  id: number;
  buildingName: string;
  spaceCategory?: string | null;
}

interface Unit {
  id: number;
  unitNumber: string;
  unitName: string | null;
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
  entityType?: string | null;
  companyName?: string | null;
}

/** The API's user.name is the person. A company customer is labelled by its
 *  company (never the signatory) as tenants load, so the search, the lists and
 *  the chosen customer all read the same name. */
function labelTenant(t: Tenant): Tenant {
  return { ...t, user: { ...t.user, name: tenantDisplayName({ name: t.user.name, entityType: t.entityType, companyName: t.companyName }) ?? t.user.name } };
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
  // One-off fees (AED) — prefilled from the unit/lead suggestion but editable.
  // Whatever the RP confirms here is what's stored; blank = fee not charged.
  adminFee: string;
  ejariFee: string;
  commission: string;
}

type PlanItem = {
  index: number;
  amountFils: number;
  dueDate: string;
  description?: string;
  type?: 'fee' | 'first_bundle' | 'security_deposit' | 'installment' | 'extra_installment';
};
type LeadPlan = {
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
};

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cheque', label: 'Post-Dated Cheques' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online Payment' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const AVAILABILITY: Record<Unit['availability'], { label: string; tone: Tone }> = {
  available:   { label: 'Vacant',      tone: 'primary' },
  reserved:    { label: 'Reserved',    tone: 'amber' },
  occupied:    { label: 'Occupied',    tone: 'danger' },
  maintenance: { label: 'Maintenance', tone: 'amber' },
};

const unitLabel = (u: Unit) =>
  `Unit ${u.unitNumber}${isResidentialUnitType(u.unitType) && u.bedrooms ? ` · ${u.bedrooms}BR` : ''}`;

/** Fill the one-off fee fields with the suggested default (lead plan or the unit's
 *  configured fees) — only while a field is still blank, so the RP's own edits are
 *  never clobbered. Blank = fee not charged; nothing is auto-derived on the backend. */
function prefillFees(f: FormState, u: Unit | undefined, plan: LeadPlan | null): FormState {
  if (!u && !plan) return f;
  const a = plan ? plan.adminFeeFils / 100 : Number(u?.adminFee) || 0;
  const e = plan ? plan.ejariFils / 100 : Number(u?.ejariFeeFils) || 0;
  const c = plan ? plan.commissionFils / 100 : Number(u?.commission) || 0;
  const next = {
    ...f,
    adminFee:   f.adminFee === ''   && a ? String(a) : f.adminFee,
    ejariFee:   f.ejariFee === ''   && e ? String(e) : f.ejariFee,
    commission: f.commission === '' && c ? String(c) : f.commission,
  };
  return next.adminFee === f.adminFee && next.ejariFee === f.ejariFee && next.commission === f.commission ? f : next;
}

type StepId = 'customer' | 'unit' | 'period' | 'rent' | 'fees' | 'clauses' | 'review';
const STEPS: { id: StepId; t: string; d: string }[] = [
  { id: 'customer', t: 'Customer',           d: 'Who the lease is issued to' },
  { id: 'unit',     t: 'Property & unit',    d: 'The space being let' },
  { id: 'period',   t: 'Rental period',      d: 'Start, end and duration' },
  { id: 'rent',     t: 'Rent & instalments', d: 'Rent, discount and payment plan' },
  { id: 'fees',     t: 'Fees & deposit',     d: 'Security deposit and one-off fees' },
  { id: 'clauses',  t: 'Clauses & notes',    d: 'Special terms on the contract' },
  { id: 'review',   t: 'Preview & create',   d: 'Checklist, then create the draft' },
];

// ─── Small parts ─────────────────────────────────────────────────────────────

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
      onCreated({ id: d.tenantId, name: tenantDisplayName(d) ?? name.trim() });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to create customer'); }
    finally { setBusy(false); }
  };
  return (
    <Card title="New customer" sub="They'll sign in with this email via a one-time code — no password needed."
      right={<Btn size="xs" onClick={onCancel}>Cancel</Btn>} pad>
      <div className="gx-two">
        <Field label="Full name *" htmlFor="nc-name"><input id="nc-name" className="gx-inp" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Email *" htmlFor="nc-email"><input id="nc-email" className="gx-inp" type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Phone (optional)" htmlFor="nc-phone"><input id="nc-phone" className="gx-inp" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
        <Field label="Customer type" htmlFor="nc-type">
          <select id="nc-type" className="gx-sel" value={entityType} onChange={e => setEntityType(e.target.value as 'individual' | 'company')}>
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </select>
        </Field>
      </div>
      {entityType === 'company' && (
        <Field label="Company name" htmlFor="nc-company"><input id="nc-company" className="gx-inp" value={companyName} onChange={e => setCompanyName(e.target.value)} /></Field>
      )}
      {err && <div style={{ marginBottom: 10 }}><Callout tone="bad">{err}</Callout></div>}
      <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create customer'}</Btn>
    </Card>
  );
}

function SumRow({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--ms-surface-3)', fontSize: 11.5 }}>
      <span style={{ color: 'var(--ms-ink-3)' }}>{k}</span>
      <span style={{ fontWeight: strong ? 800 : 600, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NewContractPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qUnitId     = searchParams.get('unitId')     ?? '';
  const qTenantId   = searchParams.get('tenantId')   ?? '';
  const qTenantName = searchParams.get('tenantName') ? decodeURIComponent(searchParams.get('tenantName')!) : '';
  const qStartDate  = searchParams.get('startDate')  ?? '';
  const qLeadId     = searchParams.get('leadId')     ?? '';
  const qChequeCount = searchParams.get('chequeCount') ?? '';
  // Context-aware endpoints: manager (re-export) goes via the manager routes + ?rp;
  // the RP uses its own.
  const pathname = usePathname();
  const isManager = (pathname ?? '').startsWith('/dashboard/manager');
  const rpParam = searchParams.get('rp') ?? '';
  const createTenantUrl = isManager ? `/api/manager/tenants?rp=${rpParam}` : '/api/contracts/tenants';
  const propertiesUrl  = isManager ? '/api/manager/properties' : '/api/properties';
  const tenantsListUrl = isManager ? `/api/manager/tenants/list?rp=${rpParam}` : '/api/contracts/tenants/list';
  const tenantSearchUrl = (q: string) => isManager
    ? `/api/manager/tenants/search?rp=${rpParam}&q=${encodeURIComponent(q)}`
    : `/api/contracts/tenants/search?q=${encodeURIComponent(q)}`;
  const unitsUrl = useCallback((pid: string | number) => isManager
    ? `/api/manager/properties/${pid}/units`
    : `/api/properties/${pid}/units`, [isManager]);
  const submitUrl = isManager ? `/api/manager/contracts?rp=${rpParam}` : '/api/contracts';
  const backHref = isManager ? '/dashboard/manager/contracts' : '/rental-provider/dashboard';
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  // Live plan brought over from the lead (when available) — drives the prefilled amounts
  // AND the cheque schedule preview, so the contract matches what was issued to the tenant.
  const [planFromLead, setPlanFromLead] = useState<LeadPlan | null>(null);

  // Track whether end date was auto-set so we can re-auto when start changes
  const [autoEndDate, setAutoEndDate] = useState(true);

  const [step, setStep] = useState<StepId>('customer');
  const [preferredStartDays, setPreferredStartDays] = useState<number[]>([]);
  // RP's configured cheque days — the schedule preview snaps each due date to the
  // nearest of these, matching what the backend stamps (Settings → Rules).
  const [preferredChequeDays, setPreferredChequeDays] = useState<number[]>([]);
  // Installment plans this RP offers (Settings → Rules). Empty = all allowed.
  const [allowedInstallments, setAllowedInstallments] = useState<number[]>([]);
  // RP's rent-VAT collection mode (Settings → Rules): 'annual' = one Rental VAT
  // cheque for the year, 'installment' = one beside each rent cheque.
  const [rentVatMode, setRentVatMode] = useState<'annual' | 'installment'>('installment');
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoaded, setPropertiesLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitsState, setUnitsState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [unitsReload, setUnitsReload] = useState(0);
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
    adminFee: '',
    ejariFee: '',
    commission: '',
  });

  // Load preferred start / cheque days + instalment counts from the landlord's
  // profile — the manager-aware mirror for a manager, so the same rules apply.
  useEffect(() => {
    fetch(isManager ? `/api/manager/landlord-profile?rp=${rpParam}` : '/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { profile?: { preferredStartDays?: number[] | null; preferredChequeDays?: number[] | null; allowedInstallments?: number[] | null; rentVatMode?: 'annual' | 'installment' | null } } | null) => {
        if (Array.isArray(data?.profile?.preferredStartDays)) {
          setPreferredStartDays(data!.profile!.preferredStartDays!);
        }
        if (Array.isArray(data?.profile?.preferredChequeDays)) {
          setPreferredChequeDays(data!.profile!.preferredChequeDays!);
        }
        if (data?.profile?.rentVatMode === 'annual' || data?.profile?.rentVatMode === 'installment') {
          setRentVatMode(data.profile.rentVatMode);
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

  // Load properties + tenants on mount (and on "Try again"); pre-fill if query params present
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(propertiesUrl, { credentials: 'include' }).then(r => r.json()),
      fetch(tenantsListUrl, { credentials: 'include' }).then(r => r.json()),
    ]).then(([propDataRaw, tenantData]) => {
      if (cancelled) return;
      // Manager properties span all managed landlords — scope to the selected one.
      const propData = (isManager && Array.isArray(propDataRaw) && rpParam)
        ? propDataRaw.filter((p: { rentalProviderId?: number }) => p.rentalProviderId === Number(rpParam))
        : propDataRaw;
      if (Array.isArray(propData)) setProperties(propData);
      setLoadFailed(false);
      setPropertiesLoaded(true);
      if (Array.isArray(tenantData)) {
        const labelled = (tenantData as Tenant[]).map(labelTenant);
        setActiveTenants(labelled);
        // Only try to enrich from list if name wasn't passed via URL
        if (qTenantId && !qTenantName) {
          const found = labelled.find((t) => String(t.id) === qTenantId);
          if (found) {
            setForm(f => ({ ...f, tenantId: String(found.id), tenantName: found.user.name }));
          }
        }
      }
      // Pre-fill unit: fetch the unit to learn its propertyId, then select that property
      // (the units effect then auto-selects ?unitId once that property's units load).
      if (qUnitId && Array.isArray(propData)) {
        fetch(`/api/listings/units/${qUnitId}`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : null)
          .then((data: { unit?: { propertyId?: number } } | null) => {
            const pid = data?.unit?.propertyId;
            if (pid && !cancelled) {
              setUnitsState('loading');
              setForm(f => ({ ...f, propertyId: String(pid), unitId: '' }));
            }
          })
          .catch(() => undefined);
      }
    }).catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // When a leadId is in the URL, fetch the lead and pre-fill from its issued payment plan.
  // This keeps the contract issue page consistent with what the RP issued + the tenant saw.
  useEffect(() => {
    if (!qLeadId) return;
    // Managers read the lead through the manager API (same swap as leads/[id] leadUrl()).
    const leadApi = isManager ? `/api/manager/leads/${qLeadId}?rp=${rpParam}` : `/api/leads/${qLeadId}`;
    fetch(leadApi, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((lead: null | { paymentPlan?: null | LeadPlan }) => {
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
  }, [qLeadId, isManager, rpParam]);

  // Load units when the property changes (the property picker clears the old list);
  // auto-select the ?unitId unit when it belongs to this property.
  useEffect(() => {
    if (!form.propertyId) return;
    let cancelled = false;
    fetch(unitsUrl(form.propertyId), { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const list: Unit[] = Array.isArray(data) ? data : [];
        setUnits(list);
        setUnitsState('ok');
        // Only auto-select if query param matches a unit in this property
        if (qUnitId && list.some((u) => String(u.id) === qUnitId)) {
          setForm(f => ({ ...f, unitId: qUnitId }));
        }
      })
      .catch(() => { if (!cancelled) setUnitsState('error'); });
    return () => { cancelled = true; };
  }, [form.propertyId, qUnitId, unitsUrl, unitsReload]);

  // Prefill the editable one-off fee fields whenever the suggestion changes (unit
  // picked, its units reloaded, or the lead plan arrived) — adjusted during render
  // rather than in an effect. Only blank fields are filled (see prefillFees).
  const selectedUnit = units.find(u => String(u.id) === form.unitId);
  const feeKey = `${form.unitId}|${selectedUnit ? `${selectedUnit.adminFee}|${selectedUnit.ejariFeeFils}|${selectedUnit.commission}` : '-'}|${planFromLead ? `${planFromLead.adminFeeFils}|${planFromLead.ejariFils}|${planFromLead.commissionFils}` : '-'}`;
  const [seenFeeKey, setSeenFeeKey] = useState('');
  if (feeKey !== seenFeeKey) {
    setSeenFeeKey(feeKey);
    if (selectedUnit || planFromLead) setForm(f => prefillFees(f, selectedUnit, planFromLead));
  }

  const changeProperty = (pid: string) => {
    setUnits([]);
    setUnitsState(pid ? 'loading' : 'idle');
    setForm(f => ({ ...f, propertyId: pid, unitId: '' }));
  };

  // When start date changes and end date was auto-set, recalculate end date
  const applyStartDate = (newStart: string) => {
    setForm(f => {
      const newEnd = autoEndDate && newStart ? addMonths(newStart, 12) : f.contractEndDate;
      return { ...f, contractStartDate: newStart, contractEndDate: newEnd };
    });
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAutoEndDate(false); // user manually set end date
    setForm(f => ({ ...f, contractEndDate: e.target.value }));
  };

  // Tenant search with debounce
  const searchTenants = (q: string) => {
    if (!q || q.length < 2) { setTenantResults([]); return; }
    fetch(tenantSearchUrl(q), { credentials: 'include' })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTenantResults((data as Tenant[]).map(labelTenant)); })
      .catch(() => undefined);
  };

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

  const clearTenant = () => {
    setTenantSearch('');
    setForm(f => ({ ...f, tenantId: '', tenantName: '' }));
    setTenantResults([]);
    setTenantDropdownOpen(false);
  };

  const set = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm(f => ({ ...f, [field]: e.target.value }));

  // Apply a duration preset (in months) from start date
  const applyPreset = (months: number) => {
    if (!form.contractStartDate) return;
    setForm(f => ({ ...f, contractEndDate: addMonths(f.contractStartDate, months) }));
  };

  const addClause = () => {
    const trimmed = clauseInput.trim();
    if (trimmed) { setCustomClauses(prev => [...prev, trimmed]); setClauseInput(''); }
  };

  const fail = (msg: string, at: StepId) => { setError(msg); setStep(at); };

  const handleSubmit = async () => {
    setError(null);

    if (!form.unitId) { fail('Please select a unit.', 'unit'); return; }
    if (!form.tenantId) { fail('Please select a customer.', 'customer'); return; }
    if (!form.contractStartDate || !form.contractEndDate) {
      fail('Please fill in contract dates.', 'period'); return;
    }
    const su = units.find(u => String(u.id) === form.unitId);
    const listedRentCheck = Number(su?.rentalPrice ?? 0);
    if (listedRentCheck <= 0) {
      fail('The selected unit has no rental price set. Please update the unit first.', 'unit'); return;
    }

    setSubmitting(true);
    try {
      // If the lead has an issued plan, use those amounts so the contract matches.
      // Otherwise compute from the unit defaults.
      const rentFromUnit = Number(su?.rentalPrice ?? 0);
      const discRawS = Number(form.discountValue) || 0;
      const discAmt = form.discountType === 'percent' ? Math.round(rentFromUnit * discRawS) / 100
                    : form.discountType === 'fixed'   ? Math.min(discRawS, rentFromUnit)
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
          : (form.discountType !== 'none' && discRawS > 0
              ? { listedRent: rentFromUnit, discountType: form.discountType, discountValue: discRawS }
              : {})),
        // The units API serializes numerics as strings ("5600.00") — coerce,
        // or the contracts DTO rejects the whole POST with a 400.
        securityDepositAmount: planFromLead
          ? planFromLead.securityDepositFils / 100
          : su?.securityDeposit != null ? Number(su.securityDeposit) : undefined,
        // One-off fees: send exactly what the RP confirmed in the editable fields
        // (blank = omit → no fee row). Never auto-derived on the backend.
        adminFee:   form.adminFee   !== '' ? Number(form.adminFee)   : undefined,
        ejariFee:   form.ejariFee   !== '' ? Number(form.ejariFee)   : undefined,
        commission: form.commission !== '' ? Number(form.commission) : undefined,
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
      // A new contract is a draft → it belongs in the Operations setup pipeline
      // (the read-only contract "record" page has no workflow actions). Land the
      // user straight on the pipeline so they can issue / send / sign / activate.
      const opsBase = isManager ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations';
      setTimeout(() => router.push(`${opsBase}/${created.id}`), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Live summary calculations (unchanged maths) ──────────────────────────

  const selectedProperty = properties.find(p => String(p.id) === form.propertyId);
  // Prefer the lead's issued payment plan as the source of truth (so the contract matches what
  // the RP shared with the tenant). Fall back to the unit defaults when no plan is supplied.
  const listedRent    = planFromLead ? (planFromLead.rentFils + (planFromLead.discountFils ?? 0)) / 100
                                     : Number(selectedUnit?.rentalPrice ?? 0);
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
  // Editable, RP-confirmed values (prefilled above from the suggestion).
  const adminFee      = Number(form.adminFee)   || 0;
  const ejariFee      = Number(form.ejariFee)   || 0;
  const commission    = Number(form.commission) || 0;
  const installments  = Number(form.numberOfInstallments) || 4;
  const chequeAmount  = installments > 0 ? annualRent / installments : 0;
  // Rent VAT (commercial/industrial = 5%; residential exempt) — collected as separate
  // VAT cheque(s). Read-only preview: the authoritative rate is set on the server at
  // creation via the same effectiveSpaceCategory rule.
  const rentVatable   = selectedUnit ? isRentVatable(selectedUnit.unitType, selectedProperty?.spaceCategory) : false;
  const taxCategory   = selectedUnit ? effectiveSpaceCategory(selectedUnit.unitType, selectedProperty?.spaceCategory) : null;
  const rentVat       = rentVatable ? Math.round(annualRent * 5) / 100 : 0;
  const durationLabel = calcDurationLabel(form.contractStartDate, form.contractEndDate);
  const datesValid    = !!form.contractStartDate && !!form.contractEndDate && durationLabel !== 'Invalid range';
  // Cheque due dates for the preview — spread over the ACTUAL term and snapped to
  // the RP's configured cheque days, exactly as the backend stamps them.
  const previewDueDates = buildInstallmentDueDates(
    form.contractStartDate, form.contractEndDate, installments, preferredChequeDays,
  );

  // Segregated four-group preview (Deposit · Rental Income · Management Fee · Third
  // Party) — the SAME shared view as the contract, receipts, PDFs, lead and edit form.
  // From a lead: mirror the issued plan's exact items (bundle, extras, deposit). Else:
  // even-split the rent with a separate VAT line, matching the contract's own summary.
  const previewSeg = buildSegregatedPlan((() => {
    if (planFromLead) return segRowsFromCustomerPlan(planFromLead);
    const rows: SegPaymentInput[] = [];
    for (let i = 0; i < installments; i++) {
      rows.push({
        paymentType: 'rental_income',
        description: installments > 1 ? `Instalment ${i + 1} of ${installments}` : 'Rent',
        amount: chequeAmount,
        transactionDate: previewDueDates[i] ?? null,
      });
    }
    if (rentVat > 0) rows.push({ paymentType: 'other', description: 'VAT on rent (5%)', amount: rentVat });
    if (secDeposit > 0) rows.push({ paymentType: 'security_deposit', description: 'Security Deposit', amount: secDeposit });
    if (adminFee > 0) rows.push({ paymentType: 'admin_fee', description: 'Admin Fee', amount: adminFee });
    if (commission > 0) rows.push({ paymentType: 'commission', description: 'Commission', amount: commission });
    if (ejariFee > 0) rows.push({ paymentType: 'ejari_fee', description: 'Contract Registration Fee', amount: ejariFee });
    return rows;
  })());

  const taxLabel = selectedUnit
    ? (rentVatable ? `${humanize(taxCategory)} · 5% VAT` : 'Residential · VAT exempt')
    : '—';
  const methodLabel = PAYMENT_METHODS.find(m => m.value === form.modeOfPayment)?.label ?? humanize(form.modeOfPayment);
  const availability = selectedUnit ? (AVAILABILITY[selectedUnit.availability] ?? AVAILABILITY.available) : null;

  // ─── Wizard state ──────────────────────────────────────────────────────────

  const stepIdx = STEPS.findIndex(s => s.id === step);
  const complete: Record<StepId, boolean> = {
    customer: !!form.tenantId,
    unit: !!form.unitId,
    period: datesValid,
    rent: annualRent > 0,
    fees: !!form.unitId && stepIdx > 4,
    clauses: stepIdx > 5,
    review: false,
  };
  const next = STEPS[stepIdx + 1]?.id;
  const prev = STEPS[stepIdx - 1]?.id;

  const checks: { l: React.ReactNode; sub?: React.ReactNode; state: 'pass' | 'fail' | 'wait' }[] = [
    { l: 'Customer selected', sub: form.tenantId ? form.tenantName || `Customer #${form.tenantId}` : 'Choose or create the customer in step 1.', state: form.tenantId ? 'pass' : 'fail' },
    { l: 'Unit selected', sub: selectedUnit ? `${unitLabel(selectedUnit)}${selectedProperty ? ` · ${selectedProperty.buildingName}` : ''}` : 'Choose the property and unit in step 2.', state: selectedUnit ? 'pass' : 'fail' },
    ...(selectedUnit ? [{
      l: 'Unit has a rental price',
      sub: Number(selectedUnit.rentalPrice ?? 0) > 0 ? `${fmtAed(Number(selectedUnit.rentalPrice))} / yr listed` : 'Set the rent on the unit first — the contract cannot be created without it.',
      state: (Number(selectedUnit.rentalPrice ?? 0) > 0 ? 'pass' : 'fail') as 'pass' | 'fail',
    }, {
      l: `Unit availability: ${availability!.label}`,
      sub: selectedUnit.availability === 'available' ? 'The unit is vacant.' : 'Check this unit is free for the new lease period before issuing.',
      state: (selectedUnit.availability === 'available' ? 'pass' : 'wait') as 'pass' | 'wait',
    }] : []),
    {
      l: 'Contract dates',
      sub: !form.contractStartDate || !form.contractEndDate ? 'Set the start and end date in step 3.'
        : datesValid ? `${fmtDate(form.contractStartDate)} → ${fmtDate(form.contractEndDate)} · ${durationLabel}` : 'The end date must be after the start date.',
      state: datesValid ? 'pass' : 'fail',
    },
    {
      l: 'Payment plan',
      sub: planFromLead
        ? `From the issued payment plan on lead #${qLeadId} · ${installments} payment${installments === 1 ? '' : 's'} · ${methodLabel}`
        : `${installments} payment${installments === 1 ? '' : 's'} · ${methodLabel}${annualRent > 0 ? ` · ${fmtAed(chequeAmount)} per cheque` : ''}`,
      state: annualRent > 0 ? 'pass' : 'wait',
    },
    { l: 'Tax treatment', sub: selectedUnit ? `${taxLabel}${rentVat > 0 ? ` · ${fmtAed(rentVat)} VAT on rent, collected as separate cheque(s)` : ''}` : 'Follows the unit type once a unit is chosen.', state: selectedUnit ? 'pass' : 'wait' },
    {
      l: 'Security deposit',
      sub: secDeposit > 0 ? `${fmtAed(secDeposit)} (PDC)` : 'No security deposit on this unit or plan.',
      state: secDeposit > 0 ? 'pass' : 'wait',
    },
    {
      l: 'One-off fees confirmed',
      sub: [adminFee > 0 && `Admin ${fmtAed(adminFee)}`, ejariFee > 0 && `Registration ${fmtAed(ejariFee)}`, commission > 0 && `Commission ${fmtAed(commission)}`]
        .filter(Boolean).join(' · ') || 'No one-off fees will be charged (blank = not charged).',
      state: 'pass',
    },
    ...(customClauses.length > 0 ? [{ l: `${customClauses.length} special clause${customClauses.length === 1 ? '' : 's'}`, state: 'pass' as const }] : []),
  ];
  const blocking = checks.filter(c => c.state === 'fail').length;

  // ─── Success screen ───────────────────────────────────────────────────────

  if (success) {
    return (
      <OsPage>
        <PageHead eyebrow="Operations" title="Contract created" lede="Opening it in the Operations pipeline, where you issue it, collect payments and signatures, and activate the tenancy." />
        <Card pad>
          <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <Loader2 size={15} className="animate-spin" aria-hidden /> Redirecting to the pipeline…
          </div>
        </Card>
      </OsPage>
    );
  }

  const head = (
    <PageHead
      eyebrow="Operations"
      title="New tenancy contract"
      lede="New contracts only — renewals are auto-triggered 90 days before expiry. Creating saves a draft and opens it in the Operations pipeline."
      actions={<Btn href={backHref}>Cancel</Btn>}
    />
  );

  // ─── No properties guard ──────────────────────────────────────────────────

  if (propertiesLoaded && properties.length === 0) {
    return (
      <OsPage>
        {head}
        <Card pad>
          <div className="gx-empty">
            <b>No properties yet</b>
            You need to list a property and add at least one unit before you can create a tenancy contract.
            <div style={{ marginTop: 12 }}><Btn variant="primary" href="/rental-provider/dashboard/portfolio?add=1">List your first property</Btn></div>
          </div>
        </Card>
      </OsPage>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const filteredActive = activeTenants.filter(t =>
    !tenantSearch ||
    t.user.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
    t.user.email.toLowerCase().includes(tenantSearch.toLowerCase())
  );

  return (
    <OsPage>
      {head}
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Spaces · Long-term lease' },
        { label: 'Source', value: qLeadId ? `Lead #${qLeadId}${planFromLead ? ' · issued plan' : ''}` : 'Direct' },
        { label: 'Type', value: 'New contract' },
        ...(isManager ? [{ label: 'Scope', value: `Managed landlord #${rpParam || '—'}` }] : []),
      ]} />

      {loadFailed && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="bad" title="Couldn't load your properties and customers.">
            <span style={{ marginLeft: 6 }}><Btn size="xs" onClick={() => { setLoadFailed(false); setReloadKey(k => k + 1); }}>Try again</Btn></span>
          </Callout>
        </div>
      )}

      <section className="gx-card">
        <div className="gx-wz">
          <nav className="gx-wz-steps" aria-label="New contract steps">
            {STEPS.map((sx, i) => (
              <button key={sx.id} type="button" className={`gx-wz-s${complete[sx.id] ? ' done' : ''}`}
                aria-current={sx.id === step ? 'step' : undefined} onClick={() => setStep(sx.id)}>
                <span className="n">{complete[sx.id] ? '✓' : i + 1}</span>
                <span><span className="t">{sx.t}</span><span className="d">{sx.d}</span></span>
              </button>
            ))}
            <div className="max-[760px]:hidden" style={{ marginTop: 12, padding: '0 8px', fontSize: 10.5, color: 'var(--ms-ink-3)', lineHeight: 1.45 }}>
              Jump to any step. Nothing is saved until you create the contract in the last step.
            </div>
          </nav>

          <div className="gx-wz-main">
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{stepIdx + 1}. {STEPS[stepIdx].t}</h2>
            <p style={{ fontSize: 12, color: 'var(--ms-ink-3)', marginBottom: 14 }}>{STEPS[stepIdx].d}</p>

            {/* 1 · CUSTOMER */}
            {step === 'customer' && (
              qTenantId ? (
                // Tenant passed from the lead — locked card, no search
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', border: '1px solid var(--ms-tint)', background: 'var(--ms-tint-light)', borderRadius: 10 }}>
                    <Thumb text={form.tenantName || '?'} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{form.tenantName || 'Loading…'}</div>
                      <div style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>Customer #{qTenantId}</div>
                    </div>
                    <Pill tone="primary">{qLeadId ? 'Pre-filled from lead' : 'Chosen customer'}</Pill>
                  </div>
                  <div style={{ marginTop: 10 }}><Evid>{qLeadId
                    ? 'The customer comes from the lead and cannot be changed here.'
                    : 'This contract was started for this customer. To pick someone else, start again from Leases › New contract.'}</Evid></div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <Btn size="sm" href="/rental-provider/dashboard/tenants" target="_blank">Add customer (opens Customers)</Btn>
                  </div>
                  <Field label="Search by name or email *" htmlFor="cust-search" hint="Type at least 2 characters to search all your customers.">
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Search size={14} aria-hidden style={{ position: 'absolute', left: 10, color: 'var(--ms-ink-3)' }} />
                        <input id="cust-search" type="text" className="gx-inp" placeholder="Type name or email…" autoComplete="off"
                          style={{ paddingLeft: 30, paddingRight: 30 }} value={tenantSearch}
                          onChange={e => handleTenantInput(e.target.value)}
                          onFocus={() => { if (tenantResults.length > 0) setTenantDropdownOpen(true); }} />
                        {tenantSearch && (
                          <button type="button" className="gx-x" onClick={clearTenant} aria-label="Clear customer" style={{ position: 'absolute', right: 6 }}>
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      {tenantDropdownOpen && tenantResults.length > 0 && (
                        <div role="listbox" aria-label="Matching customers" style={{ position: 'absolute', zIndex: 20, marginTop: 4, width: '100%', background: 'var(--ms-surface)', border: '1px solid var(--ms-border)', borderRadius: 10, boxShadow: 'var(--ms-shadow-lg)', overflow: 'hidden' }}>
                          {tenantResults.map(t => (
                            <button key={t.id} type="button" role="option" aria-selected={String(t.id) === form.tenantId} onClick={() => selectTenant(t)}
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, background: 'transparent', cursor: 'pointer' }}
                              onMouseOver={e => { e.currentTarget.style.background = 'var(--ms-surface-2)'; }}
                              onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}>
                              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{t.user.name}</span>
                              <span style={{ display: 'block', fontSize: 11, color: 'var(--ms-ink-3)' }}>{t.user.email}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Field>

                  {form.tenantId && (
                    <>
                      <Evid tone="ok">Selected: <b>{form.tenantName}</b></Evid>
                      <div className="gx-btn-row" style={{ marginTop: 8 }}>
                        <DocsLinkButton tenantId={Number(form.tenantId)} label="Request documents" />
                        <Btn size="sm" onClick={clearTenant}>Choose a different customer</Btn>
                      </div>
                    </>
                  )}

                  {/* Customer not in the system yet — create one inline */}
                  {!form.tenantId && (
                    showNewCustomer ? (
                      <div style={{ marginTop: 4 }}>
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
                      </div>
                    ) : (
                      <Btn size="sm" onClick={() => setShowNewCustomer(true)}>Customer not listed? Create a new customer</Btn>
                    )
                  )}

                  {/* Active customers quick list */}
                  {!form.tenantId && (
                    <div style={{ marginTop: 14 }}>
                      <div className="gx-lb">Active customers — select one</div>
                      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                        <TableWrap>
                          <table className="gx-tbl">
                            <thead><tr><th>Customer</th><th>Email</th><th className="act" /></tr></thead>
                            {!propertiesLoaded && !loadFailed ? <SkeletonRows rows={3} cols={3} />
                              : loadFailed ? <ErrorRow cols={3} onRetry={() => { setLoadFailed(false); setReloadKey(k => k + 1); }} />
                              : filteredActive.length === 0 ? (
                                <EmptyRow cols={3} title={activeTenants.length === 0 ? 'No active customers yet' : 'No active customer matches'}
                                  text={activeTenants.length === 0 ? 'Create a new customer above.' : 'Try the search above or create a new customer.'} />
                              ) : (
                                <tbody>
                                  {filteredActive.map(t => (
                                    <tr key={t.id} className="click" onClick={() => selectTenant(t)}>
                                      <td className="strong"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Thumb text={t.user.name} />{t.user.name}</span></td>
                                      <td>{t.user.email}</td>
                                      <td className="act"><Btn size="xs" onClick={() => selectTenant(t)}>Select</Btn></td>
                                    </tr>
                                  ))}
                                </tbody>
                              )}
                          </table>
                        </TableWrap>
                      </div>
                    </div>
                  )}
                </>
              )
            )}

            {/* 2 · PROPERTY & UNIT */}
            {step === 'unit' && (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <Field label="Property *" htmlFor="prop-sel">
                      <select id="prop-sel" className="gx-sel" value={form.propertyId} onChange={e => changeProperty(e.target.value)}>
                        <option value="">{propertiesLoaded ? 'Select property…' : 'Loading properties…'}</option>
                        {properties.map(p => <option key={p.id} value={String(p.id)}>{p.buildingName}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div style={{ marginBottom: 13 }}>
                    {form.propertyId
                      ? <Btn size="sm" href={`/rental-provider/dashboard/units?propertyId=${form.propertyId}`} target="_blank">Add unit (new tab)</Btn>
                      : <Btn size="sm" href="/rental-provider/dashboard/portfolio?add=1" target="_blank">List property first (new tab)</Btn>}
                  </div>
                </div>

                <div className="gx-lb">Unit *</div>
                <TableWrap>
                  <table className="gx-tbl">
                    <thead><tr><th>Unit</th><th>Type</th><th className="num">Rent / yr</th><th>Availability</th><th className="act" /></tr></thead>
                    {!form.propertyId ? (
                      <EmptyRow cols={5} title="Select property first" text="Its units appear here." />
                    ) : unitsState === 'loading' ? <SkeletonRows rows={4} cols={5} />
                      : unitsState === 'error' ? <ErrorRow cols={5} onRetry={() => { setUnitsState('loading'); setUnitsReload(n => n + 1); }} />
                      : units.length === 0 ? (
                        <EmptyRow cols={5} title="No units found for this property" text="Use “Add unit” to create one, then come back." />
                      ) : (
                        <tbody>
                          {units.map(u => {
                            const cfg = AVAILABILITY[u.availability] ?? AVAILABILITY.available;
                            const isSelected = form.unitId === String(u.id);
                            return (
                              <tr key={u.id} className="click" onClick={() => setForm(f => ({ ...f, unitId: String(u.id) }))}
                                style={isSelected ? { background: 'var(--ms-tint-light)' } : undefined}>
                                <td className="strong">{unitLabel(u)}{u.unitName ? <span className="sub">{u.unitName}</span> : null}</td>
                                <td>{u.unitType ? humanize(u.unitType) : '—'}</td>
                                <td className="num">{u.rentalPrice != null ? fmtAed(Number(u.rentalPrice)) : '—'}</td>
                                <td><Pill tone={cfg.tone}>{cfg.label}</Pill></td>
                                <td className="act">
                                  <Btn size="xs" variant={isSelected ? 'primary' : undefined} onClick={() => setForm(f => ({ ...f, unitId: String(u.id) }))}>
                                    {isSelected ? 'Selected' : 'Select'}
                                  </Btn>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      )}
                  </table>
                </TableWrap>
                {selectedUnit && Number(selectedUnit.rentalPrice ?? 0) <= 0 && (
                  <div style={{ marginTop: 10 }}><Callout tone="warn" title="No rental price.">This unit has no rent set — update the unit before creating a contract for it.</Callout></div>
                )}
              </>
            )}

            {/* 3 · RENTAL PERIOD */}
            {step === 'period' && (
              <>
                <div className="gx-two">
                  <Field label="Start date *" hint={preferredStartDays.length ? `Your rules allow starts on day ${preferredStartDays.join(', ')} of the month.` : undefined}>
                    <PreferredDayPicker
                      value={form.contractStartDate}
                      preferredDays={preferredStartDays}
                      onChange={applyStartDate}
                      placeholder="Pick start date"
                      inputClassName="rounded-lg border-[#d3dbd5] bg-white py-2 text-sm focus:ring-2 focus:ring-[#047246]"
                    />
                  </Field>
                  <Field label="End date *" htmlFor="end-date" hint={autoEndDate ? 'Set automatically to 12 months from the start until you change it.' : undefined}>
                    <input id="end-date" type="date" className="gx-inp" value={form.contractEndDate} onChange={handleEndDateChange} min={form.contractStartDate} />
                  </Field>
                </div>
                <div className="gx-lb">Quick duration (from start date)</div>
                <div className="gx-chips" role="group" aria-label="Quick duration">
                  {[{ label: '6 months', months: 6 }, { label: '12 months', months: 12 }, { label: '24 months', months: 24 }].map(p => (
                    <button key={p.months} type="button" className="gx-chip" disabled={!form.contractStartDate}
                      aria-pressed={!!form.contractStartDate && form.contractEndDate === addMonths(form.contractStartDate, p.months)}
                      onClick={() => applyPreset(p.months)}>{p.label}</button>
                  ))}
                </div>
                {form.contractStartDate && form.contractEndDate && (
                  <div style={{ marginTop: 12 }}>
                    <Evid tone={datesValid ? 'ok' : 'bad'}>Duration: <b>{durationLabel}</b></Evid>
                  </div>
                )}
              </>
            )}

            {/* 4 · RENT & INSTALMENTS */}
            {step === 'rent' && (
              <>
                {!form.unitId ? (
                  <div style={{ marginBottom: 14 }}>
                    <Callout tone="info" title="Select a unit to see pricing.">
                      <span style={{ marginLeft: 6 }}><Btn size="xs" onClick={() => setStep('unit')}>Choose unit</Btn></span>
                    </Callout>
                  </div>
                ) : (
                  <>
                    <Card title={planFromLead ? 'Pricing (from issued payment plan)' : 'Unit pricing'} pad>
                      <KV items={[
                        {
                          k: 'Annual rent',
                          v: planFromLead?.originalRentFils ? (
                            <>
                              <span style={{ textDecoration: 'line-through', color: 'var(--ms-ink-3)', marginRight: 6 }}>{fmtAed(planFromLead.originalRentFils / 100)}</span>
                              <span style={{ color: 'var(--ms-primary-dark)' }}>{fmtAed(planFromLead.rentFils / 100)}</span>
                              <span style={{ marginLeft: 4, fontSize: 10.5, color: 'var(--ms-primary-dark)', fontWeight: 500 }}>
                                ({planFromLead.discountType === 'percent'
                                  ? `${planFromLead.discountPercent}% off`
                                  : `AED ${((planFromLead.discountFils ?? 0) / 100).toLocaleString('en-AE')} off`})
                              </span>
                            </>
                          ) : (annualRent > 0 ? fmtAed(annualRent) : '—'),
                        },
                        { k: 'Tax treatment', v: taxLabel },
                      ]} />
                    </Card>

                    {/* Discount input — only without a lead plan. With the lead's plan its discount is final and read-only. */}
                    {!planFromLead ? (
                      <div style={{ marginTop: 14 }}>
                        <div className="gx-lb">Discount (optional)</div>
                        <div className="gx-chips" role="group" aria-label="Discount type" style={{ marginBottom: 8 }}>
                          {(['none', 'percent', 'fixed'] as const).map(t => (
                            <button key={t} type="button" className="gx-chip" aria-pressed={form.discountType === t}
                              onClick={() => setForm(f => ({ ...f, discountType: t, discountValue: t === 'none' ? '' : f.discountValue }))}>
                              {t === 'none' ? 'No discount' : t === 'percent' ? '% off' : 'Fixed AED'}
                            </button>
                          ))}
                        </div>
                        {form.discountType !== 'none' && (
                          <Field label={form.discountType === 'percent' ? 'Discount (%)' : 'Discount (AED)'} htmlFor="disc-val">
                            <input id="disc-val" type="number" min="0" step={form.discountType === 'percent' ? '0.1' : '1'} className="gx-inp" style={{ maxWidth: 200 }}
                              value={form.discountValue} onChange={set('discountValue')}
                              placeholder={form.discountType === 'percent' ? 'e.g. 5' : 'e.g. 2000'} />
                          </Field>
                        )}
                        {discountAmt > 0 && listedRent > 0 && (
                          <Card pad>
                            <SumRow k="Listed rent" v={<span style={{ textDecoration: 'line-through', color: 'var(--ms-ink-3)' }}>{fmtAed(listedRent)}</span>} />
                            <SumRow k="Discount" v={<span style={{ color: 'var(--ms-danger)' }}>− {fmtAed(discountAmt)} ({((discountAmt / listedRent) * 100).toFixed(1)}%)</span>} />
                            <SumRow k="Contract value" v={<span style={{ color: 'var(--ms-primary-dark)' }}>{fmtAed(annualRent)}</span>} strong />
                          </Card>
                        )}
                      </div>
                    ) : (
                      <div style={{ marginTop: 14 }}>
                        <Callout tone="info">Discount and pricing come from the issued payment plan. To change them, edit the plan on the lead.</Callout>
                      </div>
                    )}
                  </>
                )}

                <div className="gx-two" style={{ marginTop: 14 }}>
                  <Field label="Payment method" htmlFor="pay-method">
                    <select id="pay-method" className="gx-sel" value={form.modeOfPayment} onChange={set('modeOfPayment')}>
                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Payments / year" htmlFor="pay-count" hint={allowedInstallments.length ? 'Limited to the plans in your Settings → Rules.' : undefined}>
                    <select id="pay-count" className="gx-sel" value={form.numberOfInstallments} onChange={set('numberOfInstallments')}>
                      {allowedInstallmentPlans(allowedInstallments, [Number(form.numberOfInstallments)]).map(p => (
                        <option key={p.value} value={p.value}>{p.longLabel}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* Cheque schedule — the shared segregated four-group view. From a lead it
                    mirrors the issued plan's exact items (bundle, extras, deposit); otherwise
                    it even-splits the rent with a separate VAT line, matching the contract. */}
                {(planFromLead || annualRent > 0) && (
                  <>
                    <div className="gx-lb" style={{ marginTop: 4 }}>Cheque schedule preview</div>
                    <SegregatedPlanView plan={previewSeg} />
                  </>
                )}
              </>
            )}

            {/* 5 · FEES & DEPOSIT */}
            {step === 'fees' && (
              !form.unitId ? (
                <Callout tone="info" title="Select a unit first.">
                  The deposit and fee suggestions come from the unit{qLeadId ? ' or the lead’s plan' : ''}.
                  <span style={{ marginLeft: 6 }}><Btn size="xs" onClick={() => setStep('unit')}>Choose unit</Btn></span>
                </Callout>
              ) : (
                <>
                  <Card title="Security deposit" sub={planFromLead ? 'From the issued payment plan' : 'From the unit'} pad>
                    <KV items={[{ k: 'Security deposit (PDC)', v: secDeposit > 0 ? fmtAed(secDeposit) : '—' }]} />
                  </Card>
                  <div style={{ marginTop: 14 }}>
                    <Card title="One-off fees" sub="AED · Suggested from the unit/lead — edit as needed. Blank means the fee isn’t charged; nothing is auto-added." pad>
                      {/* Lead-driven plans are final, so their fees are read-only. */}
                      {planFromLead ? (
                        <KV items={[
                          { k: 'Admin fee', v: adminFee > 0 ? fmtAed(adminFee) : '—' },
                          { k: 'Contract registration fee', v: ejariFee > 0 ? fmtAed(ejariFee) : '—' },
                          { k: 'Commission', v: commission > 0 ? fmtAed(commission) : '—' },
                        ]} />
                      ) : (
                        <div className="gx-cols gx-cols-3">
                          {([
                            ['Admin fee (AED)', 'adminFee'],
                            ['Contract registration fee (AED)', 'ejariFee'],
                            ['Commission (AED)', 'commission'],
                          ] as [string, 'adminFee' | 'ejariFee' | 'commission'][]).map(([label, key]) => (
                            <Field key={key} label={label} htmlFor={`fee-${key}`}>
                              <input id={`fee-${key}`} type="number" min={0} step="0.01" inputMode="decimal" className="gx-inp"
                                value={form[key]} placeholder="0"
                                onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} />
                            </Field>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                </>
              )
            )}

            {/* 6 · CLAUSES & NOTES */}
            {step === 'clauses' && (
              <>
                <Field label="Special clauses" htmlFor="clause-in" hint="Add custom terms or conditions to append to the contract.">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input id="clause-in" type="text" className="gx-inp" value={clauseInput}
                      onChange={e => setClauseInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addClause(); } }}
                      placeholder="Type a clause and press Enter or click Add…" />
                    <Btn variant="primary" onClick={addClause} disabled={!clauseInput.trim()}>Add clause</Btn>
                  </div>
                </Field>
                {customClauses.length > 0 && (
                  <TableWrap>
                    <table className="gx-tbl">
                      <thead><tr><th style={{ width: 36 }}>#</th><th>Clause</th><th className="act" /></tr></thead>
                      <tbody>
                        {customClauses.map((clause, i) => (
                          <tr key={i}>
                            <td className="mono">{i + 1}</td>
                            <td style={{ whiteSpace: 'normal' }}>{clause}</td>
                            <td className="act"><Btn size="xs" variant="danger" onClick={() => setCustomClauses(prev => prev.filter((_, j) => j !== i))}>Remove</Btn></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
                <div style={{ marginTop: 14 }}>
                  <Field label="Notes" htmlFor="notes">
                    <textarea id="notes" rows={3} className="gx-ta" placeholder="Any additional notes…" value={form.notes} onChange={set('notes')} />
                  </Field>
                </div>
              </>
            )}

            {/* 7 · PREVIEW & CREATE */}
            {step === 'review' && (
              <>
                <div className="gx-lb">Preview &amp; validate</div>
                <Checklist items={checks} />
                <div style={{ marginTop: 12 }}>
                  {blocking === 0
                    ? <Evid tone="ok">Ready to create. The contract is saved as a draft — you issue it to the customer from the Operations pipeline.</Evid>
                    : <Evid tone="warn">{blocking} required item{blocking === 1 ? '' : 's'} missing. Click a step on the left to fix it.</Evid>}
                </div>
                {(planFromLead || annualRent > 0) && (
                  <div style={{ marginTop: 14 }}>
                    <div className="gx-lb">Payment schedule</div>
                    <SegregatedPlanView plan={previewSeg} />
                  </div>
                )}
                <div style={{ marginTop: 14 }}>
                  <Callout tone="warn" title="New contract only.">Renewals are automatically offered to customers 90 days before the contract expires, not created manually.</Callout>
                </div>
                {error && <div style={{ marginTop: 12 }}><Callout tone="bad" title="Not created.">{error}</Callout></div>}
                <div className="gx-btn-row" style={{ marginTop: 14 }}>
                  <Btn variant="primary" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Creating…' : 'Create contract'}</Btn>
                  <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Opens the draft in the Operations pipeline.</span>
                </div>
              </>
            )}

            {/* Errors surface on whichever step validation sent you to */}
            {error && step !== 'review' && <div style={{ marginTop: 12 }}><Callout tone="bad">{error}</Callout></div>}

            {/* footer nav */}
            <div className="gx-btn-row" style={{ marginTop: 18, borderTop: '1px solid var(--ms-surface-3)', paddingTop: 14 }}>
              <Btn href={backHref}>Cancel</Btn>
              <span style={{ flex: 1 }} />
              {prev && <Btn onClick={() => setStep(prev)}>Back</Btn>}
              {next && <Btn variant="primary" onClick={() => setStep(next)}>Continue</Btn>}
            </div>
          </div>

          {/* Live contract summary */}
          <aside className="gx-wz-prev" aria-label="Contract summary">
            <div className="gx-lb" style={{ marginBottom: 8 }}>Contract summary</div>
            <div className="gx-card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Thumb text={form.tenantName || '?'} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.3 }}>{form.tenantName || 'No customer yet'}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>{form.tenantId ? 'Customer selected' : 'Step 1'}</div>
                </div>
              </div>
              <SumRow k="Unit" v={selectedUnit ? unitLabel(selectedUnit) : '—'} />
              {selectedProperty && <SumRow k="Property" v={selectedProperty.buildingName} />}
              <SumRow k="Tax treatment" v={<span style={{ color: rentVatable ? 'var(--ms-amber-text)' : undefined }}>{taxLabel}</span>} />
              <SumRow k="Period" v={form.contractStartDate ? `${form.contractStartDate} → ${form.contractEndDate || '…'}` : '—'} />
              {form.contractStartDate && form.contractEndDate && <SumRow k="Duration" v={durationLabel} />}
              <SumRow k="Annual rent" strong v={annualRent > 0 ? (
                <>
                  {discountAmt > 0 && <span style={{ fontWeight: 400, color: 'var(--ms-ink-3)', textDecoration: 'line-through', marginRight: 5, fontSize: 10.5 }}>{fmtAed(listedRent)}</span>}
                  {fmtAed(annualRent)}
                </>
              ) : '—'} />
              {discountAmt > 0 && <SumRow k="Discount" v={<span style={{ color: 'var(--ms-danger)' }}>− {fmtAed(discountAmt)}</span>} />}
              {annualRent > 0 && <SumRow k={`Per cheque (${installments}×)`} v={<span style={{ color: 'var(--ms-primary-dark)' }}>{fmtAed(chequeAmount)}</span>} />}
              {rentVat > 0 && <SumRow k="VAT on rent (5%)" v={fmtAed(rentVat)} />}
              <SumRow k="Security deposit (PDC)" v={secDeposit > 0 ? fmtAed(secDeposit) : '—'} />
              {adminFee > 0 && <SumRow k="Admin fee" v={fmtAed(adminFee)} />}
              {ejariFee > 0 && <SumRow k="Registration fee" v={fmtAed(ejariFee)} />}
              {commission > 0 && <SumRow k="Commission" v={fmtAed(commission)} />}
              <SumRow k="Payment method" v={methodLabel} />
              <div style={{ marginTop: 10, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <Pill tone="neutral" dot={false}>Draft</Pill>
                {planFromLead && <Pill tone="info" dot={false}>Issued plan</Pill>}
                {availability && <Pill tone={availability.tone}>{availability.label}</Pill>}
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ms-ink-3)', lineHeight: 1.5 }}>
              {checks.filter(c => c.state === 'pass').length} of {checks.length} checks passing
              {rentVatable && <><br />Rent VAT is collected {rentVatMode === 'annual' ? 'as one cheque for the year' : 'beside each rent cheque'} (Settings → Rules).</>}
              <br />New contract only — renewals are auto-offered 90 days before expiry.
            </div>
          </aside>
        </div>
      </section>
    </OsPage>
  );
}
