'use client';

/**
 * The shared contract "documents binder" — a full-page, two-pane verification +
 * sign surface used in TWO places so they stay identical:
 *   • the RP's authenticated "View all" page (/contracts/:id/documents)
 *   • the landlord's no-login magic-link page (/portal/:token/contract/:id)
 *
 * Layout: LEFT pane (fixed) = the tenant identity card + KYC (Emirates ID ·
 * Passport · UAE Visa, then each occupant); RIGHT pane (scrolls) = the rental /
 * financial documents in order (Payment plan · Payment Advice · Receipts ·
 * Agreement · Ejari, + new-lease extras). Every document renders full-preview on
 * a watermarked <canvas> (no download); the Agreement + Receipts render as
 * stacked canvas pages (no inner scroll). A sticky bar signs as the landlord.
 *
 * Each caller adapts its own data into the props below (the authenticated API vs
 * the token-scoped portal payload), then this component renders the rest.
 */
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FileText } from 'lucide-react';
import type { OfferPlan } from '@/components/upnow/OfferReceiptModal';
import type { ReceiptContract } from '@/components/upnow/PaymentReceiptPdf';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';
import { SecureDocCanvas } from '@/components/upnow/SecureDocCanvas';
import { ContractSignBar } from '@/components/upnow/ContractSignBar';
import { buildCurrentPlan, type PlanContract, type PlanPayment } from '@/lib/currentPlan';
import ds from './ContractDocsBinder.module.css';

const EjariInline = dynamic(() => import('@/components/contract/EjariInline'), {
  ssr: false,
  loading: () => <div style={{ padding: 36, textAlign: 'center', color: '#9b9890', fontSize: 13 }}>Rendering contract…</div>,
});
const ReceiptInline = dynamic(() => import('@/components/upnow/PaymentReceiptPdf').then(m => ({ default: m.ReceiptInline })), {
  ssr: false,
  loading: () => <div style={{ padding: 36, textAlign: 'center', color: '#9b9890', fontSize: 13 }}>Rendering receipts…</div>,
});
const FULL = 100000; // height so the inline canvas never hits its own scroll cap

export interface BinderDoc { id: number; documentKey: string; displayName: string | null; fileUrl: string; category?: string | null; ownerType?: string }

const KEY_ALIASES: Record<string, string[]> = {
  ejari_certificate: ['ejari', 'contract_registration', 'tenancy_contract_registration', 'ejari_registration'],
  payment_advice: ['pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques'],
  utility_registration: ['utility_proof_of_payment', 'utility_proof', 'utility_activation'],
  utility_final_bill: ['final_bill'],
  salary_certificate: ['salary', 'salary_cert', 'salary_slip', 'payslip', 'pay_slip'],
  bank_statement: ['bank', 'bank_statements', 'bank_stmt', 'statement_of_account'],
  marriage_certificate: ['marriage', 'marriage_cert'],
};
const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const aed = (fils: number) => `AED ${Math.round((fils ?? 0) / 100).toLocaleString('en-AE')}`;
const fmtD = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?)$/.test((url || '').toLowerCase().split('?')[0]);

const isEid = (d: BinderDoc) => /emirates_?id|(^|_)eid(_|$)/.test(norm(d.documentKey));
const isPassport = (d: BinderDoc) => norm(d.documentKey).includes('passport');
const isVisa = (d: BinderDoc) => norm(d.documentKey).includes('visa');
const isIdentity = (d: BinderDoc) => isEid(d) || isPassport(d) || isVisa(d);
const isOccupant = (d: BinderDoc) => /occupant/.test(norm(d.documentKey)) || /occupant/i.test(d.displayName || '');
const isDependant = (d: BinderDoc) => /depend[ae]nt/.test(norm(d.documentKey)) || /depend[ae]nt/i.test(d.displayName || '');
const occNum = (d: BinderDoc) => { const m = norm(d.documentKey).match(/occupant_?(\d+)/); return m ? Number(m[1]) : 1; };
const idRank = (d: BinderDoc) => (isEid(d) ? 0 : isPassport(d) ? 1 : isVisa(d) ? 2 : 3);
// A person has ONE Emirates ID (its front — plus a back only if a separate back
// was uploaded), ONE Passport and ONE Visa. The same identity doc, though, gets
// uploaded repeatedly — into the per-customer KYC store AND this lease's contract
// store, and a passport can arrive as both `passport` and `passport_2` (same doc,
// two captures) — so without collapsing them a tenant looks like they have 2-3× of
// each. We key each doc by its logical SLOT (type + side) and keep ONE per slot.
//   • Side matters only for the EID, and only an explicit BACK is its own slot — a
//     bare `emirates_id` and an `emirates_id_front` are the same (front) side.
//   • Occupant docs keep their occupant number so occupants never merge together.
const idBaseKey = (d: BinderDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
const isEidBack = (d: BinderDoc) => /(^|_)back(_|$)/.test(idBaseKey(d));
const idType = (d: BinderDoc) => (isEid(d) ? 'eid' : isPassport(d) ? 'passport' : isVisa(d) ? 'visa' : idBaseKey(d));
const idSlot = (d: BinderDoc) => `${isOccupant(d) ? `occ${occNum(d)}:` : ''}${idType(d)}${isEid(d) && isEidBack(d) ? ':back' : ''}`;
// Within a slot prefer the canonical customer-KYC copy, then the clean-key one
// (no upload-timestamp suffix), then the most recent upload.
const idSourceRank = (d: BinderDoc) => (d.ownerType === 'customer' ? 0 : norm(d.documentKey) === idBaseKey(d) ? 1 : 2);
const dedupeIdentity = (docs: BinderDoc[]): BinderDoc[] => {
  const best = new Map<string, BinderDoc>();
  for (const d of docs) {
    const k = idSlot(d);
    const cur = best.get(k);
    if (!cur || idSourceRank(d) < idSourceRank(cur) || (idSourceRank(d) === idSourceRank(cur) && d.id > cur.id)) best.set(k, d);
  }
  return Array.from(best.values());
};
const idLabel = (d: BinderDoc) =>
  isEid(d) ? (isEidBack(d) ? 'Emirates ID — Back' : 'Emirates ID')
  : isPassport(d) ? 'Passport'
  : isVisa(d) ? 'UAE Visa / Residency'
  : (d.displayName ?? d.documentKey.replace(/_/g, ' '));

const cardCss: React.CSSProperties = { border: '1px solid #e3e0d9', borderRadius: 12, overflow: 'hidden', marginBottom: 16, background: '#fff' };
const capCss: React.CSSProperties = { padding: '9px 13px', fontSize: 12.5, fontWeight: 700, color: '#1a1916', background: '#faf9f7', borderBottom: '1px solid #efece6' };
const schTh: React.CSSProperties = { textAlign: 'left', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9b9890', padding: '0 8px 6px', borderBottom: '1px solid #ece9e3' };
const schTd: React.CSSProperties = { padding: '7px 8px', borderTop: '1px solid #f2efe9', verticalAlign: 'middle' };
const chip: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 999, border: '1px solid #dcd8d0', background: '#fff', color: '#4a4742', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto', lineHeight: 1.3 };
const JUMP_OFFSET = 88;

function SecurePreview({ url, caption, watermark }: { url: string; caption: string; watermark: string }) {
  return (
    <div style={cardCss}>
      <div style={capCss}>{caption}</div>
      <SecureDocCanvas fileUrl={url} isImage={isImageUrl(url)} caption={caption} watermark={watermark} />
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={cardCss}><div style={capCss}>{label}</div>{children}</div>;
}

function Missing({ label }: { label: string }) {
  return (
    <div style={{ border: '1px dashed #d8d4cc', borderRadius: 12, padding: '14px 16px', marginBottom: 16, color: '#9b9890', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
      <FileText size={14} /> {label} — not yet available
    </div>
  );
}

function PendingLink({ label }: { label: string }) {
  return (
    <div style={{ border: '1px dashed #d8d4cc', borderRadius: 12, padding: '14px 16px', marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', color: '#6b6860' }}>
      <FileText size={14} /> {label} — not completed yet
    </div>
  );
}

const PLAN_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  cleared:   { label: 'Cleared',   bg: '#e6f5ee', fg: '#1f6f54' },
  bounced:   { label: 'Bounced',   bg: '#fdece7', fg: '#9a3520' },
  cancelled: { label: 'Cancelled', bg: '#f0ede8', fg: '#6b6860' },
};
const planStatus = (s?: string | null) => PLAN_STATUS[(s ?? '').toLowerCase()] ?? { label: 'Pending', bg: '#fff7ed', fg: '#c2410c' };

function PlanMeta({ label, value, align = 'left' }: { label: string; value?: string | null; align?: 'left' | 'right' }) {
  if (!value) return null;
  return (
    <div style={align === 'right' ? { marginLeft: 'auto', textAlign: 'right' } : undefined}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1a1916' }}>{value}</div>
    </div>
  );
}

function OfferBlock({ plan, unitNumber, buildingName, periodStart, periodEnd }: { plan: OfferPlan; unitNumber?: string | null; buildingName?: string | null; periodStart?: string | null; periodEnd?: string | null }) {
  const lines: { label: string; fils: number }[] = [
    { label: `Annual rent${(plan.rentVatFils ?? 0) > 0 ? ' (incl. VAT)' : ''}`, fils: plan.rentFils + (plan.rentVatFils ?? 0) },
  ];
  if (plan.adminFeeFils > 0) lines.push({ label: 'Admin fee', fils: plan.adminFeeFils + (plan.adminFeeVatFils ?? 0) });
  if (plan.ejariFils > 0) lines.push({ label: 'Ejari fee', fils: plan.ejariFils + (plan.ejariVatFils ?? 0) });
  if (plan.commissionFils > 0) lines.push({ label: 'Commission', fils: plan.commissionFils + (plan.commissionVatFils ?? 0) });
  (plan.customFees ?? []).forEach(f => lines.push({ label: f.label, fils: f.netFils + f.vatFils }));
  if (plan.securityDepositFils > 0) lines.push({ label: 'Security deposit', fils: plan.securityDepositFils });
  const items = [...(plan.items ?? [])].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return (
    <div style={cardCss}>
      <div style={capCss}>Payment plan · current rent, fees &amp; deposit</div>
      {(buildingName || unitNumber || periodStart) && (
        <div style={{ padding: '11px 14px 2px', display: 'flex', flexWrap: 'wrap', gap: '10px 28px' }}>
          <PlanMeta label="Building" value={buildingName} />
          <PlanMeta label="Unit" value={unitNumber} />
          <PlanMeta label="Contract period" align="right" value={periodStart ? `${fmtD(periodStart)} – ${fmtD(periodEnd)}` : null} />
        </div>
      )}
      <div style={{ padding: '12px 14px', display: 'grid', gap: 5 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#334155' }}><span>{l.label}</span><span style={{ fontWeight: 600 }}>{aed(l.fils)}</span></div>
        ))}
        <div style={{ borderTop: '2px solid #c5e8df', margin: '4px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, color: '#15803d' }}><span>Total</span><span>{aed(plan.totalAmountFils)}</span></div>
      </div>
      {items.length > 0 && (
        <div style={{ borderTop: '1px solid #efece6', padding: '10px 14px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', margin: '2px 0 8px' }}>Schedule · {plan.installmentCount} installment{plan.installmentCount === 1 ? '' : 's'}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ color: '#9b9890' }}>
                <th style={{ ...schTh, width: 30, textAlign: 'center' }}>#</th>
                <th style={schTh}>Description</th>
                <th style={{ ...schTh, whiteSpace: 'nowrap' }}>Due date</th>
                <th style={{ ...schTh, textAlign: 'center' }}>Status</th>
                <th style={{ ...schTh, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.index ?? i} style={{ background: i % 2 ? '#faf9f6' : '#fff' }}>
                  <td style={{ ...schTd, textAlign: 'center' }}>
                    <span style={{ display: 'inline-grid', placeItems: 'center', width: 20, height: 20, borderRadius: 6, background: '#eaf5f0', color: '#1f6f54', fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
                  </td>
                  <td style={{ ...schTd, color: '#1a1916' }}>{it.description ?? `Payment ${i + 1}`}</td>
                  <td style={{ ...schTd, color: '#6b6860', whiteSpace: 'nowrap' }}>{fmtD(it.dueDate)}</td>
                  <td style={{ ...schTd, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {(() => { const st = planStatus(it.status); return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>; })()}
                  </td>
                  <td style={{ ...schTd, textAlign: 'right', fontWeight: 700, color: '#1a1916', whiteSpace: 'nowrap' }}>{aed(it.amountFils)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ ...schTd, borderTop: '2px solid #c5e8df', textAlign: 'right', fontWeight: 700, color: '#6b6860' }}>Schedule total</td>
                <td style={{ ...schTd, borderTop: '2px solid #c5e8df', textAlign: 'right', fontWeight: 800, color: '#15803d', whiteSpace: 'nowrap' }}>{aed(items.reduce((s, it) => s + (it.amountFils ?? 0), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', margin: '8px 0 12px' }}>{children}</div>;
}

function QuickNav({ title, items }: { title: string; items: { id: string; label: string }[] }) {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className={ds.quickNav} style={{ position: 'sticky', top: 0, zIndex: 5, background: '#f4f3ef', padding: '14px 0 10px', borderBottom: '1px solid #e7e3dc', marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9b9890', marginBottom: items.length ? 8 : 0 }}>{title}</div>
      {items.length > 0 && (
        <div className={ds.navChips}>
          {items.map(it => <button key={it.id} type="button" onClick={() => go(it.id)} style={chip}>{it.label}</button>)}
        </div>
      )}
    </div>
  );
}

const initials = (name?: string | null) =>
  (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '—';

function TenantCard({ t, isCompany }: { t: { name?: string | null; email?: string | null; phone?: string | null; companyName?: string | null; emiratesId?: string | null; licenseNumber?: string | null }; isCompany: boolean }) {
  const fields: [string, string | null | undefined][] = [
    ['Emirates ID', t.emiratesId],
    [isCompany ? 'Trade licence' : 'Company', isCompany ? t.licenseNumber : t.companyName],
    ['Phone', t.phone],
    ['Email', t.email],
  ];
  const rows = fields.filter(([, v]) => v && String(v).trim());
  const title = t.companyName || t.name || 'Tenant';
  return (
    <div style={{ ...cardCss, borderColor: '#cfe7dd' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'linear-gradient(180deg,#f4faf7,#fff)', borderBottom: '1px solid #eef4f1' }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: '#2e9f82', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16, flexShrink: 0 }}>{initials(title)}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: '#1a1916', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: 11.5, color: '#6b6860' }}>{isCompany ? 'Corporate tenant' : 'Individual tenant'} · verify against the documents below</div>
        </div>
      </div>
      {rows.length > 0 && (
        <div style={{ padding: '10px 16px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#9b9890' }}>{k}</div>
              <div style={{ fontSize: 13, color: '#1a1916', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(v)}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 8, border: '1px solid #2e9f82', background: '#2e9f82', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' };
const linkBtnGhost: React.CSSProperties = { ...linkBtn, background: '#fff', color: '#1f6f54' };

/** Generates + copies the no-login landlord signing link from the binder header
 *  (authenticated RP only). */
export function LandlordLinkButton({ tenantId, contractId }: { tenantId: number; contractId: number }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const gen = async () => {
    setState('sending');
    try {
      const res = await fetch('/api/portal/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, contractId, purpose: 'contract', signerRole: 'landlord' }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setLink(d.link ?? ''); setState('done');
      if (d.link) { try { await navigator.clipboard.writeText(d.link); setCopied(true); } catch { /* ignore */ } }
    } catch { setState('error'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };
  if (state === 'done' && link) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <input readOnly value={link} onFocus={e => e.currentTarget.select()}
          style={{ width: 230, fontSize: 11, padding: '5px 8px', border: '1px solid #e3e0d9', borderRadius: 8, background: '#fafaf8', color: '#1a1916' }} />
        <button onClick={copy} style={linkBtnGhost}>{copied ? 'Copied ✓' : 'Copy'}</button>
        <a href={link} target="_blank" rel="noreferrer" style={{ ...linkBtnGhost, textDecoration: 'none' }}>Open ↗</a>
      </span>
    );
  }
  return (
    <button onClick={gen} disabled={state === 'sending'} style={linkBtn} title="Generate a no-login link for the landlord to review every document & sign as the lessor">
      {state === 'sending' ? 'Generating…' : state === 'error' ? 'Retry' : 'Send landlord signing link'}
    </button>
  );
}

export interface ContractDocsBinderProps {
  refLabel: string;
  contractType?: string | null;
  /** Lease is ending (terminated / vacating) → show move-out artifacts. */
  ended?: boolean;
  documents: BinderDoc[];
  tenant: { name?: string | null; email?: string | null; phone?: string | null; companyName?: string | null; emiratesId?: string | null; licenseNumber?: string | null };
  ejari: EjariContractData;
  addendums?: EjariAddendum[];
  planContract: PlanContract;
  planPayments: PlanPayment[];
  /** When provided, the Receipts slot renders; null/omitted hides it. */
  receipt?: ReceiptContract | null;
  watermark: string;
  headerRight?: React.ReactNode;
  signerName: string;
  signerDefaultName: string;
  landlordSigned: boolean;
  onSign: (p: { signatureImage: string; signatoryName: string }) => Promise<void>;
}

type Slot =
  | { kind: 'plan' }
  | { kind: 'receipts' }
  | { kind: 'agreement' }
  | { kind: 'doc'; key: string; label: string; pending?: boolean; optional?: boolean };

export function ContractDocsBinder(props: ContractDocsBinderProps) {
  const { refLabel, contractType, ended, documents, tenant, ejari, addendums = [], planContract, planPayments, receipt, watermark, headerRight, signerName, signerDefaultName, landlordSigned, onSign } = props;

  const all = documents.filter(d => !!d.fileUrl && !isDependant(d));
  const matchDocs = (key: string): BinderDoc[] => {
    const accepted = [key, ...(KEY_ALIASES[key] ?? [])];
    const base = (d: BinderDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
    return all.filter(d => !isIdentity(d) && !isOccupant(d) && (accepted.includes(base(d)) || accepted.includes(norm(d.displayName)))).sort((a, b) => b.id - a.id);
  };
  const isRenewal = contractType === 'renewal';
  const currentPlan = buildCurrentPlan(planContract, planPayments);
  const hasPlan = currentPlan.rentFils > 0 || currentPlan.items.length > 0;
  const showReceipts = receipt != null;
  const hasReceiptData = planPayments.length > 0 || (planContract.fees?.length ?? 0) > 0;

  // RIGHT column order.
  const seq: Slot[] = [
    { kind: 'plan' },
    { kind: 'doc', key: 'payment_advice', label: 'Payment Advice' },
    ...(showReceipts ? [{ kind: 'receipts' } as Slot] : []),
    { kind: 'agreement' },
    { kind: 'doc', key: 'ejari_certificate', label: 'Ejari' },
  ];
  if (!isRenewal) {
    seq.push({ kind: 'doc', key: 'utility_registration', label: 'Utility Proof of Payment' });
    seq.push({ kind: 'doc', key: 'salary_certificate', label: 'Salary Certificate' });
    seq.push({ kind: 'doc', key: 'bank_statement', label: 'Bank Statement' });
    seq.push({ kind: 'doc', key: 'marriage_certificate', label: 'Marriage Certificate', optional: true });
  }
  if (ended) {
    seq.push({ kind: 'doc', key: 'move_out_report', label: 'Move-out', pending: true });
    seq.push({ kind: 'doc', key: 'utility_final_bill', label: 'Utility Final Bill' });
    seq.push({ kind: 'doc', key: 'deposit_settlement', label: 'Final Settlement', pending: true });
  }

  // LEFT column — primary tenant identity first, then occupants. Dedupe across
  // owner scopes so the same EID/passport/visa stored on both the customer KYC
  // record and this lease's contract record renders once (see dedupeIdentity).
  const primaryId = dedupeIdentity(all.filter(d => isIdentity(d) && !isOccupant(d))).sort((a, b) => idRank(a) - idRank(b) || a.id - b.id);
  const occDocs = dedupeIdentity(all.filter(d => isIdentity(d) && isOccupant(d)));
  const occGroups = Array.from(new Set(occDocs.map(occNum))).sort((a, b) => a - b)
    .map(n => ({ n, docs: occDocs.filter(d => occNum(d) === n).sort((a, b) => idRank(a) - idRank(b) || a.id - b.id) }));

  const seqIds = new Set(seq.flatMap(s => (s.kind === 'doc' ? matchDocs(s.key).map(d => d.id) : [])));
  // Renewals drop the salary-certificate slot (income re-verification lives on the
  // original lease) — also drop any uploaded salary cert so it doesn't resurface
  // under "Other documents".
  const isSalaryDoc = (d: BinderDoc) => /salary/.test(norm(d.documentKey)) || /salary/i.test(d.displayName || '');
  const leftover = all.filter(d => !isIdentity(d) && !isOccupant(d) && !seqIds.has(d.id) && !(isRenewal && isSalaryDoc(d)));

  const rightLabel = (s: Slot) => s.kind === 'plan' ? 'Payment plan' : s.kind === 'receipts' ? 'Receipts' : s.kind === 'agreement' ? 'Agreement' : s.label;
  const slotId = (s: Slot) => s.kind === 'doc' ? `r-${s.key}` : `r-${s.kind}`;
  const leftNav = [
    ...primaryId.map(d => ({ id: `l-${d.id}`, label: idLabel(d) })),
    ...occGroups.map(g => ({ id: `l-occ-${g.n}`, label: occGroups.length > 1 ? `Occupant ${g.n}` : 'Occupant' })),
  ];
  const rightNav = [
    ...seq.filter(s => !(s.kind === 'doc' && s.optional && matchDocs(s.key).length === 0)).map(s => ({ id: slotId(s), label: rightLabel(s) })),
    ...(leftover.length ? [{ id: 'r-other', label: 'Other documents' }] : []),
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f4f3ef', display: 'flex', flexDirection: 'column' }}>
      <header style={{ flexShrink: 0, padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e3e0d9', display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 6, gap: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#1a1916' }}>All documents</span>
        <span style={{ fontSize: 12.5, color: '#9b9890' }}>{refLabel}</span>
        <span style={{ fontSize: 11, color: '#9b9890' }}>· View only</span>
        {headerRight && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{headerRight}</div>}
      </header>

      <div className={ds.body}>
        {/* LEFT — tenant identity + KYC. On desktop a fixed scrolling pane; on
            mobile the first block of the single top-to-bottom scroll. */}
        <section className={`${ds.pane} ${ds.paneLeft}`}>
          <QuickNav title="Tenant &amp; KYC" items={leftNav} />
          <TenantCard t={tenant} isCompany={!!(tenant.companyName || tenant.licenseNumber)} />
          {primaryId.length === 0 ? <p style={{ fontSize: 13, color: '#9b9890' }}>No identity documents on file.</p>
            : primaryId.map(d => (
                <div key={'id' + d.id} id={`l-${d.id}`} style={{ scrollMarginTop: JUMP_OFFSET }}>
                  <SecurePreview url={d.fileUrl} caption={idLabel(d)} watermark={watermark} />
                </div>
              ))}
          {occGroups.map(g => (
            <div key={'occ' + g.n} id={`l-occ-${g.n}`} style={{ scrollMarginTop: JUMP_OFFSET }}>
              <SectionTitle>{occGroups.length > 1 ? `Occupant ${g.n}` : 'Occupant'}</SectionTitle>
              {g.docs.map(d => (
                <SecurePreview key={'occ' + d.id} url={d.fileUrl} caption={idLabel(d)} watermark={watermark} />
              ))}
            </div>
          ))}
        </section>

        {/* RIGHT — rental / financial documents. Desktop: its own scrolling
            pane; mobile: continues the single scroll below Tenant & KYC. */}
        <section className={`${ds.pane} ${ds.paneRight}`}>
          <QuickNav title="Rental documents · in order" items={rightNav} />
          {seq.map(s => {
            let inner: React.ReactNode;
            if (s.kind === 'plan') inner = hasPlan ? <OfferBlock plan={currentPlan} unitNumber={ejari.unit?.number} buildingName={ejari.property?.buildingName} periodStart={ejari.startDate} periodEnd={ejari.endDate} /> : <Missing label="Payment plan" />;
            else if (s.kind === 'receipts') inner = hasReceiptData
              ? <Block label="Receipts"><ReceiptInline contract={receipt as ReceiptContract} height={FULL} /></Block>
              : <Missing label="Receipts" />;
            else if (s.kind === 'agreement') inner = <Block label="Agreement"><EjariInline data={ejari} addendums={addendums} height={FULL} /></Block>;
            else {
              const docs = matchDocs(s.key);
              if (!docs.length) {
                if (s.optional) return null;
                inner = s.pending ? <PendingLink label={s.label} /> : <Missing label={s.label} />;
              } else {
                inner = docs.map((d, i) => <SecurePreview key={s.key + d.id} url={d.fileUrl} caption={`${s.label}${docs.length > 1 ? ` · ${i + 1} of ${docs.length}` : ''}`} watermark={watermark} />);
              }
            }
            return <div key={slotId(s)} id={slotId(s)} style={{ scrollMarginTop: JUMP_OFFSET }}>{inner}</div>;
          })}
          {leftover.length > 0 && (
            <div id="r-other" style={{ scrollMarginTop: JUMP_OFFSET }}>
              {leftover.map(d => (
                <SecurePreview key={'x' + d.id} url={d.fileUrl} caption={d.displayName ?? d.documentKey.replace(/_/g, ' ')} watermark={watermark} />
              ))}
            </div>
          )}
        </section>
      </div>

      <ContractSignBar
        signerRole="Landlord"
        signerName={signerName}
        defaultName={signerDefaultName}
        alreadySigned={landlordSigned}
        onSign={onSign}
        reviewNote="You've reviewed every document above."
      />
    </div>
  );
}
