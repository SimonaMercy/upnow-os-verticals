/**
 * Operations › Long-term leases › Edit tenancy contract — the Genspark wizard
 * (steps left · form centre · live summary right).
 *
 * Operates on an EXISTING contract: prefills every term, keeps the unit fixed, lets
 * the customer be reassigned only before any signature, and lets the RP edit the
 * FULL financial terms + dates, third-party charges, clauses and notes. Saves via
 * PATCH /contracts/:id (audited, no re-sign).
 *
 * Reused by the manager route (/dashboard/manager/contracts/[id]/edit re-exports this
 * default export inside ManagerPermissionGate "Manage Agreements", after resolving ?rp=).
 *
 * Parity with previous page (single-scroll form + summary column; original backed up
 * to the session scratchpad as contracts-edit.orig.tsx):
 *  Data / API (unchanged endpoints + payloads)
 *   [x] GET   /contracts/:id/signatures → customerEditable (no signatures) + signedLocked (any non-on_file method)
 *   [x] GET   /contracts/tenants/list | manager: /manager/tenants/list?rp=   → active customers list
 *   [x] GET   /contracts/tenants/search?q= | manager: /manager/tenants/search?rp=&q= (300 ms debounce)
 *   [x] POST  /api/contracts/tenants | manager: /api/manager/tenants?rp=   → inline "Create a new customer"
 *   [x] GET   /profiles/rental-provider/me (RP only) → allowedInstallments
 *   [x] GET   /contracts/:id → every field (fees from fee rows, falling back to legacy columns; `other`
 *             payment rows → third-party lines, bounced/cancelled dropped, non-pending = locked)
 *   [x] GET   /contracts/:id/addendums · POST /contracts/:id/addendums/from-layout → Agreement Addendum
 *   [x] PATCH /contracts/:id → same body: tenantId (only when editable), contractStartDate/EndDate,
 *             listedRent (2 dp), discountType (null clears) / discountValue, securityDepositAmount, adminFee,
 *             ejariFee (blank = undefined), numberOfInstallments, modeOfPayment, customClauses, notes,
 *             extraCharges (unlocked, described, amount > 0; id = update in place)
 *   [x] Save → `${contractsBase}/:id/v2` (manager: /dashboard/manager/contracts/:id/v2)
 *  Fields / behaviour
 *   [x] Unit + building read-only ("Fixed")
 *   [x] Customer: fixed once signed · "Change" → search + dropdown + clear, active-customers list,
 *       inline new customer, "Done" · "Changed" confirmation when reassigned
 *   [x] Start / end date (min = start; a blank end re-anchors to 12 months) · 6 / 12 / 24-month presets · duration
 *   [x] Listed rent, discount none / % / fixed with Listed → Discount → Net breakdown, VAT on rent at the
 *       contract's rentVatRate (read-only), total incl. VAT
 *   [x] Security deposit, admin fee, contract registration fee, payment method, payments / year
 *       (allowedInstallmentPlans keeping the current value)
 *   [x] SegregatedPlanView preview (same rows: even split dated by chequeDateISO, VAT, deposit, fees,
 *       third-party lines) + "Saving regenerates the cheque schedule…" note
 *   [x] Third-party charges: add (due with the first instalment), edit, remove; derived % lines follow the
 *       net rent (recomputeThirdPartyCharges) and show their hint; recorded lines locked
 *   [x] Custom clauses add (Enter / Add) + remove · notes
 *   [x] Addendum list / attach (hidden for terminated / expired) with error
 *   [x] Validation: signed lock, dates required, end after start, listed rent ≥ 0 (zero = rent-free allowed),
 *       discount must leave rent > 0 · error banner
 *   [x] Signed contract → locked notice + "Back to contract" · loading state · Back (router.back) · Cancel
 *  Added (Genspark): step list, live summary on every step, "Preview & save" checklist from the real form
 *  state, validation jumps to the failing step, a load failure shows a retry instead of an empty form.
 *  Changed on purpose: row actions are labelled ("Remove"), recorded charges show a "Recorded" pill.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { SegregatedPlanView } from '@/components/upnow/SegregatedPlanView';
import { buildSegregatedPlan, type SegPaymentInput } from '@/lib/segregatedPlan';
import { buildInstallmentDueDates } from '@/lib/installmentDates';
import { derivedChargeHint, recomputeThirdPartyCharges } from '@/lib/thirdPartyCharges';
import { tenantDisplayName } from '@/lib/tenantName';
import {
  Btn, Callout, Card, Checklist, EmptyRow, Evid, Field, KV, Locked, OsPage, PageHead, Pill, ScopeStrip,
  StatusTag, TableWrap, Thumb, fmtAed, fmtDate,
} from '@/components/os/kit';

interface Tenant {
  id: number;
  user: { name: string; email: string };
  entityType?: string | null;
  companyName?: string | null;
}

/** The API's user.name is the person. A company customer is labelled by its
 *  company (never the signatory) as tenants load, so the search, the list and
 *  the chosen customer all read the same name. */
function labelTenant(t: Tenant): Tenant {
  return { ...t, user: { ...t.user, name: tenantDisplayName({ name: t.user.name, entityType: t.entityType, companyName: t.companyName }) ?? t.user.name } };
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
      onCreated({ id: d.tenantId, name: tenantDisplayName(d) ?? name.trim() });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to create customer'); }
    finally { setBusy(false); }
  };
  return (
    <Card title="New customer" right={<Btn size="xs" onClick={onCancel}>Cancel</Btn>} pad>
      <div className="gx-two">
        <Field label="Full name *" htmlFor="enc-name"><input id="enc-name" className="gx-inp" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Email *" htmlFor="enc-email"><input id="enc-email" className="gx-inp" type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field label="Phone (optional)" htmlFor="enc-phone"><input id="enc-phone" className="gx-inp" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
        <Field label="Customer type" htmlFor="enc-type">
          <select id="enc-type" className="gx-sel" value={entityType} onChange={e => setEntityType(e.target.value as 'individual' | 'company')}>
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </select>
        </Field>
      </div>
      {entityType === 'company' && (
        <Field label="Company name" htmlFor="enc-company"><input id="enc-company" className="gx-inp" value={companyName} onChange={e => setCompanyName(e.target.value)} /></Field>
      )}
      {err && <div style={{ marginBottom: 10 }}><Callout tone="bad">{err}</Callout></div>}
      <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create customer'}</Btn>
    </Card>
  );
}

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cheque', label: 'Post-Dated Cheques' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online Payment' },
];

function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
/** Due date of cheque i (ISO yyyy-mm-dd) — fed to the shared segregated view so it formats dates itself. */
function chequeDateISO(startDate: string, installments: number, i: number): string | null {
  if (!startDate || !installments) return null;
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Math.round(i * (12 / installments)));
  return d.toISOString().slice(0, 10);
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
  /** Every non-fee payment row. The `other` ones are the third-party charges
   *  (sub-lease charge + its VAT, a labelled "5% VAT on Rent", service charge…)
   *  this form edits as a list. */
  payments?: { id: number; paymentType: string | null; description: string | null; amount: number; chequeStatus: string | null; transactionDate: string | null }[];
  preferredChequeDays?: number[] | null;
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  customClauses?: string[] | null;
  notes?: string | null;
  tenant?: { id?: number | null; name?: string | null } | null;
  unit?: { number?: string | null; name?: string | null } | null;
  property?: { buildingName?: string | null } | null;
}

interface ExtraLine {
  key: string;
  id?: number;
  description: string;
  amount: string;
  dueDate: string;
  locked: boolean;
}

const toDateInput = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
const numStr = (v: number | null | undefined) => (v == null ? '' : String(v));

type StepId = 'parties' | 'period' | 'rent' | 'fees' | 'charges' | 'clauses' | 'addendum' | 'review';
const STEPS: { id: StepId; t: string; d: string }[] = [
  { id: 'parties',  t: 'Unit & customer',     d: 'Unit is fixed; customer until signed' },
  { id: 'period',   t: 'Rental period',       d: 'Start, end and duration' },
  { id: 'rent',     t: 'Rent & instalments',  d: 'Listed rent, discount, payment plan' },
  { id: 'fees',     t: 'Fees & deposit',      d: 'Security deposit and one-off fees' },
  { id: 'charges',  t: 'Third-party charges', d: 'Pass-through amounts on this lease' },
  { id: 'clauses',  t: 'Clauses & notes',     d: 'Special terms on the contract' },
  { id: 'addendum', t: 'Agreement addendum',  d: 'Attach the layout addendum' },
  { id: 'review',   t: 'Preview & save',      d: 'Checklist, then save the changes' },
];

function SumRow({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--ms-surface-3)', fontSize: 11.5 }}>
      <span style={{ color: 'var(--ms-ink-3)' }}>{k}</span>
      <span style={{ fontWeight: strong ? 800 : 600, textAlign: 'right' }}>{v}</span>
    </div>
  );
}

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

  const [step, setStep] = useState<StepId>('parties');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
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
  // Third-party charge lines — seeded from the contract's `other` rows and sent
  // back as `extraCharges`. `id` names the row to update in place; a recorded
  // row (cleared/bounced) is `locked`: shown for the full picture, never edited
  // or sent. The derived lines (sub-lease %, "5% VAT on Rent") follow the net
  // rent as it is typed — see lib/thirdPartyCharges.
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [preferredChequeDays, setPreferredChequeDays] = useState<number[]>([]);
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
      .then((rows) => { if (!cancelled) setActiveTenants(Array.isArray(rows) ? rows.map(labelTenant) : []); })
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
        setLoadError(false);
        setTenantId(c.tenant?.id != null ? String(c.tenant.id) : '');
        setOriginalTenantId(c.tenant?.id != null ? String(c.tenant.id) : '');
        setTenantName(tenantDisplayName(c.tenant) ?? '');
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
        setPreferredChequeDays(Array.isArray(c.preferredChequeDays) ? c.preferredChequeDays : []);
        // Bounced/cancelled rows are history, not charges the lease still bills.
        setExtras((c.payments ?? [])
          .filter((p) => (p.paymentType ?? '') === 'other')
          .filter((p) => !['bounced', 'cancelled'].includes((p.chequeStatus ?? '').toLowerCase()))
          .map((p) => ({
            key: `row-${p.id}`,
            id: p.id,
            description: p.description ?? '',
            amount: p.amount != null ? String(p.amount) : '',
            dueDate: toDateInput(p.transactionDate),
            locked: (p.chequeStatus ?? 'pending').toLowerCase() !== 'pending',
          })));
        setClauses(Array.isArray(c.customClauses) ? c.customClauses : []);
        setNotes(c.notes ?? '');
        setMeta({
          ref: c.ref ?? `CID-${id}`,
          status: c.status ?? null,
          tenant: tenantDisplayName(c.tenant),
          unit: c.unit?.number ? `Unit ${c.unit.number}${c.unit.name ? ` · ${c.unit.name}` : ''}` : (c.unit?.name ?? null),
          building: c.property?.buildingName ?? null,
        });
      })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey]);

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
        setTenantResults(Array.isArray(rows) ? rows.map(labelTenant) : []);
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
  // The 2 dp the backend + the numeric(12,2) columns keep. Everything that
  // validates or SENDS a rent figure uses these, never the raw input.
  const listedAed = Math.round(listedNum * 100) / 100;
  const rentAed = Math.round(rentNum * 100) / 100;
  const inst = Number(installments) || 1;
  const chequeAmount = inst > 0 ? rentNum / inst : 0;
  // Rent VAT (commercial/industrial) is collected as SEPARATE VAT cheque(s), so the
  // rent cheques stay NET. Shown here so the edit form reflects the tax.
  const rentVat = rentVatRate > 0 ? Math.round(rentNum * rentVatRate) / 100 : 0;
  const durationLabel = calcDurationLabel(startDate, endDate);
  const datesValid = !!startDate && !!endDate && new Date(startDate) < new Date(endDate);

  // Keep the derived third-party lines pinned to the net rent as it is edited —
  // adjusted during render when the net rent changes (no effect round-trip).
  // recomputeThirdPartyCharges returns the same array when nothing moved.
  // Flat charges and recorded rows are untouched.
  const [seenRent, setSeenRent] = useState<number | null>(null);
  if (seenRent !== rentNum) {
    setSeenRent(rentNum);
    setExtras((prev) => recomputeThirdPartyCharges(prev, rentNum));
  }

  // New lines fall due with the first rent instalment — the same anchor the
  // backend uses for an undated line and the renewal form uses for carried ones.
  const firstInstalmentDue = buildInstallmentDueDates(startDate, endDate, inst, preferredChequeDays)[0] ?? startDate;
  const addExtra = () => setExtras((p) => [...p, { key: `new-${Date.now()}`, description: '', amount: '', dueDate: firstInstalmentDue, locked: false }]);
  const setExtra = (key: string, k: 'description' | 'amount' | 'dueDate', v: string) =>
    setExtras((p) => p.map((e) => (e.key === key ? { ...e, [k]: v } : e)));
  const removeExtra = (key: string) => setExtras((p) => p.filter((e) => e.key !== key));
  const extrasTotal = extras.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  // Live four-group preview — same segregated view (Deposit · Rent · Management · Third Party)
  // shown on the contract, receipts and lead. Built from the form state so it updates as you type.
  const previewRows: SegPaymentInput[] = [];
  for (let i = 0; i < inst; i++) {
    previewRows.push({
      paymentType: 'rental_income',
      description: inst > 1 ? `Instalment ${i + 1} of ${inst}` : 'Rent',
      amount: chequeAmount,
      transactionDate: chequeDateISO(startDate, inst, i),
    });
  }
  if (rentVat > 0) previewRows.push({ paymentType: 'other', description: `VAT on rent (${rentVatRate}%)`, amount: rentVat });
  if (Number(securityDeposit) > 0) previewRows.push({ paymentType: 'security_deposit', description: 'Security Deposit', amount: Number(securityDeposit) });
  if (Number(adminFee) > 0) previewRows.push({ paymentType: 'admin_fee', description: 'Admin Fee', amount: Number(adminFee) });
  if (Number(ejariFee) > 0) previewRows.push({ paymentType: 'ejari_fee', description: 'Contract Registration Fee', amount: Number(ejariFee) });
  for (const e of extras) {
    if (e.description.trim() && Number(e.amount) > 0) {
      previewRows.push({ paymentType: 'other', description: e.description.trim(), amount: Number(e.amount), transactionDate: e.dueDate || null });
    }
  }
  const previewSeg = buildSegregatedPlan(previewRows);

  const fail = (msg: string, at: StepId) => { setError(msg); setStep(at); };

  const save = async () => {
    setError(null);
    if (signedLocked) { setError('This contract has been signed and can no longer be edited.'); return; }
    if (!startDate || !endDate) { fail('Start and end dates are required.', 'period'); return; }
    if (new Date(startDate) >= new Date(endDate)) { fail('End date must be after the start date.', 'period'); return; }
    // A rent-free tenancy is legitimate — staff accommodation, a grace period —
    // so zero is allowed here. Refusing it is what pushed a landlord to type
    // 0.001 to get a zero past this check (prod, 3 Aug 2026): a sub-cent value
    // clears a bare `> 0`, then stores as 0.00 in a numeric(12,2) column, and
    // the backend's schedule rebuild saw it as positive on the way in and as
    // nothing on the way out — leaving an ACTIVE lease with no cheques at all.
    // Validate the 2 dp that actually get SAVED, and let zero through.
    if (listedAed < 0) { fail('Listed rent cannot be negative.', 'rent'); return; }
    // A discount that cancels the whole rent is a data-entry slip; a genuinely
    // rent-free lease is entered as a zero rent, not as a 100% discount.
    if (discountType !== 'none' && rentAed <= 0) { fail('The discount cannot be equal to or greater than the rent.', 'rent'); return; }
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
        listedRent: listedAed,
        discountType: discountType === 'none' ? null : discountType,
        discountValue: discountType === 'none' ? 0 : discRaw,
        securityDepositAmount: opt(securityDeposit),
        adminFee: opt(adminFee),
        ejariFee: opt(ejariFee),
        numberOfInstallments: Number(installments),
        modeOfPayment,
        customClauses: clauses,
        notes: notes.trim(),
        // The full pending third-party list: rows with an id update in place,
        // new lines insert, pending rows left out are removed. Recorded rows
        // are never sent (and the backend never touches them).
        extraCharges: extras
          .filter((e) => !e.locked)
          .map((e) => ({ id: e.id, description: e.description.trim(), amount: Number(e.amount) || 0, dueDate: e.dueDate || undefined }))
          .filter((e) => e.description && e.amount > 0),
      });
      router.push(`${contractsBase}/${id}/v2`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the contract.');
      setSaving(false);
    }
  };

  // ─── Wizard state + checklist (from the real form state) ──────────────────

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[stepIdx + 1]?.id;
  const prev = STEPS[stepIdx - 1]?.id;
  const discountOk = !(discountType !== 'none' && rentAed <= 0);
  const openExtras = extras.filter((e) => !e.locked);
  const droppedExtras = openExtras.filter((e) => !(e.description.trim() && (Number(e.amount) || 0) > 0)).length;
  const lockedExtras = extras.length - openExtras.length;
  const methodLabel = PAYMENT_METHODS.find((m) => m.value === modeOfPayment)?.label ?? modeOfPayment;
  const customerChanged = tenantId !== originalTenantId;
  const complete: Record<StepId, boolean> = {
    parties: stepIdx > 0,
    period: datesValid,
    rent: listedAed >= 0 && listedRent.trim() !== '' && discountOk,
    fees: stepIdx > 3,
    charges: stepIdx > 4 && droppedExtras === 0,
    clauses: stepIdx > 5,
    addendum: addendums.length > 0,
    review: false,
  };

  const checks: { l: React.ReactNode; sub?: React.ReactNode; state: 'pass' | 'fail' | 'wait' }[] = [
    {
      l: 'Customer',
      sub: !customerEditable ? `${tenantName || meta.tenant || '—'} · fixed (the contract has a signature)`
        : customerChanged ? `Reassigned to ${tenantName || '—'} — saved with this change` : `${tenantName || meta.tenant || '—'} · unchanged`,
      state: tenantId ? 'pass' : 'wait',
    },
    {
      l: 'Contract dates',
      sub: !startDate || !endDate ? 'Start and end dates are required.'
        : datesValid ? `${fmtDate(startDate)} → ${fmtDate(endDate)} · ${durationLabel}` : 'End date must be after the start date.',
      state: datesValid ? 'pass' : 'fail',
    },
    {
      l: 'Rent',
      sub: listedAed < 0 ? 'Listed rent cannot be negative.'
        : !discountOk ? 'The discount cannot be equal to or greater than the rent.'
        : rentAed === 0 ? 'Rent-free lease (AED 0) — allowed; no rent cheques will be scheduled.'
        : `${fmtAed(rentAed)} net${discountAmt > 0 ? ` (listed ${fmtAed(listedAed)} − ${fmtAed(discountAmt)})` : ''} · ${inst} payment${inst === 1 ? '' : 's'} · ${methodLabel}`,
      state: listedAed < 0 || !discountOk ? 'fail' : rentAed === 0 ? 'wait' : 'pass',
    },
    {
      l: 'VAT on rent',
      sub: rentVat > 0 ? `${rentVatRate}% · ${fmtAed(rentVat)}, collected as separate cheque(s). The backend recomputes it on save.` : 'Not VAT-able (residential) — the backend confirms on save.',
      state: 'pass',
    },
    {
      l: 'Third-party charges',
      sub: `${openExtras.length - droppedExtras} line${openExtras.length - droppedExtras === 1 ? '' : 's'} will be saved`
        + (lockedExtras ? ` · ${lockedExtras} recorded line${lockedExtras === 1 ? '' : 's'} kept as is` : '')
        + (droppedExtras ? ` · ${droppedExtras} incomplete line${droppedExtras === 1 ? '' : 's'} (no description or amount) will be dropped` : ''),
      state: droppedExtras ? 'wait' : 'pass',
    },
    {
      l: 'Cheque schedule',
      sub: 'Saving regenerates the cheque schedule — unless a cheque is already recorded (cleared/bounced); then the existing cheques are kept and you adjust them on the contract page.',
      state: 'wait',
    },
    {
      l: 'Agreement addendum',
      sub: addendums.length ? addendums.map((a) => a.name || 'Agreement Addendum').join(', ') : 'None attached (optional).',
      state: addendums.length ? 'pass' : 'wait',
    },
  ];
  const blocking = checks.filter((c) => c.state === 'fail').length;

  const head = (
    <PageHead
      eyebrow="Operations"
      title="Edit tenancy contract"
      lede={<>
        {meta.ref ?? `CID-${id}`}
        {signedLocked
          ? ' — signed, so its terms are locked.'
          : ' — editing terms is recorded in the audit log and does not require re-signing.'}
      </>}
      actions={<>
        {meta.status && <StatusTag status={meta.status} />}
        <Btn onClick={() => router.back()}>Back</Btn>
      </>}
    />
  );

  if (loading) {
    return (
      <OsPage>
        {head}
        <Card pad>
          <div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
            {[70, 55, 85, 40].map((w, i) => <div key={i} className="gx-skel" style={{ height: 14, width: `${w}%` }} />)}
          </div>
        </Card>
      </OsPage>
    );
  }

  if (loadError) {
    return (
      <OsPage>
        {head}
        <Callout tone="bad" title="Could not load this contract.">
          <span className="gx-btn-row" style={{ display: 'inline-flex', marginLeft: 6 }}>
            <Btn size="xs" onClick={() => { setLoading(true); setReloadKey((k) => k + 1); }}>Try again</Btn>
            <Btn size="xs" href={`${contractsBase}/${id}/v2`}>Back to contract</Btn>
          </span>
        </Callout>
      </OsPage>
    );
  }

  if (signedLocked) {
    // Signed → read-only. The Edit affordance is hidden across the app, but a deep
    // link still lands here, so show a clear locked notice instead of a form that
    // the backend would reject on save.
    return (
      <OsPage>
        {head}
        <Locked
          title="Contract is signed"
          text={<>{meta.ref ?? `CID-${id}`} has been signed, so its terms are locked and can no longer be edited. Editing after signing would no longer match the executed agreement.</>}
          actions={<Btn variant="primary" href={`${contractsBase}/${id}/v2`}>Back to contract</Btn>}
        />
      </OsPage>
    );
  }

  const filteredActive = activeTenants.filter((t) => !tenantSearch || t.user.name.toLowerCase().includes(tenantSearch.toLowerCase()) || t.user.email.toLowerCase().includes(tenantSearch.toLowerCase()));

  return (
    <OsPage>
      {head}
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Operations' },
        { label: 'Vertical', value: 'Spaces · Long-term lease' },
        { label: 'Contract', value: meta.ref ?? `CID-${id}` },
        { label: 'Status', value: meta.status ? <StatusTag status={meta.status} /> : '—' },
        ...(isManager ? [{ label: 'Scope', value: `Managed landlord #${rpParam || '—'}` }] : []),
      ]} />

      <section className="gx-card">
        <div className="gx-wz">
          <nav className="gx-wz-steps" aria-label="Edit contract steps">
            {STEPS.map((sx, i) => (
              <button key={sx.id} type="button" className={`gx-wz-s${complete[sx.id] ? ' done' : ''}`}
                aria-current={sx.id === step ? 'step' : undefined} onClick={() => setStep(sx.id)}>
                <span className="n">{complete[sx.id] ? '✓' : i + 1}</span>
                <span><span className="t">{sx.t}</span><span className="d">{sx.d}</span></span>
              </button>
            ))}
            <div className="max-[760px]:hidden" style={{ marginTop: 12, padding: '0 8px', fontSize: 10.5, color: 'var(--ms-ink-3)', lineHeight: 1.45 }}>
              Jump to any step. Changes are saved only when you press “Save changes”.
            </div>
          </nav>

          <div className="gx-wz-main">
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{stepIdx + 1}. {STEPS[stepIdx].t}</h2>
            <p style={{ fontSize: 12, color: 'var(--ms-ink-3)', marginBottom: 14 }}>{STEPS[stepIdx].d}</p>

            {/* 1 · UNIT & CUSTOMER */}
            {step === 'parties' && (
              <>
                <Card title="Property & unit" right={<Pill tone="neutral" dot={false}>Fixed</Pill>} pad>
                  <KV items={[{ k: 'Unit', v: meta.unit ?? '—' }, { k: 'Building', v: meta.building ?? '—' }]} />
                </Card>
                <div style={{ marginTop: 14 }}>
                  <Card title="Customer"
                    right={!customerEditable ? <Pill tone="neutral" dot={false}>Fixed</Pill>
                      : customerChanged && !changingCustomer ? <Pill tone="primary">Changed</Pill>
                      : !changingCustomer ? <Btn size="xs" onClick={() => setChangingCustomer(true)}>Change customer</Btn> : null}
                    pad>
                    {!changingCustomer || !customerEditable ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Thumb text={tenantName || meta.tenant || '?'} />
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{tenantName || meta.tenant || '—'}</div>
                        </div>
                        {!customerEditable && <div style={{ marginTop: 8 }}><Evid>The customer can only be changed before the contract is signed.</Evid></div>}
                      </>
                    ) : (
                      <>
                        <Field label="Search by name or email" htmlFor="ecust-search">
                          <div style={{ position: 'relative' }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                              <Search size={14} aria-hidden style={{ position: 'absolute', left: 10, color: 'var(--ms-ink-3)' }} />
                              <input id="ecust-search" type="text" className="gx-inp" placeholder="Type name or email…" autoComplete="off"
                                style={{ paddingLeft: 30, paddingRight: 30 }} value={tenantSearch}
                                onChange={(e) => handleTenantInput(e.target.value)}
                                onFocus={() => { if (tenantResults.length > 0) setTenantDropdownOpen(true); }} />
                              {tenantSearch && (
                                <button type="button" className="gx-x" aria-label="Clear search" style={{ position: 'absolute', right: 6 }}
                                  onClick={() => { setTenantSearch(''); setTenantResults([]); setTenantDropdownOpen(false); }}>
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                            {tenantDropdownOpen && tenantResults.length > 0 && (
                              <div role="listbox" aria-label="Matching customers" style={{ position: 'absolute', zIndex: 20, marginTop: 4, width: '100%', background: 'var(--ms-surface)', border: '1px solid var(--ms-border)', borderRadius: 10, boxShadow: 'var(--ms-shadow-lg)', overflow: 'hidden' }}>
                                {tenantResults.map((t) => (
                                  <button key={t.id} type="button" role="option" aria-selected={String(t.id) === tenantId} onClick={() => selectTenant(t)}
                                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, background: 'transparent', cursor: 'pointer' }}
                                    onMouseOver={(e) => { e.currentTarget.style.background = 'var(--ms-surface-2)'; }}
                                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{t.user.name}</span>
                                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ms-ink-3)' }}>{t.user.email}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </Field>

                        <Evid tone="ok">Current: <b>{tenantName || '—'}</b></Evid>

                        <div style={{ marginTop: 10 }}>
                          {showNewCustomer ? (
                            <NewCustomerForm createTenantUrl={createTenantUrl} onCancel={() => setShowNewCustomer(false)}
                              onCreated={(t) => selectTenant({ id: t.id, user: { name: t.name, email: '' } })} />
                          ) : (
                            <Btn size="sm" onClick={() => setShowNewCustomer(true)}>Customer not listed? Create a new customer</Btn>
                          )}
                        </div>

                        {activeTenants.length > 0 && !(tenantDropdownOpen && tenantResults.length > 0) && (
                          <div style={{ marginTop: 14 }}>
                            <div className="gx-lb">Active customers — select one</div>
                            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                              <TableWrap>
                                <table className="gx-tbl">
                                  <thead><tr><th>Customer</th><th>Email</th><th className="act" /></tr></thead>
                                  {filteredActive.length === 0 ? (
                                    <EmptyRow cols={3} title="No active customer matches" text="Try the search above or create a new customer." />
                                  ) : (
                                    <tbody>
                                      {filteredActive.map((t) => (
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
                        <div style={{ marginTop: 12 }}><Btn size="sm" onClick={() => setChangingCustomer(false)}>Done</Btn></div>
                      </>
                    )}
                  </Card>
                </div>
              </>
            )}

            {/* 2 · RENTAL PERIOD */}
            {step === 'period' && (
              <>
                <div className="gx-two">
                  <Field label="Start date *" htmlFor="e-start">
                    <input id="e-start" type="date" className="gx-inp" value={startDate} onChange={(e) => applyStartDate(e.target.value)} />
                  </Field>
                  <Field label="End date *" htmlFor="e-end">
                    <input id="e-end" type="date" className="gx-inp" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
                  </Field>
                </div>
                <div className="gx-lb">Quick duration (from start date)</div>
                <div className="gx-chips" role="group" aria-label="Quick duration">
                  {[{ label: '6 months', months: 6 }, { label: '12 months', months: 12 }, { label: '24 months', months: 24 }].map((p) => (
                    <button key={p.months} type="button" className="gx-chip" disabled={!startDate}
                      aria-pressed={!!startDate && endDate === addMonths(startDate, p.months)}
                      onClick={() => applyPreset(p.months)}>{p.label}</button>
                  ))}
                </div>
                {startDate && endDate && (
                  <div style={{ marginTop: 12 }}><Evid tone={datesValid ? 'ok' : 'bad'}>Duration: <b>{durationLabel}</b></Evid></div>
                )}
              </>
            )}

            {/* 3 · RENT & INSTALMENTS */}
            {step === 'rent' && (
              <>
                <div className="gx-two">
                  <Field label="Listed rent (AED) *" htmlFor="e-listed" hint="Zero is allowed for a rent-free lease.">
                    <input id="e-listed" type="number" min={0} className="gx-inp" value={listedRent} onChange={(e) => setListedRent(e.target.value)} />
                  </Field>
                  <div>
                    <div className="gx-lb">Discount (optional)</div>
                    <div className="gx-chips" role="group" aria-label="Discount type" style={{ marginBottom: 8 }}>
                      {(['none', 'percent', 'fixed'] as const).map((t) => (
                        <button key={t} type="button" className="gx-chip" aria-pressed={discountType === t}
                          onClick={() => { setDiscountType(t); if (t === 'none') setDiscountValue(''); }}>
                          {t === 'none' ? 'None' : t === 'percent' ? '% off' : 'Fixed AED'}
                        </button>
                      ))}
                    </div>
                    {discountType !== 'none' && (
                      <Field label={discountType === 'percent' ? 'Discount (%)' : 'Discount (AED)'} htmlFor="e-disc">
                        <input id="e-disc" type="number" min={0} step={discountType === 'percent' ? 0.1 : 1} className="gx-inp"
                          value={discountValue} onChange={(e) => setDiscountValue(e.target.value)}
                          placeholder={discountType === 'percent' ? 'e.g. 5' : 'e.g. 2000'} />
                      </Field>
                    )}
                  </div>
                </div>

                {/* Discount (rent line only) → live Listed → Discount → Net breakdown */}
                <Card pad>
                  <SumRow k="Listed rent" v={<span style={discountAmt > 0 ? { textDecoration: 'line-through', color: 'var(--ms-ink-3)' } : undefined}>{listedNum > 0 ? fmtAed(listedNum) : '—'}</span>} />
                  {discountAmt > 0 && (
                    <SumRow k="Discount" v={<span style={{ color: 'var(--ms-danger)' }}>− {fmtAed(discountAmt)} ({listedNum > 0 ? ((discountAmt / listedNum) * 100).toFixed(1) : '0'}%)</span>} />
                  )}
                  <SumRow k="Annual rent / Contract value" strong v={<span style={{ color: 'var(--ms-primary-dark)' }}>{rentNum > 0 ? fmtAed(rentNum) : '—'}</span>} />
                  {rentVat > 0 && (
                    <>
                      <SumRow k={`VAT on rent (${rentVatRate}%) · separate cheque`} v={fmtAed(rentVat)} />
                      <SumRow k="Total incl. VAT" v={fmtAed(rentNum + rentVat)} />
                    </>
                  )}
                </Card>

                <div className="gx-two" style={{ marginTop: 14 }}>
                  <Field label="Payment method" htmlFor="e-method">
                    <select id="e-method" className="gx-sel" value={modeOfPayment} onChange={(e) => setModeOfPayment(e.target.value)}>
                      {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Payments / year" htmlFor="e-inst">
                    <select id="e-inst" className="gx-sel" value={installments} onChange={(e) => setInstallments(e.target.value)}>
                      {allowedInstallmentPlans(allowedInstallments, [Number(installments)]).map((p) => (
                        <option key={p.value} value={p.value}>{p.longLabel}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                {/* Cheque schedule preview — segregated four-group view (matches the contract, receipts & lead) */}
                {rentNum > 0 && (
                  <>
                    <div className="gx-lb">Cheque schedule preview</div>
                    <SegregatedPlanView plan={previewSeg} />
                  </>
                )}
                <div style={{ marginTop: 10 }}>
                  <Callout tone="info">
                    Saving regenerates the cheque schedule to match these terms — as long as no cheque has been recorded yet (cleared/bounced). If any payment is already recorded, the existing cheques are kept and you can adjust them on the contract page.
                  </Callout>
                </div>
              </>
            )}

            {/* 4 · FEES & DEPOSIT */}
            {step === 'fees' && (
              <div className="gx-cols gx-cols-3">
                <Field label="Security deposit (AED)" htmlFor="e-dep">
                  <input id="e-dep" type="number" min={0} className="gx-inp" value={securityDeposit} onChange={(e) => setSecurityDeposit(e.target.value)} />
                </Field>
                <Field label="Admin fee (AED)" htmlFor="e-admin">
                  <input id="e-admin" type="number" min={0} className="gx-inp" value={adminFee} onChange={(e) => setAdminFee(e.target.value)} />
                </Field>
                <Field label="Contract registration fee (AED)" htmlFor="e-ejari">
                  <input id="e-ejari" type="number" min={0} className="gx-inp" value={ejariFee} onChange={(e) => setEjariFee(e.target.value)} />
                </Field>
              </div>
            )}

            {/* 5 · THIRD-PARTY CHARGES — the contract's `other` rows, edited as a list */}
            {step === 'charges' && (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                  <p style={{ fontSize: 12, color: 'var(--ms-ink-3)', flex: 1 }}>
                    Pass-through amounts billed with this lease — sub-lease charge, its VAT, VAT on rent recorded as a charge, service charge, parking. Percentage lines follow the net rent automatically.
                  </p>
                  <Btn size="sm" variant="primary" onClick={addExtra}>Add charge</Btn>
                </div>
                <TableWrap>
                  <table className="gx-tbl">
                    <thead><tr><th>Description</th><th style={{ width: 150 }}>Amount (AED)</th><th style={{ width: 160 }}>Due date</th><th className="act" /></tr></thead>
                    {extras.length === 0 ? (
                      <EmptyRow cols={4} title="No third-party charges on this contract." text="Use “Add charge” to bill a service charge, parking or similar with this lease." />
                    ) : (
                      <tbody>
                        {extras.map((e) => {
                          const hint = derivedChargeHint(e.description);
                          const derived = !!hint && !e.locked;
                          return (
                            <tr key={e.key}>
                              <td style={{ whiteSpace: 'normal' }}>
                                {e.locked ? <span>{e.description || '—'}</span> : (
                                  <input aria-label="Charge description" className="gx-inp" value={e.description}
                                    onChange={(ev) => setExtra(e.key, 'description', ev.target.value)} placeholder="e.g. Service Charge" />
                                )}
                                {e.locked ? <span className="sub">Recorded — collected money is kept as is.</span>
                                  : hint ? <span className="sub" style={{ color: 'var(--ms-primary-dark)' }}>Auto · {hint}. Rename the line without a percentage to make it a fixed amount.</span>
                                  : null}
                              </td>
                              <td>
                                {e.locked || derived ? <b>{e.amount ? fmtAed(Number(e.amount)) : '—'}</b> : (
                                  <input aria-label="Charge amount (AED)" type="number" min={0} className="gx-inp" value={e.amount}
                                    onChange={(ev) => setExtra(e.key, 'amount', ev.target.value)} />
                                )}
                              </td>
                              <td>
                                {e.locked ? <span>{e.dueDate ? fmtDate(e.dueDate) : '—'}</span> : (
                                  <input aria-label="Charge due date" type="date" className="gx-inp" value={e.dueDate}
                                    onChange={(ev) => setExtra(e.key, 'dueDate', ev.target.value)} />
                                )}
                              </td>
                              <td className="act">
                                {e.locked ? <Pill tone="neutral" dot={false} title="Recorded — cannot be edited">Recorded</Pill>
                                  : <Btn size="xs" variant="danger" onClick={() => removeExtra(e.key)}>Remove</Btn>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    )}
                  </table>
                </TableWrap>
                {extras.length > 0 && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Total third-party charges: <b>{extrasTotal > 0 ? fmtAed(extrasTotal) : '—'}</b></div>}
              </>
            )}

            {/* 6 · CLAUSES & NOTES */}
            {step === 'clauses' && (
              <>
                <Field label="Custom clauses" htmlFor="e-clause">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input id="e-clause" className="gx-inp" value={clauseInput} onChange={(e) => setClauseInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addClause(); } }}
                      placeholder="Add a clause and press Enter" />
                    <Btn variant="primary" onClick={addClause} disabled={!clauseInput.trim()}>Add clause</Btn>
                  </div>
                </Field>
                {clauses.length > 0 && (
                  <TableWrap>
                    <table className="gx-tbl">
                      <thead><tr><th style={{ width: 36 }}>#</th><th>Clause</th><th className="act" /></tr></thead>
                      <tbody>
                        {clauses.map((cl, i) => (
                          <tr key={i}>
                            <td className="mono">{i + 1}</td>
                            <td style={{ whiteSpace: 'normal' }}>{cl}</td>
                            <td className="act"><Btn size="xs" variant="danger" onClick={() => setClauses((c) => c.filter((_, j) => j !== i))}>Remove</Btn></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                )}
                <div style={{ marginTop: 14 }}>
                  <Field label="Notes" htmlFor="e-notes">
                    <textarea id="e-notes" className="gx-ta" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                </div>
              </>
            )}

            {/* 7 · AGREEMENT ADDENDUM */}
            {step === 'addendum' && (
              addendums.length > 0 ? (
                <TableWrap>
                  <table className="gx-tbl">
                    <thead><tr><th>Addendum</th><th>Status</th></tr></thead>
                    <tbody>
                      {addendums.map((a) => (
                        <tr key={a.id}><td className="strong">{a.name || 'Agreement Addendum'}</td><td><Pill tone="primary">Attached</Pill></td></tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (meta.status === 'terminated' || meta.status === 'expired') ? (
                <Evid>No addendum attached.</Evid>
              ) : (
                <>
                  <p style={{ fontSize: 12.5, color: 'var(--ms-ink-2)', marginBottom: 10 }}>
                    Attach this plan’s Agreement Addendum so it appears on the tenancy agreement. Works on issued and active contracts.
                  </p>
                  {addendumErr && <div style={{ marginBottom: 10 }}><Callout tone="bad">{addendumErr}</Callout></div>}
                  <Btn variant="primary" onClick={attachAddendum} disabled={addendumBusy}>{addendumBusy ? 'Attaching…' : 'Attach Agreement Addendum'}</Btn>
                  <div style={{ marginTop: 10 }}><Evid>Attaching takes effect immediately — it does not wait for “Save changes”.</Evid></div>
                </>
              )
            )}

            {/* 8 · PREVIEW & SAVE */}
            {step === 'review' && (
              <>
                <div className="gx-lb">Preview &amp; validate</div>
                <Checklist items={checks} />
                <div style={{ marginTop: 12 }}>
                  {blocking === 0
                    ? <Evid tone="ok">Ready to save. The change is recorded in the audit log and does not require re-signing.</Evid>
                    : <Evid tone="warn">{blocking} item{blocking === 1 ? '' : 's'} must be fixed before saving. Click a step on the left to fix it.</Evid>}
                </div>
                {rentNum > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="gx-lb">Payment schedule</div>
                    <SegregatedPlanView plan={previewSeg} />
                  </div>
                )}
                {error && <div style={{ marginTop: 12 }}><Callout tone="bad" title="Not saved.">{error}</Callout></div>}
                <div className="gx-btn-row" style={{ marginTop: 14 }}>
                  <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Btn>
                  <Btn href={`${contractsBase}/${id}/v2`}>Cancel</Btn>
                </div>
              </>
            )}

            {error && step !== 'review' && <div style={{ marginTop: 12 }}><Callout tone="bad">{error}</Callout></div>}

            {/* footer nav */}
            <div className="gx-btn-row" style={{ marginTop: 18, borderTop: '1px solid var(--ms-surface-3)', paddingTop: 14 }}>
              <Btn href={`${contractsBase}/${id}/v2`}>Cancel</Btn>
              <span style={{ flex: 1 }} />
              {prev && <Btn onClick={() => setStep(prev)}>Back</Btn>}
              {next && <Btn variant="primary" onClick={() => setStep(next)}>Continue</Btn>}
            </div>
          </div>

          {/* Live summary + save (as on the previous page's side panel) */}
          <aside className="gx-wz-prev" aria-label="Contract summary">
            <div className="gx-lb" style={{ marginBottom: 8 }}>Summary</div>
            <div className="gx-card" style={{ padding: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{meta.unit ?? '—'}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)', marginBottom: 6 }}>{meta.building ?? '—'} · {tenantName || meta.tenant || '—'}</div>
              {discountAmt > 0 && <SumRow k="Listed rent" v={fmtAed(listedNum)} />}
              {discountAmt > 0 && <SumRow k="Discount" v={`− ${fmtAed(discountAmt)}`} />}
              <SumRow k={discountAmt > 0 ? 'Annual rent (net)' : 'Annual rent'} strong v={rentNum > 0 ? fmtAed(rentNum) : '—'} />
              {rentVat > 0 && <SumRow k={`VAT on rent (${rentVatRate}%)`} v={fmtAed(rentVat)} />}
              <SumRow k="Security deposit" v={securityDeposit ? fmtAed(Number(securityDeposit)) : '—'} />
              <SumRow k="Admin fee" v={adminFee ? fmtAed(Number(adminFee)) : '—'} />
              <SumRow k="Contract Registration Fee" v={ejariFee ? fmtAed(Number(ejariFee)) : '—'} />
              <SumRow k="Third-party charges" v={extrasTotal > 0 ? fmtAed(extrasTotal) : '—'} />
              <SumRow k="Payments / year" v={String(inst)} />
              <SumRow k="Per cheque" v={rentNum > 0 ? fmtAed(chequeAmount) : '—'} />
              <SumRow k="Duration" v={durationLabel} />
              <div className="gx-btn-row" style={{ marginTop: 10 }}>
                <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Btn>
                <Btn size="sm" href={`${contractsBase}/${id}/v2`}>Cancel</Btn>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ms-ink-3)', lineHeight: 1.5 }}>
              {checks.filter((c) => c.state === 'pass').length} of {checks.length} checks passing
              {blocking > 0 && <><br /><span style={{ color: 'var(--ms-danger)' }}>{blocking} must be fixed before saving.</span></>}
            </div>
          </aside>
        </div>
      </section>
    </OsPage>
  );
}
