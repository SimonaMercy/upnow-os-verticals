'use client';

/**
 * LayoutFinancialsModal — plan-wide pricing & financial-details editor.
 *
 * Extracted from the Units & Pricing page so both that workspace AND the
 * portfolio Property View (its Unit Mix table) can open the SAME editor: one
 * place to set the annual rent + deposit/fees + lease terms + Agreement
 * addendum, written through to every unit on a layout (the "plan → all units"
 * model). The RP portal calls the `/properties/floor-plans/*` endpoints; the
 * Manager portal passes `manager={{ rp }}` + `rpQ` to hit the landlord-scoped
 * `/manager/units/*` endpoints (edits are additionally gated server-side).
 *
 *   Price:  PATCH /properties/floor-plans/price       { propertyId, planLabel, rentalPrice }
 *   Fees:   PATCH /properties/floor-plans/financials  { propertyId, planLabel, …fees }
 *   Terms:  PATCH /properties/floor-plans/lease-terms { propertyId, planLabel, …terms }
 */
import { useEffect, useState } from 'react';
import { Loader2, Check, X, Pencil, Eye, Star } from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import AddendumEditorModal from '@/components/upnow/AddendumEditorModal';
import AddendumPreviewModal from '@/components/upnow/AddendumPreviewModal';
import AddendumTemplatePicker from '@/components/upnow/AddendumTemplatePicker';
import { type AddendumTerms, emptyAddendumTerms, hasAddendumTerms } from '@/lib/addendumTerms';
import { UNIT_TYPE_LABELS } from '@/components/upnow/UnitFormModal';
import { categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { feeFromRules, type FeeRuleLite } from '@/lib/feeRules';
import ds from '@/components/upnow/unitForm.module.css';
import { useBackClose } from '@/lib/useSlideOver';

/** Tiny class-name joiner (drops falsy values). */
const dcx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const bedLabel = (b: number | null) => (b == null ? 'Unit' : b === 0 ? 'Studio' : `${b} Bed`);
const sizeLabel = (a: number | null | undefined, b: number | null | undefined) => {
  const lo = a || b, hi = b || a;
  if (!lo || !hi) return '—';
  return lo === hi ? lo.toLocaleString() : `${lo.toLocaleString()} – ${hi.toLocaleString()}`;
};
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }) : '';

/**
 * One layout (units grouped by plan_label) with the aggregates the pricing
 * workspace and the Unit Mix table both render. Returned by
 * GET /properties/floor-plans (and /manager/units).
 */
export interface Plan {
  displayName: string;
  planLabel: string;
  propertyId: number;
  buildingName: string;
  spaceCategory: string | null;
  unitType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqftMin: number; sqftMax: number; sqmMin: number; sqmMax: number; avgSqft: number | null;
  priceFrom: number | null;            // asking-rent "from"
  rentFrom: number | null; rentTo: number | null;
  // Asking-rent total across the layout's units (sum of every unit's price).
  rentSum?: number | null;
  // Contracted Annual Rent range + total (latest lease per leased unit on the
  // plan) — pairs with rentFrom/rentTo (asking) the way portfolio pairs Market
  // Price with Annual Rent. All null when nothing on the plan has ever leased.
  annualRentFrom?: number | null; annualRentTo?: number | null; annualRentSum?: number | null; leasedCount?: number;
  aedPerSqft: number | null;
  // representative financial details for the layout (editable plan-wide)
  securityDeposit: number | null; adminFee: number | null; ejariFee: number | null;
  commission: number | null; serviceCharges: number | null;
  // current plan-wide lease terms (from the units' facilities JSON)
  leaseTerms: LeaseTerms | null;
  // latest Agreement addendum version for the layout (file-based)
  termsVersion: {
    id: number; versionNo: number; effectiveAt: string; versionsCount: number;
    addendumUrl: string | null; addendumFileName: string | null;
    addendumTerms?: AddendumTerms | null;
  } | null;
  unpricedCount: number;
  unitCount: number;
  sampleUnitId: number;
  floorPlanUrl: string | null;
  flags: string[];
}
export interface LeaseTerms {
  minLeaseMonths?: number; noticePeriodDays?: number; rentEscalationPct?: number;
  rentalType?: string; numberOfPayments?: number; advancePayment?: number;
  gracePeriodDays?: number; latePaymentFee?: number;
}
export interface TermsVersion {
  id: number; versionNo: number; effectiveAt: string; contractsCount: number;
  addendumUrl: string | null; addendumFileName: string | null;
}
// The RP's default addendum template suggested for a layout with no addendum yet.
interface AddendumDefault {
  id: number; name: string; fileName: string; fileUrl: string | null;
  mimeType: string; source: 'subcategory' | 'category';
}
interface AddendumDefaultResp {
  template: AddendumDefault | null;
  category: string | null;
  unitType: string | null;
}

// Plan-wide pricing & financial-details editor — one place to set the price
// AND the deposit/fees/service charges, written to every unit on the layout
// (the "plan → all units" model).
const FIN_FIELDS = [
  { key: 'securityDeposit', label: 'Security Deposit' },
  { key: 'adminFee',        label: 'Admin Fee' },
  { key: 'ejariFee',        label: 'Contract Registration Fee' },
  { key: 'commission',      label: 'Commission' },
  { key: 'serviceCharges',  label: 'Service Charges (AED/yr)' },
] as const;

// Lease terms + leasing configuration — also plan-wide, written to every unit's
// facilities JSON. Labels mirror the per-unit form (UnitFormModal) verbatim so
// the two editors look identical.
const LEASE_TERM_FIELDS = [
  { key: 'minLeaseMonths',    label: 'Min. Lease (months)',    placeholder: '12', step: '1',   max: undefined as number | undefined },
  { key: 'noticePeriodDays',  label: 'Notice Period (days)',   placeholder: '60', step: '1',   max: undefined },
  { key: 'rentEscalationPct', label: 'Rent Escalation (%/yr)', placeholder: 'e.g. 5', step: '0.5', max: 100 },
] as const;
const LEASE_CONFIG_FIELDS = [
  { key: 'numberOfPayments', label: 'Number of Payments', placeholder: 'e.g. 4 cheques', step: '1',   max: undefined as number | undefined },
  { key: 'advancePayment',   label: 'Advance Payment (AED)', placeholder: 'e.g. 5000',  step: 'any', max: undefined },
  { key: 'gracePeriodDays',  label: 'Grace Period (days)',   placeholder: 'e.g. 7',     step: '1',   max: undefined },
  { key: 'latePaymentFee',   label: 'Late Payment Fee (AED)', placeholder: 'e.g. 500',  step: 'any', max: undefined },
] as const;
// Every numeric lease key the editor manages (validation + save).
const LEASE_NUM_KEYS = [...LEASE_TERM_FIELDS, ...LEASE_CONFIG_FIELDS] as readonly { key: string; label: string }[];
const RENTAL_TYPES = [
  { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' }, { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' }, { id: 'custom', label: 'Custom' },
];

export function LayoutFinancialsModal({ plan, manager, rpQ, feeRules, onClose, onSaved }: {
  plan: Plan; manager?: { rp: number }; rpQ: string;
  feeRules: Record<string, FeeRuleLite[]> | null;
  onClose: () => void; onSaved: () => void;
}) {
  // Browser Back closes this full-screen editor instead of navigating away; the
  // overlay / close (X) / Cancel route through the same path. See useBackClose.
  const dismiss = useBackClose(onClose);
  // The fee rules for this layout's space category (fallback: residential).
  const rules = (plan.spaceCategory && feeRules?.[plan.spaceCategory]) || feeRules?.residential;
  // Fees driven by a rule (default off the rent); service charges has no rule.
  const RULE_KEYS = ['securityDeposit', 'adminFee', 'ejariFee', 'commission'];

  // Rule-defaulted value for a fee key at a given rent (string for the input).
  const ruleDefault = (key: string, rent: number): string => {
    const v = feeFromRules(rules, key, rent);
    if (v != null) return String(v);
    const stored = plan[key as keyof Plan] as number | null; // fall back to stored
    return stored != null ? String(stored) : '';
  };

  const initRent = plan.rentFrom ?? 0;
  const [vals, setVals] = useState<Record<string, string>>(() => ({
    rentalPrice: plan.rentFrom != null ? String(plan.rentFrom) : '',
    securityDeposit: ruleDefault('securityDeposit', initRent),
    adminFee:        ruleDefault('adminFee', initRent),
    ejariFee:        ruleDefault('ejariFee', initRent),
    commission:      ruleDefault('commission', initRent),
    serviceCharges:  plan.serviceCharges != null ? String(plan.serviceCharges) : '',
  }));
  // Fee keys the user has overridden — these stop auto-recomputing off the rent.
  const [overridden, setOverridden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Lease terms + leasing configuration (plan-wide), seeded from current values.
  const lt = plan.leaseTerms ?? {};
  const [lease, setLease] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of LEASE_NUM_KEYS) {
      const v = (lt as Record<string, number | undefined>)[f.key];
      seed[f.key] = v != null ? String(v) : '';
    }
    return seed;
  });
  const [rentalType, setRentalType] = useState<string>(lt.rentalType || 'yearly');
  // Agreement addendum — authored IN-APP as bilingual terms (mints a new version
  // on save), seeded from the layout's current text version. File uploads retired.
  const seededTermsJson = JSON.stringify(plan.termsVersion?.addendumTerms ?? emptyAddendumTerms());
  const [addendumTerms, setAddendumTerms] = useState<AddendumTerms>(
    () => plan.termsVersion?.addendumTerms ?? emptyAddendumTerms(),
  );
  const [addendumErr, setAddendumErr] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<TermsVersion[] | null>(null);
  const [verLoading, setVerLoading] = useState(false);

  // Pre-fill suggestion: when the layout has no addendum yet, offer the RP's
  // default template for this property category / unit type (sub-category first,
  // else category). The RP can accept it or upload their own instead.
  const hasAddendum = !!(plan.termsVersion?.addendumUrl
    || (plan.termsVersion?.addendumTerms && hasAddendumTerms(plan.termsVersion.addendumTerms)));
  const [defaultResp, setDefaultResp] = useState<AddendumDefaultResp | null>(null);
  const suggested = defaultResp?.template ?? null;
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    if (hasAddendum) return;
    let live = true;
    const qs = new URLSearchParams({ propertyId: String(plan.propertyId), planLabel: plan.planLabel });
    const url = manager
      ? `/manager/units/addendum-default?${[rpQ, qs.toString()].filter(Boolean).join('&')}`
      : `/properties/floor-plans/addendum-default?${qs.toString()}`;
    apiGet<AddendumDefaultResp>(url)
      .then(r => { if (live) setDefaultResp(r); })
      .catch(() => { if (live) setDefaultResp(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Commercial › Retail Shop" / "Commercial" — the category/sub-category this default matched.
  const suggestedScope = defaultResp && (() => {
    const cat = categoryDisplayLabel(defaultResp.category);
    return defaultResp.unitType ? `${cat} › ${UNIT_TYPE_LABELS[defaultResp.unitType] ?? defaultResp.unitType}` : cat;
  })();

  const useDefault = async () => {
    if (!suggested) return;
    setApplying(true); setAddendumErr(null);
    try {
      const url = manager
        ? `/manager/units/addendum/from-template?${rpQ}`
        : '/properties/floor-plans/addendum/from-template';
      await apiPost(url, { propertyId: plan.propertyId, planLabel: plan.planLabel, templateId: suggested.id });
      onSaved();
    } catch (e) {
      setAddendumErr(e instanceof Error ? e.message : 'Could not apply the default');
      setApplying(false);
    }
  };

  const toggleHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    if (versions || verLoading) return;
    setVerLoading(true);
    try {
      const qs = new URLSearchParams({ propertyId: String(plan.propertyId), planLabel: plan.planLabel });
      const url = manager
        ? `/manager/units/terms-versions?${[rpQ, qs.toString()].filter(Boolean).join('&')}`
        : `/properties/floor-plans/terms-versions?${qs.toString()}`;
      const r = await apiGet<{ versions: TermsVersion[] }>(url);
      setVersions(r.versions ?? []);
    } catch { setVersions([]); }
    finally { setVerLoading(false); }
  };

  // When the rent changes, re-default the rule-driven fees the user hasn't touched.
  const onRentChange = (raw: string) => {
    const rent = Number(raw);
    setVals(v => {
      const next: Record<string, string> = { ...v, rentalPrice: raw };
      if (Number.isFinite(rent)) {
        for (const k of RULE_KEYS) {
          if (!overridden.has(k)) next[k] = ruleDefault(k, rent);
        }
      }
      return next;
    });
  };
  const onFeeChange = (key: string, raw: string) => {
    setOverridden(s => new Set(s).add(key));
    setVals(v => ({ ...v, [key]: raw }));
  };
  const resetToRules = () => {
    const rent = Number(vals.rentalPrice) || 0;
    setOverridden(new Set());
    setVals(v => ({
      ...v,
      securityDeposit: ruleDefault('securityDeposit', rent),
      adminFee: ruleDefault('adminFee', rent),
      ejariFee: ruleDefault('ejariFee', rent),
      commission: ruleDefault('commission', rent),
    }));
  };

  const save = async () => {
    // Financial details — blank clears the fee.
    const finBody: Record<string, unknown> = { propertyId: plan.propertyId, planLabel: plan.planLabel };
    for (const f of FIN_FIELDS) {
      const s = vals[f.key].trim();
      if (s === '') { finBody[f.key] = null; continue; }
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) { setErr(`Enter a valid ${f.label.toLowerCase()}`); return; }
      finBody[f.key] = n;
    }
    // Annual rent (the single price) — optional; only written when provided.
    const priceStr = vals.rentalPrice.trim();
    let price: number | null = null;
    if (priceStr !== '') {
      price = Number(priceStr);
      if (!Number.isFinite(price) || price < 0) { setErr('Enter a valid market price'); return; }
    }

    // Lease terms + leasing config + Special Conditions — the editor is the
    // source of truth, so the whole set is submitted; a blank numeric clears
    // that term on the layout. The backend versions the Special Conditions.
    const leaseBody: Record<string, unknown> = { propertyId: plan.propertyId, planLabel: plan.planLabel };
    for (const f of LEASE_NUM_KEYS) {
      const s = (lease[f.key] ?? '').trim();
      if (s === '') continue;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) { setErr(`Enter a valid ${f.label.toLowerCase()}`); return; }
      leaseBody[f.key] = n;
    }
    if (rentalType) leaseBody.rentalType = rentalType;

    setSaving(true); setErr(null);
    try {
      if (price != null) {
        await apiPatch(manager ? `/manager/units/price?${rpQ}` : '/properties/floor-plans/price',
          { propertyId: plan.propertyId, planLabel: plan.planLabel, rentalPrice: price });
      }
      await apiPatch(manager ? `/manager/units/financials?${rpQ}` : '/properties/floor-plans/financials', finBody);
      await apiPatch(manager ? `/manager/units/lease-terms?${rpQ}` : '/properties/floor-plans/lease-terms', leaseBody);
      // In-app addendum terms — mint a new version only when they have content and changed.
      if (hasAddendumTerms(addendumTerms) && JSON.stringify(addendumTerms) !== seededTermsJson) {
        await apiPatch(manager ? `/manager/units/addendum-terms?${rpQ}` : '/properties/floor-plans/addendum-terms',
          { propertyId: plan.propertyId, planLabel: plan.planLabel, terms: addendumTerms });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  };

  return (
    <div className={ds.overlay} onClick={dismiss}>
      <div className={dcx(ds.modalCard, ds.modalNarrow)} onClick={e => e.stopPropagation()}>
        <header className={ds.modalHeader}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={ds.modalTitle}>{plan.buildingName} · {plan.displayName}</div>
            <div className={ds.modalSub}>
              {bedLabel(plan.bedrooms)} · {sizeLabel(plan.sqftMin, plan.sqftMax)} sqft · applies to all {plan.unitCount} unit{plan.unitCount === 1 ? '' : 's'} on this layout
            </div>
          </div>
          <button className={ds.closeBtn} onClick={dismiss} aria-label="Close"><X size={16} /></button>
        </header>

        <div className={ds.modalBody}>
          {/* Market Price (asking rent) — the single price (drives the fee auto-defaults). */}
          <div className={ds.field}>
            <label className={ds.lbl}>Market Price (AED)</label>
            <input type="number" min={0} step="any" autoFocus placeholder="e.g. 85000" value={vals.rentalPrice}
              onChange={e => onRentChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              className={ds.input} />
          </div>

          {/* Fees — plan-wide; rule-driven defaults off the rent. */}
          <div className={ds.feesBox} style={{ marginBottom: 15 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span className={ds.feesTitle} style={{ marginBottom: 0 }}>FEES</span>
              <button type="button" onClick={resetToRules} className={ds.linkBtn}>Reset to fee rules</button>
            </div>
            <div className={ds.grid2}>
              {FIN_FIELDS.map(f => {
                const ruled = RULE_KEYS.includes(f.key);
                return (
                  <div key={f.key}>
                    <label className={ds.lbl}>
                      {f.label}
                      {ruled && overridden.has(f.key) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#92400e' }}>· custom</span>}
                    </label>
                    <input type="number" min={0} step="any" className={ds.input} value={vals[f.key]}
                      onChange={e => onFeeChange(f.key, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') save(); }} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lease & payment — plan-wide; written to every unit's facilities JSON. */}
          <div className={ds.leaseBox} style={{ marginBottom: 15 }}>
            <div className={ds.leaseTitle}>LEASE &amp; PAYMENT</div>
            <div className={ds.field}>
              <label className={ds.lbl}>Rental Type</label>
              <div className={ds.segGroup}>
                {RENTAL_TYPES.map(o => (
                  <button key={o.id} type="button" className={dcx(ds.seg, rentalType === o.id && ds.segOn)}
                    onClick={() => setRentalType(o.id)}>{o.label}</button>
                ))}
              </div>
            </div>
            <div className={dcx(ds.grid3, ds.field)}>
              {LEASE_TERM_FIELDS.map(f => (
                <div key={f.key}>
                  <label className={ds.lbl}>{f.label}</label>
                  <input type="number" min={0} step={f.step} max={f.max} className={ds.input}
                    placeholder={f.placeholder} value={lease[f.key] ?? ''}
                    onChange={e => setLease(v => ({ ...v, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className={ds.grid2}>
              {LEASE_CONFIG_FIELDS.map(f => (
                <div key={f.key}>
                  <label className={ds.lbl}>{f.label}</label>
                  <input type="number" min={0} step={f.step} className={ds.input}
                    placeholder={f.placeholder} value={lease[f.key] ?? ''}
                    onChange={e => setLease(v => ({ ...v, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Agreement — Addendum, authored IN-APP as bilingual terms. The
              signature block is system-managed (rendered into the contract PDF)
              and shown locked in the editor — it can never be missing. Saving
              changes mints a new version; signed contracts keep theirs. */}
          <div className="rounded-xl border border-[#efe1bf] bg-[#fdf8ec] p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#b45309]">Agreement — Addendum</p>
            <p className="text-[10px] text-[#a16207]">
              {plan.termsVersion
                ? `Current v${plan.termsVersion.versionNo} · updated ${fmtDate(plan.termsVersion.effectiveAt)}. Saving changes mints a new version; new contracts use the latest, signed contracts keep theirs.`
                : 'Write the addendum terms new contracts from this layout will carry. A tenant & landlord signature block is added automatically.'}
            </p>

            {/* Pre-fill suggestion — the RP's default template for this category /
                unit type, offered when the layout has no addendum yet. */}
            {!hasAddendum && suggested && (
              <div className="rounded-lg border border-[#fcd34d] bg-white p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Star size={14} className="text-[#b45309] fill-[#b45309] mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[#1a1916] truncate">Suggested default · {suggested.name}</p>
                    <p className="text-[10px] text-[#a16207] mt-0.5">
                      Your {suggested.source === 'subcategory' ? 'sub-category' : 'category'} default
                      {suggestedScope ? ` for ${suggestedScope}` : ''}. Apply it as a starting point, or write the terms below.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={useDefault} disabled={applying}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b45309] text-white text-xs font-semibold hover:bg-[#92400e] disabled:opacity-60 cursor-pointer">
                    {applying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Use this default
                  </button>
                  {suggested.fileUrl && (
                    <a href={suggested.fileUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b45309] hover:underline">
                      <Eye size={12} /> Preview
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Compact summary + open the big document editor (write + live preview). */}
            {(() => {
              const n = (addendumTerms.en?.filter(l => l.trim()).length ?? 0) + (addendumTerms.ar?.filter(l => l.trim()).length ?? 0);
              return (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[#e8e6e0] bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1a1916] truncate">
                      {addendumTerms.name?.trim() || 'Agreement Addendum'}
                    </p>
                    <p className="text-[11px] text-[#9b9890]">{n ? `${n} term${n === 1 ? '' : 's'} written` : 'No terms yet'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Choose from a saved template… */}
                    <AddendumTemplatePicker onPick={t => setAddendumTerms(t)} manager={manager} rpQ={rpQ} />
                    {n > 0 && (
                      <button type="button" onClick={() => setPreviewOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c5e8df] text-[#2e9f82] text-xs font-semibold hover:bg-[#f0faf6] cursor-pointer">
                        <Eye size={13} /> Preview
                      </button>
                    )}
                    {/* …or add new / edit */}
                    <button type="button" onClick={() => setEditorOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b45309] text-white text-xs font-semibold hover:bg-[#92400e] cursor-pointer">
                      <Pencil size={13} /> {n ? 'Edit addendum' : 'Write new'}
                    </button>
                  </div>
                </div>
              );
            })()}
            {addendumErr && <p className="text-[11px] text-red-600">{addendumErr}</p>}
            {editorOpen && (
              <AddendumEditorModal value={addendumTerms} onChange={setAddendumTerms} onClose={() => setEditorOpen(false)} />
            )}
            {previewOpen && (
              <AddendumPreviewModal terms={addendumTerms} title={addendumTerms.name?.trim() || 'Agreement Addendum'} onClose={() => setPreviewOpen(false)} />
            )}

            {plan.termsVersion && (
              <button type="button" onClick={toggleHistory} className="text-[11px] font-semibold text-[#b45309] underline">
                {showHistory ? 'Hide' : 'View'} history · {plan.termsVersion.versionsCount} version{plan.termsVersion.versionsCount === 1 ? '' : 's'}
              </button>
            )}
            {showHistory && (
              <div className="rounded-lg border border-[#fde68a] bg-white p-3 space-y-2.5">
                {verLoading && (
                  <div className="text-xs flex items-center gap-1.5 text-[#6b6860]">
                    <Loader2 size={13} className="animate-spin" /> Loading history…
                  </div>
                )}
                {!verLoading && versions && versions.length === 0 && (
                  <p className="text-xs text-[#9b9890]">No versions yet — saving terms creates v1.</p>
                )}
                {!verLoading && versions?.map(v => (
                  <div key={v.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-[#1a1916] shrink-0">v{v.versionNo}</span>
                    {v.addendumUrl
                      ? <a href={v.addendumUrl} target="_blank" rel="noreferrer" className="text-[#b45309] truncate flex-1 hover:underline">{v.addendumFileName ?? 'Addendum'}</a>
                      : <span className="text-[#6b6860] flex-1">Addendum terms</span>}
                    <span className="text-[#9b9890] shrink-0">{fmtDate(v.effectiveAt)}</span>
                    <span className="text-[#9b9890] shrink-0">· {v.contractsCount} contract{v.contractsCount === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {err && <div style={{ padding: '0 22px 4px', fontSize: 12.5, color: '#b91c1c' }}>{err}</div>}
        <footer className={ds.modalFooter}>
          <button className={ds.cancelBtn} onClick={dismiss} disabled={saving}>Cancel</button>
          <div className={ds.footSpacer} />
          <button className={ds.saveBtn} onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />} Save to layout
          </button>
        </footer>
      </div>
    </div>
  );
}
