/**
 * Lead Detail — the single-lead workspace in the Operations "quest-page" design
 * system (Manrope · lucide · QuestMap journey + action card). Faithful port of
 * the approved mock (Business Decision Reports/leads-detail-stages.html), but it
 * renders the ONE real state derived from the lead's live data — no selector,
 * no group/substate chips. The state "falls out" of the data + the primary
 * action for the stage (see getPrimary / getUrgency in @/lib/leadJourney).
 *
 * Action card only — no persistent Payments/Documents/Notes sections below it.
 * After any action we refetch the lead so the page reflects the new state.
 *
 * Manager mirror: pass ?rp=<id> and every call is rewritten to /api/manager/...
 * via leadUrl() (the manager single-lead GET returns the same raw-entity shape).
 */
'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Eye, UserPlus, FolderOpen, Wallet, Receipt, BadgeCheck,
  FileText, Check, X, ArrowRight, ArrowLeft, ChevronRight,
  MapPin, Clock, Building2, MessageSquare, RotateCcw,
  TriangleAlert, CircleAlert, Plus, UserX,
  Loader2, Calendar, CreditCard, UploadCloud, Trash2, ClipboardList,
  ShieldAlert, Send, Copy,
} from 'lucide-react';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { getRequiredDocs, type DocReq } from '@/lib/docRequirements';
import { openDocViewer } from '@/lib/docViewer';
import { openDocsTogether } from '@/lib/openDocsTogether';
import { DocumentReaderModal, type ReaderSlot, type ReaderFile } from '@/components/upnow/DocumentReaderModal';
import { putKycSlot } from '@/lib/kycSlotUpload';
import { REQUESTABLE_DOCS, additionalDocKey, parseAdditionalDocs, resolveRequestedDocKey } from '@/lib/requestableDocs';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';
import { PreferredDayPicker } from '@/components/PreferredDayPicker';
import {
  type ApiLead, type LeadStage, type PaymentPlanItem, type LeadChequeRecord,
  type PaymentMethodKind, type ApiViewing,
  STAGE_LABELS, getPendingViewing, getLatestViewing, getUrgency, getPrimary,
} from '@/lib/leadJourney';

/* ─── Formatting ──────────────────────────────────────────────────────────── */
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE,
  });
}
function fmtDateOnly(ymd: string) {
  // YYYY-MM-DD (no time) — render without tz shifting the day.
  const d = new Date(ymd + (ymd.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AE', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE,
  });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE });
}
const aed = (fils: number) => `AED ${(fils / 100).toLocaleString('en-AE')}`;
const aedWhole = (n: number) => `AED ${Number(n).toLocaleString('en-AE')}`;

/* ─── Manager URL rewrite (mirrors leads/page.tsx leadUrl) ────────────────── */
function leadUrl(path: string, manager?: { rp: number } | null): string {
  if (!manager) return path;
  const swapped = path.replace('/api/leads', '/api/manager/leads');
  return swapped + (swapped.includes('?') ? '&' : '?') + `rp=${manager.rp}`;
}

/* ─── Documents (fetched separately — getLeadById does not include them) ───── */
type TenantDoc = {
  id: number; documentKey: string; displayName: string | null;
  fileUrl: string; mimeType: string | null; status: string;
  notes?: string | null;
};
type DocState = 'approved' | 'pending' | 'rejected' | 'docmiss';
function docState(status: string | undefined, onFile: boolean): DocState {
  if (!onFile) return 'docmiss';
  if (status === 'processed') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'pending'; // pending / attached
}

/* ─── Fee-rule / plan-form shared logic (ported verbatim from leads/page.tsx) ─ */
interface FeeRuleDto {
  feeType: string;
  valueType: 'fixed_aed' | 'percentage';
  value: number;
  vatApplicable: boolean;
  vatRate: number;
  isActive?: boolean;
}
type FeeRulesMap = Record<string, FeeRuleDto[]>;

const COMMERCIAL_UNIT_TYPES = new Set([
  'retail_shop','showroom','office_fitted','office_shell_core',
  'restaurant_fnb','clinic_medical','coworking_desk','private_office',
  'meeting_room','day_office','event_hall','wedding_venue',
  'conference_hall','private_dining','outdoor_venue',
]);
const INDUSTRIAL_UNIT_TYPES = new Set([
  'warehouse','open_yard','storage_unit','cold_storage','logistics_facility',
]);
function unitSpaceCategory(unitType?: string | null): 'residential' | 'commercial' | 'industrial' {
  if (!unitType) return 'residential';
  if (INDUSTRIAL_UNIT_TYPES.has(unitType)) return 'industrial';
  if (COMMERCIAL_UNIT_TYPES.has(unitType)) return 'commercial';
  return 'residential';
}
function feeToAed(rule: FeeRuleDto, annualRentAed: number): string {
  if (rule.valueType === 'percentage') return String(Math.round(annualRentAed * rule.value / 100));
  return String(rule.value);
}

const PAYMENT_METHOD_LABEL: Record<PaymentMethodKind, string> = {
  cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', cash: 'Cash',
};
const CHEQUE_STATUSES = ['pending', 'cleared', 'bounced', 'cancelled'] as const;
type ChequeRowStatus = typeof CHEQUE_STATUSES[number];

/** Increment the trailing numeric portion of a cheque serial, e.g. "CK001234" → "CK001235". */
function nextSerial(base: string, offset = 1): string {
  const match = base.match(/^(.*?)(\d+)$/);
  if (!match) return base;
  const [, prefix, digits] = match;
  const next = (parseInt(digits, 10) + offset).toString().padStart(digits.length, '0');
  return prefix + next;
}

// Timezone-safe month shift on a YYYY-MM-DD string.
function addMonthsToISO(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  let newY = y, newM = m + months;
  while (newM > 12) { newM -= 12; newY += 1; }
  while (newM < 1)  { newM += 12; newY -= 1; }
  const lastDay = new Date(Date.UTC(newY, newM, 0)).getUTCDate();
  return `${newY}-${String(newM).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}
function installmentsFromStart(startDate: string, installments: number): string[] {
  if (!startDate || installments <= 1) return Array.from({ length: Math.max(0, installments - 1) }, () => '');
  const interval = 12 / installments;
  return Array.from({ length: installments - 1 }, (_, i) => addMonthsToISO(startDate, Math.round((i + 1) * interval)));
}

/* ─── Journey nodes (must match the mock) ─────────────────────────────────── */
const NODES = ['Viewing', 'Interested', 'Documents', 'Payment plan', 'Payment advice', 'Converted'] as const;
const NODE_ICON = [Eye, UserPlus, FolderOpen, Wallet, Receipt, BadgeCheck];

type Tone = 'action' | 'waiting' | 'celebrate' | 'danger' | 'neutral';

/** Journey node index (0–5) for a stage. Terminal 'rejected' is treated as
 *  node 1 (like the mock) but rendered as "Closed". */
function stageNode(stage: LeadStage): number {
  switch (stage) {
    case 'viewing_scheduled': return 0;
    case 'interested':        return 1;
    case 'documents_collection': return 2;
    case 'approved':             return 3; // docs approved — plan draft (RP reviewing before sharing)
    case 'payment_plan_shared':  return 3;
    case 'cheques_submitted':    return 4;
    case 'cheques_collected':    return 4;
    case 'converted':            return 5;
    case 'rejected':             return 1;
    default:                     return 0; // legacy/stray
  }
}

/* ─── QuestMap — serpentine SVG journey (ported from the mock renderMap) ───── */
function QuestMap({ current, selected, tone, rejected, onSelect }: { current: number; selected: number; tone: Tone; rejected: boolean; onSelect: (n: number) => void }) {
  const W = 332, topPad = 56, gap = 108, innerH = topPad + 56 + (NODES.length - 1) * gap;
  const xs = NODES.map((_, i) => 166 + (i % 4 === 1 ? 70 : i % 4 === 3 ? -70 : 0));
  const ys = NODES.map((_, i) => topPad + i * gap);
  const celebrate = tone === 'celebrate';
  // Progress (filled/solid) tracks the ACTUAL stage; the ring tracks the step
  // you've clicked to inspect (selected). Default selected === current.
  const done = NODES.map((_, i) => i < current || (i === current && celebrate));
  const doneCount = done.filter(Boolean).length;

  const segp = (i: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[i] + ys[i + 1]) / 2;
    return `M ${xs[i]} ${ys[i]} C ${cx} ${cy}, ${cx} ${cy}, ${xs[i + 1]} ${ys[i + 1]}`;
  };

  const yiCls = selected < current ? 'done' : selected > current ? 'neutral'
    : (celebrate ? 'done' : rejected ? 'neutral' : (tone === 'neutral' ? 'neutral' : 'here'));
  const YiIcon = selected < current ? BadgeCheck : selected > current ? MapPin
    : (celebrate ? BadgeCheck : rejected ? UserX : MapPin);
  const yl = selected === current ? (celebrate ? 'Complete' : rejected ? 'Closed' : 'Current step')
    : selected < current ? 'Completed step' : 'Upcoming step';

  return (
    <div className="qmap">
      <div className="qmap-h">
        <span className="qmap-l"><MapPin size={13} /> Lead journey</span>
        <span className="qmap-c">{doneCount}/{NODES.length} complete</span>
      </div>
      <svg viewBox={`0 0 ${W} ${innerH}`} width="100%" height={innerH} style={{ display: 'block' }}>
        {NODES.slice(0, -1).map((_, i) => {
          const solid = done[i] && done[i + 1];
          return (
            <path key={`seg-${i}`} d={segp(i)} fill="none"
              stroke={solid ? 'var(--jade-deep)' : 'var(--mute)'}
              strokeWidth={solid ? 3 : 2}
              strokeDasharray={solid ? undefined : '2 7'}
              strokeLinecap="round" opacity={solid ? 1 : 0.5} />
          );
        })}
        {NODES.map((label, j) => {
          const dn = done[j], selc = j === selected, isCur = j === current, cx = xs[j], cy = ys[j], r = selc ? 22 : 18;
          const fill = dn ? 'var(--jade-deep)' : '#fff';
          const stroke = selc ? 'var(--brick)' : dn ? 'var(--jade-deep)' : 'var(--mist-strong)';
          const icol = dn ? '#fff' : selc ? 'var(--brick)' : 'var(--mute)';
          const lcol = dn ? 'var(--jade-deep)' : selc ? 'var(--brick)' : 'var(--mute)';
          const Ic = NODE_ICON[j];
          return (
            <g key={`wp-${j}`} className="wp" onClick={() => onSelect(j)}>
              {selc && !dn && (
                <circle cx={cx} cy={cy} r={30} fill="var(--brick)" opacity={0.14}>
                  <animate attributeName="r" values="22;34;22" dur="2.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.22;0;0.22" dur="2.4s" repeatCount="indefinite" />
                </circle>
              )}
              <ellipse cx={cx + 1} cy={cy + r + 3} rx={r * 0.7} ry={3} fill="var(--ink)" opacity={0.08} />
              <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={selc ? 3 : 2} />
              <g transform={`translate(${cx + r - 5},${cy - r + 5})`}>
                <circle r={8} fill="var(--ink)" />
                <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={9} fontWeight={700}>{j + 1}</text>
              </g>
              {/* lucide glyph, hand-placed like the mock's wpIcon */}
              <foreignObject x={cx - 10} y={cy - 10} width={20} height={20}>
                <Ic size={20} color={icol} strokeWidth={1.8} />
              </foreignObject>
              <text x={cx} y={cy + r + 18} textAnchor="middle" fontSize={11} fontWeight={600} fill={lcol}>{label}</text>
              <text x={cx} y={cy + r + 30} textAnchor="middle" fontSize={10} fill={selc ? 'var(--brick)' : 'var(--mute)'}>
                {dn ? 'done' : isCur ? 'here' : ''}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="youare">
        <span className={`yi ${yiCls}`}><YiIcon size={15} /></span>
        <div style={{ flex: 1 }}>
          <div className="yl">{yl}</div>
          <div className="yv">{NODES[selected]}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── StepPreview: read-only view when you click a non-current journey step ─── */
const STEP_BLURB = [
  'The customer booked a viewing and reviews the payment summary you offer.',
  'The customer expressed interest — an initial payment plan was auto-generated and KYC document collection begins.',
  'The customer uploads KYC documents for you to review, approve or reject.',
  'The payment plan is shared with the customer, who uploads a cheque attachment per instalment.',
  'The customer submits their payment advice; approving it converts the lead into a contract.',
  'The lead has been converted into a tenancy contract.',
];
function StepPreview({ node, current, onBack }: { node: number; current: number; onBack: () => void }) {
  const Icon = NODE_ICON[node];
  const done = node < current;
  return (
    <div className="acard">
      <div className="ahead">
        <div className="ahl">
          <div className={`heroicon ${done ? 'celebrate' : 'neutral'}`}><Icon size={26} /></div>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Step {node + 1} · {NODES[node]}</div>
            <h2>{NODES[node]}</h2>
          </div>
        </div>
        <span className={`pill ${done ? 'celebrate' : 'neutral'}`}>{done ? 'Completed' : 'Upcoming'}</span>
      </div>
      <p className="abody">{STEP_BLURB[node]}</p>
      <div className="action-body">
        <div className="note" style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          {done
            ? <BadgeCheck size={15} style={{ color: 'var(--jade-deep)', flexShrink: 0 }} />
            : <Clock size={15} style={{ color: 'var(--mute)', flexShrink: 0 }} />}
          <span>{done ? 'This step is complete — you’re viewing it read-only.' : `Not reached yet — the lead is currently at “${NODES[current]}”.`}</span>
        </div>
        <button className="btn btn-jade btn-block" onClick={onBack}>Return to current step <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

/* ─── Small presentational helpers ────────────────────────────────────────── */
function Banner({ tone, title, body, quote }: { tone: Tone; title: string; body: string; quote?: string }) {
  const Ic = tone === 'danger' ? TriangleAlert : tone === 'waiting' ? Clock : CircleAlert;
  return (
    <div className={`qbanner ${tone}`}>
      <span className="bic"><Ic size={18} /></span>
      <div>
        <p className="bt">{title}</p>
        <p className="bp">{body}</p>
        {quote && <div className="quote">{quote}</div>}
      </div>
    </div>
  );
}

function DocItem({ state, name, status, children }: { state: DocState; name: string; status: string; children?: React.ReactNode }) {
  return (
    <div className={`docitem ${state}${state === 'docmiss' && status.toLowerCase().includes('required') ? ' req' : ''}`}>
      <FileText size={15} />
      <div><span className="dn">{name}</span><span className="ds">{status}</span></div>
      {children && <div className="dacts">{children}</div>}
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const leadId = Number(id);
  const router = useRouter();
  const search = useSearchParams();
  const rpParam = search.get('rp');
  const manager = rpParam ? { rp: Number(rpParam) } : null;

  const [lead, setLead] = useState<ApiLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docs, setDocs] = useState<TenantDoc[] | null>(null);
  const [cheques, setCheques] = useState<LeadChequeRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Which journey step the RP has clicked to inspect. null → follow the real
  // current stage (default). Non-null → viewing another step read-only.
  const [selNode, setSelNode] = useState<number | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);   // reopen-with-note modal
  const [reopenNote, setReopenNote] = useState('');

  // RP settings needed by the plan editor (fee prefill, preferred days, allowed
  // instalment counts) — same sources as the list page's page-level fetches.
  const [feeRules, setFeeRules] = useState<FeeRulesMap | null>(null);
  const [preferredStartDays, setPreferredStartDays] = useState<number[]>([]);
  const [allowedInstallments, setAllowedInstallments] = useState<number[]>([]);

  // Refetch the lead's cheques — extends fetchLead so the cheque panel reflects
  // the newest state after any mutating action. Exposed so child handlers can
  // refresh after RP-record / status / mapping mutations too.
  const fetchCheques = useCallback(async () => {
    const res = await fetch(leadUrl(`/api/leads/${leadId}/cheques`, manager), { credentials: 'include', cache: 'no-store' });
    if (res.ok) setCheques(await res.json());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, rpParam]);

  // `showSpinner` gates the full-page loader — true on first load / navigation,
  // false on the post-action refetch so the card doesn't flash to "Loading…".
  const fetchLead = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(leadUrl(`/api/leads/${leadId}`, manager), { credentials: 'include', cache: 'no-store' });
      if (!res.ok) { setLoadError(res.status === 404 ? 'Lead not found.' : 'Failed to load lead.'); setLead(null); return; }
      const data: ApiLead = await res.json();
      setLead(data);
      setSelNode(null); // snap the journey back to the (possibly new) current step
      // Documents live under the customer owner — same source the list page uses.
      if (data.convertedTenant?.id) {
        const dres = await fetch(`/api/documents?ownerType=customer&ownerId=${data.convertedTenant.id}`, { credentials: 'include', cache: 'no-store' });
        if (dres.ok) setDocs(await dres.json());
      } else {
        setDocs([]);
      }
      // Cheques exist once a plan is shared / cheques are submitted or collected.
      if (['payment_plan_shared', 'cheques_submitted', 'cheques_collected', 'interested'].includes(data.stage)) {
        await fetchCheques();
      } else {
        setCheques([]);
      }
    } catch {
      setLoadError('Failed to load lead.');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, rpParam, fetchCheques]);

  // Initial load / navigation — fetchLead flips the loader itself. Matches the
  // effect-driven fetch pattern used throughout this dashboard.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchLead(true); }, [fetchLead]);

  // RP settings (same endpoints the list page uses at page level).
  useEffect(() => {
    fetch('/api/fee-rules', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: FeeRulesMap | null) => { if (data) setFeeRules(data); })
      .catch(() => undefined);
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { profile?: { preferredStartDays?: number[] | null; allowedInstallments?: number[] | null } } | null) => {
        if (Array.isArray(data?.profile?.preferredStartDays)) setPreferredStartDays(data!.profile!.preferredStartDays!);
        if (Array.isArray(data?.profile?.allowedInstallments)) setAllowedInstallments(data!.profile!.allowedInstallments!);
      })
      .catch(() => undefined);
  }, []);

  /* ── Action runners — each hits the real endpoint then refetches ── */
  async function runAction(fn: () => Promise<Response>) {
    setBusy(true); setActionError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError((body as { message?: string }).message ?? 'Action failed.');
        return;
      }
      await fetchLead();
    } catch {
      setActionError('Action failed.');
    } finally {
      setBusy(false);
    }
  }

  const markVisited = (viewingId: number, outcome?: string) => runAction(() =>
    fetch(leadUrl(`/api/leads/viewings/${viewingId}/status`, manager), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed', ...(outcome ? { outcome } : {}) }),
    }));

  const approveDocuments = () => runAction(() =>
    fetch(leadUrl(`/api/leads/${leadId}/approve-documents`, manager), { method: 'PATCH', credentials: 'include' }));

  const sharePlan = () => runAction(() =>
    fetch(leadUrl(`/api/leads/${leadId}/share-plan`, manager), { method: 'PATCH', credentials: 'include' }));

  const approveCheques = () => runAction(() =>
    fetch(leadUrl(`/api/leads/${leadId}/approve-cheques`, manager), { method: 'PATCH', credentials: 'include' }));

  const confirmCollected = () => runAction(() =>
    fetch(leadUrl(`/api/leads/${leadId}/confirm-cheques-collected`, manager), { method: 'PATCH', credentials: 'include' }));

  const setStage = (stage: LeadStage) => runAction(() =>
    fetch(leadUrl(`/api/leads/${leadId}/stage`, manager), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    }));

  // Reopen revives the viewing + stage server-side so the CUSTOMER stops showing
  // "declined" too, and carries the RP's note (e.g. a revised price) to the customer.
  const reopenLead = (note?: string) => runAction(() =>
    fetch(leadUrl(`/api/leads/${leadId}/reopen`, manager), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note ?? '' }),
    }));

  const verifyDoc = (docId: number) => runAction(async () => {
    const r = await fetch(`/api/documents/${docId}/verify`, { method: 'POST', credentials: 'include' });
    if (r.ok) setDocs(prev => prev ? prev.map(d => d.id === docId ? { ...d, status: 'processed' } : d) : prev);
    return r;
  });
  // Doc-reject DOES take an optional {reason} — mirrors handleRejectDoc on the list page.
  const rejectDoc = (docId: number, reason?: string) => runAction(async () => {
    const r = await fetch(`/api/documents/${docId}/reject`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
    });
    if (r.ok) setDocs(prev => prev ? prev.map(d => d.id === docId ? { ...d, status: 'rejected', notes: reason?.trim() || d.notes } : d) : prev);
    return r;
  });

  // RP uploads a required/additional document on the customer's behalf (written
  // under the customer owner; backend auto-verifies RP/manager uploads).
  const uploadDocForCustomer = async (req: { key: string; label: string; category: string }, file: File) => {
    const ownerId = lead?.convertedTenant?.id;
    if (!ownerId) throw new Error('Convert the lead to a customer first.');
    const existing = (docs ?? []).find(d => d.documentKey === req.key);
    await putKycSlot({
      ownerType: 'customer', ownerId,
      canonicalKey: req.key, category: req.category, displayName: req.label,
      file, existingDocId: existing?.id ?? null, existingKey: existing?.documentKey ?? null,
    });
    // Refetch docs bypassing any guard so the checklist re-renders.
    const dres = await fetch(`/api/documents?ownerType=customer&ownerId=${ownerId}`, { credentials: 'include', cache: 'no-store' });
    if (dres.ok) setDocs(await dres.json());
  };

  // Save the RP's additional-documents request list → additional-docs-note.
  const saveDocsNote = (items: string[]) => runAction(() =>
    fetch(leadUrl(`/api/leads/${leadId}/additional-docs-note`, manager), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }));

  // Issue OR edit the payment plan (same endpoint) — body built by the plan form.
  const issuePlan = (body: Record<string, unknown>) => runAction(() =>
    fetch(leadUrl(`/api/leads/${leadId}/issue-payment-plan`, manager), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));

  /* ── Cheque mutations (no full refetch — patch the local list, mirrors list page) ── */
  const recordCheque = async (payload: { chequeSerial: string; bankName: string; amountFils: number; dueDate: string; notes: string }) => {
    const res = await fetch(leadUrl(`/api/leads/${leadId}/cheques`, manager), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? 'Failed to record');
    setCheques(prev => [...prev, body]);
  };
  const deleteCheque = async (chequeId: number) => {
    const res = await fetch(leadUrl(`/api/leads/${leadId}/cheques/${chequeId}`, manager), { method: 'DELETE', credentials: 'include' });
    if (res.ok) setCheques(prev => prev.filter(c => c.id !== chequeId));
  };
  const setChequeStatus = async (chequeId: number, status: ChequeRowStatus) => {
    const res = await fetch(leadUrl(`/api/leads/${leadId}/cheques/${chequeId}/status`, manager), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.id) setCheques(prev => prev.map(c => c.id === body.id ? body : c));
  };
  // Tag a customer upload with the verified method + which plan installment it settles.
  const tagCheque = async (chequeId: number, patch: { paymentMethod?: PaymentMethodKind; planItemIndex?: number | null; chequeSerial?: string }) => {
    const res = await fetch(leadUrl(`/api/leads/${leadId}/cheques/${chequeId}/status`, manager), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.id) setCheques(prev => prev.map(c => c.id === body.id ? body : c));
    else if (!res.ok) throw new Error(body.message ?? 'Failed to tag payment');
  };
  // Set the RP-chosen method / reference on a plan item (independent of uploads).
  const setPlanItemMethod = async (patch: { itemIndex: number; paymentMethod?: PaymentMethodKind; reference?: string }) => {
    const res = await fetch(leadUrl(`/api/leads/${leadId}/plan-item-method`, manager), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.message ?? 'Failed to set method'); }
  };

  /* ── Loading / error ── */
  if (loading) {
    return (
      <div className="quest-page">
        <div className="wrap" style={{ padding: 40, textAlign: 'center', color: 'var(--mute)' }}>
          <Loader2 size={22} className="animate-spin" style={{ display: 'inline-block' }} /> Loading lead…
        </div>
        <GlobalStyle />
      </div>
    );
  }
  if (loadError || !lead) {
    return (
      <div className="quest-page">
        <div className="wrap">
          <button className="backbtn" onClick={() => router.back()} style={{ marginBottom: 16 }}><ArrowLeft size={18} /></button>
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--mute)' }}>{loadError ?? 'Lead not found.'}</div>
        </div>
        <GlobalStyle />
      </div>
    );
  }

  /* ── Derived state (real data → the one rendered view) ── */
  const displayName = lead.convertedTenant?.user?.name ?? lead.customerName;
  const email  = lead.leadEmail ?? lead.convertedTenant?.user?.email ?? null;
  const phone  = lead.leadPhone ?? lead.convertedTenant?.user?.phone ?? null;
  const unitLabel = lead.unit?.unitName ?? (lead.unit ? `Unit ${lead.unit.unitNumber}` : '—');
  const building  = lead.unit?.property?.buildingName ?? null;
  const node = stageNode(lead.stage);
  const effNode = selNode ?? node;              // journey step currently on screen
  const viewingCurrent = effNode === node;      // true → full interactive card; false → read-only preview
  const urgency = getUrgency(lead);
  const primary = getPrimary(lead);
  const pendingViewing = getPendingViewing(lead);
  const latestViewing = getLatestViewing(lead);
  const plan = lead.paymentPlan ?? null;
  const rejected = lead.stage === 'rejected';
  const converted = lead.stage === 'converted';

  // Annual rent (whole AED) — from the firm plan if issued, else the unit price.
  const annualRentAed = plan ? plan.rentFils / 100 : (lead.unit?.rentalPrice != null ? Number(lead.unit.rentalPrice) : null);
  const planLabel = plan ? `${plan.chequeCount} cheque${plan.chequeCount === 1 ? '' : 's'}` : null;
  const moveIn = plan?.items?.find(it => it.type === 'first_bundle')?.dueDate
    ?? plan?.items?.slice().sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0]?.dueDate
    ?? latestViewing?.desiredMoveIn?.slice(0, 10) ?? null;

  // Tone/hero/headline/eyebrow/body — derived from stage + urgency (the mock's
  // per-state map, collapsed to the single real branch).
  const view = deriveView({ lead, urgency, primary, pendingViewing, docs });

  // "Open lease" deep-link: when we know the created contract, jump straight to
  // the New Lease tab in Operations with that lease highlighted; otherwise fall
  // back to a name search so the RP can still find it.
  const openLeaseHref = manager
    ? `/dashboard/manager/contracts${manager ? `?rp=${manager.rp}` : ''}${lead.contractId ? `&focus=c-${lead.contractId}` : ''}`
    : lead.contractId
      ? `/rental-provider/dashboard/operations?tab=new&focus=c-${lead.contractId}`
      : `/rental-provider/dashboard/operations?q=${encodeURIComponent(displayName)}`;

  /* ── Header actions ── */
  const headerActions = (
    <div className="rhs">
      {rejected ? (
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setReopenNote(''); setReopenOpen(true); }}>
          <RotateCcw size={14} /> Reopen
        </button>
      ) : converted ? (
        <button className="btn btn-ghost btn-sm" onClick={() => router.push(openLeaseHref)}>
          <ArrowRight size={14} /> Open lease
        </button>
      ) : (
        <>
          {email && <a className="btn btn-ghost btn-sm" href={`mailto:${email}`}><MessageSquare size={14} /> Message</a>}
          {!email && phone && <a className="btn btn-ghost btn-sm" href={`tel:${phone}`}><MessageSquare size={14} /> Message</a>}
          {/* Lead-reject is REASONLESS — the list page rejects via
              PATCH /api/leads/:id/stage {stage:'rejected'} with no reason field
              or endpoint (only DOCUMENT reject takes {reason}). We keep it
              reasonless here too, gated by a confirm to avoid an accidental close. */}
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }}
            disabled={busy} onClick={() => { if (window.confirm(`Reject this lead? You can reopen ${displayName} later.`)) setStage('rejected'); }}>
            <X size={14} /> Reject
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="quest-page">
      <div className="wrap">
        {/* Header */}
        <div className="qhead">
          <div className="lhs">
            <button className="backbtn" onClick={() => router.back()}><ArrowLeft size={18} /></button>
            <div>
              <h1>
                Lead-{lead.id}
                <span className={`pill ${view.tone === 'danger' ? 'action' : view.tone === 'declined' ? 'declined' : view.tone}`}>{view.pill}</span>
              </h1>
              <div className="hsub">
                <Building2 size={13} />
                {building && <span>{building}</span>}
                {building && <ChevronRight size={12} />}
                <span>{unitLabel}</span>
                <ChevronRight size={12} />
                <span>Lead-{lead.id}</span>
                {lead.source && <> · {lead.source}</>}
              </div>
            </div>
          </div>
          {headerActions}
        </div>

        {/* Info bar */}
        <div className="infobar">
          <div className="pitem"><span className="pk">Customer</span><span className="pv">{displayName}</span></div>
          {phone && <div className="pitem"><span className="pk">Phone</span><span className="pv">{phone}</span></div>}
          <span className="isep" />
          {annualRentAed != null && <div className="pitem"><span className="pk">Annual rent</span><span className="pv">{aedWhole(annualRentAed)}</span></div>}
          {planLabel && <div className="pitem"><span className="pk">Plan</span><span className="pv">{planLabel}</span></div>}
          {moveIn && <div className="pitem"><span className="pk">Move-in</span><span className="pv">{fmtDateOnly(moveIn)}</span></div>}
        </div>

        {/* Banner — only when real data warrants one */}
        {view.banner && <div style={{ marginBottom: 16 }}><Banner {...view.banner} /></div>}
        {actionError && <div style={{ marginBottom: 16 }}><Banner tone="danger" title="Action failed" body={actionError} /></div>}

        {/* Journey + action card */}
        <div className="quest">
          <QuestMap current={node} selected={effNode} onSelect={setSelNode}
            tone={view.tone === 'declined' ? 'neutral' : view.tone} rejected={rejected} />

          {viewingCurrent ? (
          <div className="acard">
            <div className="ahead">
              <div className="ahl">
                <div className={`heroicon ${view.tone === 'danger' ? 'action' : view.tone === 'declined' ? 'declined' : view.tone}`}>
                  <view.HeroIcon size={26} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="eyebrow">{view.eyebrow}</div>
                  <h2>{view.headline}</h2>
                </div>
              </div>
              <span className={`pill ${view.tone === 'danger' ? 'action' : view.tone === 'declined' ? 'declined' : view.tone}`}>{view.pill}</span>
            </div>
            <p className="abody">{view.body}</p>

            <div className="action-body">
              <StageBody
                lead={lead} plan={plan} docs={docs} cheques={cheques} busy={busy}
                pendingViewing={pendingViewing} latestViewing={latestViewing}
                annualRentAed={annualRentAed}
                feeRules={feeRules} preferredStartDays={preferredStartDays} allowedInstallments={allowedInstallments}
                onMarkVisited={markVisited}
                onApproveDocuments={approveDocuments}
                onSharePlan={sharePlan}
                onApproveCheques={approveCheques}
                onConfirmCollected={confirmCollected}
                onReopen={() => { setReopenNote(''); setReopenOpen(true); }}
                onVerifyDoc={verifyDoc}
                onRejectDoc={rejectDoc}
                onUploadDoc={uploadDocForCustomer}
                onSaveDocsNote={saveDocsNote}
                onIssuePlan={issuePlan}
                onRecordCheque={recordCheque}
                onDeleteCheque={deleteCheque}
                onSetChequeStatus={setChequeStatus}
                onTagCheque={tagCheque}
                onSetPlanItemMethod={setPlanItemMethod}
                onOpenLease={() => router.push(openLeaseHref)}
              />
            </div>

            <div className="timing">
              <Clock size={12} /> Last updated {fmtDateTime(lead.updatedAt)} · created {fmtDate(lead.createdAt)}
            </div>
          </div>
          ) : (
            <StepPreview node={effNode} current={node} onBack={() => setSelNode(null)} />
          )}
        </div>
      </div>

      {/* Reopen-with-note modal — the note is carried to the customer (e.g. a
          revised price / negotiation) so a reopen is never silent. */}
      {reopenOpen && (
        <div className="qmodal-scrim" onClick={() => setReopenOpen(false)}>
          <div className="qmodal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="subhead"><RotateCcw size={13} /> Reopen lead</div>
            <p className="note" style={{ margin: '0 0 10px' }}>Add a note for the customer (optional) — e.g. a revised price or why you’re reopening. They’ll see it on their viewing.</p>
            <textarea className="qinput" rows={4} style={{ resize: 'vertical' }} autoFocus value={reopenNote} onChange={e => setReopenNote(e.target.value)}
              placeholder="e.g. We can offer AED 120,000 — happy to discuss. Please take another look." />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-jade btn-sm" disabled={busy} onClick={() => { reopenLead(reopenNote); setReopenOpen(false); }}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <><RotateCcw size={14} /> Reopen &amp; notify customer</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setReopenOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <GlobalStyle />
    </div>
  );
}

/* ─── deriveView: stage + urgency → the single rendered view ───────────────── */
type View = {
  tone: Tone | 'declined';
  pill: string;
  eyebrow: string;
  headline: string;
  body: string;
  HeroIcon: React.ComponentType<{ size?: number }>;
  banner?: { tone: Tone; title: string; body: string; quote?: string };
};

function deriveView({ lead, urgency, primary, pendingViewing, docs }: {
  lead: ApiLead;
  urgency: ReturnType<typeof getUrgency>;
  primary: ReturnType<typeof getPrimary>;
  pendingViewing: ReturnType<typeof getPendingViewing>;
  docs: TenantDoc[] | null;
}): View {
  const stage = lead.stage;

  // Additional-doc request outstanding? (blocks the customer at Documents)
  let additionalDocs: string[] = [];
  try { additionalDocs = lead.additionalDocsNote ? (JSON.parse(lead.additionalDocsNote) as string[]) : []; } catch { additionalDocs = []; }
  const hasAdditionalReq = additionalDocs.length > 0;

  // A rejected doc present?
  const hasRejectedDoc = (docs ?? []).some(d => d.status === 'rejected');

  const urgencyBanner = urgency
    ? { tone: (urgency.level === 'red' ? 'danger' : 'waiting') as Tone, title: urgency.label, body: 'This lead is on the needs-action list. Idle thresholds escalate amber → red.' }
    : undefined;

  switch (stage) {
    case 'viewing_scheduled': {
      const overdue = pendingViewing && new Date(pendingViewing.scheduledAt).getTime() < Date.now();
      if (urgency && overdue) {
        return {
          tone: urgency.level === 'red' ? 'danger' : 'waiting',
          pill: urgency.level === 'red' ? 'Overdue' : 'Your turn',
          eyebrow: 'Step 1 · Viewing',
          headline: urgency.label,
          body: 'The scheduled viewing has passed with no recorded outcome. Mark it visited (or reschedule) to keep the lead moving.',
          HeroIcon: urgency.level === 'red' ? TriangleAlert : Clock,
          banner: urgencyBanner,
        };
      }
      return {
        tone: 'waiting', pill: 'Waiting on customer',
        eyebrow: 'Step 1 · Viewing',
        headline: pendingViewing?.status === 'confirmed' ? 'Viewing confirmed' : 'Viewing scheduled',
        body: 'A viewing is booked. The customer is reviewing the payment summary you are offering — you see the same figures. Mark it visited once they have seen the unit.',
        HeroIcon: Calendar,
      };
    }
    case 'interested':
      return {
        tone: 'action', pill: urgency ? 'Needs action' : 'Your turn',
        eyebrow: 'Step 2 · Interested',
        headline: urgency ? 'Interested — no next step' : 'Interested — review documents',
        body: 'The customer expressed interest and an initial payment plan was auto-generated. They can now upload KYC documents; review them to advance.',
        HeroIcon: UserPlus,
        banner: urgencyBanner,
      };
    case 'documents_collection': {
      if (hasRejectedDoc) {
        return {
          tone: 'danger', pill: 'Re-upload needed',
          eyebrow: 'Step 3 · Documents',
          headline: 'A document was rejected',
          body: 'You rejected a document; it is excluded from the received count and the customer sees a re-upload slot. Wait for the re-upload, or upload a replacement yourself.',
          HeroIcon: TriangleAlert,
        };
      }
      if (hasAdditionalReq) {
        return {
          tone: 'waiting', pill: 'Waiting on customer',
          eyebrow: 'Step 3 · Documents',
          headline: 'Additional document requested',
          body: 'You requested an extra document beyond the standard checklist. The customer is held at this step until it arrives.',
          HeroIcon: FileText,
          banner: { tone: 'waiting', title: `Awaiting ${additionalDocs.length} additional document${additionalDocs.length === 1 ? '' : 's'} you requested`, body: 'A custom document request blocks the customer from submitting payment advice until it is uploaded.' },
        };
      }
      return {
        tone: 'action', pill: urgency ? 'Needs action' : 'Your turn',
        eyebrow: 'Step 3 · Documents',
        headline: 'Review the customer’s documents',
        body: 'View each document, then approve, reject, or require more. Approving the required set unlocks the payment plan for the customer.',
        HeroIcon: FolderOpen,
        banner: urgencyBanner,
      };
    }
    case 'approved':
      return {
        tone: 'action', pill: 'Your turn',
        eyebrow: 'Step 4 · Payment plan',
        headline: 'Documents approved — review the plan',
        body: 'Review the payment plan below. Add an instalment, adjust a due date, or apply a discount if needed — then share it with the customer. They won’t see the plan until you share it.',
        HeroIcon: Wallet,
        banner: urgencyBanner,
      };
    case 'payment_plan_shared':
      return {
        tone: 'waiting', pill: urgency ? 'Needs action' : 'Waiting on customer',
        eyebrow: 'Step 4 · Payment plan',
        headline: urgency ? 'Plan shared — follow up' : 'Plan shared — awaiting payment advice',
        body: 'The full plan (instalments, fees, VAT, deposit, payable-to) is shared with the customer, who now uploads a cheque attachment per instalment. You can still edit and re-share it.',
        HeroIcon: Wallet,
        banner: urgencyBanner,
      };
    case 'cheques_submitted':
      return {
        tone: 'action', pill: urgency ? 'Needs action' : 'Your turn',
        eyebrow: 'Step 5 · Payment advice',
        headline: 'Payment advice — review & approve',
        body: 'The customer uploaded a cheque attachment for each instalment. Review each, then approve — which converts the lead into a contract.',
        HeroIcon: Receipt,
        banner: urgencyBanner,
      };
    case 'cheques_collected': {
      const canIssue = !!(lead.unit?.id && lead.convertedTenant?.id);
      return {
        tone: 'danger', pill: canIssue ? 'Blocked' : 'Cannot issue',
        eyebrow: 'Recovery · Payment advice collected',
        headline: canIssue ? 'Contract auto-create failed' : 'Missing unit or customer link',
        body: canIssue
          ? 'The cheques were confirmed but contract creation was blocked (e.g. the unit is still occupied). Fix the blocker and re-issue.'
          : 'This lead is missing its unit or customer link, so no contract can be created and no retry is offered. Repair the link first.',
        HeroIcon: canIssue ? TriangleAlert : CircleAlert,
        banner: {
          tone: 'danger',
          title: canIssue ? 'Contract could not be created automatically' : 'Cannot issue contract — lead is missing its unit or customer link',
          body: canIssue
            ? 'The advice was collected but the contract could not auto-create (overlap guard or a validation error). Re-run once the blocker is cleared.'
            : 'Creating a contract requires both a linked unit and a linked customer profile. Repair the link before retrying.',
        },
      };
    }
    case 'converted':
      return {
        tone: 'celebrate', pill: 'Complete',
        eyebrow: 'Step 6 · Converted',
        headline: 'Lead converted to a contract',
        body: 'Approval auto-created the contract and moved the customer to signing. The lead drops off the live pipeline. The lead cycle ends here.',
        HeroIcon: BadgeCheck,
      };
    case 'rejected':
      return {
        tone: 'declined', pill: 'Rejected',
        eyebrow: 'Closed · Rejected',
        headline: 'Rejected — this lead was declined',
        body: 'The lead moved to the Rejected column and off the active pipeline. Reopening restarts it at Viewing.',
        HeroIcon: UserX,
        banner: lead.rejectionReason ? { tone: 'danger', title: 'Declined', body: lead.rejectionReason } : undefined,
      };
    default:
      // Legacy / stray stage — badge only, no primary action.
      return {
        tone: 'neutral', pill: STAGE_LABELS[stage] ?? 'Lead',
        eyebrow: 'Legacy stage',
        headline: `${STAGE_LABELS[stage] ?? stage}`,
        body: 'This lead is at a legacy or stray stage that is not part of the live funnel. It renders a status badge with no primary action.',
        HeroIcon: FileText,
      };
  }
  // exhaustiveness note: primary is unused directly here but kept for parity with the mock.
  void primary;
}

/* ─── StageBody: the action-body from real data, per stage ─────────────────── */
type StageBodyProps = {
  lead: ApiLead;
  plan: ApiLead['paymentPlan'];
  docs: TenantDoc[] | null;
  cheques: LeadChequeRecord[];
  busy: boolean;
  pendingViewing: ReturnType<typeof getPendingViewing>;
  latestViewing: ReturnType<typeof getLatestViewing>;
  annualRentAed: number | null;
  feeRules: FeeRulesMap | null;
  preferredStartDays: number[];
  allowedInstallments: number[];
  onMarkVisited: (viewingId: number, outcome?: string) => void;
  onApproveDocuments: () => void;
  onSharePlan: () => void;
  onApproveCheques: () => void;
  onConfirmCollected: () => void;
  onReopen: () => void;
  onVerifyDoc: (id: number) => void;
  onRejectDoc: (id: number, reason?: string) => void;
  onUploadDoc: (req: { key: string; label: string; category: string }, file: File) => Promise<void>;
  onSaveDocsNote: (items: string[]) => void;
  onIssuePlan: (body: Record<string, unknown>) => Promise<void> | void;
  onRecordCheque: (payload: { chequeSerial: string; bankName: string; amountFils: number; dueDate: string; notes: string }) => Promise<void>;
  onDeleteCheque: (chequeId: number) => Promise<void>;
  onSetChequeStatus: (chequeId: number, status: ChequeRowStatus) => Promise<void>;
  onTagCheque: (chequeId: number, patch: { paymentMethod?: PaymentMethodKind; planItemIndex?: number | null; chequeSerial?: string }) => Promise<void>;
  onSetPlanItemMethod: (patch: { itemIndex: number; paymentMethod?: PaymentMethodKind; reference?: string }) => Promise<void>;
  onOpenLease: () => void;
};
/* ─── CostSummary: the FULL cost breakdown the customer sees (from lead.costPreview),
 *  mirroring the customer spaces v2 payment summary (rent incl VAT · deposit · admin ·
 *  ejari · commission · custom fees · total payable). Shown at the viewing stage
 *  before a firm plan exists. ──────────────────────────────────────────────────── */
function CostSummary({ cp }: { cp: NonNullable<ApiLead['costPreview']> }) {
  const rows: { label: string; fils: number }[] = [
    { label: `Annual rent${cp.rentVatFils > 0 ? ' (incl. VAT)' : ''}`, fils: cp.rentFils + cp.rentVatFils },
    { label: 'Security deposit', fils: cp.securityDepositFils },
  ];
  if (cp.adminFeeFils > 0) rows.push({ label: `Admin fee${cp.adminFeeVatFils > 0 ? ' (incl. VAT)' : ''}`, fils: cp.adminFeeFils + cp.adminFeeVatFils });
  if (cp.ejariFils > 0) rows.push({ label: `Ejari fee${cp.ejariVatFils > 0 ? ' (incl. VAT)' : ''}`, fils: cp.ejariFils + cp.ejariVatFils });
  if (cp.commissionFils > 0) rows.push({ label: `Commission${cp.commissionVatFils > 0 ? ' (incl. VAT)' : ''}`, fils: cp.commissionFils + cp.commissionVatFils });
  for (const f of cp.customFees ?? []) rows.push({ label: `${f.label}${f.vatFils > 0 ? ' (incl. VAT)' : ''}`, fils: f.netFils + f.vatFils });
  return (
    <div>
      <div className="subhead"><Wallet size={13} /> Payment summary · shared with customer</div>
      <table className="ptable">
        <tbody>{rows.map((r, i) => <tr key={i}><td>{r.label}</td><td className="amt">{aed(r.fils)}</td></tr>)}</tbody>
        <tfoot><tr><td className="tot">Total payable</td><td className="amt tot">{aed(cp.totalFils)}</td></tr></tfoot>
      </table>
    </div>
  );
}

/* ─── NotifyGuard: pre-filled WhatsApp / Email / Copy so the building security
 *  guard is there for the viewing (ported from the leads list "Notify Guard"). ── */
function NotifyGuard({ viewing, unitLabel, building }: { viewing: ApiViewing; unitLabel: string; building: string | null }) {
  const when = fmtDateTime(viewing.scheduledAt);
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState('');
  const [msg, setMsg] = useState(
    `Hi,\n\nPlease be advised that a customer viewing has been scheduled at ${unitLabel}${building ? `, ${building}` : ''} on ${when}.\n\nKindly ensure you are available at the building entrance during this time to assist the customer with access to the property.\n\nThank you.`,
  );
  const [copied, setCopied] = useState(false);
  const digits = contact.replace(/\D/g, '');
  const isEmail = contact.includes('@');
  const isPhone = !isEmail && digits.length >= 7;
  return (
    <>
      <button className="btn btn-ghost btn-block" onClick={() => setOpen(true)}>
        <ShieldAlert size={15} /> Notify guard — be there for the viewing
      </button>
      {open && (
        <div className="qmodal-scrim" onClick={() => setOpen(false)}>
          <div className="qmodal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="subhead"><ShieldAlert size={13} /> Notify security guard</div>
            <p className="note" style={{ margin: '0 0 10px' }}>Viewing at {unitLabel}{building ? ` · ${building}` : ''} — {when}</p>
            <input className="qinput" style={{ marginBottom: 8 }} placeholder="Guard phone or email — +971 50 123 4567 or guard@building.ae"
              value={contact} onChange={e => setContact(e.target.value)} autoFocus />
            <textarea className="qinput" rows={5} style={{ marginBottom: 12, resize: 'vertical' }} value={msg} onChange={e => setMsg(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Send appears once a phone or email is entered — WhatsApp for a number, Email for an address. */}
              {isPhone && (
                <a className="btn btn-sm" style={{ background: '#25d366', color: '#fff' }} target="_blank" rel="noopener noreferrer"
                  href={`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`}><Send size={14} /> Send WhatsApp</a>
              )}
              {isEmail && (
                <a className="btn btn-jade btn-sm"
                  href={`mailto:${contact}?subject=${encodeURIComponent(`Viewing alert — ${unitLabel} on ${when}`)}&body=${encodeURIComponent(msg)}`}><Send size={14} /> Send email</a>
              )}
              {!isEmail && !isPhone && <span className="note">Enter a phone or email to send.</span>}
              <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(msg).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── MarkVisitedButton: marks the viewing completed AND captures the RP's
 *  outcome notes (how the viewing went). ─────────────────────────────────────── */
function MarkVisitedButton({ viewingId, busy, onConfirm }: { viewingId: number; busy: boolean; onConfirm: (viewingId: number, outcome: string) => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  return (
    <>
      <button className="btn btn-jade btn-block" disabled={busy} onClick={() => setOpen(true)}>
        Mark visited <ArrowRight size={15} />
      </button>
      {open && (
        <div className="qmodal-scrim" onClick={() => setOpen(false)}>
          <div className="qmodal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="subhead"><Calendar size={13} /> Record the viewing outcome</div>
            <p className="note" style={{ margin: '0 0 10px' }}>How did the viewing go? Add notes — the customer’s reaction, interest level, next steps. (Optional.)</p>
            <textarea className="qinput" rows={4} style={{ resize: 'vertical' }} autoFocus value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Customer liked the unit, wants a 4-cheque plan; will confirm by Friday…" />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-jade btn-sm" disabled={busy} onClick={() => { onConfirm(viewingId, notes.trim()); setOpen(false); }}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <><Check size={14} /> Save &amp; mark visited</>}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StageBody(props: StageBodyProps) {
  const {
    lead, plan, docs, cheques, busy, pendingViewing, latestViewing, annualRentAed,
    feeRules, preferredStartDays, allowedInstallments,
    onMarkVisited, onApproveDocuments, onSharePlan, onApproveCheques, onConfirmCollected,
    onReopen, onVerifyDoc, onRejectDoc, onUploadDoc, onSaveDocsNote, onIssuePlan,
    onRecordCheque, onDeleteCheque, onSetChequeStatus, onTagCheque, onSetPlanItemMethod,
    onOpenLease,
  } = props;

  switch (lead.stage) {
    /* ── Viewing ── */
    case 'viewing_scheduled': {
      const v = pendingViewing ?? latestViewing;
      const unitLabel = lead.unit?.unitName ?? (lead.unit ? `Unit ${lead.unit.unitNumber}` : 'the unit');
      const building = lead.unit?.property?.buildingName ?? null;
      return (
        <>
          {/* Section 1 · Your viewing — mirrors the customer's two-section layout
              (spaces/v2): a "Your viewing" card + a "Cost summary" card. */}
          {v && (
            <div>
              <div className="subhead"><Calendar size={13} /> Your viewing</div>
              <div className="vcard">
                <div className="vdate">{fmtDate(v.scheduledAt)}</div>
                <div className="vtime">{fmtTime(v.scheduledAt)}</div>
                <div className="vloc">
                  <MapPin size={14} />
                  <span>{building ? `${building}${lead.unit?.unitNumber ? ` · Unit ${lead.unit.unitNumber}` : ''}` : unitLabel}</span>
                </div>
                <div className="vmeta">
                  {v.desiredMoveIn && <span>Desired move-in <b>{fmtDateOnly(v.desiredMoveIn.slice(0, 10))}</b></span>}
                  <span>Status <span className={`cstat ${v.status === 'confirmed' ? 'cleared' : 'pending'}`}>{v.status === 'confirmed' ? 'Confirmed' : 'Scheduled'}</span></span>
                </div>
              </div>
            </div>
          )}
          {/* Section 2 · Cost summary — identical to the customer's spaces/v2 summary. */}
          {lead.costPreview
            ? <CostSummary cp={lead.costPreview} />
            : annualRentAed != null && (
              <div>
                <div className="subhead"><Wallet size={13} /> Payment summary · shared with customer</div>
                <table className="ptable"><tbody>
                  <tr><td>Annual rent</td><td className="amt">{aedWhole(annualRentAed)}</td></tr>
                  {v?.preferredChequeCount ? <tr><td>Preferred cheques</td><td className="amt">{v.preferredChequeCount}</td></tr> : null}
                </tbody></table>
              </div>
            )}
          {pendingViewing
            ? <MarkVisitedButton viewingId={pendingViewing.id} busy={busy} onConfirm={onMarkVisited} />
            : (v && (v.status === 'cancelled' || v.outcome === 'not_interested'))
              ? (
                <>
                  <div className="note">This viewing was cancelled or declined — reactivate it to put the lead (and the customer) back on an active viewing.</div>
                  <button className="btn btn-jade btn-block" disabled={busy} onClick={onReopen}><RotateCcw size={15} /> Reactivate viewing</button>
                </>
              )
              : <div className="note">No active viewing to mark. Waiting for a rebook, or reject the lead.</div>}
          {pendingViewing && <NotifyGuard viewing={pendingViewing} unitLabel={unitLabel} building={building} />}
        </>
      );
    }

    /* ── Interested + Documents (same rich review section) ── */
    case 'interested':
    case 'documents_collection':
      return (
        <DocsSection
          lead={lead} docs={docs} busy={busy}
          onVerifyDoc={onVerifyDoc} onRejectDoc={onRejectDoc}
          onUploadDoc={onUploadDoc} onSaveDocsNote={onSaveDocsNote}
          onApproveDocuments={onApproveDocuments}
        />
      );

    /* ── Payment plan — table + inline editor ── */
    /* ── Plan draft (docs approved) — RP reviews/edits, then shares ── */
    case 'approved':
      return (
        <PlanSection
          lead={lead} plan={plan} busy={busy}
          latestViewing={latestViewing}
          feeRules={feeRules} preferredStartDays={preferredStartDays} allowedInstallments={allowedInstallments}
          onIssuePlan={onIssuePlan}
          shared={false} onSharePlan={onSharePlan}
        />
      );

    case 'payment_plan_shared':
      return (
        <PlanSection
          lead={lead} plan={plan} busy={busy}
          latestViewing={latestViewing}
          feeRules={feeRules} preferredStartDays={preferredStartDays} allowedInstallments={allowedInstallments}
          onIssuePlan={onIssuePlan}
          shared={true} onSharePlan={onSharePlan}
        />
      );

    /* ── Payment advice — review each cheque + approve → convert ── */
    case 'cheques_submitted':
      return (
        <>
          {plan && <PlanTable plan={plan} advice />}
          <ChequesSection
            plan={plan} cheques={cheques} busy={busy}
            onRecordCheque={onRecordCheque} onDeleteCheque={onDeleteCheque}
            onSetChequeStatus={onSetChequeStatus} onTagCheque={onTagCheque}
            onSetPlanItemMethod={onSetPlanItemMethod}
          />
          <button className="btn btn-jade btn-block" disabled={busy} onClick={onApproveCheques}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <>Payment review & approve <ArrowRight size={15} /> convert</>}
          </button>
        </>
      );

    /* ── Recovery — collected but contract auto-create failed ── */
    case 'cheques_collected': {
      const canIssue = !!(lead.unit?.id && lead.convertedTenant?.id);
      return (
        <>
          {plan && <PlanTable plan={plan} advice />}
          <ChequesSection
            plan={plan} cheques={cheques} busy={busy}
            onRecordCheque={onRecordCheque} onDeleteCheque={onDeleteCheque}
            onSetChequeStatus={onSetChequeStatus} onTagCheque={onTagCheque}
            onSetPlanItemMethod={onSetPlanItemMethod}
          />
          {canIssue
            ? <button className="btn btn-jade btn-block" disabled={busy} onClick={onConfirmCollected}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <><RotateCcw size={15} /> Issue contract (retry)</>}
              </button>
            : <div className="note">Repair the unit / customer link on this lead, then the Issue-Contract action returns.</div>}
        </>
      );
    }

    /* ── Converted ── */
    case 'converted':
      return (
        <>
          <div className="donepanel">
            <span className="dp-ic"><BadgeCheck size={18} /></span>
            <div>
              <div className="dp-t">Contract created</div>
              <div className="dp-s">{lead.unit ? `${lead.unit.unitName ?? `Unit ${lead.unit.unitNumber}`}` : ''}{annualRentAed != null ? ` · ${aedWhole(annualRentAed)}/yr` : ''} · now in Operations</div>
            </div>
          </div>
          <button className="btn btn-jade btn-block" onClick={onOpenLease}>Open lease <ArrowRight size={15} /></button>
        </>
      );

    /* ── Rejected ── */
    case 'rejected': {
      // Distinguish a CUSTOMER decline (they marked the viewing "not interested",
      // possibly with a reason) from an RP-side reject (header button, no reason).
      const customerDeclined = latestViewing?.outcome === 'not_interested';
      const declineReason = latestViewing?.declineNote?.trim() || null;
      return (
        <>
          {customerDeclined && declineReason && (
            <Banner
              tone="danger"
              title="Customer’s reason for declining"
              body="They marked this viewing “not interested”. Reopen with a reply if you think you can win them back."
              quote={declineReason}
            />
          )}
          <div className="note" style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <UserX size={15} style={{ color: 'var(--mute)', flexShrink: 0 }} />
            <span>
              {customerDeclined && !declineReason
                ? 'The customer declined without leaving a reason. '
                : 'Lead closed. '}
              Reopening restarts the journey at Viewing.
            </span>
          </div>
          <button className="btn btn-ghost btn-block" disabled={busy} onClick={onReopen}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <><RotateCcw size={15} /> Reopen lead</>}
          </button>
        </>
      );
    }

    default:
      return <div className="note">This stage has no primary action.</div>;
  }
}

/* ─── DocsSection: real docs with View / Approve / Reject-with-reason,
 *  require-additional-document, RP upload-on-behalf + bulk approve. Ports the
 *  list page's docs panel behaviour into the quest-page design. ────────────── */
function DocsSection({
  lead, docs, busy, onVerifyDoc, onRejectDoc, onUploadDoc, onSaveDocsNote, onApproveDocuments,
}: {
  lead: ApiLead;
  docs: TenantDoc[] | null;
  busy: boolean;
  onVerifyDoc: (id: number) => void;
  onRejectDoc: (id: number, reason?: string) => void;
  onUploadDoc: (req: { key: string; label: string; category: string }, file: File) => Promise<void>;
  onSaveDocsNote: (items: string[]) => void;
  onApproveDocuments: () => void;
}) {
  const canUpload = !!lead.convertedTenant?.id;
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: number; label: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  // Additional-docs request list (append a slug via additional-docs-note).
  const [noteItems, setNoteItems] = useState<string[]>(() => parseAdditionalDocs(lead.additionalDocsNote));
  const [docSearch, setDocSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);   // "View all documents" reader popup

  const reqDocs = getRequiredDocs(lead.unit?.unitType);
  const okKeys = new Set((docs ?? []).filter(d => !['missing', 'rejected'].includes(d.status)).map(d => d.documentKey));
  const required = reqDocs.filter(d => d.required);
  const optional = reqDocs.filter(d => !d.required);
  const received = required.filter(d => okKeys.has(d.key)).length;

  // "View all documents" — opens the SHARED DocumentReaderModal (sidebar list +
  // gallery preview) the tenant / property / unit views use, so every surface
  // that previews customer documents looks and behaves the same. Slots mirror the
  // on-page checklist (each requirement, uploaded → its file(s), missing → an
  // empty "Not uploaded" row), then the RP-requested docs, then any loose extras.
  const reqLabel = new Map(reqDocs.map(d => [d.key, d.label]));
  const prettyDocKey = (k: string) => k.replace(/^additional_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const allUploaded = (docs ?? []).filter(d => !!d.fileUrl && d.status !== 'missing');
  const toReaderFile = (d: TenantDoc): ReaderFile => ({ id: d.id, name: d.displayName || reqLabel.get(d.documentKey) || prettyDocKey(d.documentKey), url: d.fileUrl, mimeType: d.mimeType });
  const filesForKey = (key: string) => (docs ?? []).filter(d => d.documentKey === key && d.fileUrl).map(toReaderFile);
  const readerSlots: ReaderSlot[] = [];
  const seenKeys = new Set<string>();
  for (const d of reqDocs) { seenKeys.add(d.key); readerSlots.push({ key: d.key, label: d.label, group: d.required ? 'Required' : 'Supporting', files: filesForKey(d.key) }); }
  for (const item of noteItems) {
    const k = resolveRequestedDocKey(item) ?? additionalDocKey(item);
    if (seenKeys.has(k)) continue;            // already shown as a requirement slot
    seenKeys.add(k);
    readerSlots.push({ key: `req-${k}`, label: item, group: 'Requested by you', files: filesForKey(k) });
  }
  for (const d of (docs ?? [])) {
    if (!d.fileUrl || seenKeys.has(d.documentKey)) continue;   // loose / legacy uploads
    seenKeys.add(d.documentKey);
    readerSlots.push({ key: `x-${d.id}`, label: toReaderFile(d).name, group: 'Other documents', files: [toReaderFile(d)] });
  }

  const addDocByName = (raw: string) => {
    const name = raw.trim();
    if (!name || noteItems.includes(name)) return;
    setNoteItems(prev => [...prev, name]);
    setDocSearch(''); setMenuOpen(false);
  };

  async function doUpload(req: DocReq | { key: string; label: string; category: string }, file: File) {
    setUploadingKey(req.key); setUploadError(null);
    try { await onUploadDoc({ key: req.key, label: req.label, category: req.category }, file); }
    catch (e) { setUploadError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploadingKey(null); }
  }

  // One row per requirement: status + View/Approve/Reject + Upload-on-behalf.
  const ReqRow = (d: DocReq) => {
    const doc = (docs ?? []).find(x => x.documentKey === d.key);
    const on = okKeys.has(d.key);
    const st = docState(doc?.status, on);
    const label = d.label + (d.required && !on ? ' *' : '');
    const statusText = st === 'approved' ? 'Approved'
      : st === 'rejected' ? 'Rejected'
      : st === 'pending' ? 'Uploaded · review'
      : d.required ? 'Missing · required' : 'Optional';
    const uploading = uploadingKey === d.key;
    return (
      <DocItem key={d.key} state={st} name={label} status={statusText}>
        {doc?.fileUrl && (
          <button className="mini-btn view" type="button"
            onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: d.label, mimeType: doc.mimeType })}>
            <Eye size={12} /> View
          </button>
        )}
        {doc && st !== 'approved' && <button className="mini-btn ok" disabled={busy} onClick={() => onVerifyDoc(doc.id)}><Check size={12} /></button>}
        {doc && st !== 'rejected' && <button className="mini-btn no" disabled={busy} onClick={() => { setRejecting({ id: doc.id, label: d.label }); setRejectReason(''); }}><X size={12} /></button>}
        {canUpload && (
          <label className={`mini-btn view ${uploading ? 'is-busy' : ''}`} style={{ cursor: uploading ? 'progress' : 'pointer' }}>
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
            {doc ? 'Replace' : 'Upload'}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" disabled={uploading}
              onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(d, f); e.currentTarget.value = ''; }} />
          </label>
        )}
      </DocItem>
    );
  };

  return (
    <>
      <div>
        <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText size={13} /> KYC documents · {received} of {required.length} required received</span>
          {allUploaded.length > 0 && (
            <button type="button" className="linkbtn" onClick={() => setReaderOpen(true)}>
              <Eye size={11} /> View all documents ({allUploaded.length})
            </button>
          )}
        </div>
        <div className="doclist">{required.map(ReqRow)}</div>
        {optional.length > 0 && (
          <>
            <div className="subhead" style={{ marginTop: 12 }}>Supporting (optional)</div>
            <div className="doclist">{optional.map(ReqRow)}</div>
          </>
        )}
        {uploadError && <div className="errline">{uploadError}</div>}
        {!canUpload && <div className="note" style={{ marginTop: 6 }}>Convert this lead to a customer to upload documents on their behalf.</div>}
      </div>

      {/* ── Require additional document ── */}
      <div>
        <div className="subhead"><Plus size={13} /> Request additional documents</div>
        <p className="note" style={{ margin: '0 0 8px' }}>Each appears as an individual upload slot in the customer&rsquo;s journey.</p>
        {noteItems.length > 0 && (
          <div className="doclist" style={{ marginBottom: 8 }}>
            {noteItems.map((item, idx) => {
              // A request that maps to a standard slot (e.g. UAE Visa) is fulfilled
              // by that existing upload — track the same key the customer uploads to.
              const key = resolveRequestedDocKey(item) ?? additionalDocKey(item);
              const doc = (docs ?? []).find(d => d.documentKey === key);
              const on = !!doc && !['missing', 'rejected'].includes(doc.status);
              const st = docState(doc?.status, on);
              const uploading = uploadingKey === key;
              return (
                <DocItem key={idx} state={doc ? st : 'docmiss'} name={item}
                  status={st === 'approved' ? 'Approved' : st === 'rejected' ? 'Rejected' : doc ? 'Uploaded · review' : 'Awaiting upload'}>
                  {doc?.fileUrl && (
                    <button className="mini-btn view" type="button"
                      onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: item, mimeType: doc.mimeType })}><Eye size={12} /> View</button>
                  )}
                  {doc && st !== 'approved' && <button className="mini-btn ok" disabled={busy} onClick={() => onVerifyDoc(doc.id)}><Check size={12} /></button>}
                  {doc && st !== 'rejected' && <button className="mini-btn no" disabled={busy} onClick={() => { setRejecting({ id: doc.id, label: item }); setRejectReason(''); }}><X size={12} /></button>}
                  {canUpload && (
                    <label className="mini-btn view" style={{ cursor: uploading ? 'progress' : 'pointer' }}>
                      {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}{doc ? 'Replace' : 'Upload'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only" disabled={uploading}
                        onChange={e => { const f = e.target.files?.[0]; if (f) doUpload({ key, label: item, category: 'other' }, f); e.currentTarget.value = ''; }} />
                    </label>
                  )}
                  <button className="mini-btn no" title="Remove request" onClick={() => setNoteItems(prev => prev.filter((_, i) => i !== idx))}><Trash2 size={12} /></button>
                </DocItem>
              );
            })}
          </div>
        )}
        <div className="addwrap">
          <input className="qinput" type="text" value={docSearch}
            onChange={e => { setDocSearch(e.target.value); setMenuOpen(true); }}
            onFocus={() => setMenuOpen(true)}
            onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const q = docSearch.trim();
                const matches = REQUESTABLE_DOCS.filter(d => d.toLowerCase().includes(q.toLowerCase()) && !noteItems.includes(d));
                if (matches.length === 1) addDocByName(matches[0]); else if (q) addDocByName(q);
              } else if (e.key === 'Escape') setMenuOpen(false);
            }}
            placeholder="Search or type a document name…" />
          {menuOpen && (() => {
            const q = docSearch.trim().toLowerCase();
            const matches = REQUESTABLE_DOCS.filter(d => d.toLowerCase().includes(q) && !noteItems.includes(d));
            const exact = REQUESTABLE_DOCS.some(d => d.toLowerCase() === q);
            return (
              <div className="addmenu">
                {matches.map(d => (
                  <button key={d} type="button" onMouseDown={e => e.preventDefault()} onClick={() => addDocByName(d)}>
                    <FileText size={11} /> {d}
                  </button>
                ))}
                {docSearch.trim() && !exact && (
                  <button type="button" className="custom" onMouseDown={e => e.preventDefault()} onClick={() => addDocByName(docSearch.trim())}>
                    + Add &ldquo;{docSearch.trim()}&rdquo; (custom)
                  </button>
                )}
                {matches.length === 0 && !docSearch.trim() && <p className="note" style={{ padding: '8px 10px' }}>Start typing to search…</p>}
              </div>
            );
          })()}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => onSaveDocsNote(noteItems)}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save request
        </button>
      </div>

      {/* ── Approve docs → opens the plan for review (customer sees it only after you share) ── */}
      <button className="btn btn-jade btn-block" disabled={busy} onClick={onApproveDocuments}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <>Approve documents <ArrowRight size={15} /> review plan</>}
      </button>

      {/* ── Reject-with-reason overlay ── */}
      {rejecting && (
        <div className="qmodal-scrim" onClick={() => setRejecting(null)}>
          <div className="qmodal" onClick={e => e.stopPropagation()}>
            <div className="subhead"><X size={13} /> Reject document</div>
            <p className="note" style={{ margin: '0 0 10px' }}>Rejecting <strong>{rejecting.label}</strong>. The customer sees a re-upload slot.</p>
            <textarea className="qinput" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason (optional — shown to the customer)…" />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-sm" style={{ background: 'var(--brick)', color: '#fff' }}
                disabled={busy} onClick={() => { onRejectDoc(rejecting.id, rejectReason); setRejecting(null); }}>
                <X size={14} /> Reject
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── View-all documents reader — shared sidebar + gallery popup ── */}
      {readerOpen && (
        <DocumentReaderModal
          title="All documents"
          summary={`${allUploaded.length} uploaded · ${lead.customerName ?? 'customer'}`}
          slots={readerSlots}
          onClose={() => setReaderOpen(false)}
        />
      )}
    </>
  );
}

/* ─── PlanSection: plan table + inline "Edit plan" editor (full port of the
 *  list page's plan form; same issue-payment-plan endpoint issues OR edits). ── */
function PlanSection({
  lead, plan, busy, latestViewing, feeRules, preferredStartDays, allowedInstallments, onIssuePlan,
  shared, onSharePlan,
}: {
  lead: ApiLead;
  plan: ApiLead['paymentPlan'];
  busy: boolean;
  latestViewing: ReturnType<typeof getLatestViewing>;
  feeRules: FeeRulesMap | null;
  preferredStartDays: number[];
  allowedInstallments: number[];
  onIssuePlan: (body: Record<string, unknown>) => Promise<void> | void;
  /** true once the plan has been shared with the customer (payment_plan_shared). */
  shared?: boolean;
  onSharePlan?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!plan) return <div className="note">No plan on record.</div>;
  return (
    <>
      <PlanTable plan={plan} />
      {!editing && (
        <>
          <div className="note">
            {shared
              ? 'Shared with the customer — waiting for a payment advice per instalment. You can still edit and re-share it.'
              : 'The customer can’t see this plan yet. Review it, add instalments / adjust dates / apply a discount if needed, then share it.'}
          </div>
          <button className="btn btn-ghost btn-block" onClick={() => setEditing(true)}>
            <ClipboardList size={15} /> Edit plan
          </button>
          {onSharePlan && (
            <button className="btn btn-jade btn-block" disabled={busy} onClick={onSharePlan}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <><Send size={15} /> {shared ? 'Re-share updated plan' : 'Share plan with customer'}</>}
            </button>
          )}
        </>
      )}
      {editing && (
        <PlanEditor
          lead={lead} plan={plan} busy={busy} latestViewing={latestViewing}
          feeRules={feeRules} preferredStartDays={preferredStartDays} allowedInstallments={allowedInstallments}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => { await onIssuePlan(body); setEditing(false); }}
        />
      )}
    </>
  );
}

/* PlanEditor — the exact field set + due-date logic from leads/page.tsx. */
function PlanEditor({
  lead, plan, busy, latestViewing, feeRules, preferredStartDays, allowedInstallments, onCancel, onSubmit,
}: {
  lead: ApiLead;
  plan: NonNullable<ApiLead['paymentPlan']>;
  busy: boolean;
  latestViewing: ReturnType<typeof getLatestViewing>;
  feeRules: FeeRulesMap | null;
  preferredStartDays: number[];
  allowedInstallments: number[];
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const defaultInstallments = plan.installmentCount ?? latestViewing?.preferredChequeCount ?? 4;
  const startInit = plan.items?.find(it => it.type === 'first_bundle')?.dueDate
    ?? plan.items?.[0]?.dueDate ?? latestViewing?.desiredMoveIn?.slice(0, 10) ?? '';
  // Prefill LISTED (pre-discount) rent when editing — the discount fields re-apply.
  const [rentAed, setRentAed] = useState(String((plan.originalRentFils ?? plan.rentFils) / 100));
  const [installmentCount, setInstallmentCount] = useState<number>(defaultInstallments);
  const [startDate, setStartDate] = useState(startInit);
  const [adminAed, setAdminAed] = useState(String(plan.adminFeeFils / 100));
  const [ejariAed, setEjariAed] = useState(String(plan.ejariFils / 100));
  const [commAed, setCommAed] = useState(String(plan.commissionFils / 100));
  const [depositAed, setDepositAed] = useState(String(plan.securityDepositFils / 100));
  const bundleInit = plan.items.find(it => it.type === 'first_bundle')?.dueDate ?? '';
  const depositInit = plan.items.find(it => it.type === 'security_deposit')?.dueDate ?? '';
  const instDatesInit = plan.items
    .filter(it => it.type === 'installment' && it.description && /^Installment \d+$/.test(it.description))
    .sort((a, b) => { const n = (d?: string) => Number((d?.match(/(\d+)/) ?? [])[1] ?? 0); return n(a.description) - n(b.description); })
    .map(it => it.dueDate);
  const [bundleDate, setBundleDate] = useState(bundleInit);
  const [depositDate, setDepositDate] = useState(depositInit);
  const [instDates, setInstDates] = useState<string[]>(
    instDatesInit.length === defaultInstallments - 1
      ? instDatesInit
      : Array.from({ length: Math.max(0, defaultInstallments - 1) }, (_, i) => instDatesInit[i] ?? ''),
  );
  const [notes, setNotes] = useState(plan.notes ?? '');
  const [payableTo, setPayableTo] = useState(plan.chequesPayableTo ?? '');
  const extrasInit = plan.items
    .filter(it => it.type === 'extra_installment' || (it.type === 'installment' && it.description && !/^Installment \d+$/.test(it.description)))
    .map(it => ({ description: it.description ?? '', amountAed: String(it.amountFils / 100), dueDate: it.dueDate }));
  const [extras, setExtras] = useState<{ description: string; amountAed: string; dueDate: string }[]>(extrasInit);
  const [discountType, setDiscountType] = useState<'none' | 'percent' | 'fixed'>(plan.discountType ?? 'none');
  const [discountValue, setDiscountValue] = useState(
    plan.discountType === 'percent' ? String(plan.discountPercent ?? '')
    : plan.discountType === 'fixed' ? String((plan.discountFils ?? 0) / 100) : '',
  );
  const [error, setError] = useState<string | null>(null);

  const applyStart = (d: string, n: number) => { setBundleDate(d); setInstDates(installmentsFromStart(d, n)); };
  const resizeInst = (n: number) => {
    if (startDate) setInstDates(installmentsFromStart(startDate, n));
    else setInstDates(prev => Array.from({ length: Math.max(0, n - 1) }, (_, i) => prev[i] ?? ''));
  };

  // Prefill "cheques payable to" from the RP profile on first open (when blank).
  useEffect(() => {
    if (payableTo) return;
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { profile?: { bankAccountName?: string | null; companyName?: string | null; user?: { name?: string | null } } } | null) => {
        const p = data?.profile; if (!p) return;
        const name = p.bankAccountName?.trim() || p.companyName?.trim() || p.user?.name?.trim() || '';
        if (name) setPayableTo(name);
      }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefill fees from unit → global fee rules when they arrive & fields are blank.
  // Fee rules load async, so this genuinely needs an effect (setState-in-effect is
  // the intended pattern here, matching the list page's openPanel prefill).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const u = lead.unit;
    if (u?.adminFee != null && !adminAed) setAdminAed(String(Number(u.adminFee)));
    if (u?.ejariFeeFils != null && !ejariAed) setEjariAed(String(Number(u.ejariFeeFils)));
    if (u?.commission != null && !commAed) setCommAed(String(Number(u.commission)));
    if (u?.securityDeposit != null && !depositAed) setDepositAed(String(Number(u.securityDeposit)));
    if (feeRules) {
      const cat = unitSpaceCategory(lead.unit?.unitType);
      const rules = feeRules[cat] ?? feeRules['residential'] ?? [];
      const rent = parseFloat(rentAed) || 0;
      const find = (ft: string) => rules.find(r => r.feeType === ft);
      if (!adminAed && u?.adminFee == null)   { const r = find('admin_fee');        if (r) setAdminAed(feeToAed(r, rent)); }
      if (!ejariAed && u?.ejariFeeFils == null) { const r = find('ejari_fee');       if (r) setEjariAed(feeToAed(r, rent)); }
      if (!commAed && u?.commission == null)  { const r = find('commission');        if (r) setCommAed(feeToAed(r, rent)); }
      if (!depositAed && u?.securityDeposit == null) { const r = find('security_deposit'); if (r) setDepositAed(feeToAed(r, rent)); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeRules]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const rentFils = Math.round((parseFloat(rentAed) || 0) * 100);
  const discountFils = discountType !== 'none' && parseFloat(discountValue) > 0
    ? discountType === 'percent' ? Math.round(rentFils * parseFloat(discountValue) / 100) : Math.round(parseFloat(discountValue) * 100)
    : 0;
  const effRent = Math.max(0, rentFils - discountFils);
  const per = effRent > 0 ? Math.floor(effRent / installmentCount) : 0;
  const last = effRent > 0 ? effRent - per * (installmentCount - 1) : 0;
  const adminFils = Math.round((parseFloat(adminAed) || 0) * 100);
  const ejariFils = Math.round((parseFloat(ejariAed) || 0) * 100);
  const commFils = Math.round((parseFloat(commAed) || 0) * 100);
  const depositFils = Math.round((parseFloat(depositAed) || 0) * 100);

  type Row = { kind: 'bundle' | 'deposit' | 'installment'; instIndex?: number; label: string; amountFils: number; dueDate: string };
  const KW: Record<Row['kind'], number> = { bundle: 0, installment: 1, deposit: 2 };
  const rows: Row[] = (rentFils > 0 ? [
    { kind: 'bundle' as const, label: 'Admin + Ejari + Commission + Installment 1', amountFils: adminFils + ejariFils + commFils + per, dueDate: bundleDate },
    ...Array.from({ length: installmentCount - 1 }, (_, i) => ({
      kind: 'installment' as const, instIndex: i, label: `Installment ${i + 2}`,
      amountFils: i === installmentCount - 2 ? last : per, dueDate: instDates[i] ?? '',
    })),
    { kind: 'deposit' as const, label: 'Security Deposit', amountFils: depositFils, dueDate: depositDate },
  ] : []).slice().sort((a, b) => (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) ? a.dueDate.localeCompare(b.dueDate) : KW[a.kind] - KW[b.kind]);
  const totalFils = effRent + adminFils + ejariFils + commFils + depositFils;

  async function submit() {
    if (!rentAed || isNaN(rentFils) || rentFils <= 0) { setError('Enter a valid annual rent'); return; }
    if (!bundleDate || !depositDate || instDates.some(d => !d)) { setError('All cheque due dates are required'); return; }
    const validExtra = extras.filter(e => e.description.trim() && e.dueDate && parseFloat(e.amountAed) > 0);
    setError(null);
    await onSubmit({
      rentFils, installmentCount, adminFeeFils: adminFils, ejariFils, commissionFils: commFils,
      securityDepositFils: depositFils, bundleDueDate: bundleDate, depositDueDate: depositDate,
      installmentDueDates: instDates,
      notes: notes.trim() || undefined,
      extraItems: validExtra.length ? validExtra.map(e => ({ description: e.description.trim(), amountFils: Math.round(parseFloat(e.amountAed) * 100), dueDate: e.dueDate })) : undefined,
      chequesPayableTo: payableTo.trim() || undefined,
      ...(discountType !== 'none' && discountValue && parseFloat(discountValue) > 0 && {
        discountType,
        ...(discountType === 'percent' ? { discountPercent: parseFloat(discountValue) } : { discountFils: Math.round(parseFloat(discountValue) * 100) }),
      }),
    });
  }

  return (
    <div className="planbox">
      <div className="subhead"><ClipboardList size={13} /> Edit payment plan</div>
      {(latestViewing?.desiredMoveIn || latestViewing?.preferredChequeCount) && (
        <div className="note" style={{ marginBottom: 10 }}>
          <BadgeCheck size={12} style={{ color: 'var(--jade)', verticalAlign: '-2px' }} /> Customer requested
          {latestViewing.desiredMoveIn && <> · start {fmtDateOnly(latestViewing.desiredMoveIn.slice(0, 10))}</>}
          {latestViewing.preferredChequeCount && <> · {latestViewing.preferredChequeCount} payments</>}
        </div>
      )}
      <div className="fgrid">
        <label>Annual rent (AED) *
          <input className="qinput" type="number" value={rentAed} onChange={e => setRentAed(e.target.value)} placeholder="e.g. 85000" />
        </label>
        <label>No. of installments *
          <select className="qinput" value={installmentCount} onChange={e => { const n = Number(e.target.value); setInstallmentCount(n); resizeInst(n); }}>
            {allowedInstallmentPlans(allowedInstallments, [installmentCount]).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </div>
      <label className="fblock">Contract start date
        <PreferredDayPicker value={startDate} preferredDays={preferredStartDays}
          onChange={d => { setStartDate(d); if (d) applyStart(d, installmentCount); }} placeholder="Pick start date" />
      </label>
      <div className="subhead" style={{ marginTop: 12 }}>Fees &amp; deposit</div>
      <div className="fgrid">
        <label>Admin fee<input className="qinput" type="number" value={adminAed} onChange={e => setAdminAed(e.target.value)} placeholder="0" /></label>
        <label>Ejari fee<input className="qinput" type="number" value={ejariAed} onChange={e => setEjariAed(e.target.value)} placeholder="0" /></label>
        <label>Commission<input className="qinput" type="number" value={commAed} onChange={e => setCommAed(e.target.value)} placeholder="0" /></label>
        <label>Security deposit<input className="qinput" type="number" value={depositAed} onChange={e => setDepositAed(e.target.value)} placeholder="0" /></label>
      </div>
      <div className="discbox">
        <div className="subhead" style={{ margin: '0 0 6px' }}>Rent discount (optional)</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {(['none', 'percent', 'fixed'] as const).map(t => (
            <button key={t} type="button" className={`chip ${discountType === t ? 'on' : ''}`}
              onClick={() => { setDiscountType(t); if (t === 'none') setDiscountValue(''); }}>
              {t === 'none' ? 'No discount' : t === 'percent' ? '% off' : 'Fixed AED'}
            </button>
          ))}
        </div>
        {discountType !== 'none' && (
          <input className="qinput" type="number" value={discountValue} onChange={e => setDiscountValue(e.target.value)}
            placeholder={discountType === 'percent' ? 'e.g. 5' : 'e.g. 2000'} />
        )}
      </div>
      {rows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="subhead">Cheque schedule ({rows.length}) · total {aed(totalFils)}</div>
          <div className="doclist">
            {rows.map((row, i) => {
              const key = row.kind === 'bundle' ? 'bundle' : row.kind === 'deposit' ? 'deposit' : `inst-${row.instIndex}`;
              const onChange = (v: string) => {
                if (row.kind === 'bundle') setBundleDate(v);
                else if (row.kind === 'deposit') setDepositDate(v);
                else setInstDates(prev => prev.map((d, j) => j === row.instIndex ? v : d));
              };
              return (
                <div key={key} className="schedrow">
                  <span className="sq">#{i + 1}</span>
                  <span className="sl">{row.label}</span>
                  <span className="sa">{row.amountFils > 0 ? aed(row.amountFils) : '—'}</span>
                  <input className="qinput sd" type="date" value={row.dueDate} onChange={e => onChange(e.target.value)} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Extra installments</span>
          <button type="button" className="linkbtn" onClick={() => setExtras(prev => [...prev, { description: '', amountAed: '', dueDate: '' }])}><Plus size={11} /> Add</button>
        </div>
        {extras.length > 0 && (
          <div className="doclist">
            {extras.map((it, idx) => (
              <div key={idx} className="schedrow">
                <input className="qinput sl" type="text" value={it.description} placeholder="Label (e.g. VAT)"
                  onChange={e => setExtras(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} />
                <input className="qinput" style={{ width: 76 }} type="number" value={it.amountAed} placeholder="AED"
                  onChange={e => setExtras(prev => prev.map((x, i) => i === idx ? { ...x, amountAed: e.target.value } : x))} />
                <input className="qinput sd" type="date" value={it.dueDate}
                  onChange={e => setExtras(prev => prev.map((x, i) => i === idx ? { ...x, dueDate: e.target.value } : x))} />
                <button type="button" className="mini-btn no" onClick={() => setExtras(prev => prev.filter((_, i) => i !== idx))}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <label className="fblock" style={{ marginTop: 12 }}>Cheques payable to
        <input className="qinput" type="text" value={payableTo} onChange={e => setPayableTo(e.target.value)} placeholder="e.g. ABC Real Estate LLC" />
      </label>
      <label className="fblock">Notes (optional)
        <input className="qinput" type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. 4 quarterly cheques" />
      </label>
      {error && <div className="errline">{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-jade btn-sm" disabled={busy} onClick={submit}>{busy ? <Loader2 size={14} className="animate-spin" /> : <>Update plan</>}</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/* ─── ChequesSection: per-cheque view + method/instalment mapping + status +
 *  record. Ports the list page's cheque panel (customer-upload vs RP-recorded). */
function ChequesSection({
  plan, cheques, busy, onRecordCheque, onDeleteCheque, onSetChequeStatus, onTagCheque, onSetPlanItemMethod,
}: {
  plan: ApiLead['paymentPlan'];
  cheques: LeadChequeRecord[];
  busy: boolean;
  onRecordCheque: (payload: { chequeSerial: string; bankName: string; amountFils: number; dueDate: string; notes: string }) => Promise<void>;
  onDeleteCheque: (chequeId: number) => Promise<void>;
  onSetChequeStatus: (chequeId: number, status: ChequeRowStatus) => Promise<void>;
  onTagCheque: (chequeId: number, patch: { paymentMethod?: PaymentMethodKind; planItemIndex?: number | null; chequeSerial?: string }) => Promise<void>;
  onSetPlanItemMethod: (patch: { itemIndex: number; paymentMethod?: PaymentMethodKind; reference?: string }) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [itemMethods, setItemMethods] = useState<Record<number, PaymentMethodKind>>({});
  const [itemRefs, setItemRefs] = useState<Record<number, string>>({});

  const sortedItems = plan ? plan.items.slice().sort((a, b) => {
    if (a.dueDate !== b.dueDate) return (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
    const order: Record<string, number> = { fee: 0, first_bundle: 1, installment: 2, extra_installment: 3, security_deposit: -1 };
    return (order[a.type ?? 'installment'] ?? 1) - (order[b.type ?? 'installment'] ?? 1);
  }) : [];
  const chequeByDesc = new Map<string, LeadChequeRecord>();
  for (const c of cheques) if (c.notes) chequeByDesc.set(c.notes, c);
  const customerUploads = cheques.filter(c => c.isCustomerUpload);
  const hasCustomerUploads = customerUploads.length > 0;

  return (
    <div className="chqbox">
      <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span><CreditCard size={13} style={{ verticalAlign: '-2px' }} /> Payments</span>
        {plan && <span style={{ color: 'var(--mute)', fontWeight: 600 }}>{plan.chequeCount} · {aed(plan.totalAmountFils)}</span>}
      </div>
      {error && <div className="errline">{error}</div>}

      {/* Payment method + reference per plan item — an aligned grid so the
          method / reference controls line up cleanly across every instalment. */}
      {plan && sortedItems.length > 0 && (
        <div className="paygrid">
          <div className="payhead">
            <span>Instalment</span><span>Method</span><span>Reference</span>
          </div>
          {sortedItems.map((item, i) => {
            const method = itemMethods[item.index] ?? item.paymentMethod ?? 'cheque';
            return (
              <div key={`m-${item.index}`} className="payrow">
                <div className="payrow-info">
                  <span className="payrow-n">#{i + 1}</span>
                  <span className="payrow-lbl">
                    <span className="payrow-desc">{item.description ?? `Payment ${i + 1}`}</span>
                    <span className="payrow-sub">{aed(item.amountFils)}{item.dueDate ? ` · due ${fmtDateOnly(item.dueDate)}` : ''}</span>
                  </span>
                </div>
                <select className="qinput payrow-ctl" value={method}
                  onChange={async e => {
                    const m = e.target.value as PaymentMethodKind; setError(null);
                    setItemMethods(prev => ({ ...prev, [item.index]: m }));
                    try { await onSetPlanItemMethod({ itemIndex: item.index, paymentMethod: m }); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
                  }}>
                  {(['cheque', 'bank_transfer', 'card', 'cash'] as PaymentMethodKind[]).map(m => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                </select>
                <input className="qinput payrow-ctl" type="text" value={itemRefs[item.index] ?? item.reference ?? ''}
                  onChange={e => setItemRefs(prev => ({ ...prev, [item.index]: e.target.value }))}
                  placeholder="Cheque # / ID…"
                  onBlur={async e => {
                    const val = e.currentTarget.value.trim(); setError(null);
                    try {
                      await onSetPlanItemMethod({ itemIndex: item.index, reference: val });
                      if (val) {
                        for (let j = i + 1; j < sortedItems.length; j++) {
                          const t = sortedItems[j];
                          if ((itemRefs[t.index] ?? t.reference ?? '').trim()) continue;
                          const serial = nextSerial(val, j - i);
                          setItemRefs(prev => ({ ...prev, [t.index]: serial }));
                          await onSetPlanItemMethod({ itemIndex: t.index, reference: serial });
                        }
                      }
                    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
                  }} />
              </div>
            );
          })}
        </div>
      )}

      {/* Customer-uploaded references — thumbnail + View + map to installment + method */}
      {hasCustomerUploads && (
        <div className="doclist" style={{ marginBottom: 10 }}>
          <div className="subhead" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Uploaded by customer ({customerUploads.length})</span>
            {customerUploads.length > 1 && (
              <button type="button" className="linkbtn"
                onClick={() => openDocsTogether(customerUploads.map(c => ({ fileUrl: c.imageUrl, displayName: c.notes ?? 'Cheque' })))}>
                <Eye size={11} /> View all
              </button>
            )}
          </div>
          {customerUploads.map((c, i) => {
            const label = c.notes || `Payment ${i + 1}`;
            const open = () => c.imageUrl && openDocViewer({ fileUrl: c.imageUrl, caption: label });
            return (
              <div key={c.id} className="uprow">
                <button type="button" className="upthumb" onClick={open} disabled={!c.imageUrl} aria-label={`Preview ${label}`}>
                  {c.imageUrl && !c.imageUrl.toLowerCase().split('?')[0].endsWith('.pdf')
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={c.imageUrl} alt={label} />
                    : <FileText size={16} />}
                </button>
                <div className="upmeta">
                  <div className="dn">{label}</div>
                  <div className="ds">
                    {c.amountFils > 0 && <>{aed(c.amountFils)} </>}
                    {c.chequeSerial && <>· {c.chequeSerial} </>}
                    {c.bankName && c.bankName !== 'N/A' && <>· {c.bankName} </>}
                    {c.dueDate && <>· due {fmtDateOnly(c.dueDate)} </>}
                    {c.ocrStatus === 'done' && <span style={{ color: 'var(--jade-deep)' }}>· auto-read</span>}
                  </div>
                  <div className="upctl">
                    {c.imageUrl && <button type="button" className="mini-btn view" onClick={open}><Eye size={12} /> View</button>}
                    <select className="qinput" style={{ width: 110 }} value={c.paymentMethod ?? 'cheque'}
                      onChange={async e => { setError(null); try { await onTagCheque(c.id, { paymentMethod: e.target.value as PaymentMethodKind }); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); } }}>
                      {(['cheque', 'bank_transfer', 'card', 'cash'] as PaymentMethodKind[]).map(m => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                    </select>
                    {plan && (
                      <select className="qinput" style={{ width: 150 }} value={c.planItemIndex ?? ''}
                        onChange={async e => { setError(null); const v = e.target.value; try { await onTagCheque(c.id, { planItemIndex: v === '' ? null : Number(v) }); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); } }}>
                        <option value="">Map to installment…</option>
                        {sortedItems.map((it, k) => <option key={it.index} value={it.index}>#{k + 1} {it.description ?? `Payment ${k + 1}`}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* RP-recorded path — one record row per plan item when no customer uploads */}
      {plan && !hasCustomerUploads && sortedItems.length > 0 && (
        <div className="doclist">
          {sortedItems.map((it, i) => {
            const desc = it.description ?? `Cheque ${i + 1}`;
            const recorded = chequeByDesc.get(desc);
            return (
              <RecordChequeRow
                key={`${it.index}-${desc}`} seq={i + 1} description={desc} amountFils={it.amountFils} dueDate={it.dueDate}
                recorded={recorded} busy={busy}
                onRecord={async serial => {
                  if (!serial.trim()) { setError('Cheque number is required'); return; }
                  setError(null);
                  try { await onRecordCheque({ chequeSerial: serial.trim(), bankName: 'N/A', amountFils: it.amountFils, dueDate: it.dueDate, notes: desc }); }
                  catch (err) { setError(err instanceof Error ? err.message : 'Failed to record'); }
                }}
                onDelete={() => recorded && onDeleteCheque(recorded.id)}
                onStatusChange={status => recorded && onSetChequeStatus(recorded.id, status)}
              />
            );
          })}
        </div>
      )}

      {/* Orphan RP cheques not matching any plan item */}
      {plan && (() => {
        const planDescs = new Set(sortedItems.map(it => it.description ?? ''));
        const orphans = cheques.filter(c => !c.isCustomerUpload && (!c.notes || !planDescs.has(c.notes)));
        if (orphans.length === 0) return null;
        return (
          <div className="doclist" style={{ marginTop: 10 }}>
            <div className="subhead">Extra / unscheduled cheques</div>
            {orphans.map(c => (
              <div key={c.id} className="schedrow">
                <span className="sl">{c.chequeSerial} · {c.bankName} · {aed(c.amountFils)} · due {fmtDateOnly(c.dueDate)}{c.notes ? ` · ${c.notes}` : ''}</span>
                <button className="mini-btn no" onClick={() => onDeleteCheque(c.id)}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        );
      })()}

      {!plan && <div className="note">Issue the payment plan first — the cheque series appears here once payments are scheduled.</div>}
    </div>
  );
}

/* RecordChequeRow — record / edit-status one plan-item cheque (quest-page style). */
function RecordChequeRow({
  seq, description, amountFils, dueDate, recorded, busy, onRecord, onDelete, onStatusChange,
}: {
  seq: number; description: string; amountFils: number; dueDate: string;
  recorded?: LeadChequeRecord; busy: boolean;
  onRecord: (serial: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onStatusChange: (status: ChequeRowStatus) => void | Promise<void>;
}) {
  const [serial, setSerial] = useState('');
  const [saving, setSaving] = useState(false);
  if (recorded) {
    const status = (recorded.status as ChequeRowStatus) || 'pending';
    return (
      <div className="schedrow">
        <span className="sq">#{seq}</span>
        <span className="sl">{description} · <b>{recorded.chequeSerial}</b> · {aed(amountFils)} · due {fmtDateOnly(dueDate)}</span>
        <select className="qinput" style={{ width: 110 }} value={status} onChange={e => onStatusChange(e.target.value as ChequeRowStatus)}>
          {CHEQUE_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button className="mini-btn no" onClick={onDelete} title="Remove"><Trash2 size={12} /></button>
      </div>
    );
  }
  return (
    <div className="schedrow">
      <span className="sq">#{seq}</span>
      <span className="sl">{description} · {aed(amountFils)} · due {fmtDateOnly(dueDate)}</span>
      <input className="qinput" style={{ width: 130 }} type="text" value={serial} onChange={e => setSerial(e.target.value)} placeholder="Cheque #" />
      <button className="btn btn-jade btn-sm" disabled={saving || busy || !serial.trim()}
        onClick={async () => { setSaving(true); try { await onRecord(serial); setSerial(''); } finally { setSaving(false); } }}>
        {saving ? '…' : 'Record'}
      </button>
    </div>
  );
}

/* ─── PlanTable: real instalments ─────────────────────────────────────────── */
function PlanTable({ plan, advice }: { plan: NonNullable<ApiLead['paymentPlan']>; advice?: boolean }) {
  const items: PaymentPlanItem[] = plan.items
    .slice()
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  // Group consecutive line items sharing a due date into one dated payment block
  // (kills the repeated-date noise and reads like the cheque schedule it is).
  const groups: { date: string | null; items: PaymentPlanItem[]; total: number }[] = [];
  for (const it of items) {
    const key = it.dueDate ?? null;
    const last = groups[groups.length - 1];
    if (last && last.date === key) { last.items.push(it); last.total += it.amountFils; }
    else groups.push({ date: key, items: [it], total: it.amountFils });
  }
  const dateOf = (d: string | null) => (d ? fmtDateOnly(d) : 'No date set');
  return (
    <div>
      <div className="subhead"><Wallet size={13} /> Payment plan{advice ? ' · advice submitted' : ' · proposed to customer'}</div>
      <div className="plan2">
        {groups.map((g, gi) => (
          g.items.length === 1 ? (
            /* Solo line — date · description · amount on one row. */
            <div className="pline" key={gi}>
              <span className="pl-date"><Calendar size={12} /> {dateOf(g.date)}</span>
              <span className="pl-desc">{g.items[0].description ?? '—'}</span>
              <span className="pl-amt">{aed(g.items[0].amountFils)}</span>
            </div>
          ) : (
            /* Grouped block — one dated header + indented line items + subtotal. */
            <div className="pgrp" key={gi}>
              <div className="pgrp-h">
                <span className="pgrp-d"><Calendar size={12} /> {dateOf(g.date)}</span>
                <span className="pgrp-t">{aed(g.total)}</span>
              </div>
              {g.items.map((it, i) => (
                <div className="pgrp-r" key={i}>
                  <span className="pr-desc">{it.description ?? '—'}</span>
                  <span className="pr-amt">{aed(it.amountFils)}</span>
                </div>
              ))}
            </div>
          )
        ))}
        <div className="plan2-tot">
          <span>Total · {plan.chequeCount} {plan.chequeCount === 1 ? 'payment' : 'payments'}</span>
          <span>{aed(plan.totalAmountFils)}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Global style — scoped under .quest-page (copied from the Operations
 *  detail v2 page + the mock's lead-specific tokens). ──────────────────────── */
function GlobalStyle() {
  return (
    <style jsx global>{`
      .quest-page {
        --ink: #1a1916; --ink-2: #3d3b35; --ink-3: #54534c;
        --mute: #9b9890; --mute-2: #bdbab2;
        --paper: #ffffff; --surface: #f9f8f6; --mist: #f0ede8; --mist-strong: #e8e6e0;
        --jade: #2e9f82; --jade-deep: #1f5a3f; --jade-soft: #d8f2e8; --jade-tint: #eef8f4;
        --saffron: #f59e0b; --saffron-deep: #c2410c; --saffron-soft: #fff7ed; --saffron-edge: #f0d68f;
        --brick: #c8492c; --brick-deep: #9a3520; --brick-soft: #fdede7; --brick-edge: #f3cabb;
        --sky: #0369a1; --sky-bg: #e0f2fe;
        --r-lg: 22px; --r-md: 16px; --r-sm: 12px;
        --sh-card: 0 1px 2px rgba(26,23,20,.04);
        --sh-hero: 0 24px 60px -32px rgba(26,23,20,.2);
        --sh-pop:  0 30px 70px -24px rgba(26,23,20,.34);
        background: var(--surface); color: var(--ink); min-height: 100vh;
        font-family: inherit;
      }
      .quest-page .wrap { max-width: 1240px; margin: 0 auto; padding: 26px 28px 64px; width: 100%; }
      .quest-page button, .quest-page input, .quest-page select, .quest-page textarea { font-family: inherit; color: inherit; }
      .quest-page .eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; color: var(--mute); }
      .quest-page .note { font-size: 12.5px; color: var(--mute); line-height: 1.5; }
      .quest-page .mono { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; }

      .quest-page .qhead { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
      .quest-page .qhead .lhs { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .quest-page .backbtn { width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--mist-strong); background: #fff; display: grid; place-items: center; color: var(--ink-2); cursor: pointer; flex-shrink: 0; }
      .quest-page .backbtn:hover { border-color: var(--mute-2); color: var(--ink); }
      .quest-page .qhead h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .quest-page .qhead .hsub { font-size: 13px; color: var(--mute); margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .quest-page .qhead .hsub svg { color: var(--mute-2); }
      .quest-page .qhead .rhs { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; justify-content: flex-end; }

      .quest-page .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 20px; border-radius: 12px; font-weight: 700; font-size: 14px; border: 1px solid transparent; cursor: pointer; transition: all .15s; line-height: 1; white-space: nowrap; font-family: inherit; text-decoration: none; }
      .quest-page .btn:disabled { opacity: .55; cursor: not-allowed; }
      .quest-page .btn-jade { background: var(--jade); color: #fff; }
      .quest-page .btn-jade:hover:not(:disabled) { background: #268d72; }
      .quest-page .btn-brick { background: var(--brick); color: #fff; }
      .quest-page .btn-brick:hover:not(:disabled) { background: var(--brick-deep); }
      .quest-page .btn-ghost { background: #fff; color: var(--ink-2); border-color: var(--mist-strong); font-weight: 600; }
      .quest-page .btn-ghost:hover:not(:disabled) { border-color: var(--mute-2); color: var(--ink); }
      .quest-page .btn-sm { padding: 10px 15px; font-size: 13px; border-radius: 10px; }
      .quest-page .btn-block { width: 100%; }

      .quest-page .pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 99px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
      .quest-page .pill.action { background: var(--brick-soft); color: var(--brick); }
      .quest-page .pill.waiting { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .pill.celebrate { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .pill.declined { background: var(--mist); color: var(--ink-2); }
      .quest-page .pill.neutral { background: var(--mist); color: var(--ink-2); }

      .quest-page .infobar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 26px; background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); padding: 10px 18px; margin-bottom: 16px; }
      .quest-page .infobar .pitem { display: flex; flex-direction: column; gap: 1px; }
      .quest-page .infobar .pk { font-size: 9.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--mute); }
      .quest-page .infobar .pv { font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; }
      .quest-page .infobar .isep { width: 1px; align-self: stretch; background: var(--mist-strong); margin-left: auto; }

      .quest-page .qbanner { display: flex; gap: 14px; border: 1px solid; border-radius: var(--r-md); padding: 14px 16px; }
      .quest-page .qbanner .bic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; background: #fff; }
      .quest-page .qbanner .bt { font-size: 14px; font-weight: 800; margin: 0 0 2px; }
      .quest-page .qbanner .bp { font-size: 13px; margin: 0; line-height: 1.5; }
      .quest-page .qbanner .quote { margin-top: 10px; background: #fff; border-radius: 11px; padding: 10px 13px; font-size: 13px; line-height: 1.45; border: 1px solid; }
      .quest-page .qbanner.action, .quest-page .qbanner.danger { background: var(--brick-soft); border-color: var(--brick-edge); }
      .quest-page .qbanner.action .bic, .quest-page .qbanner.danger .bic { color: var(--brick); }
      .quest-page .qbanner.action .bt, .quest-page .qbanner.danger .bt { color: var(--brick-deep); }
      .quest-page .qbanner.action .bp, .quest-page .qbanner.danger .bp { color: var(--brick); }
      .quest-page .qbanner.action .quote, .quest-page .qbanner.danger .quote { border-color: var(--brick-edge); color: var(--ink-2); }
      .quest-page .qbanner.waiting { background: var(--saffron-soft); border-color: var(--saffron-edge); }
      .quest-page .qbanner.waiting .bic, .quest-page .qbanner.waiting .bt, .quest-page .qbanner.waiting .bp { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .quote { border-color: var(--saffron-edge); color: var(--ink-2); }
      .quest-page .qbanner.neutral { background: var(--surface); border-color: var(--mist-strong); }
      .quest-page .qbanner.neutral .bic { color: var(--ink-3); }
      .quest-page .qbanner.neutral .bt { color: var(--ink-2); }
      .quest-page .qbanner.neutral .bp { color: var(--ink-3); }

      .quest-page .quest { display: grid; grid-template-columns: minmax(300px,360px) minmax(0,1fr); gap: 26px; align-items: start; }
      @media (max-width: 1040px) { .quest-page .quest { grid-template-columns: 1fr; } }

      .quest-page .qmap { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: var(--r-lg); padding: 22px 14px; position: sticky; top: 84px; }
      @media (max-width: 1040px) { .quest-page .qmap { position: static; } }
      .quest-page .qmap-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 0 8px; }
      .quest-page .qmap-l { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .12em; font-weight: 800; }
      .quest-page .qmap-l svg { color: var(--brick); }
      .quest-page .qmap-c { font-size: 12px; color: var(--mute); font-weight: 600; }
      .quest-page .qmap svg g.wp { transition: opacity .12s; cursor: pointer; }
      .quest-page .qmap svg g.wp:hover { opacity: .72; }
      .quest-page .youare { margin-top: 6px; padding: 12px 14px; background: #fff; border: 1px solid var(--mist-strong); border-radius: 14px; display: flex; align-items: center; gap: 11px; }
      .quest-page .youare .yi { width: 30px; height: 30px; border-radius: 99px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
      .quest-page .youare .yi.here { background: var(--brick); animation: qpulse 2s ease-in-out infinite; }
      .quest-page .youare .yi.done { background: var(--jade-deep); }
      .quest-page .youare .yi.neutral { background: var(--ink-3); }
      .quest-page .youare .yl { font-size: 9px; color: var(--mute); text-transform: uppercase; letter-spacing: .12em; font-weight: 800; }
      .quest-page .youare .yv { font-size: 13.5px; font-weight: 700; margin-top: 2px; }
      @keyframes qpulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.09); } }

      .quest-page .acard { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-lg); padding: 28px 32px; box-shadow: var(--sh-hero); display: flex; flex-direction: column; }
      @media (max-width: 560px) { .quest-page .acard { padding: 22px 18px; } }
      .quest-page .acard .ahead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .quest-page .acard .ahl { display: flex; align-items: flex-start; gap: 15px; flex: 1; min-width: 0; }
      .quest-page .heroicon { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; color: #fff; flex-shrink: 0; box-shadow: 0 8px 20px -8px rgba(26,23,20,.4); }
      .quest-page .heroicon.action { background: var(--brick); }
      .quest-page .heroicon.waiting { background: var(--saffron-deep); }
      .quest-page .heroicon.celebrate { background: var(--jade-deep); }
      .quest-page .heroicon.danger { background: var(--brick-deep); }
      .quest-page .heroicon.declined, .quest-page .heroicon.neutral { background: var(--ink-3); }
      .quest-page .acard h2 { margin: 5px 0 0; font-size: 25px; line-height: 1.15; letter-spacing: -.02em; font-weight: 800; }
      .quest-page .acard .abody { font-size: 14px; color: var(--ink-2); line-height: 1.6; margin: 16px 0 0; }
      .quest-page .acard .action-body { margin-top: 20px; display: grid; gap: 14px; }
      .quest-page .acard .timing { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--mute); margin-top: 20px; padding-top: 14px; border-top: 1px dashed var(--mist-strong); font-weight: 500; }

      .quest-page .subhead { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--mute); margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
      /* "Your viewing" card — mirrors the customer spaces/v2 viewing section */
      .quest-page .vcard { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 14px; padding: 14px 16px; }
      .quest-page .vcard .vdate { font-size: 18px; font-weight: 800; letter-spacing: -.01em; color: var(--ink); }
      .quest-page .vcard .vtime { font-size: 13px; color: var(--ink-2); margin: 2px 0 8px; }
      .quest-page .vcard .vloc { display: flex; align-items: flex-start; gap: 6px; font-size: 13px; color: var(--ink-2); font-weight: 600; }
      .quest-page .vcard .vloc svg { margin-top: 2px; flex-shrink: 0; color: var(--mute); }
      .quest-page .vcard .vmeta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 10px; font-size: 12px; color: var(--mute); align-items: center; }
      .quest-page .vcard .vmeta b { color: var(--ink); font-weight: 700; }

      .quest-page .ptable { width: 100%; border-collapse: collapse; font-size: 12.5px; border: 1px solid var(--mist-strong); border-radius: 12px; overflow: hidden; }
      .quest-page .ptable th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--mute); font-weight: 800; padding: 8px 10px; border-bottom: 1px solid var(--mist-strong); background: var(--surface); }
      .quest-page .ptable td { padding: 9px 10px; border-bottom: 1px solid var(--mist); color: var(--ink-2); }
      .quest-page .ptable tr:last-child td { border-bottom: 0; }
      .quest-page .ptable .amt { font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
      .quest-page .ptable tfoot td { border-top: 2px solid #bfe3d5; background: var(--jade-tint); font-weight: 800; }
      .quest-page .ptable tfoot .tot { color: var(--jade-deep); }

      /* Grouped payment plan (cleaner cheque schedule) */
      .quest-page .plan2 { border: 1px solid var(--mist-strong); border-radius: 12px; overflow: hidden; background: #fff; }
      .quest-page .plan2 > * + * { border-top: 1px solid var(--mist); }
      .quest-page .pline { display: grid; grid-template-columns: minmax(96px, auto) 1fr auto; gap: 12px; align-items: center; padding: 10px 12px; font-size: 12.5px; color: var(--ink-2); }
      .quest-page .pl-date, .quest-page .pgrp-d { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--mute); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .quest-page .pl-date svg, .quest-page .pgrp-d svg { color: var(--mute-2); flex-shrink: 0; }
      .quest-page .pl-desc, .quest-page .pr-desc { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .quest-page .pl-amt, .quest-page .pr-amt, .quest-page .pgrp-t { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
      .quest-page .pgrp-h { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 12px; background: var(--surface); }
      .quest-page .pgrp-d { font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
      .quest-page .pgrp-t { color: var(--jade-deep); font-weight: 800; }
      .quest-page .pgrp-r { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px 8px 22px; font-size: 12.5px; color: var(--ink-2); }
      .quest-page .pgrp-r + .pgrp-r { border-top: 1px dashed var(--mist); }
      .quest-page .plan2-tot { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 11px 13px; border-top: 2px solid #bfe3d5; background: var(--jade-tint); font-weight: 800; color: var(--jade-deep); font-size: 13px; }
      .quest-page .plan2-tot span:last-child { font-variant-numeric: tabular-nums; }

      /* Record-payment grid (method + reference per instalment) */
      .quest-page .paygrid { display: grid; gap: 6px; margin-bottom: 10px; }
      .quest-page .payhead { display: grid; grid-template-columns: 1fr 132px 172px; gap: 8px; padding: 0 10px 2px; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--mute); }
      .quest-page .payhead span:nth-child(2), .quest-page .payhead span:nth-child(3) { text-align: left; }
      .quest-page .payrow { display: grid; grid-template-columns: 1fr 132px 172px; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--mist-strong); border-radius: 10px; background: #fff; }
      .quest-page .payrow-info { display: flex; align-items: center; gap: 9px; min-width: 0; }
      .quest-page .payrow-n { font-size: 10px; font-weight: 800; color: var(--jade-deep); background: var(--jade-soft); border-radius: 6px; padding: 2px 6px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
      .quest-page .payrow-lbl { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .quest-page .payrow-desc { font-size: 12.5px; color: var(--ink-2); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .quest-page .payrow-sub { font-size: 11px; color: var(--mute); font-variant-numeric: tabular-nums; }
      .quest-page .payrow-ctl { width: 100%; min-width: 0; }
      @media (max-width: 640px) {
        .quest-page .payhead { display: none; }
        .quest-page .payrow { grid-template-columns: 1fr; }
      }
      .quest-page .cstat { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 99px; white-space: nowrap; }
      .quest-page .cstat.cleared { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .cstat.pending { background: var(--saffron-soft); color: var(--saffron-deep); }

      .quest-page .doclist { display: flex; flex-direction: column; gap: 6px; }
      .quest-page .docitem { display: flex; align-items: center; gap: 10px; border: 1px solid; border-radius: 9px; padding: 7px 11px; min-height: 38px; }
      .quest-page .docitem > svg { flex-shrink: 0; }
      .quest-page .docitem > div:not(.dacts) { display: flex; align-items: baseline; gap: 9px; min-width: 0; flex: 1; }
      .quest-page .docitem .dn { font-size: 12.5px; font-weight: 600; }
      .quest-page .docitem .ds { font-size: 10.5px; font-weight: 800; }
      .quest-page .docitem.approved { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .docitem.approved svg, .quest-page .docitem.approved .ds { color: var(--jade-deep); }
      .quest-page .docitem.pending { background: var(--saffron-soft); border-color: var(--saffron-edge); }
      .quest-page .docitem.pending svg, .quest-page .docitem.pending .ds { color: var(--saffron-deep); }
      .quest-page .docitem.rejected { background: var(--brick-soft); border-color: var(--brick-edge); }
      .quest-page .docitem.rejected svg, .quest-page .docitem.rejected .ds { color: var(--brick); }
      .quest-page .docitem.docmiss { background: #fff; border-style: dashed; border-color: var(--saffron-edge); }
      .quest-page .docitem.docmiss svg, .quest-page .docitem.docmiss .ds { color: var(--saffron-deep); }
      .quest-page .docitem.docmiss .dn { color: var(--mute); }
      .quest-page .docitem.docmiss.req { border-color: var(--brick-edge); }
      .quest-page .docitem.docmiss.req svg, .quest-page .docitem.docmiss.req .ds { color: var(--brick); }
      .quest-page .docitem .dacts { margin-left: auto; display: flex; gap: 5px; flex-shrink: 0; }
      .quest-page .mini-btn { font-size: 11px; font-weight: 700; padding: 5px 9px; border-radius: 8px; border: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
      .quest-page .mini-btn:disabled { opacity: .55; cursor: not-allowed; }
      .quest-page .mini-btn.ok { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .mini-btn.no { background: var(--brick-soft); color: var(--brick); }
      .quest-page .mini-btn.view { background: #fff; color: var(--jade-deep); border: 1px solid var(--mist-strong); }

      .quest-page .donepanel { display: flex; align-items: center; gap: 13px; background: var(--jade-tint); border: 1px solid #cfe9df; border-radius: 14px; padding: 14px 16px; }
      .quest-page .donepanel .dp-ic { width: 36px; height: 36px; border-radius: 99px; background: var(--jade); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
      .quest-page .donepanel .dp-t { font-size: 14px; font-weight: 800; color: var(--jade-deep); }
      .quest-page .donepanel .dp-s { font-size: 12px; color: var(--ink-3); margin-top: 1px; }

      .quest-page .chain-link { color: var(--jade-deep); font-weight: 600; text-decoration: none; }
      .quest-page .chain-link:hover { text-decoration: underline; }

      /* ── Added interactions: inputs, forms, modals, cheques ── */
      .quest-page .qinput { width: 100%; font-size: 12.5px; border: 1px solid var(--mist-strong); border-radius: 9px; padding: 8px 10px; background: #fff; color: var(--ink); outline: none; }
      .quest-page .qinput:focus { border-color: var(--jade); }
      .quest-page textarea.qinput { resize: vertical; line-height: 1.5; }
      .quest-page .errline { font-size: 11.5px; color: var(--brick); background: var(--brick-soft); border: 1px solid var(--brick-edge); border-radius: 9px; padding: 7px 10px; margin-top: 8px; }
      .quest-page .linkbtn { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--jade-deep); background: none; border: 0; cursor: pointer; padding: 0; }
      .quest-page .linkbtn:hover { text-decoration: underline; }
      .quest-page .mini-btn.is-busy { opacity: .6; }

      /* Additional-docs combobox */
      .quest-page .addwrap { position: relative; }
      .quest-page .addmenu { position: absolute; z-index: 20; margin-top: 4px; width: 100%; background: #fff; border: 1px solid var(--mist-strong); border-radius: 10px; box-shadow: var(--sh-pop); max-height: 224px; overflow: auto; }
      .quest-page .addmenu button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font-size: 12px; padding: 8px 10px; background: none; border: 0; cursor: pointer; color: var(--ink); }
      .quest-page .addmenu button:hover { background: var(--jade-tint); }
      .quest-page .addmenu button.custom { color: var(--jade-deep); font-weight: 700; border-top: 1px solid var(--mist); }

      /* Small on-brand modal (doc reject reason) */
      .quest-page .qmodal-scrim { position: fixed; inset: 0; background: rgba(26,23,20,.32); display: grid; place-items: center; z-index: 60; padding: 20px; }
      .quest-page .qmodal { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); box-shadow: var(--sh-pop); padding: 20px; width: 100%; max-width: 420px; }

      /* Plan editor + cheques panel wrappers */
      .quest-page .planbox, .quest-page .chqbox { border: 1px solid var(--mist-strong); border-radius: var(--r-md); background: var(--surface); padding: 16px; }
      .quest-page .fgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .quest-page .fgrid label, .quest-page .fblock { display: flex; flex-direction: column; gap: 4px; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--mute); margin-bottom: 8px; }
      .quest-page .fgrid label .qinput, .quest-page .fblock .qinput { text-transform: none; letter-spacing: normal; font-weight: 500; }
      .quest-page .discbox { margin-top: 12px; background: var(--saffron-soft); border: 1px solid var(--saffron-edge); border-radius: 12px; padding: 10px 12px; }
      .quest-page .chip { font-size: 11px; font-weight: 700; padding: 5px 10px; border-radius: 9px; border: 1px solid var(--mist-strong); background: #fff; color: var(--ink-2); cursor: pointer; }
      .quest-page .chip.on { background: var(--saffron-deep); color: #fff; border-color: var(--saffron-deep); }

      .quest-page .schedrow { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid var(--mist-strong); border-radius: 9px; padding: 7px 10px; }
      .quest-page .schedrow .sq { font-size: 11px; font-weight: 800; color: var(--jade-deep); flex-shrink: 0; }
      .quest-page .schedrow .sl { flex: 1; min-width: 0; font-size: 11.5px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; }
      .quest-page .schedrow .sl b { color: var(--ink); }
      .quest-page .schedrow .sa { font-size: 11.5px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; flex-shrink: 0; }
      .quest-page .schedrow .sd { width: 140px; flex-shrink: 0; }

      /* Customer-upload cheque rows */
      .quest-page .uprow { display: flex; gap: 11px; background: #fff; border: 1px solid var(--mist-strong); border-radius: 12px; padding: 10px; }
      .quest-page .uprow .upthumb { width: 52px; height: 52px; border-radius: 9px; border: 1px solid var(--mist-strong); overflow: hidden; background: var(--surface); display: grid; place-items: center; cursor: pointer; flex-shrink: 0; color: var(--mute); }
      .quest-page .uprow .upthumb:disabled { cursor: default; }
      .quest-page .uprow .upthumb img { width: 100%; height: 100%; object-fit: cover; }
      .quest-page .uprow .upmeta { flex: 1; min-width: 0; }
      .quest-page .uprow .upmeta .dn { font-size: 12.5px; font-weight: 700; color: var(--ink); }
      .quest-page .uprow .upmeta .ds { font-size: 11px; color: var(--mute); margin-top: 1px; }
      .quest-page .uprow .upctl { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; }
    `}</style>
  );
}
