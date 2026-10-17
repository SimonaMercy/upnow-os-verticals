'use client';

/**
 * NewLeadModal — capture a lead from inside the portal, in the order a lead
 * actually arrives:
 *
 *   1 · Who's enquiring   individual or company, then their details
 *   2 · Which unit        the available units, grouped by building
 *   3 · What's next       book it now, or schedule a viewing
 *   4 · Notes             where they came from + anything worth remembering
 *
 * Presented as the full-screen slide-over the property and unit surfaces use
 * (globals.css `.slideover-*` + useSlideOver: swipes in from the right, browser
 * Back closes it, back-arrow left of the title).
 *
 * Each stage asks only what a LEAD needs — the identity documents, KYC and
 * signatures come later in the journey, exactly as they do for a customer who
 * booked on the public site. Stage 3 reuses the public booking controls verbatim
 * so the landlord and the customer are filling in the same thing.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Loader2, CalendarDays, Zap, Search, UserPlus,
  User, Building2, Check, Home, MessageSquare, MapPin, Users, Minus, Plus,
} from 'lucide-react';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { toast } from 'sonner';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { useSlideOver } from '@/lib/useSlideOver';
import { MiniCalendar, TIME_SLOTS, fmtSlot, nextAllowedDate } from '@/components/booking/MiniCalendar';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { UNIT_TYPE_LABELS } from '@/components/upnow/UnitFormModal';
import { tenantDisplayName } from '@/lib/tenantName';

interface PropertyOpt {
  id: number;
  buildingName: string;
  /** Human address line, e.g. "Khalid Bin Al Waleed Rd, Al Raffa". */
  fullAddress?: string | null;
  street?: string | null;
  rentalProviderId?: number;
}
interface UnitOpt {
  id: number;
  propertyId: number;
  unitNumber: string;
  unitType?: string | null;
  floor?: string | null;
  bedrooms: number | null;
  bathrooms?: number | null;
  unitSizeSqft?: string | number | null;
  rentalPrice: number | null;
  availability: 'available' | 'reserved' | 'occupied' | 'maintenance';
}
interface TenantOpt { id: number; user: { name: string | null; email: string }; entityType?: string | null; companyName?: string | null }

/** The API's user.name is the person. A company customer is labelled by its
 *  company (never the signatory) as the list loads, so the search, the list and
 *  the chosen customer all read the same name. */
const labelTenantOpt = (t: TenantOpt): TenantOpt =>
  ({ ...t, user: { ...t.user, name: tenantDisplayName({ name: t.user.name, entityType: t.entityType, companyName: t.companyName }) } });

/** Gross, VAT-inclusive cost of letting the unit — computed server-side so it
 *  matches the lead detail, the customer's booking summary and the plan that
 *  gets generated. All amounts in fils. */
interface CostPreview {
  rentFils: number;
  rentVatFils?: number;
  rentVatRate?: number;
  securityDepositFils?: number;
  adminFeeFils?: number; adminFeeVatFils?: number;
  ejariFils?: number; ejariVatFils?: number;
  commissionFils?: number; commissionVatFils?: number;
  customFees?: Array<{ label: string; netFils: number; vatFils: number }>;
  customFeesFils?: number;
  totalFils: number;
}

const aed = (fils: number) => `AED ${Math.round(fils / 100).toLocaleString()}`;
const aedWhole = (v: number) => `AED ${Math.round(v).toLocaleString()}`;
/** Building names carry stray whitespace from import — never render them raw. */
const clean = (s?: string | null) => (s ?? '').trim();
// Same shape the sign-in form accepts — the customer logs in with this address.
const looksLikeEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s.trim());

/** "2 BR · 2 bath · 1,313 sqft · Floor 1" — whatever of that we actually know. */
function unitSpecLine(u: UnitOpt): string {
  const bits: string[] = [];
  if (u.unitType) bits.push(UNIT_TYPE_LABELS[u.unitType] ?? u.unitType);
  if (u.bedrooms != null) bits.push(u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} BR`);
  if (u.bathrooms != null && u.bathrooms > 0) bits.push(`${u.bathrooms} bath`);
  const sqft = u.unitSizeSqft != null ? Number(u.unitSizeSqft) : NaN;
  if (Number.isFinite(sqft) && sqft > 0) bits.push(`${Math.round(sqft).toLocaleString()} sqft`);
  if (clean(u.floor)) bits.push(`Floor ${clean(u.floor)}`);
  return bits.join(' · ');
}

/**
 * Where the enquiry came from — the one thing the public flow can't tell us.
 *
 * Keys mirror `LEAD_SOURCES` in upnow-backend/src/leads/lead-sources.ts, minus
 * `portal`: the marketplace stamps that one itself and nobody picks it by hand.
 * These keys are what Platform Pulse's "Lead channels" card counts, so an
 * option missing here is a channel that can never appear on the chart.
 */
const SOURCES: [string, string][] = [
  ['walk_in', 'Walk-in'],
  ['phone', 'Phone'],
  ['whatsapp', 'WhatsApp'],
  ['email', 'Email'],
  ['referral', 'Referral'],
  ['agent', 'Agent'],
  ['property_finder', 'Property Finder'],
  ['bayut', 'Bayut'],
  ['dubizzle', 'Dubizzle'],
  ['social_media', 'Social media'],
  ['other', 'Other'],
];

const STAGES = [
  { n: 1, label: 'Customer', icon: User },
  { n: 2, label: 'Unit', icon: Home },
  { n: 3, label: 'Booking', icon: CalendarDays },
  { n: 4, label: 'Notes', icon: MessageSquare },
] as const;

const FIELD = 'w-full text-sm border border-[#e4e9e5] rounded-xl px-3 py-2.5 text-[#14201a] bg-white focus:outline-none focus:ring-2 focus:ring-[#047246]/30';
const LABEL = 'block text-sm font-medium text-[#46534c] mb-1.5';
const CARD = 'bg-white border border-[#e4e9e5] rounded-2xl p-6';
const STAGE_TITLE = 'text-lg font-bold text-[#14201a]';
const STAGE_SUB = 'text-sm text-[#8a948d] mt-0.5 mb-5';
const PILL = (on: boolean) => `py-2 rounded-xl text-xs font-medium border transition-colors cursor-pointer ${
  on ? 'border-[#047246] bg-[#d8efe3] text-[#1a7a5a]' : 'border-[#e4e9e5] text-[#5f6b63] hover:border-[#047246]'
}`;

/** One labelled money line of the payment summary. Zero-value lines are dropped
 *  rather than shown as "AED 0" — a fee the landlord doesn't charge is noise. */
function SummaryRow({ label, hint, fils }: { label: string; hint?: string; fils: number }) {
  if (!fils) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-[#eef1ef]">
      <dt className="text-[#46534c]">
        {label}
        {hint && <span className="block text-[11px] text-[#8a948d]">{hint}</span>}
      </dt>
      <dd className="text-[#14201a] font-medium tabular-nums shrink-0">{aed(fils)}</dd>
    </div>
  );
}

/** The unit the lead is for — what it is, where it is, what it lets for. Stacked,
 *  because it lives in the narrow summary rail on the right. */
function UnitContext({ unit, building, address, onChange }: {
  unit: UnitOpt;
  building: string;
  address: string;
  onChange: () => void;
}) {
  const spec = unitSpecLine(unit);
  return (
    <div className="rounded-xl border border-[#047246] bg-[#edf7f3] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-[#14201a] min-w-0">Unit {unit.unitNumber}</p>
        <button type="button" onClick={onChange} className="text-xs text-[#047246] font-medium cursor-pointer shrink-0">Change</button>
      </div>
      {building && <p className="text-xs text-[#46534c] mt-0.5">{building}</p>}
      {spec && <p className="text-xs text-[#5f6b63] mt-0.5">{spec}</p>}
      {address && (
        <p className="flex items-start gap-1 text-xs text-[#8a948d] mt-0.5">
          <MapPin size={11} className="mt-0.5 shrink-0" />{address}
        </p>
      )}
      {unit.rentalPrice != null && (
        <div className="flex items-baseline justify-between gap-3 mt-2.5 pt-2.5 border-t border-[#c5e8df]">
          <span className="text-xs text-[#5f6b63]">Asking rent</span>
          <span className="text-sm font-bold text-[#1a7a5a] tabular-nums">{aedWhole(Number(unit.rentalPrice))}<span className="font-normal text-[#8a948d]">/yr</span></span>
        </div>
      )}
    </div>
  );
}

export function NewLeadModal({
  manager, preferredStartDays, allowedInstallments, onClose, onCreated,
}: {
  manager?: { rp: number } | null;
  preferredStartDays: number[];
  allowedInstallments: number[];
  onClose: () => void;
  /** Fired after a successful create, with the new lead's id. */
  onCreated: (leadId: number) => void;
}) {
  // Right-to-left slide + browser-Back-to-close, same as the property / unit panels.
  const { closing, dismiss } = useSlideOver(onClose);
  const rp = manager?.rp;

  const propertiesUrl = manager ? '/api/manager/properties' : '/api/properties';
  const unitsUrl = manager ? `/api/manager/properties/units/all?rp=${rp}` : '/api/properties/units/all';
  const tenantsUrl = manager ? `/api/manager/tenants/list?rp=${rp}` : '/api/contracts/tenants/list';
  const submitUrl = manager ? `/api/manager/leads?rp=${rp}` : '/api/leads';
  const costUrl = (uid: string) =>
    manager ? `/api/manager/leads/unit-cost-preview/${uid}?rp=${rp}` : `/api/leads/unit-cost-preview/${uid}`;

  const [stage, setStage] = useState(1);
  const [properties, setProperties] = useState<PropertyOpt[]>([]);
  const [units, setUnits] = useState<UnitOpt[]>([]);
  const [unitsLoaded, setUnitsLoaded] = useState(false);
  const [tenants, setTenants] = useState<TenantOpt[]>([]);

  // 1 · Customer
  const [customerType, setCustomerType] = useState<'individual' | 'company'>('individual');
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pickingExisting, setPickingExisting] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');

  // 2 · Unit
  const [unitId, setUnitId] = useState('');
  const [unitSearch, setUnitSearch] = useState('');
  const [cost, setCost] = useState<CostPreview | null>(null);

  // 3 · Booking
  const [mode, setMode] = useState<'viewing' | 'interested'>('viewing');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('');
  const [moveIn, setMoveIn] = useState(() => nextAllowedDate(preferredStartDays));
  const [installments, setInstallments] = useState('4');

  // 4 · Notes (+ household for a direct booking)
  const [source, setSource] = useState('walk_in');
  const [notes, setNotes] = useState('');
  // Total occupants INCLUDING the customer — the same number the public "Book
  // Now" form asks for. Optional: 1 means nobody else; every extra occupant
  // gets optional Emirates ID / passport / visa slots on the lead's checklist
  // and on the customer's upload link. Residential only.
  const [occupants, setOccupants] = useState(1);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupeLeadId, setDupeLeadId] = useState<number | null>(null);

  useEffect(() => {
    fetch(propertiesUrl, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: PropertyOpt[]) => {
        if (!Array.isArray(data)) return;
        // Manager properties span every landlord they manage — keep the scoped one.
        setProperties(manager ? data.filter(p => p.rentalProviderId === rp) : data);
      })
      .catch(() => undefined);
    fetch(unitsUrl, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: UnitOpt[]) => { if (Array.isArray(data)) setUnits(data); })
      .catch(() => undefined)
      .finally(() => setUnitsLoaded(true));
    fetch(tenantsUrl, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((data: TenantOpt[]) => { if (Array.isArray(data)) setTenants(data.map(labelTenantOpt)); })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snap the default plan to one this landlord offers (Settings → Rules).
  const installmentChoices = useMemo(
    () => allowedInstallmentPlans(allowedInstallments),
    [allowedInstallments],
  );
  useEffect(() => {
    if (installmentChoices.length && !installmentChoices.some(p => String(p.value) === installments)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstallments(String(installmentChoices[0].value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installmentChoices]);

  /** Picking a unit pulls its cost breakdown — the figures the plan will use. */
  function pickUnit(id: string) {
    setUnitId(id);
    setCost(null);
    if (!id) return;
    fetch(costUrl(id), { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: CostPreview | null) => { if (data?.rentFils) setCost(data); })
      .catch(() => undefined);
  }

  const filteredTenants = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    const list = q
      ? tenants.filter(t => `${t.user?.name ?? ''} ${t.user?.email ?? ''}`.toLowerCase().includes(q))
      : tenants;
    return list.slice(0, 20);
  }, [tenants, tenantSearch]);

  // Only units that can actually be let, grouped under their building, keyed by
  // unit NUMBER — the way a landlord refers to them.
  const unitGroups = useMemo(() => {
    const q = unitSearch.trim().toLowerCase();
    const propOf = new Map(properties.map(p => [p.id, p]));
    const groups = new Map<number, { building: string; address: string; units: UnitOpt[] }>();
    for (const u of units) {
      if (u.availability !== 'available') continue;
      const prop = propOf.get(u.propertyId);
      const building = clean(prop?.buildingName) || 'Other building';
      const address = clean(prop?.fullAddress) || clean(prop?.street);
      if (q && !`${building} ${address} ${u.unitNumber}`.toLowerCase().includes(q)) continue;
      if (!groups.has(u.propertyId)) groups.set(u.propertyId, { building, address, units: [] });
      groups.get(u.propertyId)!.units.push(u);
    }
    return [...groups.values()].sort((a, b) => a.building.localeCompare(b.building));
  }, [units, properties, unitSearch]);

  const availableCount = unitGroups.reduce((n, g) => n + g.units.length, 0);
  const selectedUnit = units.find(u => String(u.id) === unitId) ?? null;
  // Unknown type ⇒ treated as residential, same as the customer journey.
  const residential = isResidentialUnitType(selectedUnit?.unitType ?? null);
  const asksOccupants = mode === 'interested' && residential;
  const selectedProperty = selectedUnit
    ? properties.find(p => p.id === selectedUnit.propertyId) ?? null
    : null;
  const selectedBuilding = clean(selectedProperty?.buildingName);
  const selectedAddress = clean(selectedProperty?.fullAddress) || clean(selectedProperty?.street);
  const selectedTenant = tenants.find(t => String(t.id) === tenantId) ?? null;
  const today = new Date().toISOString().slice(0, 10);

  const customerLabel = pickingExisting
    ? (selectedTenant?.user?.name ?? selectedTenant?.user?.email ?? '')
    : (customerType === 'company' ? companyName.trim() : name.trim());

  const stageReady: Record<number, boolean> = {
    1: pickingExisting
      ? !!tenantId
      : !!name.trim() && looksLikeEmail(email) && (customerType === 'individual' || !!companyName.trim()),
    2: !!unitId,
    3: mode === 'viewing' ? !!date : !!moveIn,
    4: true,
  };
  const canCreate = stageReady[1] && stageReady[2] && stageReady[3] && !saving;

  function goTo(next: number) {
    // Only step forward through stages that are complete.
    if (next > stage && !stageReady[stage]) return;
    setError(null);
    setStage(Math.min(4, Math.max(1, next)));
  }

  async function submit() {
    if (!canCreate) return;
    setSaving(true); setError(null); setDupeLeadId(null);
    try {
      const body = {
        unitId: Number(unitId),
        ...(pickingExisting
          ? { tenantId: Number(tenantId) }
          : {
              customerType,
              ...(customerType === 'company' ? { companyName: companyName.trim() } : {}),
              customerName: name.trim(),
              customerEmail: email.trim(),
              ...(phone.trim() ? { customerPhone: phone.trim() } : {}),
            }),
        source,
        mode,
        ...(mode === 'viewing'
          ? { scheduledAt: new Date(`${date}T${time || '10:00'}:00`).toISOString() }
          : { desiredMoveIn: moveIn, paymentsCount: Number(installments), occupantsAdults: residential ? occupants : 1 }),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      const res = await fetch(submitUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409 && data?.leadId) setDupeLeadId(Number(data.leadId));
        const m = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
        throw new Error(m ?? `Could not create the lead (${res.status})`);
      }
      toast.success(mode === 'interested' ? 'Lead created — payment plan ready' : 'Lead created — viewing booked');
      onCreated(Number(data.leadId));
      dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the lead');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={dismiss}
      className={`slideover-scrim${closing ? ' closing' : ''}`}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,25,.46)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', zIndex: 50 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a lead"
        onClick={e => e.stopPropagation()}
        className={`slideover-panel${closing ? ' closing' : ''}`}
        style={{ width: '100%', height: '100dvh', maxHeight: '100dvh', background: '#faf9f7', boxShadow: '0 24px 70px rgba(15,30,22,.30)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* ── Header — back arrow LEFT of the title, as on the property panels ── */}
        <header className="flex items-center gap-3.5 px-6 py-3.5 bg-white border-b border-[#f0ede8] shrink-0">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Back"
            className="w-[34px] h-[34px] shrink-0 rounded-[9px] border border-[#e4e9e5] bg-white flex items-center justify-center text-[#5f6b63] hover:bg-[#eef1ef] hover:text-[#14201a] transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="text-[17px] font-extrabold tracking-[-0.01em] leading-tight text-[#14201a]">Add a Lead</h1>
            <p className="text-xs text-[#8a948d] mt-0.5">
              For an enquiry that came to you directly — a walk-in, a call, a message.
            </p>
          </div>
        </header>

        {/* ── Stage rail ───────────────────────────────────────────────── */}
        <nav className="bg-white border-b border-[#f0ede8] shrink-0">
          <ol className="max-w-[1180px] mx-auto flex items-center gap-2 px-6 py-3">
            {STAGES.map((s, i) => {
              const done = s.n < stage && stageReady[s.n];
              const current = s.n === stage;
              return (
                <li key={s.n} className="flex items-center gap-2 flex-1 last:flex-none">
                  <button
                    type="button"
                    onClick={() => goTo(s.n)}
                    disabled={s.n > stage && !stageReady[stage]}
                    className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-colors ${
                      current ? 'bg-[#d8efe3]' : 'hover:bg-[#eef1ef]'
                    } ${s.n > stage && !stageReady[stage] ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                  >
                    <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                      done ? 'bg-[#047246] text-white'
                        : current ? 'bg-[#047246] text-white'
                        : 'bg-[#eef1ef] text-[#8a948d]'
                    }`}>
                      {done ? <Check size={13} /> : s.n}
                    </span>
                    <span className={`text-xs font-semibold ${current ? 'text-[#1a7a5a]' : done ? 'text-[#14201a]' : 'text-[#8a948d]'}`}>
                      {s.label}
                    </span>
                  </button>
                  {i < STAGES.length - 1 && <span className="flex-1 h-px bg-[#e4e9e5]" />}
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ── Body — the flow on the LEFT, the running summary on the RIGHT ── */}
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[1180px] mx-auto px-6 py-6 grid gap-5 items-start lg:grid-cols-[minmax(0,1fr)_330px]">
            <div className="space-y-4 min-w-0">

            {error && (
              <div className="rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">
                <p>{error}</p>
                {dupeLeadId && (
                  <button
                    type="button"
                    onClick={() => { onCreated(dupeLeadId); dismiss(); }}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-800 hover:underline cursor-pointer"
                  >
                    Open the existing lead <ArrowRight size={12} />
                  </button>
                )}
              </div>
            )}

            {/* ═══ 1 · WHO'S ENQUIRING ═══════════════════════════════════ */}
            {stage === 1 && (
              <section className={CARD}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className={STAGE_TITLE}>Who&apos;s enquiring?</h2>
                    <p className={STAGE_SUB}>Just enough to reach them — documents come later in the journey.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPickingExisting(v => !v); setTenantId(''); }}
                    className="text-xs font-medium text-[#047246] hover:underline cursor-pointer shrink-0 mt-1"
                  >
                    {pickingExisting ? 'Add someone new' : 'Pick an existing customer'}
                  </button>
                </div>

                {pickingExisting ? (
                  selectedTenant ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#047246] bg-[#edf7f3] px-3 py-2.5">
                      <span className="text-sm text-[#14201a] min-w-0 break-words">
                        {selectedTenant.user?.name ?? selectedTenant.user?.email}
                        {selectedTenant.user?.name && <span className="text-[#8a948d]"> · {selectedTenant.user.email}</span>}
                      </span>
                      <button type="button" onClick={() => setTenantId('')} className="text-xs text-[#047246] font-medium cursor-pointer shrink-0">Change</button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8c6c0]" />
                        <input
                          className={`${FIELD} pl-8`}
                          value={tenantSearch}
                          onChange={e => setTenantSearch(e.target.value)}
                          placeholder="Search your customers…"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-xl border border-[#e4e9e5] divide-y divide-[#f0ede8] mt-2">
                        {filteredTenants.length === 0 ? (
                          <p className="px-3 py-3 text-xs text-[#8a948d]">No customer matches — add someone new instead.</p>
                        ) : filteredTenants.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setTenantId(String(t.id))}
                            className="w-full text-left px-3 py-2 hover:bg-[#f9f8f6] cursor-pointer"
                          >
                            <span className="block text-sm text-[#14201a]">{t.user?.name ?? t.user?.email}</span>
                            {t.user?.name && <span className="block text-xs text-[#8a948d]">{t.user.email}</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <label className={LABEL}>Renting as</label>
                    <div className="grid grid-cols-2 gap-2 max-w-md mb-4">
                      {([
                        ['individual', User, 'Individual', 'A person renting in their own name'],
                        ['company', Building2, 'Company', 'A business renting for staff or offices'],
                      ] as const).map(([v, Icon, title, sub]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setCustomerType(v)}
                          className={`text-left px-4 py-3 rounded-xl border-2 transition-all cursor-pointer ${
                            customerType === v ? 'border-[#047246] bg-[#eef7f2]' : 'border-[#e4e9e5] bg-[#f9f8f6] hover:border-[#c5e8df]'
                          }`}
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold text-[#14201a]">
                            <Icon size={14} className={customerType === v ? 'text-[#047246]' : 'text-[#8a948d]'} /> {title}
                          </span>
                          <span className="block text-[11px] text-[#5f6b63] mt-1 leading-snug">{sub}</span>
                        </button>
                      ))}
                    </div>

                    {customerType === 'company' && (
                      <div className="mb-3">
                        <label className={LABEL}>Company name <span className="text-red-500">*</span></label>
                        <input className={`${FIELD} max-w-md`} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Al Mansoori Trading LLC" />
                      </div>
                    )}

                    <label className={LABEL}>
                      {customerType === 'company' ? 'Contact person' : 'Full name'} <span className="text-red-500">*</span>
                    </label>
                    <input className={`${FIELD} max-w-md mb-3`} value={name} onChange={e => setName(e.target.value)} placeholder={customerType === 'company' ? 'Who called on their behalf' : 'Ahmed Al Mansoori'} />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                      <div>
                        <label className={LABEL}>Email <span className="text-red-500">*</span></label>
                        <input className={FIELD} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ahmed@example.com" />
                        {email.trim() && !looksLikeEmail(email) && (
                          <p className="text-xs text-red-600 mt-1">Enter their real email — they sign in with it. No placeholders like “-”.</p>
                        )}
                      </div>
                      <div>
                        <label className={LABEL}>Phone <span className="text-[#8a948d] font-normal">(optional)</span></label>
                        <input className={FIELD} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 50 123 4567" />
                      </div>
                    </div>

                    <p className="flex items-start gap-1.5 text-xs text-[#8a948d] mt-3 max-w-2xl">
                      <UserPlus size={12} className="mt-0.5 shrink-0" />
                      They get a portal account on this email — same as booking on the website — so they can
                      upload documents and payments themselves. An existing account is reused.
                    </p>
                  </>
                )}
              </section>
            )}

            {/* ═══ 2 · WHICH UNIT ════════════════════════════════════════ */}
            {stage === 2 && (
              <section className={CARD}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className={STAGE_TITLE}>Which unit are they after?</h2>
                    <p className={STAGE_SUB}>Your available units, grouped by building.</p>
                  </div>
                  {unitsLoaded && <span className="text-xs text-[#8a948d] shrink-0 mt-1.5">{availableCount} available</span>}
                </div>

                <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8c6c0]" />
                      <input
                        className={`${FIELD} pl-8`}
                        value={unitSearch}
                        onChange={e => setUnitSearch(e.target.value)}
                        placeholder="Search a unit number or building…"
                      />
                </div>
                <div className="max-h-[380px] overflow-y-auto rounded-xl border border-[#e4e9e5] mt-2">
                      {unitGroups.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-[#8a948d]">
                          {!unitsLoaded ? 'Loading your units…'
                            : units.length === 0 ? 'No units on your portfolio yet.'
                            : unitSearch ? 'No available unit matches that search.'
                            : 'No available units right now — every unit is let, reserved or under maintenance.'}
                        </p>
                      ) : unitGroups.map(g => (
                        <div key={g.building}>
                          <div className="sticky top-0 bg-[#f9f8f6] px-3 py-1.5 border-b border-[#f0ede8]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#5f6b63]">{g.building}</p>
                            {g.address && <p className="text-[11px] text-[#8a948d] truncate">{g.address}</p>}
                          </div>
                          {g.units.map(u => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => pickUnit(String(u.id))}
                              className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left border-t border-[#f0ede8] cursor-pointer transition-colors ${
                                unitId === String(u.id) ? 'bg-[#edf7f3]' : 'hover:bg-[#f9f8f6]'
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-[#14201a] truncate">Unit {u.unitNumber}</span>
                                {unitSpecLine(u) && (
                                  <span className="block text-xs text-[#8a948d] truncate mt-0.5">{unitSpecLine(u)}</span>
                                )}
                              </span>
                              <span className="flex items-center gap-3 shrink-0">
                                {u.rentalPrice != null && (
                                  <span className="text-right">
                                    <span className="block text-sm font-medium text-[#14201a] tabular-nums">{aedWhole(Number(u.rentalPrice))}</span>
                                    <span className="block text-[11px] text-[#8a948d]">per year</span>
                                  </span>
                                )}
                                {unitId === String(u.id) && (
                                  <span className="w-5 h-5 rounded-full bg-[#047246] text-white flex items-center justify-center">
                                    <Check size={12} />
                                  </span>
                                )}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                </div>
              </section>
            )}

            {/* ═══ 3 · WHAT'S NEXT ═══════════════════════════════════════ */}
            {stage === 3 && (
              <section className={CARD}>
                <h2 className={STAGE_TITLE}>What happens next?</h2>
                <p className={STAGE_SUB}>Book the unit now, or put a viewing in the diary.</p>


                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                  {([
                    ['interested', Zap, 'Book directly', 'They’ve decided. Generates the payment plan for you to review and share.'],
                    ['viewing', CalendarDays, 'Schedule a viewing', 'They want to see it first. Books the visit and notifies them.'],
                  ] as const).map(([m, Icon, title, sub]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`text-left px-4 py-3 rounded-xl border-2 transition-all cursor-pointer ${
                        mode === m ? 'border-[#047246] bg-[#eef7f2]' : 'border-[#e4e9e5] bg-[#f9f8f6] hover:border-[#c5e8df]'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-[#14201a]">
                        <Icon size={14} className={mode === m ? 'text-[#047246]' : 'text-[#8a948d]'} /> {title}
                      </span>
                      <span className="block text-[11px] text-[#5f6b63] mt-1 leading-snug">{sub}</span>
                    </button>
                  ))}
                </div>

                {mode === 'viewing' ? (
                  /* Date + time — the public "Book a Viewing" controls, across the
                     full width: calendar left, every slot laid out beside it. */
                  <div className="grid gap-6 items-start md:grid-cols-[340px_minmax(0,1fr)]">
                    <div>
                      <label className={LABEL}>
                        <CalendarDays size={14} className="inline mr-1.5" />Pick a date
                      </label>
                      <MiniCalendar value={date} onChange={setDate} />
                      {date && (
                        <p className="mt-2 text-xs text-center font-medium" style={{ color: '#047246' }}>
                          {new Date(date + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className={LABEL}>
                        Preferred time <span className="text-[#8a948d] font-normal">(optional)</span>
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                        {TIME_SLOTS.filter(slot => {
                          if (date !== today) return true;
                          const [h] = slot.split(':').map(Number);
                          return h > new Date().getHours();
                        }).map(slot => (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setTime(time === slot ? '' : slot)}
                            className="w-full py-2.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
                            style={{
                              borderColor: time === slot ? '#047246' : '#e4e9e5',
                              backgroundColor: time === slot ? '#edf7f3' : '#fff',
                              color: time === slot ? '#047246' : '#46534c',
                            }}
                          >
                            {fmtSlot(slot)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Move-in + instalments — the public "Book Now" controls, verbatim */
                  <div className="grid gap-6 items-start md:grid-cols-[340px_minmax(0,1fr)]">
                    <div>
                      <label className={LABEL}>Move-in date <span className="text-red-500">*</span></label>
                      {preferredStartDays.length > 0 && (
                        <p className="text-xs text-[#8a948d] mb-1.5">
                          Contracts start on the {preferredStartDays.map(d => `${d}${['st','nd','rd'][((d % 10) - 1)] || 'th'}`).join(', ')} of the month.
                        </p>
                      )}
                      <MiniCalendar value={moveIn} onChange={setMoveIn} allowedDays={preferredStartDays} />
                      {moveIn && (
                        <p className="mt-2 text-xs text-center font-medium" style={{ color: '#047246' }}>
                          {new Date(moveIn + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' })}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className={LABEL}>Payment installments</label>
                      <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                        {installmentChoices.map(p => (
                          <button key={p.value} type="button" onClick={() => setInstallments(String(p.value))} className={`${PILL(installments === String(p.value))} py-2.5`}>
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-[#8a948d] mt-3 leading-relaxed">
                        The payment plan is generated from this — you review and edit it before sharing it
                        with the customer.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ═══ 4 · NOTES ═════════════════════════════════════════════ */}
            {stage === 4 && (
              <>
                <section className={CARD}>
                  <h2 className={STAGE_TITLE}>Anything worth noting?</h2>
                  <p className={STAGE_SUB}>Kept on the lead and its notes log, so whoever picks it up has the context.</p>

                  <label className={LABEL}>How did they reach you?</label>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4 max-w-2xl">
                    {SOURCES.map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setSource(v)} className={PILL(source === v)}>
                        {l}
                      </button>
                    ))}
                  </div>

                  <label className={LABEL}>Notes <span className="text-[#8a948d] font-normal">(optional)</span></label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={3}
                    placeholder="What they asked for, budget, timing…"
                    className={`${FIELD} resize-none max-w-2xl`}
                  />
                </section>

                {/* Household — direct booking only. The count lands on the viewing
                    (occupants_adults = total incl. the customer) exactly as the
                    public Book Now form stores it; the lead's checklist and the
                    customer upload link then carry optional slots for occupants
                    2..N, and the customer's own journey shows the same slots. */}
                {asksOccupants && (
                  <section className={CARD}>
                    <h2 className={STAGE_TITLE}>Who will live there? <span className="text-[#8a948d] font-normal text-base">(optional)</span></h2>
                    <p className={STAGE_SUB}>Total occupants including the customer. Each extra occupant gets optional Emirates ID, passport and visa slots on the lead&rsquo;s document checklist — nothing becomes mandatory.</p>
                    <div className="inline-flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-[#eef9f4] text-[#047246] flex items-center justify-center shrink-0"><Users size={15} /></span>
                      <div className="inline-flex items-center rounded-full border border-[#e4e9e5] bg-white overflow-hidden">
                        <button type="button" aria-label="Remove an occupant" onClick={() => setOccupants(n => Math.max(1, n - 1))} disabled={occupants <= 1}
                          className="w-9 h-9 flex items-center justify-center text-[#5f6b63] hover:bg-[#eef1ef] disabled:opacity-40 disabled:cursor-not-allowed">
                          <Minus size={14} />
                        </button>
                        <span className="min-w-[2.5rem] text-center text-sm font-semibold text-[#14201a] tabular-nums">{occupants}</span>
                        <button type="button" aria-label="Add an occupant" onClick={() => setOccupants(n => Math.min(12, n + 1))} disabled={occupants >= 12}
                          className="w-9 h-9 flex items-center justify-center text-[#5f6b63] hover:bg-[#eef1ef] disabled:opacity-40 disabled:cursor-not-allowed">
                          <Plus size={14} />
                        </button>
                      </div>
                      <span className="text-sm text-[#5f6b63]">{occupants === 1 ? 'Just the customer' : `${occupants - 1} more ${occupants - 1 === 1 ? 'person' : 'people'} with the customer`}</span>
                    </div>
                  </section>
                )}

                {/* Review — exactly what's about to be created */}
                <section className={CARD}>
                  <h3 className={STAGE_TITLE}>Review</h3>
                  <p className="text-sm text-[#8a948d] mt-0.5 mb-4">Check it over, then create the lead.</p>

                  <dl className="text-sm max-w-2xl">
                    {([
                      [customerType === 'company' && !pickingExisting ? 'Company' : 'Customer', customerLabel || '—'],
                      ...(customerType === 'company' && !pickingExisting
                        ? [['Contact person', name.trim() || '—'] as [string, string]]
                        : []),
                      ...(pickingExisting ? [] : [['Email', email.trim() || '—'] as [string, string]]),
                      ...(!pickingExisting && phone.trim() ? [['Phone', phone.trim()] as [string, string]] : []),
                      ['Enters the pipeline at', mode === 'viewing' ? 'Viewing scheduled' : 'Interested — payment plan generated'],
                      [mode === 'viewing' ? 'Viewing' : 'Move-in',
                        mode === 'viewing'
                          ? `${new Date(date + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${time ? ` · ${fmtSlot(time)}` : ' · time not set'}`
                          : (moveIn ? new Date(moveIn + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—')],
                      ...(mode === 'interested'
                        ? [['Payment plan', `${installments} payment${installments === '1' ? '' : 's'} per year`] as [string, string]]
                        : []),
                      ...(asksOccupants
                        ? [['Occupants', occupants === 1 ? '1 · just the customer' : `${occupants} incl. the customer`] as [string, string]]
                        : []),
                      ['Enquiry source', SOURCES.find(([v]) => v === source)?.[1] ?? source],
                    ] as [string, string][]).map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-6 py-2 border-b border-[#eef1ef]">
                        <dt className="text-[#8a948d] shrink-0">{k}</dt>
                        <dd className="text-[#14201a] font-medium text-right break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </>
            )}
            </div>

            {/* ── Right rail — the unit and what it costs, from the moment a unit
                   is chosen. Sticks while the left column is filled in. ────── */}
            <aside className="lg:sticky lg:top-0 space-y-4">
              {selectedUnit ? (
                <>
                  <UnitContext
                    unit={selectedUnit}
                    building={selectedBuilding}
                    address={selectedAddress}
                    onChange={() => goTo(2)}
                  />

                  {cost && (
                    <section className="bg-white border border-[#e4e9e5] rounded-2xl p-5">
                      <h3 className="text-sm font-bold text-[#14201a]">Payment summary</h3>
                      <p className="text-[11px] text-[#8a948d] mt-0.5 mb-3">First year, at the asking rent</p>

                      <dl className="text-[13px]">
                        <SummaryRow label="Annual rent" fils={cost.rentFils} />
                        {(cost.rentVatFils ?? 0) > 0 && (
                          <SummaryRow label={`VAT on rent (${cost.rentVatRate}%)`} fils={cost.rentVatFils!} />
                        )}
                        <SummaryRow label="Security deposit" hint="Refundable at move-out" fils={cost.securityDepositFils ?? 0} />
                        <SummaryRow label="Admin fee" fils={(cost.adminFeeFils ?? 0) + (cost.adminFeeVatFils ?? 0)} />
                        <SummaryRow label="Contract registration" hint="Ejari" fils={(cost.ejariFils ?? 0) + (cost.ejariVatFils ?? 0)} />
                        <SummaryRow label="Commission" fils={(cost.commissionFils ?? 0) + (cost.commissionVatFils ?? 0)} />
                        {(cost.customFees ?? []).map(f => (
                          <SummaryRow key={f.label} label={f.label} fils={f.netFils + f.vatFils} />
                        ))}
                      </dl>

                      <div className="flex items-baseline justify-between gap-3 mt-3 pt-3 border-t-2 border-[#e4e9e5]">
                        <div>
                          <p className="text-[13px] font-semibold text-[#14201a]">Total payable</p>
                          <p className="text-[11px] text-[#8a948d]">VAT included</p>
                        </div>
                        <p className="text-lg font-bold text-[#1a7a5a] tabular-nums">{aed(cost.totalFils)}</p>
                      </div>

                      {stage >= 3 && mode === 'interested' && (
                        <p className="text-[11px] text-[#8a948d] mt-3 leading-relaxed">
                          Rent split across {installments} payment{installments === '1' ? '' : 's'};
                          the deposit and fees come with the first. Editable on the lead before you share it.
                        </p>
                      )}
                    </section>
                  )}
                </>
              ) : (
                stage >= 2 && (
                  <div className="rounded-2xl border border-dashed border-[#e4e9e5] px-5 py-6 text-center">
                    <Home size={18} className="mx-auto text-[#c8c6c0]" />
                    <p className="text-xs text-[#8a948d] mt-2">
                      Pick a unit and its payment summary appears here.
                    </p>
                  </div>
                )
              )}
            </aside>
          </div>
        </main>

        {/* ── Footer — stage navigation. Actions sit on the RIGHT; the bottom-left
            corner belongs to the app's floating support bubble. ────────── */}
        <footer className="flex items-center justify-end gap-3 px-6 py-3.5 bg-white border-t border-[#f0ede8] shrink-0">
          <button
            type="button"
            onClick={() => (stage === 1 ? dismiss() : goTo(stage - 1))}
            className="text-sm font-bold text-[#5f6b63] hover:text-[#14201a] px-3 py-2.5 cursor-pointer"
          >
            {stage === 1 ? 'Cancel' : 'Back'}
          </button>
          {stage < 4 ? (
            <button
              type="button"
              disabled={!stageReady[stage]}
              onClick={() => goTo(stage + 1)}
              className="inline-flex items-center gap-2 text-sm font-bold text-white bg-[#047246] rounded-[11px] px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:opacity-90 transition-opacity"
              style={{ boxShadow: '0 6px 16px rgba(4,114,70,.26)' }}
            >
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              disabled={!canCreate}
              onClick={submit}
              className="inline-flex items-center gap-2 text-sm font-bold text-white bg-[#047246] rounded-[11px] px-6 py-3 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:opacity-90 transition-opacity"
              style={{ boxShadow: '0 6px 16px rgba(4,114,70,.26)' }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Creating…' : mode === 'viewing' ? 'Create Lead & Book Viewing' : 'Create Lead & Build Plan'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
