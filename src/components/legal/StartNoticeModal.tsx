'use client';

/**
 * Legal pipeline — "Start notice" (spec §7.3): opens a case in `notice_sent`.
 *
 * Lease → filed by → type → (breach reasons) → notice type, whose period comes
 * from JurisdictionConfig ("Customer will have N days") → served date → claim,
 * contact → notes → the BLOCKING
 * checklist → a merge-field text notice the landlord can copy → optional proof
 * (required before the case can be filed — rule 5.3.1).
 *
 * Shared by the RP portal (base '/legal') and the manager mirror
 * ('/manager/legal' + rp). Also exports the small UI helpers the other Legal
 * surfaces share (this is the leaf module, so no import cycle).
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, UploadCloud, X, Copy, Check } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import {
  legalApi, BREACH_CATEGORY_LABELS, DISPUTE_TYPE_LABELS, NOTICE_TYPE_LABELS, NOTICE_TEMPLATE_KIND, TEMPLATE_KINDS, type LegalTemplate, type TemplateKind, type BreachCategory, type DisputeFiledBy, type DisputeType, type JurisdictionConfig, type NoticeType, DISPUTE_STAGE_LABELS, DISPUTE_OUTCOME_LABELS, type DisputeOutcome, type ClaimSuggestion,
} from '@/lib/legal';

/* ── shared UI helpers (AMC house style) ──────────────────────────────────── */
export const card = 'bg-white border border-[#e6e8e6] rounded-[14px]';
export const btn = 'text-[12px] font-semibold px-3 py-2 rounded-lg border border-[#d9ddda] bg-white text-[#1c1f1d] hover:bg-[#f6f7f6] cursor-pointer disabled:opacity-40 disabled:cursor-default';
export const btnPrimary = 'text-[12px] font-semibold px-3 py-2 rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50';
export const btnSm = 'text-[11px] font-semibold px-2.5 py-[5px] rounded-md border border-[#d9ddda] bg-white text-[#1c1f1d] hover:bg-[#f6f7f6] cursor-pointer disabled:opacity-40 disabled:cursor-default';
export const btnGreenSm = 'text-[11px] font-bold px-2.5 py-[5px] rounded-md border border-[#1a7a52] bg-white text-[#1a7a52] hover:bg-[#e7f4ee] cursor-pointer disabled:opacity-50';
export const btnFillSm = 'text-[11px] font-bold px-2.5 py-1 rounded-md bg-[#1a7a52] text-white hover:bg-[#156643] cursor-pointer disabled:opacity-50';
export const lbl = 'text-[10px] font-bold tracking-[.08em] text-[#8a8f8c]';
export const field = 'w-full text-sm px-3 py-2 border border-[#e6e8e6] rounded-lg bg-white focus:outline-none focus:border-[#1a7a52]';
export const fieldLbl = 'text-xs font-medium text-[#5b615e] mb-1 block';
export const pillCls = 'text-[10px] font-bold px-[7px] py-[2px] rounded-full whitespace-nowrap';

export const fmtD = (d?: string | null) => d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDT = (d?: string | null) => d ? new Date(d).toLocaleString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export const money = (n?: number | null) => n != null ? `AED ${Number(n).toLocaleString('en-AE', Number.isInteger(Number(n)) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const errText = (e: unknown, fallback: string) => ((e as Error)?.message || fallback);

/** "Amount claimed" flips with filed_by (spec §6). */
export const claimLabel = (filedBy: DisputeFiledBy) => filedBy === 'landlord' ? 'Amount claimed' : 'Amount claimed against you';

/** Company customers are shown by their COMPANY name. */
export const customerDisplay = (t?: { name?: string | null; entityType?: string | null; companyName?: string | null } | null) =>
  t ? ((t.entityType === 'company' && t.companyName) ? t.companyName : (t.name ?? '—')) : '—';

/** Mirrors the server formula (dispute-rules.util.ts): flat wins; else % of annual rent clamped to [min, max]. */
export function filingFeePreview(annualRent: number | null | undefined, f: JurisdictionConfig['filingFeeFormula'] | null | undefined): number | null {
  if (!f) return null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (f.flat_fee != null) return r2(f.flat_fee);
  if (f.percent_of_annual_rent == null || annualRent == null) return null;
  let fee = (annualRent * f.percent_of_annual_rent) / 100;
  if (f.min_fee != null) fee = Math.max(fee, f.min_fee);
  if (f.max_fee != null) fee = Math.min(fee, f.max_fee);
  return r2(fee);
}

/** The config period a notice type carries (spec §3); `none` has no deadline. */
export function noticePeriodDays(noticeType: NoticeType, cfg: JurisdictionConfig | null): number | null {
  if (!cfg) return null;
  switch (noticeType) {
    case 'payment_demand': return cfg.paymentCurePeriodDays;
    case 'breach_remedy': return cfg.breachRemedyPeriodDays;
    case 'non_renewal': return cfg.nonRenewalNoticeDays;
    case 'renewal_terms_change': return cfg.renewalTermsNoticeDays;
    default: return null;
  }
}

/** Upload one file against a dispute (owner tenancy_dispute, category legal) → document id. */
export async function uploadDisputeFile(disputeId: number, file: File, displayName: string): Promise<number | null> {
  const { id } = await uploadOwnedDocument({
    ownerType: 'tenancy_dispute', ownerId: disputeId, category: 'legal',
    documentKey: `dispute_${disputeId}_${Date.now()}`, displayName, file,
  });
  return id;
}

/** Lease row as the Leases register lists it (GET /contracts · /manager/contracts?rp=). */
export interface LeaseOpt {
  id: number; ref?: string; status: string; contractActive?: boolean; startDate: string | null; endDate: string | null; annualRent: number | null;
  tenant: { name: string | null; entityType?: string | null; companyName?: string | null } | null;
  unit: { number: string | null; name?: string | null } | null;
  property: { buildingName: string | null } | null;
}
export const leaseListPath = (base: string, rp?: number | null) => base.startsWith('/manager') ? `/manager/contracts${rp != null ? `?rp=${rp}` : ''}` : '/contracts';
export const leaseLine = (l: LeaseOpt) => `Unit ${l.unit?.number ?? '—'} · ${customerDisplay(l.tenant)} · ${l.property?.buildingName?.trim() ?? ''} · CID-${l.id}${l.status && l.status !== 'active' ? ` (${l.status.replace(/_/g, ' ')})` : ''}`;

const DEFAULT_NOTICE: Record<DisputeType, NoticeType> = {
  non_payment: 'payment_demand', breach: 'breach_remedy', overstaying: 'non_renewal', eviction: 'non_renewal',
  rent_increase: 'renewal_terms_change', deposit: 'none', maintenance: 'none', early_termination: 'none', other: 'none',
};
const CHECK_PROVABLE = 'Notice will be served through an officially provable channel';
const CHECK_RENT_RULES = 'Increase checked against local rent rules';
const CHECK_GROUNDS = 'Selected grounds are valid in your jurisdiction';

/** The merge-field text notice (spec §7.3 — "simple text notice from a merge-field template"). */
export function buildNoticeText(i: {
  lease: LeaseOpt | null; typeLabel: string; noticeType: NoticeType; reasons: string[]; served: string; deadline: string | null;
  days: number | null; authority: string; claimAmount: string; contactName: string; contactPhone: string;
}): string {
  const l = i.lease;
  const lines: string[] = [];
  lines.push(NOTICE_TYPE_LABELS[i.noticeType === 'none' ? 'none' : i.noticeType].toUpperCase());
  lines.push('');
  lines.push(`To: ${customerDisplay(l?.tenant)}`);
  lines.push(`Unit ${l?.unit?.number ?? '—'}${l?.property?.buildingName ? `, ${l.property.buildingName.trim()}` : ''}`);
  if (l) lines.push(`Lease CID-${l.id} (${fmtD(l.startDate)} – ${fmtD(l.endDate)})`);
  lines.push(`Date served: ${fmtD(i.served)}`);
  lines.push('');
  lines.push(`Subject: ${i.typeLabel}`);
  lines.push('');
  lines.push('This is a formal notice regarding the tenancy of the unit named above.');
  if (i.reasons.length) lines.push(`Grounds: ${i.reasons.join('; ')}.`);
  const within = i.days != null && i.deadline ? `within ${i.days} days of this notice, that is by ${fmtD(i.deadline)}` : 'within the period the law allows';
  switch (i.noticeType) {
    case 'payment_demand':
      lines.push(`Rent${i.claimAmount ? ` of AED ${Number(i.claimAmount).toLocaleString('en-AE')}` : ''} is outstanding. You are required to settle the amount ${within}.`); break;
    case 'breach_remedy':
      lines.push(`You are required to put right the matter(s) listed above ${within}.`); break;
    case 'non_renewal':
      lines.push(`The tenancy will not be renewed. You are required to vacate the unit ${within}.`); break;
    case 'renewal_terms_change':
      lines.push(`The terms of the tenancy will change on renewal as set out in the attached schedule. This notice is given ${i.days != null ? `${i.days} days` : 'the required period'} before the renewal date.`); break;
    default: break;
  }
  lines.push(`Failing this, the matter will be referred to the ${i.authority || 'rental authority'}.`);
  if (i.contactName || i.contactPhone) { lines.push(''); lines.push(`Contact: ${[i.contactName, i.contactPhone].filter(Boolean).join(' · ')}`); }
  return lines.join('\n');
}

export function StartNoticeModal({ base, rp, leaseId, onClose, onSaved }: {
  base: string; rp?: number | null;
  /** Preselected when opened from a lease. */
  leaseId?: number | null;
  onClose: () => void; onSaved: (disputeId: number) => void;
}) {
  const [cfg, setCfg] = useState<JurisdictionConfig | null>(null);
  const [leases, setLeases] = useState<LeaseOpt[] | null>(null);
  const [lease, setLease] = useState<string>(leaseId != null ? String(leaseId) : '');
  const [leaseQ, setLeaseQ] = useState('');
  const [filedBy, setFiledBy] = useState<DisputeFiledBy>('landlord');
  const [type, setType] = useState<DisputeType>('non_payment');
  const [reasons, setReasons] = useState<BreachCategory[]>([]);
  // The notice type follows the case type until the landlord picks one (derived, not synced).
  const [noticeOverride, setNoticeOverride] = useState<NoticeType | null>(null);
  const [served, setServed] = useState(todayIso());
  const [claim, setClaim] = useState('');
  // The ledger's own figure for the claim (settlement balance + bounced cheques
  // + overdue instalments) — suggested when a lease is picked, never imposed.
  const [suggest, setSuggest] = useState<ClaimSuggestion | null>(null);
  const [showLines, setShowLines] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  // "Move a lease that is already in legal": record the case at its real stage.
  const [inProgress, setInProgress] = useState(false);
  const [stage, setStage] = useState<'case_filed' | 'settlement' | 'decision' | 'enforcement'>('case_filed');
  const [caseNo, setCaseNo] = useState('');
  const [filingDate, setFilingDate] = useState('');
  const [hearingDate, setHearingDate] = useState('');
  const [decisionDate, setDecisionDate] = useState('');
  const [outcome, setOutcome] = useState<DisputeOutcome | ''>('');
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  // The landlord's own notice template (0288), merged server-side from the lease
  // and the fields on this form; `buildNoticeText` stays as the fallback.
  const [rendered, setRendered] = useState<{ subject: string; body: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  // The legal-group templates (0289): the notice type picks its fixed one unless
  // the landlord chose one of their own custom templates.
  const [tpls, setTpls] = useState<LegalTemplate[]>([]);
  const [customTpl, setCustomTpl] = useState<number | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    legalApi.config(base, rp ?? undefined).then(setCfg).catch(() => setCfg(null));
    apiGet<LeaseOpt[]>(leaseListPath(base, rp)).then(list => setLeases(Array.isArray(list) ? list : [])).catch(() => setLeases([]));
    legalApi.templates(base, rp ?? undefined).then(r => setTpls((r.items ?? []).filter(t => t.group === 'legal'))).catch(() => setTpls([]));
  }, [base, rp]);

  const noticeType: NoticeType = noticeOverride ?? DEFAULT_NOTICE[type];
  const fixedTpl = noticeType === 'none' ? null : (tpls.find(t => t.kind === NOTICE_TEMPLATE_KIND[noticeType]) ?? null);
  const chosenTpl = (customTpl != null ? tpls.find(t => t.id === customTpl && t.source === 'custom') : null) ?? fixedTpl;
  const tplRef: TemplateKind | number | null = chosenTpl ? chosenTpl.id : noticeType === 'none' ? null : NOTICE_TEMPLATE_KIND[noticeType];
  const tplOptions = useMemo(() => {
    const fixed = tpls.filter(t => t.source !== 'custom').sort((a, b) => TEMPLATE_KINDS.indexOf(a.kind) - TEMPLATE_KINDS.indexOf(b.kind));
    const custom = tpls.filter(t => t.source === 'custom').sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    return [...fixed, ...custom];
  }, [tpls]);

  const selected = useMemo(() => leases?.find(l => String(l.id) === lease) ?? null, [leases, lease]);
  const days = noticePeriodDays(noticeType, cfg);
  const deadline = served && days != null ? addDays(served, days) : null;

  // Running leases first; the search narrows by unit, customer, building or CID.
  const needle = leaseQ.trim().toLowerCase();
  // Only leases that can carry a case: running ones, plus those that ended in
  // the last 180 days (overstaying, deposit, early-termination disputes). The
  // rest of the register is behind "Include ended leases".
  const [includeEnded, setIncludeEnded] = useState(false);
  const cutoff = useMemo(() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 180); return d.toISOString().slice(0, 10); }, []);
  const canCarryCase = (l: LeaseOpt) =>
    ['active', 'issued'].includes(l.status)
    || (l.status === 'expired' && (l.endDate ?? '') >= cutoff && l.contractActive !== false);
  const unitKey = (l: LeaseOpt) => (l.unit?.number ?? '').replace(/\d+/g, m => m.padStart(6, '0')).toLowerCase();
  const leaseOptions = useMemo(() => (leases ?? [])
    .filter(l => includeEnded || canCarryCase(l))
    .filter(l => !needle || leaseLine(l).toLowerCase().includes(needle) || String(l.id) === needle)
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || unitKey(a).localeCompare(unitKey(b)) || b.id - a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leases, needle, includeEnded, cutoff]);
  const currentCount = useMemo(() => (leases ?? []).filter(canCarryCase).length, [leases, cutoff]); // eslint-disable-line react-hooks/exhaustive-deps

  const checklist = useMemo(() => {
    // A case already in progress has had its notice served long ago — nothing to tick before serving.
    if (inProgress || filedBy !== 'landlord' || noticeType === 'none') return [] as string[];
    const items = [CHECK_PROVABLE];
    if (noticeType === 'renewal_terms_change') items.push(CHECK_RENT_RULES);
    if (noticeType === 'non_renewal') items.push(CHECK_GROUNDS);
    return items;
  }, [inProgress, filedBy, noticeType]);
  const allTicked = checklist.every(k => ticked[k]);

  const typeLabel = DISPUTE_TYPE_LABELS[type];
  const noticeText = buildNoticeText({
    lease: selected, typeLabel, noticeType, reasons: reasons.map(r => BREACH_CATEGORY_LABELS[r]), served, deadline, days,
    authority: cfg?.authorityDisplayName ?? 'rental authority', claimAmount: claim, contactName, contactPhone,
  });
  const reasonsText = reasons.map(r => BREACH_CATEGORY_LABELS[r]).join('; ');
  const contactText = [contactName, contactPhone].filter(Boolean).join(' · ');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!preview || !lease || tplRef == null) { setRendered(null); setRendering(false); return; }
    let live = true;
    setRendering(true);
    const t = window.setTimeout(() => {
      legalApi.renderTemplate(base, rp ?? undefined, tplRef, {
        leaseId: Number(lease), date: served || undefined, days: days ?? undefined, deadline: deadline ?? undefined,
        amount: claim.trim() !== '' && Number.isFinite(Number(claim)) ? Number(claim) : undefined,
        reasons: reasonsText || undefined, contact: contactText || undefined,
      })
        .then(r => { if (live) setRendered({ subject: r.subject, body: r.body }); })
        .catch(() => { if (live) setRendered(null); })
        .finally(() => { if (live) setRendering(false); });
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [preview, lease, tplRef, served, days, deadline, claim, reasonsText, contactText, base, rp]);
  const previewText = rendered ? `${rendered.subject}\n\n${rendered.body}` : noticeText;
  const copy = async () => { try { await navigator.clipboard.writeText(previewText); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } };

  const canSubmit = !!lease && !saving && allTicked && (inProgress || noticeType === 'none' || !!served);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!lease) { setSuggest(null); return; }
    let live = true;
    legalApi.claimSuggestion(base, rp ?? undefined, Number(lease))
      .then(s => { if (live) setSuggest(s); })
      .catch(() => { if (live) setSuggest(null); });
    return () => { live = false; };
  }, [lease, base, rp]);
  // Prefill once for the money cases; the landlord can still type over it.
  useEffect(() => {
    if (!suggest || suggest.total <= 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if ((type === 'non_payment' || type === 'deposit') && claim.trim() === '') setClaim(String(suggest.total));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggest, type]);

  async function submit() {
    setError(null);
    if (!lease) { setError('Pick the lease.'); return; }
    if (!allTicked) { setError('Tick every item on the checklist before starting the notice.'); return; }
    setSaving(true);
    try {
      const created = await legalApi.createDispute(base, rp ?? undefined, {
        leaseId: Number(lease), filedBy, type, breachReasons: type === 'breach' ? reasons : [],
        noticeType, noticeServedDate: noticeType === 'none' ? null : (served || null),
        claimAmount: claim.trim() !== '' ? Number(claim) : null,
        contactName: contactName.trim() || null, contactPhone: contactPhone.trim() || null, notes: notes.trim() || null,
        checklist: checklist.filter(k => ticked[k]),
        ...(inProgress ? {
          stage, authorityCaseNumber: caseNo.trim() || null, filingDate: filingDate || null,
          nextHearingDate: hearingDate || null, decisionDate: decisionDate || null, outcome: outcome || null,
        } : {}),
      });
      if (proof) {
        // The proof is uploaded against the new case, then recorded as the notice proof (rule 5.3.1).
        try {
          const docId = await uploadDisputeFile(created.id, proof, `Notice proof · ${NOTICE_TYPE_LABELS[noticeType]}`);
          if (docId) await legalApi.updateDispute(base, rp ?? undefined, created.id, { noticeProofDocumentId: docId });
        } catch (e) { console.warn('Case created; proof upload failed', e); }
      }
      onSaved(created.id);
    } catch (e) { setError(errText(e, 'Could not start the notice.')); }
    finally { setSaving(false); }
  }

  const chip = (on: boolean) => on ? { background: '#1c1f1d', color: '#fff', borderColor: '#1c1f1d' } : { background: '#fff', color: '#5b615e', borderColor: '#e6e8e6' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f1f3f1] sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-sm font-bold text-[#1c1f1d]">Start notice</h2>
            <p className="text-[11px] text-[#8a8f8c] mt-0.5">Opens a case at “Notice sent”. {cfg ? <>Periods and fees come from your jurisdiction settings ({cfg.authorityDisplayName}).</> : 'Loading jurisdiction settings…'}</p>
          </div>
          <button onClick={onClose} className="text-[#8a8f8c] hover:text-[#1c1f1d] cursor-pointer" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-6 gap-y-4">
          {/* ── left: the case ── */}
          <div className="space-y-4 min-w-0">
            <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
              <div className="text-[12px] font-bold mb-2">1 · Lease</div>
              {leases == null ? (
                <div className="flex items-center gap-2 text-[12px] text-[#8a8f8c]"><Loader2 size={13} className="animate-spin" /> Loading leases…</div>
              ) : selected ? (
                // ONE picker: the chosen lease reads as a single line; "Change" reopens the search.
                <div className="flex items-start justify-between gap-3 rounded-lg border border-[#e6e8e6] bg-[#fafbfa] px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold truncate">{leaseLine(selected)}</div>
                    <div className="text-[11px] text-[#8a8f8c] mt-0.5">{fmtD(selected.startDate)} → {fmtD(selected.endDate)} · annual rent {money(selected.annualRent)}</div>
                  </div>
                  {leaseId == null && (
                    <button type="button" onClick={() => { setLease(''); setLeaseQ(''); }} className="text-[11px] font-semibold text-[#1a7a52] hover:underline cursor-pointer shrink-0">Change</button>
                  )}
                </div>
              ) : (
                <div>
                  <input autoFocus value={leaseQ} onChange={e => setLeaseQ(e.target.value)} placeholder="Type a unit, customer, building or CID…" className={field} />
                  <div className="flex items-center justify-between mt-1.5 text-[11px] text-[#8a8f8c]">
                    <span>{includeEnded ? `${(leases ?? []).length} leases on the register` : `${currentCount} current lease${currentCount === 1 ? '' : 's'}`}{leaseOptions.length < (includeEnded ? (leases ?? []).length : currentCount) ? ` · ${leaseOptions.length} match` : ''}</span>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={includeEnded} onChange={e => setIncludeEnded(e.target.checked)} /> Include ended leases
                    </label>
                  </div>
                  <div className="mt-1.5 rounded-lg border border-[#e6e8e6] overflow-hidden max-h-56 overflow-y-auto">
                    {leaseOptions.length === 0 ? (
                      <div className="px-3 py-2 text-[12px] text-[#8a8f8c]">No lease matches.</div>
                    ) : leaseOptions.slice(0, 8).map(l => (
                      <button key={l.id} type="button" onClick={() => setLease(String(l.id))}
                        className="w-full text-left px-3 py-2 text-[12.5px] border-b border-[#f1f3f1] last:border-0 hover:bg-[#eef7f2] cursor-pointer">
                        <div className="font-medium truncate">{leaseLine(l)}</div>
                        <div className="text-[11px] text-[#8a8f8c]">{fmtD(l.startDate)} → {fmtD(l.endDate)} · annual rent {money(l.annualRent)}</div>
                      </button>
                    ))}
                    {leaseOptions.length > 8 && <div className="px-3 py-1.5 text-[11px] text-[#8a8f8c] bg-[#fafbfa]">Showing the first 8 — type to narrow it down.</div>}
                  </div>
                </div>
              )}
            </section>

            <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
              <div className="text-[12px] font-bold mb-2">2 · Who is filing, and what about</div>
              <span className={fieldLbl}>Filed by</span>
              <div className="flex gap-1.5 mb-3">
                {(['landlord', 'customer'] as DisputeFiledBy[]).map(v => (
                  <button key={v} type="button" onClick={() => setFiledBy(v)} className="text-[11px] font-semibold px-2.5 py-1 rounded-full border cursor-pointer" style={chip(filedBy === v)}>
                    {v === 'landlord' ? 'You' : 'Customer'}
                  </button>
                ))}
              </div>
              <span className={fieldLbl}>Type</span>
              <select className={field} value={type} onChange={e => setType(e.target.value as DisputeType)}>
                {(Object.keys(DISPUTE_TYPE_LABELS) as DisputeType[]).map(t => <option key={t} value={t}>{DISPUTE_TYPE_LABELS[t]}</option>)}
              </select>
              {type === 'breach' && (
                <div className="mt-3">
                  <span className={fieldLbl}>Breach reasons <span className="font-normal text-[#8a8f8c]">— go on the notice</span></span>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(BREACH_CATEGORY_LABELS) as BreachCategory[]).map(c => {
                      const on = reasons.includes(c);
                      return <button key={c} type="button" onClick={() => setReasons(r => on ? r.filter(x => x !== c) : [...r, c])}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full border cursor-pointer" style={chip(on)}>{BREACH_CATEGORY_LABELS[c]}</button>;
                    })}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <span className={fieldLbl}>{claimLabel(filedBy)} (AED)</span>
                  <input type="number" min="0" step="0.01" className={field} value={claim} onChange={e => setClaim(e.target.value)} placeholder="optional" />
                </div>

                <div><span className={fieldLbl}>Contact name <span className="font-normal text-[#8a8f8c]">— lawyer / representative</span></span><input className={field} value={contactName} onChange={e => setContactName(e.target.value)} /></div>
                <div><span className={fieldLbl}>Contact phone</span><input className={field} value={contactPhone} onChange={e => setContactPhone(e.target.value)} /></div>
                {suggest && suggest.total > 0 && (
                  <div className="col-span-2 rounded-lg border border-[#e6e8e6] bg-[#fafbfa] px-3 py-2 text-[11px]" style={{ gridColumn: '1 / -1', minWidth: 0 }}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="min-w-0">Ledger says the customer owes <b className="text-[#1c1f1d]">AED {suggest.total.toLocaleString('en-AE')}</b></span>
                      <span className="flex items-center gap-2">
                        <button type="button" className="font-semibold text-[#1a7a52] hover:underline cursor-pointer" onClick={() => setClaim(String(suggest.total))}>Use it</button>
                        <button type="button" className="text-[#8a8f8c] hover:underline cursor-pointer" onClick={() => setShowLines(v => !v)}>{showLines ? 'Hide' : 'How'}</button>
                      </span>
                    </div>
                    {showLines && (
                      <ul className="mt-1.5 space-y-0.5 text-[#5b615e]">
                        {suggest.lines.map((l, i) => (
                          <li key={i} className="flex justify-between gap-3"><span className="truncate">{l.label}{l.date ? ` · ${fmtD(l.date)}` : ''}</span><span className="tabular-nums shrink-0">AED {l.amount.toLocaleString('en-AE')}</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {suggest && suggest.total === 0 && lease && (type === 'non_payment' || type === 'deposit') && (
                  <p className="col-span-2 text-[11px] text-[#8a8f8c]" style={{ gridColumn: '1 / -1' }}>Nothing outstanding on the ledger — no bounced cheques, overdue instalments or settlement balance.</p>
                )}
              </div>
              <div className="mt-3"><span className={fieldLbl}>Notes</span><textarea rows={2} className={field} value={notes} onChange={e => setNotes(e.target.value)} /></div>
            </section>

            <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input type="checkbox" className="mt-0.5" checked={inProgress} onChange={e => setInProgress(e.target.checked)} />
                <span>
                  <span className="text-[12px] font-bold block">This case is already in progress</span>
                  <span className="text-[11px] text-[#8a8f8c]">The lease is already in legal — record it at its real stage instead of starting a new notice.</span>
                </span>
              </label>
              {inProgress && (
                <div className="mt-3 space-y-3">
                  <div>
                    <span className={fieldLbl}>Current stage</span>
                    <select className={field} value={stage} onChange={e => setStage(e.target.value as typeof stage)}>
                      {(['case_filed', 'settlement', 'decision', 'enforcement'] as const).map(s => <option key={s} value={s}>{DISPUTE_STAGE_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><span className={fieldLbl}>Authority case no.</span><input className={field} value={caseNo} onChange={e => setCaseNo(e.target.value)} placeholder="as registered" /></div>
                    <div><span className={fieldLbl}>Filing date</span><input type="date" className={field} value={filingDate} onChange={e => setFilingDate(e.target.value)} /></div>
                    {(stage === 'case_filed' || stage === 'settlement') && (
                      <div><span className={fieldLbl}>Next hearing</span><input type="date" className={field} value={hearingDate} onChange={e => setHearingDate(e.target.value)} /></div>
                    )}
                    {(stage === 'decision' || stage === 'enforcement') && (
                      <>
                        <div><span className={fieldLbl}>Decision date</span><input type="date" className={field} value={decisionDate} onChange={e => setDecisionDate(e.target.value)} /></div>
                        <div>
                          <span className={fieldLbl}>Outcome</span>
                          <select className={field} value={outcome} onChange={e => setOutcome(e.target.value as DisputeOutcome | '')}>
                            <option value="">Not recorded</option>
                            {(['won', 'lost', 'settled'] as DisputeOutcome[]).map(o => <option key={o} value={o}>{DISPUTE_OUTCOME_LABELS[o]}</option>)}
                          </select>
                        </div>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-[#8a8f8c]">The notice section on the right is optional here — fill it in if you have the dates.</p>
                </div>
              )}
            </section>
          </div>

          {/* ── right: the notice ── */}
          <div className="space-y-4 min-w-0">
            <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
              <div className="text-[12px] font-bold mb-2">3 · Notice</div>
              <span className={fieldLbl}>Notice type</span>
              <select className={field} value={noticeType} onChange={e => setNoticeOverride(e.target.value as NoticeType)}>
                {(Object.keys(NOTICE_TYPE_LABELS) as NoticeType[]).map(t => <option key={t} value={t}>{NOTICE_TYPE_LABELS[t]}</option>)}
              </select>
              {noticeType !== 'none' ? (
                <p className="text-[11.5px] mt-1.5 px-2.5 py-2 rounded-lg bg-[#e7f4ee] text-[#1a7a52] font-semibold">
                  {days != null ? <>Customer will have <b>{days} days</b> from the served date{deadline ? <> — deadline {fmtD(deadline)}</> : null}.</> : 'Period comes from your jurisdiction settings.'}
                </p>
              ) : (
                <p className="text-[11px] text-[#8a8f8c] mt-1.5">No notice — the case opens without a deadline (e.g. a dispute the customer filed).</p>
              )}
              {noticeType !== 'none' && (
                <div className="mt-3"><span className={fieldLbl}>Notice served on</span><input type="date" className={field} value={served} onChange={e => setServed(e.target.value)} /></div>
              )}
            </section>

            {checklist.length > 0 && (
              <section className="border border-[#f5d9a8] bg-[#fffbf3] rounded-xl px-3.5 py-3">
                <div className="text-[12px] font-bold">4 · Before you serve it <span className="font-semibold text-[#c47a00]">— every item must be ticked</span></div>
                <div className="mt-2 space-y-1.5">
                  {checklist.map(k => (
                    <label key={k} className="flex items-start gap-2 text-[12px] cursor-pointer">
                      <input type="checkbox" className="mt-[3px] accent-[#1a7a52]" checked={!!ticked[k]} onChange={e => setTicked(t => ({ ...t, [k]: e.target.checked }))} />
                      <span>{k}</span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-bold">{checklist.length ? '5' : '4'} · Notice text</div>
                <button type="button" onClick={() => setPreview(p => !p)} className={btnSm}>{preview ? 'Hide preview' : 'Preview notice text'}</button>
              </div>
              {noticeType !== 'none' && tplOptions.length > 0 && (
                <div className="mt-2">
                  <span className={fieldLbl}>Template</span>
                  <select className={field} aria-label="Template" value={chosenTpl?.id ?? ''} onChange={e => { const t = tplOptions.find(x => x.id === Number(e.target.value)); setCustomTpl(t?.source === 'custom' ? t.id : null); if (t && t.source !== 'custom' && t.kind !== NOTICE_TEMPLATE_KIND[noticeType]) { const nt = (Object.keys(NOTICE_TEMPLATE_KIND) as Exclude<NoticeType, 'none'>[]).find(k => NOTICE_TEMPLATE_KIND[k] === t.kind); if (nt) setNoticeOverride(nt); } }}>
                    {tplOptions.map(t => <option key={t.id} value={t.id}>{t.name}{t.source === 'custom' ? ' (custom)' : ''}</option>)}
                  </select>
                </div>
              )}
              {preview && (
                <div className="mt-2">
                  {rendering && !rendered ? (
                    <div className="flex items-center gap-2 text-[11.5px] text-[#8a8f8c] bg-[#fafbfa] border border-[#eef0ee] rounded-lg px-3 py-2.5"><Loader2 size={12} className="animate-spin" /> Rendering…</div>
                  ) : (
                    <pre className="whitespace-pre-wrap text-[11.5px] leading-relaxed font-sans bg-[#fafbfa] border border-[#eef0ee] rounded-lg px-3 py-2.5 max-h-56 overflow-y-auto" style={rendering ? { opacity: 0.6 } : undefined}>{previewText}</pre>
                  )}
                  {rendered && <p className="text-[10.5px] text-[#8a8f8c] mt-1">From your “{chosenTpl?.name ?? NOTICE_TYPE_LABELS[noticeType]}” template — change the wording under Templates → Legal.</p>}
                  <button type="button" onClick={() => void copy()} className={btnSm + ' mt-2 inline-flex items-center gap-1.5'}>{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy text'}</button>
                </div>
              )}
              {!preview && <p className="text-[11px] text-[#8a8f8c] mt-1">A plain text notice merged from the fields above — copy it into your letter or message.</p>}
            </section>

            <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
              <div className="text-[12px] font-bold">{checklist.length ? '6' : '5'} · Proof it was served</div>
              <p className="text-[11px] text-[#8a8f8c] mt-0.5 mb-2">Optional now — <b>required before the case can be filed</b>. Attach the courier receipt, registered-mail slip or notarised delivery.</p>
              <label className="flex items-center gap-2 text-xs text-[#5b615e] border border-dashed border-[#d8d6d0] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-[#f9f8f6]">
                <UploadCloud size={14} className="text-[#1a7a52]" />
                {proof ? proof.name : 'Attach proof (PDF or photo)'}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf" onChange={e => { setProof(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              </label>
            </section>
          </div>

          {error && <p className="lg:col-span-2 text-xs text-[#b42318] bg-[#fdecea] rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-[#f1f3f1] flex items-center justify-between gap-2 sticky bottom-0 bg-white">
          <span className="text-[11px] text-[#8a8f8c]">{checklist.length && !allTicked ? 'Tick the checklist to continue.' : ' '}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btn}>Cancel</button>
            <button type="button" onClick={() => void submit()} disabled={!canSubmit} className={btnPrimary + ' inline-flex items-center gap-1.5'}>
              {saving && <Loader2 size={13} className="animate-spin" />} {saving ? 'Starting…' : 'Start notice'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
