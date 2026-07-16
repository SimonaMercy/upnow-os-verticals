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
import type { ReceiptContract } from '@/components/upnow/PaymentReceiptPdf';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';
import { SecureDocCanvas } from '@/components/upnow/SecureDocCanvas';
import { canRoleDownloadDocs } from '@/lib/docViewer';
import { useAuth } from '@/contexts/AuthContext';
import { ContractSignBar } from '@/components/upnow/ContractSignBar';
import { DownloadDocButton } from '@/components/upnow/DownloadDocButton';
import { DownloadDocsButton, fetchStoredDocBytes, type MergeDocItem, type MergePart } from '@/components/upnow/DownloadDocsPopup';
import { PaymentPlanCard } from '@/components/upnow/PaymentPlanCard';
import { buildCurrentPlan, type PlanContract, type PlanPayment } from '@/lib/currentPlan';
import { segRowsFromContract } from '@/lib/segregatedPlan';
import ds from './ContractDocsBinder.module.css';

// Generated tenancy artifacts (NOT uploaded KYC/ID) are the counterparty's own
// documents and get a clean, watermark-free "Download PDF" — the stored snapshot.
const DOWNLOADABLE_ARTIFACT_KEYS = new Set(['move_in_report', 'move_out_report', 'deposit_settlement']);

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
const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?)$/.test((url || '').toLowerCase().split('?')[0]);

const isEid = (d: BinderDoc) => /emirates_?id|(^|_)eid(_|$)/.test(norm(d.documentKey));
const isPassport = (d: BinderDoc) => norm(d.documentKey).includes('passport');
const isVisa = (d: BinderDoc) => norm(d.documentKey).includes('visa');
const isLicense = (d: BinderDoc) => /trade_license|business_license|(^|_)licen[cs]e(_|$)/.test(norm(d.documentKey));
const isIdentity = (d: BinderDoc) => isEid(d) || isPassport(d) || isVisa(d);
const isOccupant = (d: BinderDoc) => /occupant/.test(norm(d.documentKey)) || /occupant/i.test(d.displayName || '');
const isDependant = (d: BinderDoc) => /depend[ae]nt/.test(norm(d.documentKey)) || /depend[ae]nt/i.test(d.displayName || '');
const occNum = (d: BinderDoc) => { const m = norm(d.documentKey).match(/occupant_?(\d+)/); return m ? Number(m[1]) : 1; };
const idRank = (d: BinderDoc) => (isEid(d) ? 0 : isPassport(d) ? 1 : isVisa(d) ? 2 : isLicense(d) ? 3 : 4);
// A person has ONE Emirates ID (its front — plus a back only if a separate back
// was uploaded), ONE Passport and ONE Visa. The same identity doc, though, gets
// uploaded repeatedly — into the per-customer KYC store AND this lease's contract
// store, and a passport can arrive as both `passport` and `passport_2` (same doc,
// two captures) — so without collapsing them a tenant looks like they have 2-3× of
// each. We key each doc by its logical SLOT (type + side) and keep ONE per slot.
//   • Side matters only for the EID: an explicit BACK is its own slot, and so is
//     an `emirates_id_2` — the EID is a two-sided card, so a second capture IS the
//     back (unlike `passport_2`, a re-capture of the same photo page). A bare
//     `emirates_id` and an `emirates_id_front` are the same (front) side.
//   • Occupant docs keep their occupant number so occupants never merge together.
const idBaseKey = (d: BinderDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
const isEidBack = (d: BinderDoc) => /(^|_)back(_|$)/.test(idBaseKey(d)) || /_2$/.test(idBaseKey(d));
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
  : isLicense(d) ? 'Trade Licence'
  : (d.displayName ?? d.documentKey.replace(/_/g, ' '));

const cardCss: React.CSSProperties = { border: '1px solid #e3e0d9', borderRadius: 12, overflow: 'hidden', marginBottom: 16, background: '#fff' };
const capCss: React.CSSProperties = { padding: '9px 13px', fontSize: 12.5, fontWeight: 700, color: '#1a1916', background: '#faf9f7', borderBottom: '1px solid #efece6' };
const chip: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 999, border: '1px solid #dcd8d0', background: '#fff', color: '#4a4742', cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto', lineHeight: 1.3 };
const JUMP_OFFSET = 88;

function SecurePreview({ url, caption, watermark, docId, canDownload, portalToken }: {
  url: string;
  caption: string;
  watermark: string;
  /** documents-table id — enables the per-document Download control when allowed. */
  docId?: number | null;
  /** True for logged-in landlord / manager / admin (never the magic-link portal). */
  canDownload?: boolean;
  portalToken?: string | null;
}) {
  const downloadable = canDownload && docId != null;
  return (
    <div style={cardCss}>
      <div style={{ ...capCss, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caption}</span>
        {downloadable && (
          <DownloadDocButton
            documentId={docId!}
            portalToken={portalToken}
            label="Download"
            title="Download this document"
            style={{ ...linkBtnGhost, padding: '3px 10px', fontSize: 11.5, flex: '0 0 auto' }}
          />
        )}
      </div>
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
  /** RP reconciliation references — plan number + per-payment receipt numbers. */
  paymentRefs?: import('@/lib/paymentRefs').PaymentRefs | null;
  /** When provided, the Receipts slot renders; null/omitted hides it. */
  receipt?: ReceiptContract | null;
  watermark: string;
  /** No-login magic-link token → stored-artifact downloads use the token-scoped
   *  endpoint. Omitted (authed RP/manager) → the JWT /documents endpoint. */
  portalToken?: string | null;
  /** Certificate-of-completion data (GET /contracts/:id/signature-certificate).
   *  When provided AND signatures exist, a "Signature certificate" PDF joins the
   *  download list — the DocuSign-style evidence record for this contract. */
  signatureCertificate?: import('@/components/upnow/SignatureCertificatePdf').SignatureCertificateData | null;
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
  const { refLabel, contractType, ended, documents, tenant, ejari, addendums = [], planContract, planPayments, paymentRefs, receipt, watermark, portalToken, signatureCertificate, headerRight, signerName, signerDefaultName, landlordSigned, onSign } = props;
  // Per-document download is offered to the logged-in landlord / manager / admin
  // only — never on the no-login magic-link portal (KYC stays locked there). Each
  // download streams the clean file via /documents/:id/download, which records the
  // download in the audit log (rp.document.download).
  const { user } = useAuth();
  const canDownloadDocs = !portalToken && canRoleDownloadDocs(user?.role);
  const planRefNo = paymentRefs?.planRefNo ?? null;
  // Enrich the receipt contract so per-payment receipts print their real gapless
  // number and the plan number (see PaymentReceiptPdf).
  const receiptWithRefs = receipt ? { ...receipt, paymentRefs: paymentRefs ?? null } : receipt;

  // A company tenant's trade licence is its identity document (the corporate
  // equivalent of an individual's Emirates ID) — it belongs in the left "Tenant
  // & KYC" pane, not the generic "Other documents" bucket.
  const isCompanyTenant = !!(tenant.companyName || tenant.licenseNumber);
  const isKyc = (d: BinderDoc) => isIdentity(d) || (isCompanyTenant && isLicense(d));

  const all = documents.filter(d => !!d.fileUrl && !isDependant(d));
  const matchDocs = (key: string): BinderDoc[] => {
    const accepted = [key, ...(KEY_ALIASES[key] ?? [])];
    const base = (d: BinderDoc) => norm(d.documentKey).replace(/_\d{10,}$/, '');
    return all.filter(d => !isKyc(d) && !isOccupant(d) && (accepted.includes(base(d)) || accepted.includes(norm(d.displayName)))).sort((a, b) => b.id - a.id);
  };
  const isRenewal = contractType === 'renewal';
  const currentPlan = buildCurrentPlan(planContract, planPayments);
  // Raw rows for the segregated Payment Plan PDF (Security Deposit · Rental Income ·
  // Management Fee · Third Party) — shared by the download and the on-screen card.
  const planRows = segRowsFromContract(planContract, planPayments);
  const hasPlan = currentPlan.rentFils > 0 || currentPlan.items.length > 0;
  const showReceipts = receipt != null;
  const hasReceiptData = planPayments.length > 0 || (planContract.fees?.length ?? 0) > 0;

  // RIGHT column order.
  const seq: Slot[] = [
    { kind: 'plan' },
    { kind: 'doc', key: 'payment_advice', label: 'Payment Advice' },
    ...(showReceipts ? [{ kind: 'receipts' } as Slot] : []),
    { kind: 'agreement' },
    { kind: 'doc', key: 'ejari_certificate', label: 'Contract Registration Certificate' },
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
  const primaryId = dedupeIdentity(all.filter(d => isKyc(d) && !isOccupant(d))).sort((a, b) => idRank(a) - idRank(b) || a.id - b.id);
  const occDocs = dedupeIdentity(all.filter(d => isIdentity(d) && isOccupant(d)));
  const occGroups = Array.from(new Set(occDocs.map(occNum))).sort((a, b) => a - b)
    .map(n => ({ n, docs: occDocs.filter(d => occNum(d) === n).sort((a, b) => idRank(a) - idRank(b) || a.id - b.id) }));

  const seqIds = new Set(seq.flatMap(s => (s.kind === 'doc' ? matchDocs(s.key).map(d => d.id) : [])));
  // Renewals drop the salary-certificate slot (income re-verification lives on the
  // original lease) — also drop any uploaded salary cert so it doesn't resurface
  // under "Other documents". Same for move-in docs: the move-in happened on the
  // ORIGINAL lease (customer-scoped `move_in_form` rows travel with every contract
  // of the tenant), so a renewal never shows one.
  const isSalaryDoc = (d: BinderDoc) => /salary/.test(norm(d.documentKey)) || /salary/i.test(d.displayName || '');
  const isMoveInDoc = (d: BinderDoc) => /move_?in/.test(norm(d.documentKey)) || /move[ -]?in/i.test(d.displayName || '');
  const leftover = all.filter(d => !isKyc(d) && !isOccupant(d) && !seqIds.has(d.id) && !(isRenewal && (isSalaryDoc(d) || isMoveInDoc(d))));

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

  // ── "Download documents" popup — everything AVAILABLE on this page, in page
  // order, so the user can tick a selection and save it as ONE combined PDF.
  // Generated documents (plan / receipts / agreement) build their bytes with the
  // same generators the inline previews use; stored uploads stream through the
  // same-origin /documents/:id/file proxy. Authenticated surfaces only — the
  // magic-link portal has no JWT for the byte proxy.
  const reactPdfBytes = async (blob: Blob): Promise<MergePart[]> =>
    [{ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'application/pdf' }];
  const storedItem = (label: string, group: string, docs: BinderDoc[]): MergeDocItem => ({
    id: `s-${docs.map(d => d.id).join('-')}`,
    label,
    group,
    count: docs.length,
    make: () => Promise.all(docs.map(d => fetchStoredDocBytes(d.id))),
  });
  const downloadItems: MergeDocItem[] = [];
  for (const s of seq) {
    if (s.kind === 'plan') {
      if (!hasPlan) continue;
      downloadItems.push({
        id: 'g-plan', label: 'Payment plan', group: 'Rental documents',
        make: async () => {
          const [{ pdf }, { PaymentPlanDoc }] = await Promise.all([import('@react-pdf/renderer'), import('@/components/upnow/PaymentPlanPdf')]);
          return reactPdfBytes(await pdf(
            <PaymentPlanDoc rows={planRows} refLabel={refLabel} planRefNo={planRefNo} meta={{
              contractType, tenantName: tenant.companyName || tenant.name,
              landlordName: ejari.landlord?.bankAccountName || ejari.landlord?.companyName || ejari.landlord?.name,
              unitNumber: ejari.unit?.number, buildingName: ejari.property?.buildingName,
              community: ejari.property?.community || ejari.property?.emirate,
              periodStart: ejari.startDate, periodEnd: ejari.endDate,
            }} />,
          ).toBlob());
        },
      });
    } else if (s.kind === 'receipts') {
      if (!hasReceiptData || !receipt) continue;
      downloadItems.push({
        id: 'g-receipts', label: 'Receipts', group: 'Rental documents',
        make: async () => {
          const [{ pdf }, { PaymentReceiptDoc }] = await Promise.all([import('@react-pdf/renderer'), import('@/components/upnow/PaymentReceiptPdf')]);
          return reactPdfBytes(await pdf(<PaymentReceiptDoc contract={receiptWithRefs as ReceiptContract} kind="all" selectedId={null} selectedIdx={0} />).toBlob());
        },
      });
    } else if (s.kind === 'agreement') {
      downloadItems.push({
        id: 'g-agreement', label: 'Agreement (tenancy contract)', group: 'Rental documents',
        make: async () => {
          const { isDubaiContract, fillEjariPdf } = await import('@/lib/ejariFill');
          if (isDubaiContract(ejari)) return [{ bytes: await fillEjariPdf(ejari, addendums), mime: 'application/pdf' }];
          const [{ pdf }, { EjariContractDoc }] = await Promise.all([import('@react-pdf/renderer'), import('@/components/contract/EjariContractPdf')]);
          return reactPdfBytes(await pdf(<EjariContractDoc data={ejari} addendums={addendums} />).toBlob());
        },
      });
    } else {
      const docs = matchDocs(s.key);
      if (docs.length) downloadItems.push(storedItem(s.label, 'Rental documents', docs));
    }
  }
  // Signature certificate — the contract's certificate of completion (who signed,
  // from where, on what device, with what consent + the envelope event trail).
  if (signatureCertificate && signatureCertificate.signatures.length > 0) {
    const certData = signatureCertificate;
    downloadItems.push({
      id: 'g-signature-cert', label: 'Signature certificate (audit trail)', group: 'Rental documents',
      make: async () => {
        const [{ pdf }, { SignatureCertificateDoc }] = await Promise.all([import('@react-pdf/renderer'), import('@/components/upnow/SignatureCertificatePdf')]);
        return reactPdfBytes(await pdf(<SignatureCertificateDoc data={certData} refLabel={refLabel} />).toBlob());
      },
    });
  }
  // Loose uploaded extras are offered under their own group (mirroring the page's
  // "Other documents" section) but arrive UNTICKED — the default selection is the
  // canonical binder set; the extras are one click away when wanted. Their own
  // group also keeps an uploaded scan named "Agreement" from sitting confusingly
  // next to the GENERATED "Agreement (tenancy contract)".
  for (const d of leftover) downloadItems.push({ ...storedItem(d.displayName ?? d.documentKey.replace(/_/g, ' '), 'Other documents (uploaded)', [d]), preselected: false });
  for (const d of primaryId) downloadItems.push(storedItem(idLabel(d), 'Tenant & KYC', [d]));
  for (const g of occGroups) for (const d of g.docs) downloadItems.push(storedItem(`Occupant ${g.n} — ${idLabel(d)}`, 'Tenant & KYC', [d]));

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f4f3ef', display: 'flex', flexDirection: 'column' }}>
      <header style={{ flexShrink: 0, padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e3e0d9', display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 6, gap: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#1a1916' }}>All documents</span>
        <span style={{ fontSize: 12.5, color: '#9b9890' }}>{refLabel}</span>
        {!canDownloadDocs && <span style={{ fontSize: 11, color: '#9b9890' }}>· View only</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {!portalToken && downloadItems.length > 0 && (
            <DownloadDocsButton items={downloadItems} fileName={`Documents-${(refLabel || 'contract').replace(/[^\w.-]+/g, '-')}.pdf`} style={linkBtnGhost} />
          )}
          {headerRight}
        </div>
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
                  <SecurePreview url={d.fileUrl} caption={idLabel(d)} watermark={watermark} docId={d.id} canDownload={canDownloadDocs} portalToken={portalToken} />
                </div>
              ))}
          {occGroups.map(g => (
            <div key={'occ' + g.n} id={`l-occ-${g.n}`} style={{ scrollMarginTop: JUMP_OFFSET }}>
              <SectionTitle>{occGroups.length > 1 ? `Occupant ${g.n}` : 'Occupant'}</SectionTitle>
              {g.docs.map(d => (
                <SecurePreview key={'occ' + d.id} url={d.fileUrl} caption={idLabel(d)} watermark={watermark} docId={d.id} canDownload={canDownloadDocs} portalToken={portalToken} />
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
            if (s.kind === 'plan') inner = hasPlan ? <PaymentPlanCard plan={currentPlan} rows={planRows} refLabel={refLabel} planRefNo={planRefNo} contractType={contractType} tenantName={tenant.companyName || tenant.name} landlordName={ejari.landlord?.bankAccountName || ejari.landlord?.companyName || ejari.landlord?.name} unitNumber={ejari.unit?.number} buildingName={ejari.property?.buildingName} community={ejari.property?.community || ejari.property?.emirate} periodStart={ejari.startDate} periodEnd={ejari.endDate} /> : <Missing label="Payment plan" />;
            else if (s.kind === 'receipts') inner = hasReceiptData
              ? <Block label="Receipts"><ReceiptInline contract={receiptWithRefs as ReceiptContract} height={FULL} showDownload /></Block>
              : <Missing label="Receipts" />;
            else if (s.kind === 'agreement') inner = <Block label="Agreement"><EjariInline data={ejari} addendums={addendums} height={FULL} showDownload /></Block>;
            else {
              const docs = matchDocs(s.key);
              if (!docs.length) {
                if (s.optional) return null;
                inner = s.pending ? <PendingLink label={s.label} /> : <Missing label={s.label} />;
              } else {
                // Generated artifacts (move-in/out report, settlement) → clean download
                // of the stored snapshot; uploaded KYC/other docs stay view-only.
                // Generated artifacts already get a single block-level Download PDF
                // (below); everything else gets a per-document Download inline.
                const perDocDownload = canDownloadDocs && !DOWNLOADABLE_ARTIFACT_KEYS.has(s.key);
                const previews = docs.map((d, i) => <SecurePreview key={s.key + d.id} url={d.fileUrl} caption={`${s.label}${docs.length > 1 ? ` · ${i + 1} of ${docs.length}` : ''}`} watermark={watermark} docId={d.id} canDownload={perDocDownload} portalToken={portalToken} />);
                inner = DOWNLOADABLE_ARTIFACT_KEYS.has(s.key)
                  ? <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                        <DownloadDocButton documentId={docs[0].id} portalToken={portalToken} style={{ ...linkBtnGhost, textDecoration: 'none' }} />
                      </div>
                      {previews}
                    </>
                  : previews;
              }
            }
            return <div key={slotId(s)} id={slotId(s)} style={{ scrollMarginTop: JUMP_OFFSET }}>{inner}</div>;
          })}
          {leftover.length > 0 && (
            <div id="r-other" style={{ scrollMarginTop: JUMP_OFFSET }}>
              {leftover.map(d => (
                <SecurePreview key={'x' + d.id} url={d.fileUrl} caption={d.displayName ?? d.documentKey.replace(/_/g, ' ')} watermark={watermark} docId={d.id} canDownload={canDownloadDocs} portalToken={portalToken} />
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
